"""Duty Change Request API endpoints — appended to roster.py logic."""
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.auth.dependencies import get_current_user
from app.db.database import get_db
from app.models.models import (
    DutyChangeRequest, DutyChangeRequestStatus,
    Roster, RosterAssignment, RosterStatus, DutyMaster, ShiftCode, Staff, User, UserRoleEnum,
)
from app.services.audit import log_event, AuditAction
from app.services.notifications import notify_staff, notify_roles

change_request_router = APIRouter(prefix="/rosters/change-requests", tags=["Duty Change Requests"])

# Roles allowed to approve / reject
APPROVER_ROLES = {UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI, UserRoleEnum.SUPER_ADMIN}


class DutyChangeRequestIn(BaseModel):
    roster_id: int
    roster_assignment_id: Optional[int] = None
    current_shift_code: str
    current_duty_category: Optional[str] = None
    current_roster_date: str            # YYYY-MM-DD
    requested_shift_code: Optional[str] = None
    requested_duty_category: Optional[str] = None
    reason: str


class DutyChangeReviewIn(BaseModel):
    remarks: Optional[str] = None


class DutyChangeRequestOut(BaseModel):
    id: int
    roster_id: int
    roster_assignment_id: Optional[int] = None
    staff_id: int
    officer_name: str
    service_number: str
    current_shift_code: str
    current_duty_category: Optional[str] = None
    current_roster_date: str
    requested_shift_code: Optional[str] = None
    requested_duty_category: Optional[str] = None
    reason: str
    status: str
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[str] = None
    reviewer_remarks: Optional[str] = None
    submitted_at: str

    class Config:
        from_attributes = True


async def _resolve_staff_id(db: AsyncSession, user: User) -> Optional[int]:
    """Resolve the staff record for the logged-in user."""
    if user.staff_id:
        return user.staff_id
    from sqlalchemy import func, or_
    uname = (user.username or "").lower()
    res = await db.execute(
        select(Staff.id).where(
            or_(
                func.lower(Staff.service_number) == uname.replace("_", ""),
                func.lower(Staff.service_number) == uname,
                func.lower(Staff.service_number) == uname.replace("_", "-"),
            )
        )
    )
    sid = res.scalar_one_or_none()
    if sid:
        return sid
    if uname == "staff_demo":
        res2 = await db.execute(select(Staff.id).where(Staff.is_active.is_(True)).order_by(Staff.id).limit(1))
        first_staff = res2.scalar_one_or_none()
        if first_staff:
            user.staff_id = first_staff
            await db.commit()
            return first_staff
    return None


# -- Locating and applying the change on the roster ---------------------------
async def _find_assignment(
    db: AsyncSession, roster_id: int, staff_id: int, category: Optional[str]
) -> Optional[RosterAssignment]:
    """The officer's assignment on this roster (matching the duty point when they named one).
    A roster is versioned, so if the officer is not on this exact version, the latest published
    version of the same date and shift is tried."""
    roster = (await db.execute(select(Roster).where(Roster.id == roster_id))).scalar_one_or_none()
    if roster is None:
        return None
    ids = [roster.id]
    latest = (await db.execute(
        select(Roster.id).where(
            Roster.roster_date == roster.roster_date, Roster.shift_code == roster.shift_code,
            Roster.status == RosterStatus.PUBLISHED,
        ).order_by(Roster.version.desc()).limit(1)
    )).scalar_one_or_none()
    if latest and latest not in ids:
        ids.append(latest)
    for rid in ids:
        rows = (await db.execute(
            select(RosterAssignment, DutyMaster)
            .join(DutyMaster, DutyMaster.id == RosterAssignment.duty_master_id)
            .where(RosterAssignment.roster_id == rid, RosterAssignment.staff_id == staff_id)
        )).all()
        if not rows:
            continue
        if category:
            for asn, duty in rows:
                if duty.category == category:
                    return asn
        return rows[0][0]
    return None


async def _find_duty(db: AsyncSession, category: str, shift: ShiftCode) -> Optional[DutyMaster]:
    """The active duty point with this name for the shift (a duty defined for all shifts also matches)."""
    rows = (await db.execute(
        select(DutyMaster).where(DutyMaster.category == category, DutyMaster.is_active == True)
    )).scalars().all()
    for d in rows:
        if d.shift_code == shift:
            return d
    for d in rows:
        if d.shift_code is None:
            return d
    return None


async def _apply_change(db: AsyncSession, dcr: DutyChangeRequest, approver: User, now: datetime) -> dict:
    """Make an approved request real: move the officer to the requested shift and/or duty point on the
    published roster. Raises 409 (leaving the request pending) when it cannot be applied."""
    asn = None
    if dcr.roster_assignment_id:
        asn = (await db.execute(select(RosterAssignment).where(RosterAssignment.id == dcr.roster_assignment_id))).scalar_one_or_none()
    if asn is None:  # requests made before assignments were linked
        asn = await _find_assignment(db, dcr.roster_id, dcr.staff_id, dcr.current_duty_category)
    if asn is None:
        raise HTTPException(status_code=409, detail="The officer is no longer assigned on this roster, so there is nothing to change.")

    roster = (await db.execute(select(Roster).where(Roster.id == asn.roster_id))).scalar_one()
    old_duty = (await db.execute(select(DutyMaster).where(DutyMaster.id == asn.duty_master_id))).scalar_one()
    before = {"roster_id": roster.id, "shift": roster.shift_code.value, "duty": old_duty.category}

    target_roster = roster
    if dcr.requested_shift_code and dcr.requested_shift_code != roster.shift_code.value:
        try:
            target_shift = ShiftCode(dcr.requested_shift_code)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Unknown shift {dcr.requested_shift_code}.")
        target_roster = (await db.execute(
            select(Roster).where(
                Roster.roster_date == roster.roster_date, Roster.shift_code == target_shift,
                Roster.status == RosterStatus.PUBLISHED,
            ).order_by(Roster.version.desc()).limit(1)
        )).scalar_one_or_none()
        if target_roster is None:
            raise HTTPException(
                status_code=409,
                detail=f"No published roster exists for {roster.roster_date} shift {target_shift.value}. Publish it first, then approve.",
            )
        clash = (await db.execute(
            select(RosterAssignment.id).where(
                RosterAssignment.roster_id == target_roster.id, RosterAssignment.staff_id == asn.staff_id,
            ).limit(1)
        )).scalar_one_or_none()
        if clash:
            raise HTTPException(status_code=409, detail=f"The officer already has a duty on shift {target_shift.value} that day.")

    # Which duty point the officer ends up on: the requested one, else the same one if it exists on the new shift.
    category = dcr.requested_duty_category or (old_duty.category if target_roster.id != roster.id else None)
    new_duty = old_duty
    if category and (category != old_duty.category or target_roster.id != roster.id):
        found = await _find_duty(db, category, target_roster.shift_code)
        if found is None:
            raise HTTPException(
                status_code=409,
                detail=f"Duty point '{category}' has no requirement defined for shift {target_roster.shift_code.value}. Choose a duty point for that shift.",
            )
        new_duty = found

    if target_roster.id != roster.id:
        asn.roster_id = target_roster.id
    asn.duty_master_id = new_duty.id
    asn.notes = (asn.notes or "") + f"\n[Duty change #{dcr.id} approved by {approver.username} on {now.date()}]"
    dcr.roster_assignment_id = asn.id
    return {"before": before, "after": {"roster_id": target_roster.id, "shift": target_roster.shift_code.value, "duty": new_duty.category}}


async def _build_out(db: AsyncSession, dcr: DutyChangeRequest) -> DutyChangeRequestOut:
    # Staff info
    staff_res = await db.execute(select(Staff).where(Staff.id == dcr.staff_id))
    staff = staff_res.scalar_one_or_none()
    officer_name = staff.name if staff else "Unknown"
    service_number = staff.service_number if staff else ""

    # Reviewer name
    reviewed_by_name = None
    if dcr.reviewed_by_id:
        u_res = await db.execute(select(User).where(User.id == dcr.reviewed_by_id))
        u = u_res.scalar_one_or_none()
        if u:
            reviewed_by_name = u.username

    return DutyChangeRequestOut(
        id=dcr.id,
        roster_id=dcr.roster_id,
        roster_assignment_id=dcr.roster_assignment_id,
        staff_id=dcr.staff_id,
        officer_name=officer_name,
        service_number=service_number,
        current_shift_code=dcr.current_shift_code,
        current_duty_category=dcr.current_duty_category,
        current_roster_date=str(dcr.current_roster_date),
        requested_shift_code=dcr.requested_shift_code,
        requested_duty_category=dcr.requested_duty_category,
        reason=dcr.reason,
        status=dcr.status.value if hasattr(dcr.status, "value") else str(dcr.status),
        reviewed_by=reviewed_by_name,
        reviewed_at=dcr.reviewed_at.isoformat() if dcr.reviewed_at else None,
        reviewer_remarks=dcr.reviewer_remarks,
        submitted_at=dcr.submitted_at.isoformat() if dcr.submitted_at else "",
    )


# ── POST /rosters/change-requests/ ───────────────────────────────────────────
@change_request_router.post("/", response_model=DutyChangeRequestOut, status_code=201)
async def submit_duty_change_request(
    payload: DutyChangeRequestIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Submit a duty change / shift swap request."""
    if not payload.requested_shift_code and not payload.requested_duty_category:
        raise HTTPException(
            status_code=422,
            detail="Provide at least one of requested_shift_code or requested_duty_category.",
        )
    if not payload.reason or not payload.reason.strip():
        raise HTTPException(status_code=422, detail="Reason is required.")

    # Resolve the staff_id — STAFF submits for themselves; supervisors can submit for sector
    staff_id = await _resolve_staff_id(db, current_user)
    if not staff_id and current_user.role == UserRoleEnum.STAFF:
        raise HTTPException(status_code=404, detail="Staff profile not found for this user account.")

    if not staff_id:
        raise HTTPException(status_code=403, detail="No linked staff profile.")

    from datetime import date as _date
    try:
        roster_date = _date.fromisoformat(payload.current_roster_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="current_roster_date must be YYYY-MM-DD.")

    # Link the request to the officer's real assignment so that approval can change the roster.
    assignment = await _find_assignment(db, payload.roster_id, staff_id, payload.current_duty_category)
    if assignment is None:
        raise HTTPException(
            status_code=422,
            detail="You are not assigned on that roster. Pick one of your published duties.",
        )

    dcr = DutyChangeRequest(
        roster_id=payload.roster_id,
        roster_assignment_id=assignment.id,
        staff_id=staff_id,
        requested_by_user_id=current_user.id,
        current_shift_code=payload.current_shift_code,
        current_duty_category=payload.current_duty_category,
        current_roster_date=roster_date,
        requested_shift_code=payload.requested_shift_code,
        requested_duty_category=payload.requested_duty_category,
        reason=payload.reason.strip(),
        status=DutyChangeRequestStatus.PENDING,
        submitted_at=datetime.now(timezone.utc),
    )
    db.add(dcr)
    await db.flush()

    # Notify approvers
    try:
        await notify_roles(
            db,
            roles=[UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI],
            title="Duty Change Request",
            message=f"Officer {current_user.username} has submitted a duty change request for {payload.current_roster_date}.",
            category="duty_change",
            entity_type="DutyChangeRequest",
            entity_id=dcr.id,
        )
    except Exception:
        pass

    await log_event(db, actor=current_user, action="DUTY_CHANGE_REQUESTED",
                    entity_type="DutyChangeRequest", entity_id=dcr.id,
                    new_values={"status": "pending", "roster_id": payload.roster_id})
    await db.commit()
    await db.refresh(dcr)
    return await _build_out(db, dcr)


# ── GET /rosters/change-requests/ ────────────────────────────────────────────
@change_request_router.get("/", response_model=List[DutyChangeRequestOut])
async def list_duty_change_requests(
    request_status: Optional[str] = Query(None, alias="status"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List duty change requests. STAFF sees only their own."""
    q = select(DutyChangeRequest)

    if current_user.role == UserRoleEnum.STAFF:
        # Only own requests
        staff_id = await _resolve_staff_id(db, current_user)
        if staff_id:
            q = q.where(DutyChangeRequest.staff_id == staff_id)
        else:
            return []
    elif current_user.role == UserRoleEnum.SECTOR_SI and current_user.sector_id:
        # Sector SI sees requests from their sector staff
        from sqlalchemy import func
        sector_staff_res = await db.execute(
            select(Staff.id).where(Staff.sector_id == current_user.sector_id)
        )
        sector_staff_ids = [r for r in sector_staff_res.scalars().all()]
        if sector_staff_ids:
            q = q.where(DutyChangeRequest.staff_id.in_(sector_staff_ids))
        else:
            return []

    if request_status:
        try:
            q = q.where(DutyChangeRequest.status == DutyChangeRequestStatus(request_status))
        except ValueError:
            pass

    q = q.order_by(DutyChangeRequest.submitted_at.desc())
    result = await db.execute(q)
    dcrs = result.scalars().all()
    return [await _build_out(db, d) for d in dcrs]


# ── GET /rosters/change-requests/{id} ────────────────────────────────────────
@change_request_router.get("/{request_id}", response_model=DutyChangeRequestOut)
async def get_duty_change_request(
    request_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    dcr = await _get_dcr_or_404(db, request_id)
    # STAFF: only own
    if current_user.role == UserRoleEnum.STAFF:
        staff_id = await _resolve_staff_id(db, current_user)
        if dcr.staff_id != staff_id:
            raise HTTPException(status_code=403, detail="Access denied.")
    return await _build_out(db, dcr)


# ── POST /rosters/change-requests/{id}/approve ───────────────────────────────
@change_request_router.post("/{request_id}/approve", response_model=DutyChangeRequestOut)
async def approve_duty_change_request(
    request_id: int,
    payload: DutyChangeReviewIn = DutyChangeReviewIn(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Approve a duty change request (SHO / Admin SI / Super Admin only)."""
    if current_user.role not in APPROVER_ROLES:
        raise HTTPException(status_code=403, detail="Only SHO, Admin SI, or Super Admin can approve.")

    dcr = await _get_dcr_or_404(db, request_id)
    if dcr.status != DutyChangeRequestStatus.PENDING:
        raise HTTPException(status_code=400, detail=f"Cannot approve a request in '{dcr.status.value}' status.")

    now = datetime.now(timezone.utc)
    dcr.status = DutyChangeRequestStatus.APPROVED
    dcr.reviewed_by_id = current_user.id
    dcr.reviewed_at = now
    dcr.reviewer_remarks = payload.remarks

    # Make the approval real on the roster (409, leaving the request pending, if it cannot be applied).
    applied = await _apply_change(db, dcr, current_user, now)

    await log_event(db, actor=current_user, action="DUTY_CHANGE_APPROVED",
                    entity_type="DutyChangeRequest", entity_id=dcr.id,
                    old_values=applied["before"],
                    new_values={"status": "approved", "remarks": payload.remarks, "roster": applied["after"]})

    # Notify the requesting officer
    try:
        await notify_staff(
            db, dcr.staff_id,
            title="Duty Change Request Approved",
            message=f"Your duty change request for {dcr.current_roster_date} has been approved by {current_user.username}.",
            category="duty_change",
            entity_type="DutyChangeRequest",
            entity_id=dcr.id,
        )
    except Exception:
        pass

    await db.commit()
    await db.refresh(dcr)
    return await _build_out(db, dcr)


# ── POST /rosters/change-requests/{id}/reject ────────────────────────────────
@change_request_router.post("/{request_id}/reject", response_model=DutyChangeRequestOut)
async def reject_duty_change_request(
    request_id: int,
    payload: DutyChangeReviewIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Reject a duty change request (SHO / Admin SI / Super Admin only)."""
    if current_user.role not in APPROVER_ROLES:
        raise HTTPException(status_code=403, detail="Only SHO, Admin SI, or Super Admin can reject.")

    dcr = await _get_dcr_or_404(db, request_id)
    if dcr.status != DutyChangeRequestStatus.PENDING:
        raise HTTPException(status_code=400, detail=f"Cannot reject a request in '{dcr.status.value}' status.")

    if not payload.remarks or not payload.remarks.strip():
        raise HTTPException(status_code=422, detail="Remarks are required when rejecting.")

    now = datetime.now(timezone.utc)
    dcr.status = DutyChangeRequestStatus.REJECTED
    dcr.reviewed_by_id = current_user.id
    dcr.reviewed_at = now
    dcr.reviewer_remarks = payload.remarks

    await log_event(db, actor=current_user, action="DUTY_CHANGE_REJECTED",
                    entity_type="DutyChangeRequest", entity_id=dcr.id,
                    new_values={"status": "rejected", "remarks": payload.remarks})

    try:
        await notify_staff(
            db, dcr.staff_id,
            title="Duty Change Request Rejected",
            message=f"Your duty change request for {dcr.current_roster_date} was rejected. Reason: {payload.remarks}",
            category="duty_change",
            entity_type="DutyChangeRequest",
            entity_id=dcr.id,
        )
    except Exception:
        pass

    await db.commit()
    await db.refresh(dcr)
    return await _build_out(db, dcr)


# ── DELETE /rosters/change-requests/{id} (withdraw) ──────────────────────────
@change_request_router.delete("/{request_id}", status_code=200)
async def withdraw_duty_change_request(
    request_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Withdraw a pending duty change request (submitter only)."""
    dcr = await _get_dcr_or_404(db, request_id)

    if dcr.requested_by_user_id != current_user.id and current_user.role not in APPROVER_ROLES:
        raise HTTPException(status_code=403, detail="You can only withdraw your own requests.")

    if dcr.status != DutyChangeRequestStatus.PENDING:
        raise HTTPException(status_code=400, detail=f"Cannot withdraw a request in '{dcr.status.value}' status.")

    dcr.status = DutyChangeRequestStatus.WITHDRAWN
    dcr.reviewed_at = datetime.now(timezone.utc)

    await log_event(db, actor=current_user, action="DUTY_CHANGE_WITHDRAWN",
                    entity_type="DutyChangeRequest", entity_id=dcr.id,
                    new_values={"status": "withdrawn"})
    await db.commit()
    return {"detail": "Request withdrawn.", "id": request_id}


async def _get_dcr_or_404(db: AsyncSession, request_id: int) -> DutyChangeRequest:
    result = await db.execute(select(DutyChangeRequest).where(DutyChangeRequest.id == request_id))
    dcr = result.scalar_one_or_none()
    if not dcr:
        raise HTTPException(status_code=404, detail="Duty change request not found.")
    return dcr

