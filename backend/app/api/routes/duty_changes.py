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
    Roster, RosterAssignment, DutyMaster, Staff, User, UserRoleEnum,
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

    # For STAFF: they can only request for themselves
    if current_user.role == UserRoleEnum.STAFF and not staff_id:
        raise HTTPException(status_code=403, detail="No linked staff profile.")

    from datetime import date as _date
    try:
        roster_date = _date.fromisoformat(payload.current_roster_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="current_roster_date must be YYYY-MM-DD.")

    dcr = DutyChangeRequest(
        roster_id=payload.roster_id,
        roster_assignment_id=payload.roster_assignment_id,
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

    # Apply roster assignment change if assignment_id is linked
    if dcr.roster_assignment_id:
        asn_res = await db.execute(
            select(RosterAssignment).where(RosterAssignment.id == dcr.roster_assignment_id)
        )
        asn = asn_res.scalar_one_or_none()
        if asn:
            if dcr.requested_duty_category:
                # Find matching duty master by category
                dm_res = await db.execute(
                    select(DutyMaster).where(DutyMaster.category == dcr.requested_duty_category, DutyMaster.is_active == True)
                )
                dm = dm_res.scalars().first()
                if dm:
                    asn.duty_master_id = dm.id
            asn.notes = (asn.notes or "") + f"\n[Duty change approved by {current_user.username} on {now.date()}]"

    await log_event(db, actor=current_user, action="DUTY_CHANGE_APPROVED",
                    entity_type="DutyChangeRequest", entity_id=dcr.id,
                    new_values={"status": "approved", "remarks": payload.remarks})

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

