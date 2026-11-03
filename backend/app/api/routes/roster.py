"""
Roster API — versioned, approval workflow, validation BEFORE save.

- Rosters are never deleted. Changing an approved/published roster creates a new
  version (`/revise`) with a reason; the original stays viewable (`/versions`).
- Allocations are validated by app.services.validation. Blocking violations are
  rejected unless an exception is authorized by a distinct officer; each
  authorized exception is written to the audit log with the authorizer.
- Drafts are visible only to the officers who prepare/approve them.
"""
from __future__ import annotations

from datetime import date as date_type, datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, delete

from app.auth.dependencies import get_current_user, has_role, require_roles, sector_scope
from app.db.database import get_db
from app.models.models import (
    Roster, RosterAssignment, RosterStatus, ShiftCode, User, UserRoleEnum,
    Staff, DutyMaster, RotationRule, PolicyStatus,
)
from app.services.audit import log_event, AuditAction
from app.services.notifications import notify_roles, notify_staff
from app.services.validation import validate_assignments

router = APIRouter(prefix="/rosters", tags=["Roster"])

# Who may see draft / submitted / approved (unpublished) rosters.
DRAFT_VIEWERS = (UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI, UserRoleEnum.SECTOR_SI)


class AssignmentIn(BaseModel):
    duty_master_id: int
    staff_id: int
    sector_id: Optional[int] = None
    notes: Optional[str] = None
    is_exception: bool = False
    exception_reason: Optional[str] = None
    exception_authorized_by_id: Optional[int] = None


class AssignmentOut(BaseModel):
    id: int
    duty_master_id: int
    duty_category: str
    duty_section: Optional[str] = None
    staff_id: int
    staff_name: str
    service_number: str
    designation: str
    sector_id: Optional[int] = None
    notes: Optional[str] = None
    is_exception: bool = False
    exception_reason: Optional[str] = None
    exception_authorized_by_id: Optional[int] = None
    exception_authorized_by: Optional[str] = None


class RosterCreate(BaseModel):
    roster_date: date_type
    shift_code: ShiftCode
    change_reason: Optional[str] = None
    assignments: List[AssignmentIn] = []


class AssignmentsUpdateIn(BaseModel):
    change_reason: Optional[str] = None
    assignments: List[AssignmentIn] = []


class ValidateIn(BaseModel):
    roster_date: date_type
    shift_code: ShiftCode
    assignments: List[AssignmentIn] = []


class DecisionIn(BaseModel):
    comments: Optional[str] = None


class ReviseIn(BaseModel):
    change_reason: str


class RosterOut(BaseModel):
    id: int
    roster_date: date_type
    shift_code: str
    version: int
    status: str
    change_reason: Optional[str]
    is_demo_policy: bool
    created_at: str
    is_latest: bool = True
    assignment_count: int = 0
    prepared_by: Optional[str] = None
    approved_by: Optional[str] = None

    class Config:
        from_attributes = True


class RosterDetailOut(RosterOut):
    prepared_by_id: Optional[int] = None
    modified_by_id: Optional[int] = None
    modified_by: Optional[str] = None
    approved_by_id: Optional[int] = None
    approved_at: Optional[str] = None
    approval_comments: Optional[str] = None
    published_at: Optional[str] = None
    assignments: List[AssignmentOut] = []
    total_assigned: int = 0
    total_vacancies: int = 0
    vacancies_by_duty: List[dict] = []
    warnings: List[str] = []


async def _get_active_rotation_policy(db: AsyncSession) -> Optional[RotationRule]:
    result = await db.execute(select(RotationRule).order_by(RotationRule.id.desc()).limit(1))
    rule = result.scalar_one_or_none()
    if rule and rule.policy_status in (PolicyStatus.CONFIRMED, PolicyStatus.DEMO_SIMULATED):
        return rule
    return None


def _can_see_drafts(user: User) -> bool:
    return has_role(user, DRAFT_VIEWERS)


async def _usernames(db: AsyncSession, ids) -> Dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    res = await db.execute(select(User.id, User.username).where(User.id.in_(ids)))
    return {i: n for i, n in res.all()}


async def _latest_versions(db: AsyncSession, rosters: List[Roster]) -> Dict[tuple, int]:
    keys = {(r.roster_date, r.shift_code) for r in rosters}
    latest: Dict[tuple, int] = {}
    if not keys:
        return latest
    dates = {k[0] for k in keys}
    res = await db.execute(select(Roster.roster_date, Roster.shift_code, Roster.version).where(Roster.roster_date.in_(dates)))
    for d, s, v in res.all():
        if (d, s) in keys:
            latest[(d, s)] = max(latest.get((d, s), 0), v)
    return latest


async def _roster_summaries(db: AsyncSession, rosters: List[Roster]) -> List[RosterOut]:
    latest = await _latest_versions(db, rosters)
    counts: Dict[int, int] = {}
    if rosters:
        res = await db.execute(select(RosterAssignment.roster_id).where(RosterAssignment.roster_id.in_([r.id for r in rosters])))
        for rid in res.scalars().all():
            counts[rid] = counts.get(rid, 0) + 1
    names = await _usernames(db, [r.prepared_by_id for r in rosters] + [r.approved_by_id for r in rosters])
    return [
        RosterOut(
            id=r.id, roster_date=r.roster_date, shift_code=r.shift_code.value, version=r.version,
            status=r.status.value, change_reason=r.change_reason, is_demo_policy=r.is_demo_policy,
            created_at=r.created_at.isoformat() if r.created_at else "",
            is_latest=latest.get((r.roster_date, r.shift_code)) == r.version,
            assignment_count=counts.get(r.id, 0),
            prepared_by=names.get(r.prepared_by_id), approved_by=names.get(r.approved_by_id),
        )
        for r in rosters
    ]


@router.get("/", response_model=List[RosterOut])
async def list_rosters(
    roster_date: Optional[date_type] = Query(None),
    start_date: Optional[date_type] = Query(None),
    end_date: Optional[date_type] = Query(None),
    shift_code: Optional[ShiftCode] = Query(None),
    roster_status: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Roster)
    if roster_date:
        query = query.where(Roster.roster_date == roster_date)
    if start_date:
        query = query.where(Roster.roster_date >= start_date)
    if end_date:
        query = query.where(Roster.roster_date <= end_date)
    if shift_code:
        query = query.where(Roster.shift_code == shift_code)
    if roster_status:
        query = query.where(Roster.status == roster_status)
    # Drafts are invisible until published, except to the preparing/approving officers.
    if not _can_see_drafts(current_user):
        query = query.where(Roster.status == RosterStatus.PUBLISHED)

    result = await db.execute(query.order_by(Roster.roster_date.desc(), Roster.shift_code, Roster.version.desc()))
    return await _roster_summaries(db, list(result.scalars().all()))


@router.get("/calendar")
async def roster_calendar(
    start_date: date_type = Query(...),
    end_date: date_type = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Daily/weekly/monthly grid: the newest visible version for every date and shift A/B/C."""
    if (end_date - start_date).days > 62:
        raise HTTPException(status_code=422, detail="Calendar range cannot exceed 62 days")
    query = select(Roster).where(Roster.roster_date >= start_date, Roster.roster_date <= end_date)
    if not _can_see_drafts(current_user):
        query = query.where(Roster.status == RosterStatus.PUBLISHED)
    rosters = list((await db.execute(query)).scalars().all())
    best: Dict[tuple, Roster] = {}
    for r in rosters:
        key = (r.roster_date, r.shift_code)
        if key not in best or r.version > best[key].version:
            best[key] = r
    summaries = {s.id: s for s in await _roster_summaries(db, list(best.values()))}
    cells = []
    for (d, s), r in sorted(best.items(), key=lambda kv: (kv[0][0], kv[0][1].value)):
        cells.append({"date": str(d), "shift_code": s.value, **summaries[r.id].model_dump(mode="json")})
    return {"start_date": str(start_date), "end_date": str(end_date), "cells": cells}


@router.get("/active-draft")
async def get_active_draft(
    roster_date: date_type = Query(...),
    shift_code: ShiftCode = Query(...),
    current_user: User = Depends(require_roles(*DRAFT_VIEWERS)),
    db: AsyncSession = Depends(get_db),
):
    """Fetch the latest draft roster for date & shift, or null if none exists."""
    result = await db.execute(
        select(Roster)
        .where(
            Roster.roster_date == roster_date,
            Roster.shift_code == shift_code,
            Roster.status == RosterStatus.DRAFT,
        )
        .order_by(Roster.version.desc())
        .limit(1)
    )
    roster = result.scalar_one_or_none()
    if not roster:
        return {"roster": None}
    return {"roster": await _build_roster_detail(db, roster, current_user)}


@router.get("/{roster_id}", response_model=RosterDetailOut)
async def get_roster(
    roster_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get full roster details including all assignments and staff metadata."""
    roster = await _get_roster_or_404(db, roster_id)
    if roster.status != RosterStatus.PUBLISHED and not _can_see_drafts(current_user):
        raise HTTPException(status_code=403, detail="This roster is not published yet.")
    return await _build_roster_detail(db, roster, current_user)


@router.get("/{roster_id}/versions", response_model=List[RosterOut])
async def roster_versions(
    roster_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Every version of the same date/shift — the original stays viewable after a change."""
    roster = await _get_roster_or_404(db, roster_id)
    query = select(Roster).where(Roster.roster_date == roster.roster_date, Roster.shift_code == roster.shift_code)
    if not _can_see_drafts(current_user):
        query = query.where(Roster.status == RosterStatus.PUBLISHED)
    result = await db.execute(query.order_by(Roster.version.desc()))
    return await _roster_summaries(db, list(result.scalars().all()))


async def _build_roster_detail(db: AsyncSession, roster: Roster, viewer: Optional[User] = None) -> RosterDetailOut:
    asns = list((await db.execute(
        select(RosterAssignment).where(RosterAssignment.roster_id == roster.id).order_by(RosterAssignment.id.asc())
    )).scalars().all())

    staff_ids = [a.staff_id for a in asns]
    duty_ids = [a.duty_master_id for a in asns]
    staff_map = {}
    if staff_ids:
        staff_map = {s.id: s for s in (await db.execute(select(Staff).where(Staff.id.in_(staff_ids)))).scalars().all()}
    duty_map = {}
    if duty_ids:
        duty_map = {d.id: d for d in (await db.execute(select(DutyMaster).where(DutyMaster.id.in_(duty_ids)))).scalars().all()}
    names = await _usernames(db, [a.exception_authorized_by_id for a in asns] +
                             [roster.prepared_by_id, roster.modified_by_id, roster.approved_by_id])

    # Vacancies are computed station-wide; a Sector SI only sees their sector's assignment rows.
    scope = sector_scope(viewer) if viewer else None
    visible = [a for a in asns if scope is None or (staff_map.get(a.staff_id) and staff_map[a.staff_id].sector_id == scope)]

    assignments_out = []
    for a in visible:
        s = staff_map.get(a.staff_id)
        d = duty_map.get(a.duty_master_id)
        assignments_out.append(AssignmentOut(
            id=a.id,
            duty_master_id=a.duty_master_id,
            duty_category=d.category if d else f"Duty #{a.duty_master_id}",
            duty_section=d.section if d else None,
            staff_id=a.staff_id,
            staff_name=s.name if s else f"Staff #{a.staff_id}",
            service_number=s.service_number if s else "N/A",
            designation=s.designation.value if (s and hasattr(s.designation, "value")) else "",
            sector_id=a.sector_id,
            notes=a.notes,
            is_exception=a.is_exception,
            exception_reason=a.exception_reason,
            exception_authorized_by_id=a.exception_authorized_by_id,
            exception_authorized_by=names.get(a.exception_authorized_by_id),
        ))

    duties = (await db.execute(select(DutyMaster).where(
        DutyMaster.is_active == True, DutyMaster.is_configured == True,
        (DutyMaster.shift_code == roster.shift_code) | (DutyMaster.shift_code == None),
    ))).scalars().all()
    total_vacancies = 0
    by_duty = []
    for d in duties:
        if not d.required_strength:
            continue
        assigned = sum(1 for a in asns if a.duty_master_id == d.id)
        vacant = max(0, d.required_strength - assigned)
        total_vacancies += vacant
        by_duty.append({"duty_master_id": d.id, "category": d.category, "section": d.section,
                        "required": d.required_strength, "allocated": assigned, "vacant": vacant})

    latest = await _latest_versions(db, [roster])
    return RosterDetailOut(
        id=roster.id,
        roster_date=roster.roster_date,
        shift_code=roster.shift_code.value,
        version=roster.version,
        status=roster.status.value,
        change_reason=roster.change_reason,
        is_demo_policy=roster.is_demo_policy,
        is_latest=latest.get((roster.roster_date, roster.shift_code)) == roster.version,
        assignment_count=len(asns),
        prepared_by_id=roster.prepared_by_id,
        prepared_by=names.get(roster.prepared_by_id),
        modified_by_id=roster.modified_by_id,
        modified_by=names.get(roster.modified_by_id),
        approved_by_id=roster.approved_by_id,
        approved_by=names.get(roster.approved_by_id),
        approved_at=roster.approved_at.isoformat() if roster.approved_at else None,
        approval_comments=roster.approval_comments,
        published_at=roster.published_at.isoformat() if roster.published_at else None,
        created_at=roster.created_at.isoformat() if roster.created_at else "",
        assignments=assignments_out,
        total_assigned=len(asns),
        total_vacancies=total_vacancies,
        vacancies_by_duty=by_duty,
        warnings=[],
    )


async def _check_and_store(db: AsyncSession, roster: Roster, assignments: List[AssignmentIn], user: User) -> dict:
    """Validate, refuse blocking violations, store assignments and audit authorized exceptions."""
    result = await validate_assignments(db, roster.roster_date, roster.shift_code, assignments, user)
    if result.blocking:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": f"{len(result.blocking)} rule violation(s) must be fixed or authorized as exceptions before saving.",
                **result.as_dict(),
            },
        )
    for idx, asn in enumerate(assignments):
        authorizer = result.authorizers.get(idx)
        db.add(RosterAssignment(
            roster_id=roster.id,
            duty_master_id=asn.duty_master_id,
            staff_id=asn.staff_id,
            sector_id=asn.sector_id,
            notes=asn.notes,
            is_exception=bool(authorizer),
            exception_reason=asn.exception_reason if authorizer else None,
            exception_authorized_by_id=authorizer.id if authorizer else None,
        ))
        if authorizer:
            overridden = [i.as_dict() for i in result.issues if i.index == idx and i.overridden]
            await log_event(db, actor=user, action=AuditAction.EXCEPTION_AUTHORIZED, entity_type="Roster",
                            entity_id=roster.id, authorizer=authorizer, exception_reason=asn.exception_reason,
                            new_values={"staff_id": asn.staff_id, "duty_master_id": asn.duty_master_id,
                                        "overridden_rules": [i["code"] for i in overridden],
                                        "details": [i["message"] for i in overridden]})
    return result.as_dict()


@router.post("/validate")
async def validate_roster(
    payload: ValidateIn,
    current_user: User = Depends(require_roles(*DRAFT_VIEWERS)),
    db: AsyncSession = Depends(get_db),
):
    """Dry run — returns every warning and violation without saving (warn BEFORE saving)."""
    result = await validate_assignments(db, payload.roster_date, payload.shift_code, payload.assignments, current_user)
    return result.as_dict()


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
    if not policy:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Roster creation is gated on policy confirmation. "
                "An SHO must confirm or demo-simulate the rotation/rest policy before drafting operational rosters."
            ),
        )
    is_demo_policy = policy.policy_status == PolicyStatus.DEMO_SIMULATED

    result = await db.execute(
        select(Roster)
        .where(and_(Roster.roster_date == payload.roster_date, Roster.shift_code == payload.shift_code))
        .order_by(Roster.version.desc())
        .limit(1)
    )
    latest = result.scalar_one_or_none()
    new_version = (latest.version + 1) if latest else 1
    if latest and not (payload.change_reason or "").strip():
        raise HTTPException(status_code=422, detail="A reason is required when creating a new version of an existing roster")

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
    validation = await _check_and_store(db, roster, payload.assignments, current_user)

    await log_event(db, actor=current_user, action=AuditAction.ROSTER_CREATED, entity_type="Roster",
                    entity_id=roster.id,
                    new_values={"date": str(payload.roster_date), "shift": payload.shift_code.value,
                                "version": new_version, "reason": payload.change_reason,
                                "previous_version_id": latest.id if latest else None,
                                "assignments": len(payload.assignments)})
    await db.commit()
    await db.refresh(roster)

    return {
        "id": roster.id,
        "version": roster.version,
        "status": roster.status.value,
        "is_demo_policy": roster.is_demo_policy,
        "warnings": validation["warnings"],
        "issues": validation["issues"],
        "message": "Draft created. Review warnings before submitting for approval.",
    }


@router.put("/{roster_id}/assignments")
async def update_roster_assignments(
    roster_id: int,
    payload: AssignmentsUpdateIn,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    """
    Replace the allocations of a draft roster. A submitted roster returns to draft
    when edited. Approved/published rosters are changed through /revise.
    """
    roster = await _get_roster_or_404(db, roster_id)
    if roster.status not in (RosterStatus.DRAFT, RosterStatus.SUBMITTED):
        raise HTTPException(status_code=400, detail="Cannot edit assignments on an approved or published roster. Create a new revision version.")

    old_rows = (await db.execute(select(RosterAssignment).where(RosterAssignment.roster_id == roster.id))).scalars().all()
    old_set = sorted((a.staff_id, a.duty_master_id) for a in old_rows)

    # Validate first, so a refused save leaves the existing allocations untouched.
    result = await validate_assignments(db, roster.roster_date, roster.shift_code, payload.assignments, current_user)
    if result.blocking:
        raise HTTPException(status_code=422, detail={
            "message": f"{len(result.blocking)} rule violation(s) must be fixed or authorized as exceptions before saving.",
            **result.as_dict()})

    await db.execute(delete(RosterAssignment).where(RosterAssignment.roster_id == roster.id))
    validation = await _check_and_store(db, roster, payload.assignments, current_user)

    old_status = roster.status.value
    roster.modified_by_id = current_user.id
    if roster.status == RosterStatus.SUBMITTED:
        roster.status = RosterStatus.DRAFT  # edited after submission: must be re-submitted
    if payload.change_reason:
        roster.change_reason = payload.change_reason

    new_set = sorted((a.staff_id, a.duty_master_id) for a in payload.assignments)
    await log_event(
        db, actor=current_user, action=AuditAction.ROSTER_ASSIGNMENTS_UPDATED, entity_type="Roster", entity_id=roster.id,
        old_values={"status": old_status, "assignments": [list(x) for x in old_set]},
        new_values={"status": roster.status.value, "assignments": [list(x) for x in new_set],
                    "added": [list(x) for x in sorted(set(new_set) - set(old_set))],
                    "removed": [list(x) for x in sorted(set(old_set) - set(new_set))],
                    "reason": payload.change_reason},
    )
    await db.commit()

    return {
        "roster_id": roster.id,
        "roster": {"id": roster.id, "version": roster.version, "status": roster.status.value},
        "assignments_count": len(payload.assignments),
        "warnings": validation["warnings"],
        "issues": validation["issues"],
        "detail": f"Saved {len(payload.assignments)} duty allocations to Roster #{roster.id} (v{roster.version}).",
    }


@router.post("/{roster_id}/revise", status_code=201)
async def revise_roster(
    roster_id: int,
    payload: ReviseIn,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    """Start a new draft version from an existing roster (copying its allocations). The original is preserved."""
    if not payload.change_reason.strip():
        raise HTTPException(status_code=422, detail="A reason for the change is required")
    source = await _get_roster_or_404(db, roster_id)
    latest = (await db.execute(select(Roster).where(
        Roster.roster_date == source.roster_date, Roster.shift_code == source.shift_code
    ).order_by(Roster.version.desc()).limit(1))).scalar_one()
    if latest.status == RosterStatus.DRAFT:
        raise HTTPException(status_code=400, detail=f"Draft v{latest.version} (Roster #{latest.id}) already exists for this shift — edit it instead")
    policy = await _get_active_rotation_policy(db)
    if not policy:
        raise HTTPException(status_code=403, detail="Rotation policy must be confirmed or demo-simulated before revising rosters")

    new = Roster(
        roster_date=source.roster_date, shift_code=source.shift_code, version=latest.version + 1,
        status=RosterStatus.DRAFT, change_reason=payload.change_reason.strip(), prepared_by_id=current_user.id,
        is_demo_policy=policy.policy_status == PolicyStatus.DEMO_SIMULATED,
    )
    db.add(new)
    await db.flush()
    rows = (await db.execute(select(RosterAssignment).where(RosterAssignment.roster_id == source.id))).scalars().all()
    for a in rows:
        db.add(RosterAssignment(roster_id=new.id, duty_master_id=a.duty_master_id, staff_id=a.staff_id,
                                sector_id=a.sector_id, notes=a.notes, is_exception=a.is_exception,
                                exception_reason=a.exception_reason,
                                exception_authorized_by_id=a.exception_authorized_by_id))
    await log_event(db, actor=current_user, action=AuditAction.ROSTER_REVISED, entity_type="Roster", entity_id=new.id,
                    new_values={"source_roster_id": source.id, "source_version": source.version,
                                "version": new.version, "reason": new.change_reason})
    await db.commit()
    return {"id": new.id, "version": new.version, "status": new.status.value,
            "detail": f"Draft v{new.version} created from v{source.version}. The original remains on record."}


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

    await log_event(db, actor=current_user, action=AuditAction.ROSTER_SUBMITTED, entity_type="Roster", entity_id=roster_id,
                    old_values={"status": "draft"}, new_values={"status": "submitted"})
    await notify_roles(db, (UserRoleEnum.SHO,), "Roster awaiting approval",
                       f"Roster {roster.roster_date} Shift {roster.shift_code.value} v{roster.version} was submitted for approval.",
                       category="approval", entity_type="Roster", entity_id=roster.id)
    await db.commit()
    return {"detail": "Roster submitted for approval", "roster_id": roster_id, "status": roster.status.value}


def _comments(payload: Optional[DecisionIn], comments: Optional[str]) -> Optional[str]:
    return (payload.comments if payload and payload.comments else None) or comments


@router.post("/{roster_id}/approve")
async def approve_roster(
    roster_id: int,
    payload: Optional[DecisionIn] = None,
    comments: Optional[str] = None,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO)),
    db: AsyncSession = Depends(get_db),
):
    roster = await _get_roster_or_404(db, roster_id)
    if roster.status != RosterStatus.SUBMITTED:
        raise HTTPException(status_code=400, detail="Only submitted rosters can be approved")
    comments = _comments(payload, comments)

    roster.status = RosterStatus.APPROVED
    roster.approved_by_id = current_user.id
    roster.approved_at = datetime.now(timezone.utc)
    roster.approval_comments = comments

    await log_event(db, actor=current_user, action=AuditAction.ROSTER_APPROVED, entity_type="Roster",
                    entity_id=roster_id, old_values={"status": "submitted"},
                    new_values={"status": "approved", "comments": comments,
                                "prepared_by_id": roster.prepared_by_id, "modified_by_id": roster.modified_by_id},
                    authorizer=current_user)
    await notify_roles(db, (UserRoleEnum.ADMIN_SI,), "Roster approved",
                       f"Roster {roster.roster_date} Shift {roster.shift_code.value} v{roster.version} was approved and can be published.",
                       category="decision", entity_type="Roster", entity_id=roster.id)
    await db.commit()
    return {"detail": "Roster approved", "roster_id": roster_id, "status": roster.status.value}


@router.post("/{roster_id}/reject")
async def reject_roster(
    roster_id: int,
    payload: Optional[DecisionIn] = None,
    comments: Optional[str] = None,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO)),
    db: AsyncSession = Depends(get_db),
):
    """Return a submitted roster to draft with the SHO's comments."""
    roster = await _get_roster_or_404(db, roster_id)
    if roster.status != RosterStatus.SUBMITTED:
        raise HTTPException(status_code=400, detail="Only submitted rosters can be returned")
    comments = _comments(payload, comments)
    if not comments:
        raise HTTPException(status_code=422, detail="Comments are required when returning a roster")
    roster.status = RosterStatus.DRAFT
    roster.approval_comments = comments
    await log_event(db, actor=current_user, action=AuditAction.ROSTER_REJECTED, entity_type="Roster", entity_id=roster_id,
                    old_values={"status": "submitted"}, new_values={"status": "draft", "comments": comments})
    await notify_roles(db, (UserRoleEnum.ADMIN_SI,), "Roster returned for changes",
                       f"Roster {roster.roster_date} Shift {roster.shift_code.value} v{roster.version}: {comments}",
                       category="decision", entity_type="Roster", entity_id=roster.id)
    await db.commit()
    return {"detail": "Roster returned to draft", "roster_id": roster_id, "status": roster.status.value}


@router.post("/{roster_id}/publish")
async def publish_roster(
    roster_id: int,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    roster = await _get_roster_or_404(db, roster_id)
    if roster.status != RosterStatus.APPROVED:
        raise HTTPException(status_code=400, detail="Only approved rosters can be published")
    newer = (await db.execute(select(Roster).where(
        Roster.roster_date == roster.roster_date, Roster.shift_code == roster.shift_code,
        Roster.version > roster.version, Roster.status == RosterStatus.PUBLISHED))).scalars().first()
    if newer:
        raise HTTPException(status_code=400, detail=f"A newer version (v{newer.version}) is already published")

    superseded = (await db.execute(select(Roster).where(
        Roster.roster_date == roster.roster_date, Roster.shift_code == roster.shift_code,
        Roster.version < roster.version, Roster.status == RosterStatus.PUBLISHED))).scalars().all()

    roster.status = RosterStatus.PUBLISHED
    roster.published_at = datetime.now(timezone.utc)

    await log_event(db, actor=current_user, action=AuditAction.ROSTER_PUBLISHED, entity_type="Roster",
                    entity_id=roster_id, old_values={"status": "approved"},
                    new_values={"status": "published", "is_demo_policy": roster.is_demo_policy,
                                "published_by": current_user.username,
                                "supersedes": [{"id": r.id, "version": r.version} for r in superseded]})

    # Tell every assigned person their published duty (and anyone dropped from the superseded version).
    rows = (await db.execute(
        select(RosterAssignment, DutyMaster).join(DutyMaster, RosterAssignment.duty_master_id == DutyMaster.id)
        .where(RosterAssignment.roster_id == roster.id))).all()
    now_assigned = set()
    for asn, duty in rows:
        now_assigned.add(asn.staff_id)
        await notify_staff(db, asn.staff_id, "Duty published",
                           f"{roster.roster_date} Shift {roster.shift_code.value}: {duty.category}"
                           + (f" — {asn.notes}" if asn.notes else ""),
                           category="roster", entity_type="Roster", entity_id=roster.id)
    if superseded:
        old_rows = (await db.execute(select(RosterAssignment.staff_id).where(
            RosterAssignment.roster_id.in_([r.id for r in superseded])))).scalars().all()
        for sid in set(old_rows) - now_assigned:
            await notify_staff(db, sid, "Duty removed",
                               f"You are no longer on duty for {roster.roster_date} Shift {roster.shift_code.value} "
                               f"(roster revised to v{roster.version}: {roster.change_reason or 'no reason given'}).",
                               category="roster", entity_type="Roster", entity_id=roster.id)
    await db.commit()
    return {
        "detail": "Roster published",
        "roster_id": roster_id,
        "status": roster.status.value,
        "is_demo_policy": roster.is_demo_policy,
        "superseded_versions": [r.version for r in superseded],
        "warning": "⚠ This roster was published under DEMO POLICY mode. Not for operational use." if roster.is_demo_policy else None,
    }


async def _get_roster_or_404(db: AsyncSession, roster_id: int) -> Roster:
    result = await db.execute(select(Roster).where(Roster.id == roster_id))
    roster = result.scalar_one_or_none()
    if not roster:
        raise HTTPException(status_code=404, detail="Roster not found")
    return roster
