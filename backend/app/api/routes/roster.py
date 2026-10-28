"""
Roster API — versioned, approval workflow, validation before save.
Stage C — gated by policy confirmation.
"""
from __future__ import annotations

from datetime import date as date_type
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.auth.dependencies import get_current_user, require_roles
from app.db.database import get_db
from app.models.models import (
    Roster, RosterAssignment, RosterStatus, ShiftCode, User, UserRoleEnum,
    Staff, DutyMaster, RotationRule, PolicyStatus
)
from app.services.audit import log_event, AuditAction
from app.services.availability import compute_staff_status

router = APIRouter(prefix="/rosters", tags=["Roster"])


class AssignmentIn(BaseModel):
    duty_master_id: int
    staff_id: int
    sector_id: Optional[int] = None
    notes: Optional[str] = None


class RosterCreate(BaseModel):
    roster_date: date_type
    shift_code: ShiftCode
    change_reason: Optional[str] = None
    assignments: List[AssignmentIn] = []


class RosterOut(BaseModel):
    id: int
    roster_date: date_type
    shift_code: str
    version: int
    status: str
    change_reason: Optional[str]
    is_demo_policy: bool
    created_at: str

    class Config:
        from_attributes = True


async def _get_active_rotation_policy(db: AsyncSession) -> Optional[RotationRule]:
    result = await db.execute(
        select(RotationRule)
        .order_by(RotationRule.id.desc())
        .limit(1)
    )
    rule = result.scalar_one_or_none()
    if rule and rule.policy_status in (PolicyStatus.CONFIRMED, PolicyStatus.DEMO_SIMULATED):
        return rule
    return None


@router.get("/", response_model=List[RosterOut])
async def list_rosters(
    roster_date: Optional[date_type] = Query(None),
    shift_code: Optional[ShiftCode] = Query(None),
    roster_status: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Roster)
    if roster_date:
        query = query.where(Roster.roster_date == roster_date)
    if shift_code:
        query = query.where(Roster.shift_code == shift_code)
    if roster_status:
        query = query.where(Roster.status == roster_status)

    # Staff can only see published rosters
    if current_user.role == UserRoleEnum.STAFF:
        query = query.where(Roster.status == RosterStatus.PUBLISHED)

    result = await db.execute(query.order_by(Roster.roster_date.desc(), Roster.version.desc()))
    rosters = result.scalars().all()

    return [
        RosterOut(
            id=r.id,
            roster_date=r.roster_date,
            shift_code=r.shift_code.value,
            version=r.version,
            status=r.status.value,
            change_reason=r.change_reason,
            is_demo_policy=r.is_demo_policy,
            created_at=r.created_at.isoformat(),
        )
        for r in rosters
    ]


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_roster_draft(
    payload: RosterCreate,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new draft roster. If an existing version exists for date+shift,
    increments the version. Previous versions are preserved.
    Policy gate: rotation policy must be at least demo-simulated.
    """
    policy = await _get_active_rotation_policy(db)
    is_demo_policy = False

    if not policy:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Roster creation is gated on policy confirmation. "
                "An SHO must confirm or demo-simulate the rotation/rest policy before drafting operational rosters."
            ),
        )
    if policy.policy_status == PolicyStatus.DEMO_SIMULATED:
        is_demo_policy = True

    # Determine next version
    result = await db.execute(
        select(Roster)
        .where(and_(Roster.roster_date == payload.roster_date, Roster.shift_code == payload.shift_code))
        .order_by(Roster.version.desc())
        .limit(1)
    )
    latest = result.scalar_one_or_none()
    new_version = (latest.version + 1) if latest else 1

    roster = Roster(
        roster_date=payload.roster_date,
        shift_code=payload.shift_code,
        version=new_version,
        status=RosterStatus.DRAFT,
        change_reason=payload.change_reason,
        prepared_by_id=current_user.id,
        is_demo_policy=is_demo_policy,
    )
    db.add(roster)
    await db.flush()

    # Validate and add assignments
    warnings = []
    for asn in payload.assignments:
        validation_warnings = await _validate_assignment(db, asn, payload.roster_date, payload.shift_code, roster.id)
        warnings.extend(validation_warnings)

        assignment = RosterAssignment(
            roster_id=roster.id,
            duty_master_id=asn.duty_master_id,
            staff_id=asn.staff_id,
            sector_id=asn.sector_id,
            notes=asn.notes,
        )
        db.add(assignment)

    await log_event(db, actor=current_user, action=AuditAction.ROSTER_CREATED, entity_type="Roster",
                    entity_id=roster.id,
                    new_values={"date": str(payload.roster_date), "shift": payload.shift_code.value, "version": new_version})
    await db.commit()
    await db.refresh(roster)

    return {
        "id": roster.id,
        "version": roster.version,
        "status": roster.status.value,
        "is_demo_policy": roster.is_demo_policy,
        "warnings": warnings,
        "message": "Draft created. Review warnings before submitting for approval.",
    }


@router.post("/{roster_id}/submit")
async def submit_for_approval(
    roster_id: int,
    current_user: User = Depends(require_roles(UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    roster = await _get_roster_or_404(db, roster_id)
    if roster.status != RosterStatus.DRAFT:
        raise HTTPException(status_code=400, detail="Only draft rosters can be submitted")

    roster.status = RosterStatus.SUBMITTED
    roster.modified_by_id = current_user.id

    await log_event(db, actor=current_user, action=AuditAction.ROSTER_SUBMITTED, entity_type="Roster", entity_id=roster_id)
    await db.commit()
    return {"detail": "Roster submitted for approval", "roster_id": roster_id}


@router.post("/{roster_id}/approve")
async def approve_roster(
    roster_id: int,
    comments: Optional[str] = None,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO)),
    db: AsyncSession = Depends(get_db),
):
    from datetime import datetime, timezone
    roster = await _get_roster_or_404(db, roster_id)
    if roster.status != RosterStatus.SUBMITTED:
        raise HTTPException(status_code=400, detail="Only submitted rosters can be approved")

    roster.status = RosterStatus.APPROVED
    roster.approved_by_id = current_user.id
    roster.approved_at = datetime.now(timezone.utc)
    roster.approval_comments = comments

    await log_event(db, actor=current_user, action=AuditAction.ROSTER_APPROVED, entity_type="Roster",
                    entity_id=roster_id, new_values={"comments": comments})
    await db.commit()
    return {"detail": "Roster approved", "roster_id": roster_id}


@router.post("/{roster_id}/publish")
async def publish_roster(
    roster_id: int,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    from datetime import datetime, timezone
    roster = await _get_roster_or_404(db, roster_id)
    if roster.status != RosterStatus.APPROVED:
        raise HTTPException(status_code=400, detail="Only approved rosters can be published")

    if roster.is_demo_policy:
        # Allowed but must be clearly labeled
        pass

    roster.status = RosterStatus.PUBLISHED
    roster.published_at = datetime.now(timezone.utc)

    await log_event(db, actor=current_user, action=AuditAction.ROSTER_PUBLISHED, entity_type="Roster",
                    entity_id=roster_id,
                    new_values={"is_demo_policy": roster.is_demo_policy})
    await db.commit()
    return {
        "detail": "Roster published",
        "roster_id": roster_id,
        "is_demo_policy": roster.is_demo_policy,
        "warning": "⚠ This roster was published under DEMO POLICY mode. Not for operational use." if roster.is_demo_policy else None,
    }


async def _validate_assignment(
    db: AsyncSession,
    asn: AssignmentIn,
    roster_date: date_type,
    shift_code: ShiftCode,
    current_roster_id: int,
) -> List[str]:
    """Run validation checks before saving an assignment. Returns list of warning messages."""
    warnings = []

    # Check staff exists and is active
    staff_result = await db.execute(select(Staff).where(Staff.id == asn.staff_id, Staff.is_active == True))
    staff = staff_result.scalar_one_or_none()
    if not staff:
        warnings.append(f"Staff ID {asn.staff_id} not found or inactive")
        return warnings

    # Duplicate assignment check (same staff, same roster)
    dup_result = await db.execute(
        select(RosterAssignment).where(
            and_(
                RosterAssignment.roster_id == current_roster_id,
                RosterAssignment.staff_id == asn.staff_id,
                RosterAssignment.duty_master_id == asn.duty_master_id,
            )
        )
    )
    if dup_result.scalar_one_or_none():
        warnings.append(f"DUPLICATE: {staff.name} ({staff.service_number}) already assigned to this duty in this roster")

    # Check availability
    availability = await compute_staff_status(db, asn.staff_id, roster_date, shift_code)
    from app.models.models import StaffStatus
    if availability.status == StaffStatus.ON_LEAVE:
        warnings.append(f"APPROVED LEAVE: {staff.name} is on approved leave on {roster_date}. Cannot assign.")
    elif availability.status == StaffStatus.ATTACHED_OTHER_WING:
        warnings.append(f"ATTACHMENT: {staff.name} is attached to another wing. Exclude from routine assignment.")
    elif availability.status == StaffStatus.OFFICIAL_MOVEMENT:
        warnings.append(f"OPEN MOVEMENT: {staff.name} has an open outside movement record.")

    # Check eligible designations
    duty_result = await db.execute(select(DutyMaster).where(DutyMaster.id == asn.duty_master_id))
    duty = duty_result.scalar_one_or_none()
    if duty and duty.eligible_designations:
        if staff.designation.value not in duty.eligible_designations:
            warnings.append(
                f"DESIGNATION MISMATCH: {staff.name} ({staff.designation.value}) is not eligible for "
                f"'{duty.category}'. Eligible: {duty.eligible_designations}"
            )

    return warnings


async def _get_roster_or_404(db: AsyncSession, roster_id: int) -> Roster:
    result = await db.execute(select(Roster).where(Roster.id == roster_id))
    roster = result.scalar_one_or_none()
    if not roster:
        raise HTTPException(status_code=404, detail="Roster not found")
    return roster
