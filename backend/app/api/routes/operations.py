"""
Leave, Movement, Attendance and Task routes.
Every write is role-checked server-side, sector-scoped for Sector SIs, and audit-logged.
"""
from __future__ import annotations

from datetime import date as date_type, datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload

from app.auth.dependencies import (
    OFFICERS, STATION_ADMINS, SUPERVISORS, ensure_staff_in_scope, get_current_user,
    has_role, require_roles, sector_scope,
)
from app.db.database import get_db
from app.models.models import (
    Alert, User, UserRoleEnum, Staff,
    LeaveRequest, LeaveStatus,
    Movement, MovementStatus,
    Attendance, ShiftCode,
    Roster, RosterAssignment, RosterStatus,
    Task, TaskStatus,
)
from app.services.audit import log_event, AuditAction
from app.services.shifts import now_local
from app.services.task_categories import CATEGORY_LABELS, normalise as normalise_category
from app.services.notifications import (
    LEAVE_APPROVER_ROLES, MOVEMENT_APPROVER_ROLES, notify_roles, notify_staff, staff_sector,
)


async def _names(db: AsyncSession, staff_ids, user_ids=()) -> tuple[Dict[int, Staff], Dict[int, str]]:
    staff_ids = {i for i in staff_ids if i}
    user_ids = {i for i in user_ids if i}
    staff_map: Dict[int, Staff] = {}
    users: Dict[int, str] = {}
    if staff_ids:
        res = await db.execute(select(Staff).where(Staff.id.in_(staff_ids)))
        staff_map = {s.id: s for s in res.scalars().all()}
    if user_ids:
        res = await db.execute(select(User.id, User.username).where(User.id.in_(user_ids)))
        users = {uid: name for uid, name in res.all()}
    return staff_map, users


async def resolve_alerts(db: AsyncSession, alert_type: str, entity_type: str, entity_id: int, user: Optional[User]):
    """Close open alerts once the underlying condition is fixed (e.g. movement returned)."""
    res = await db.execute(select(Alert).where(
        Alert.alert_type == alert_type, Alert.entity_type == entity_type,
        Alert.entity_id == entity_id, Alert.is_resolved == False,
    ))
    for alert in res.scalars().all():
        alert.is_resolved = True
        alert.resolved_at = datetime.now(timezone.utc)
        alert.resolved_by_id = user.id if user else None


def _scope_staff_query(query, user: User, staff_column):
    """Apply STAFF (own records) and Sector SI (own sector) scoping to a query joined on staff."""
    if user.role == UserRoleEnum.STAFF:
        return query.where(staff_column == (user.staff_id or -1))
    scope = sector_scope(user)
    if scope is not None:
        return query.join(Staff, staff_column == Staff.id).where(Staff.sector_id == scope)
    return query


# ─────────────────────────────────────────────────────────────────────────────
# Leave
# ─────────────────────────────────────────────────────────────────────────────
leave_router = APIRouter(prefix="/leave", tags=["Leave"])


class LeaveRequestIn(BaseModel):
    staff_id: Optional[int] = None
    leave_type: str
    start_date: date_type
    end_date: date_type
    reference_number: Optional[str] = None
    remarks: Optional[str] = None


class LeaveDecisionIn(BaseModel):
    remarks: Optional[str] = None


async def create_leave(db: AsyncSession, user: User, staff_id: int, leave_type: str, start: date_type,
                       end: date_type, reference: Optional[str] = None, remarks: Optional[str] = None) -> LeaveRequest:
    """Shared by the web and mobile routes: validates, stores, audits and routes to the approvers."""
    if end < start:
        raise HTTPException(status_code=422, detail="End date cannot be before start date")
    if not leave_type or not leave_type.strip():
        raise HTTPException(status_code=422, detail="Leave type is required")
    overlap = await db.execute(select(LeaveRequest).where(
        LeaveRequest.staff_id == staff_id,
        LeaveRequest.status.in_([LeaveStatus.PENDING, LeaveStatus.APPROVED]),
        LeaveRequest.start_date <= end,
        LeaveRequest.end_date >= start,
    ))
    clash = overlap.scalars().first()
    if clash:
        raise HTTPException(
            status_code=409,
            detail=f"Overlaps an existing {clash.status.value.lower()} request "
                   f"({clash.start_date} to {clash.end_date}, ref {clash.reference_number or clash.id})",
        )
    leave = LeaveRequest(
        staff_id=staff_id, leave_type=leave_type.strip(), start_date=start, end_date=end,
        reference_number=(reference or "").strip() or None, remarks=remarks, submitted_by_id=user.id,
    )
    db.add(leave)
    await db.flush()
    if not leave.reference_number:
        leave.reference_number = f"LV/{start.year}/{leave.id:05d}"
    await log_event(db, actor=user, action=AuditAction.LEAVE_REQUESTED, entity_type="LeaveRequest",
                    entity_id=leave.id, new_values={
                        "staff_id": staff_id, "leave_type": leave.leave_type, "start_date": start,
                        "end_date": end, "reference_number": leave.reference_number, "remarks": remarks})
    staff_res = await db.execute(select(Staff).where(Staff.id == staff_id))
    person = staff_res.scalar_one_or_none()
    who = f"{person.name} ({person.service_number})" if person else f"Staff #{staff_id}"
    await notify_roles(db, LEAVE_APPROVER_ROLES, "Leave request awaiting decision",
                       f"{who} requested {leave.leave_type} from {start} to {end} (ref {leave.reference_number}).",
                       category="approval", entity_type="LeaveRequest", entity_id=leave.id,
                       sector_id=person.sector_id if person else None)
    return leave


@leave_router.post("/", status_code=201)
async def create_leave_request(
    payload: LeaveRequestIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    staff_id = payload.staff_id or current_user.staff_id
    if not staff_id:
        raise HTTPException(status_code=422, detail="Select the staff member the leave is for")
    if current_user.role == UserRoleEnum.STAFF and staff_id != current_user.staff_id:
        raise HTTPException(status_code=403, detail="Staff can only request their own leave")
    await ensure_staff_in_scope(db, current_user, staff_id)
    leave = await create_leave(db, current_user, staff_id, payload.leave_type, payload.start_date,
                               payload.end_date, payload.reference_number, payload.remarks)
    await db.commit()
    return {"id": leave.id, "status": leave.status.value, "reference_number": leave.reference_number,
            "routed_to": [r.value for r in LEAVE_APPROVER_ROLES]}


def _decision_remarks(payload: Optional[LeaveDecisionIn], remarks: Optional[str]) -> Optional[str]:
    return (payload.remarks if payload and payload.remarks else None) or remarks


@leave_router.post("/{leave_id}/approve")
async def approve_leave(
    leave_id: int,
    payload: Optional[LeaveDecisionIn] = None,
    remarks: Optional[str] = None,
    current_user: User = Depends(require_roles(*LEAVE_APPROVER_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    leave = await _get_leave_or_404(db, leave_id)
    if leave.status != LeaveStatus.PENDING:
        raise HTTPException(status_code=400, detail="Only pending leave requests can be approved")
    remarks = _decision_remarks(payload, remarks)

    old = {"status": leave.status.value}
    leave.status = LeaveStatus.APPROVED
    leave.approver_id = current_user.id
    leave.decision_at = datetime.now(timezone.utc)
    leave.approver_remarks = remarks

    # Approved leave removes eligibility: flag affected approved/published assignments (replacement assistant)
    conflict_asns = await db.execute(
        select(RosterAssignment, Roster)
        .join(Roster, RosterAssignment.roster_id == Roster.id)
        .where(
            RosterAssignment.staff_id == leave.staff_id,
            Roster.roster_date >= leave.start_date,
            Roster.roster_date <= leave.end_date,
            Roster.status.in_([RosterStatus.APPROVED, RosterStatus.PUBLISHED]),
        )
    )
    from app.models.models import DutyMaster
    replacement_alerts = []
    for asn, ros in conflict_asns.all():
        duty = await db.get(DutyMaster, asn.duty_master_id)
        alert_msg = (
            f"Approved leave created a vacancy in Roster #{ros.id} ({ros.roster_date} Shift {ros.shift_code.value}) "
            f"for duty '{duty.category if duty else asn.duty_master_id}'. Immediate replacement allocation required."
        )
        existing = await db.execute(select(Alert).where(
            Alert.alert_type == "ROSTER_VACANCY_REPLACEMENT_NEEDED", Alert.entity_type == "RosterAssignment",
            Alert.entity_id == asn.id, Alert.is_resolved == False))
        if not existing.scalars().first():
            db.add(Alert(alert_type="ROSTER_VACANCY_REPLACEMENT_NEEDED", entity_type="RosterAssignment",
                         entity_id=asn.id, severity="warning", message=alert_msg, is_resolved=False))
        replacement_alerts.append(alert_msg)
    if replacement_alerts:
        await notify_roles(db, (UserRoleEnum.ADMIN_SI,), "Vacancy created by approved leave",
                           " ".join(replacement_alerts), category="vacancy",
                           entity_type="LeaveRequest", entity_id=leave.id)

    await log_event(db, actor=current_user, action=AuditAction.LEAVE_APPROVED, entity_type="LeaveRequest",
                    entity_id=leave_id, old_values=old,
                    new_values={"status": "Approved", "remarks": remarks, "vacancies_created": len(replacement_alerts)})
    await notify_staff(db, leave.staff_id, "Leave approved",
                       f"Your {leave.leave_type} from {leave.start_date} to {leave.end_date} was approved."
                       + (f" Remarks: {remarks}" if remarks else ""),
                       category="decision", entity_type="LeaveRequest", entity_id=leave.id)
    await db.commit()
    return {
        "detail": "Leave approved. Coverage and roster eligibility updated.",
        "leave_id": leave_id,
        "replacement_alerts": replacement_alerts,
    }


@leave_router.post("/{leave_id}/reject")
async def reject_leave(
    leave_id: int,
    payload: Optional[LeaveDecisionIn] = None,
    remarks: Optional[str] = None,
    current_user: User = Depends(require_roles(*LEAVE_APPROVER_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    leave = await _get_leave_or_404(db, leave_id)
    if leave.status != LeaveStatus.PENDING:
        raise HTTPException(status_code=400, detail="Only pending leave requests can be rejected")
    remarks = _decision_remarks(payload, remarks)

    leave.status = LeaveStatus.REJECTED
    leave.approver_id = current_user.id
    leave.decision_at = datetime.now(timezone.utc)
    leave.approver_remarks = remarks

    await log_event(db, actor=current_user, action=AuditAction.LEAVE_REJECTED, entity_type="LeaveRequest",
                    entity_id=leave_id, old_values={"status": "Pending"},
                    new_values={"status": "Rejected", "remarks": remarks})
    await notify_staff(db, leave.staff_id, "Leave rejected",
                       f"Your {leave.leave_type} from {leave.start_date} to {leave.end_date} was rejected."
                       + (f" Remarks: {remarks}" if remarks else ""),
                       category="decision", entity_type="LeaveRequest", entity_id=leave.id)
    await db.commit()
    return {"detail": "Leave rejected", "leave_id": leave_id}


@leave_router.post("/{leave_id}/cancel")
async def cancel_leave(
    leave_id: int,
    payload: Optional[LeaveDecisionIn] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cancel a pending request (owner or approver) or an approved one (approver only, or owner before it starts)."""
    leave = await _get_leave_or_404(db, leave_id)
    is_owner = current_user.staff_id is not None and current_user.staff_id == leave.staff_id
    is_approver = has_role(current_user, LEAVE_APPROVER_ROLES)
    if not (is_owner or is_approver):
        raise HTTPException(status_code=403, detail="Only the requester or an approver can cancel this leave")
    if leave.status not in (LeaveStatus.PENDING, LeaveStatus.APPROVED):
        raise HTTPException(status_code=400, detail="Only pending or approved leave can be cancelled")
    if leave.status == LeaveStatus.APPROVED and not is_approver and leave.start_date <= date_type.today():
        raise HTTPException(status_code=400, detail="Leave that has already started can only be cancelled by an approver")

    old_status = leave.status.value
    leave.status = LeaveStatus.CANCELLED
    remarks = payload.remarks if payload else None
    if is_approver and not is_owner:
        leave.approver_id = current_user.id
        leave.decision_at = datetime.now(timezone.utc)
        leave.approver_remarks = remarks or leave.approver_remarks
    await log_event(db, actor=current_user, action=AuditAction.LEAVE_CANCELLED, entity_type="LeaveRequest",
                    entity_id=leave_id, old_values={"status": old_status},
                    new_values={"status": "Cancelled", "remarks": remarks})
    if not is_owner:
        await notify_staff(db, leave.staff_id, "Leave cancelled",
                           f"Your {leave.leave_type} from {leave.start_date} to {leave.end_date} was cancelled.",
                           category="decision", entity_type="LeaveRequest", entity_id=leave.id)
    await db.commit()
    return {"detail": "Leave cancelled", "leave_id": leave_id}


@leave_router.get("/")
async def list_leave_requests(
    staff_id: Optional[int] = Query(None),
    leave_status: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = _scope_staff_query(select(LeaveRequest), current_user, LeaveRequest.staff_id)
    if staff_id and current_user.role != UserRoleEnum.STAFF:
        query = query.where(LeaveRequest.staff_id == staff_id)
    if leave_status:
        query = query.where(LeaveRequest.status == leave_status)
    result = await db.execute(query.order_by(LeaveRequest.submitted_at.desc()))
    leaves = result.scalars().all()
    staff_map, users = await _names(db, [l.staff_id for l in leaves], [l.approver_id for l in leaves])
    return [
        {
            "id": l.id, "staff_id": l.staff_id,
            "staff_name": staff_map[l.staff_id].name if l.staff_id in staff_map else None,
            "service_number": staff_map[l.staff_id].service_number if l.staff_id in staff_map else None,
            "leave_type": l.leave_type,
            "start_date": str(l.start_date), "end_date": str(l.end_date),
            "days": (l.end_date - l.start_date).days + 1,
            "status": l.status.value, "reference_number": l.reference_number,
            "remarks": l.remarks,
            "approver_id": l.approver_id,
            "approver_username": users.get(l.approver_id),
            "approver_remarks": l.approver_remarks,
            "decision_at": l.decision_at.isoformat() if l.decision_at else None,
            "submitted_at": l.submitted_at.isoformat() if l.submitted_at else None,
        }
        for l in leaves
    ]


@leave_router.get("/{leave_id}/impact")
async def leave_impact(
    leave_id: int,
    current_user: User = Depends(require_roles(*LEAVE_APPROVER_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """Roster assignments that approving this leave would vacate (rule-based, shown before approval)."""
    leave = await _get_leave_or_404(db, leave_id)
    rows = await db.execute(
        select(RosterAssignment, Roster)
        .join(Roster, RosterAssignment.roster_id == Roster.id)
        .where(RosterAssignment.staff_id == leave.staff_id,
               Roster.roster_date >= leave.start_date, Roster.roster_date <= leave.end_date,
               Roster.status.in_([RosterStatus.SUBMITTED, RosterStatus.APPROVED, RosterStatus.PUBLISHED]))
    )
    from app.models.models import DutyMaster
    affected = []
    for asn, ros in rows.all():
        duty = await db.get(DutyMaster, asn.duty_master_id)
        affected.append({"roster_id": ros.id, "date": str(ros.roster_date), "shift": ros.shift_code.value,
                         "version": ros.version, "status": ros.status.value,
                         "duty": duty.category if duty else None})
    return {"leave_id": leave_id, "affected_assignments": affected, "vacancies_if_approved": len(affected)}


async def _get_leave_or_404(db, leave_id):
    result = await db.execute(select(LeaveRequest).where(LeaveRequest.id == leave_id))
    leave = result.scalar_one_or_none()
    if not leave:
        raise HTTPException(status_code=404, detail="Leave request not found")
    return leave


# ─────────────────────────────────────────────────────────────────────────────
# Outside Movements
# ─────────────────────────────────────────────────────────────────────────────
movement_router = APIRouter(prefix="/movements", tags=["Movements"])


class MovementIn(BaseModel):
    staff_id: Optional[int] = None
    purpose: str
    destination: str
    reference_remarks: Optional[str] = None
    expected_return: Optional[datetime] = None


class MovementReturnIn(BaseModel):
    close_notes: Optional[str] = None


class MovementDecisionIn(BaseModel):
    notes: Optional[str] = None


async def create_movement_record(db: AsyncSession, user: User, payload: MovementIn) -> Movement:
    """Shared by web and mobile. Staff requests wait for authorization; officers record authorized movements."""
    staff_id = payload.staff_id or user.staff_id
    if not staff_id:
        raise HTTPException(status_code=422, detail="Select the staff member who is moving out")
    if not payload.purpose.strip() or not payload.destination.strip():
        raise HTTPException(status_code=422, detail="Purpose and destination are required")
    if user.role == UserRoleEnum.STAFF and staff_id != user.staff_id:
        raise HTTPException(status_code=403, detail="Staff can only submit their own movement requests")
    await ensure_staff_in_scope(db, user, staff_id)
    expected = payload.expected_return
    if expected is not None and expected.tzinfo is None:
        expected = expected.replace(tzinfo=timezone.utc)
    if expected is not None and expected < datetime.now(timezone.utc):
        raise HTTPException(status_code=422, detail="Expected return must be in the future")

    # Officers record movements they authorize themselves; staff requests wait for authorization.
    officer = user.role != UserRoleEnum.STAFF and has_role(user, OFFICERS)
    initial_status = MovementStatus.AUTHORIZED if officer else MovementStatus.PENDING_AUTHORIZATION
    now = datetime.now(timezone.utc)
    movement = Movement(
        staff_id=staff_id,
        purpose=payload.purpose.strip(),
        destination=payload.destination.strip(),
        reference_remarks=payload.reference_remarks,
        expected_return=expected,
        status=initial_status,
        authorizing_officer_id=user.id if officer else None,
        authorized_at=now if officer else None,
        created_by_id=user.id,
    )
    db.add(movement)
    await db.flush()
    await log_event(db, actor=user, action=AuditAction.MOVEMENT_CREATED, entity_type="Movement",
                    entity_id=movement.id, new_values={**payload.model_dump(mode="json"), "staff_id": staff_id,
                                                       "status": initial_status.value},
                    authorizer=user if officer else None)
    if not officer:
        await notify_roles(db, MOVEMENT_APPROVER_ROLES, "Movement request awaiting authorization",
                           f"Staff #{staff_id} requests to go to {movement.destination} ({movement.purpose}).",
                           category="approval", entity_type="Movement", entity_id=movement.id,
                           sector_id=await staff_sector(db, staff_id))
    return movement


@movement_router.post("/", status_code=201)
async def create_movement(
    payload: MovementIn,
    current_user: User = Depends(require_roles(*OFFICERS, UserRoleEnum.STAFF)),
    db: AsyncSession = Depends(get_db),
):
    movement = await create_movement_record(db, current_user, payload)
    await db.commit()
    return {"id": movement.id, "status": movement.status.value}


@movement_router.post("/{movement_id}/authorize")
async def authorize_movement(
    movement_id: int,
    current_user: User = Depends(require_roles(*MOVEMENT_APPROVER_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    movement = await _get_movement_or_404(db, movement_id)
    await ensure_staff_in_scope(db, current_user, movement.staff_id)
    if movement.status != MovementStatus.PENDING_AUTHORIZATION:
        raise HTTPException(status_code=400, detail="Only movements awaiting authorization can be authorized")
    now = datetime.now(timezone.utc)
    movement.status = MovementStatus.AUTHORIZED
    movement.authorizing_officer_id = current_user.id
    movement.actual_departure = now
    movement.authorized_at = now
    await log_event(db, actor=current_user, action=AuditAction.MOVEMENT_AUTHORIZED, entity_type="Movement",
                    entity_id=movement_id, old_values={"status": "pending_authorization"},
                    new_values={"status": "authorized"}, authorizer=current_user)
    await notify_staff(db, movement.staff_id, "Movement authorized",
                       f"Your movement to {movement.destination} was authorized.",
                       category="decision", entity_type="Movement", entity_id=movement.id)
    await db.commit()
    return {"detail": "Movement authorized and departed", "status": movement.status.value}


@movement_router.post("/{movement_id}/reject")
async def reject_movement(
    movement_id: int,
    payload: Optional[MovementDecisionIn] = None,
    current_user: User = Depends(require_roles(*MOVEMENT_APPROVER_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    movement = await _get_movement_or_404(db, movement_id)
    await ensure_staff_in_scope(db, current_user, movement.staff_id)
    if movement.status != MovementStatus.PENDING_AUTHORIZATION:
        raise HTTPException(status_code=400, detail="Only movements awaiting authorization can be rejected")
    notes = payload.notes if payload else None
    movement.status = MovementStatus.CANCELLED
    movement.closed_by_id = current_user.id
    movement.close_notes = f"Rejected: {notes}" if notes else "Rejected by authorizing officer"
    await log_event(db, actor=current_user, action=AuditAction.MOVEMENT_REJECTED, entity_type="Movement",
                    entity_id=movement_id, old_values={"status": "pending_authorization"},
                    new_values={"status": "cancelled", "notes": notes})
    await notify_staff(db, movement.staff_id, "Movement request rejected",
                       f"Your movement request to {movement.destination} was not authorized."
                       + (f" Notes: {notes}" if notes else ""),
                       category="decision", entity_type="Movement", entity_id=movement.id)
    await db.commit()
    return {"detail": "Movement request rejected", "status": movement.status.value}


@movement_router.post("/{movement_id}/cancel")
async def cancel_movement(
    movement_id: int,
    payload: Optional[MovementDecisionIn] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    movement = await _get_movement_or_404(db, movement_id)
    is_owner = current_user.staff_id is not None and current_user.staff_id == movement.staff_id
    if not is_owner:
        if not has_role(current_user, MOVEMENT_APPROVER_ROLES):
            raise HTTPException(status_code=403, detail="Only the requester or an authorizing officer can cancel")
        await ensure_staff_in_scope(db, current_user, movement.staff_id)
    if movement.status not in (MovementStatus.PENDING_AUTHORIZATION, MovementStatus.AUTHORIZED):
        raise HTTPException(status_code=400, detail="Only a movement that has not departed can be cancelled")
    if is_owner and movement.status != MovementStatus.PENDING_AUTHORIZATION and not has_role(current_user, MOVEMENT_APPROVER_ROLES):
        raise HTTPException(status_code=400, detail="An authorized movement can only be cancelled by an officer")
    old = movement.status.value
    movement.status = MovementStatus.CANCELLED
    movement.closed_by_id = current_user.id
    movement.close_notes = (payload.notes if payload else None) or "Cancelled"
    await log_event(db, actor=current_user, action=AuditAction.MOVEMENT_CANCELLED, entity_type="Movement",
                    entity_id=movement_id, old_values={"status": old}, new_values={"status": "cancelled"})
    await db.commit()
    return {"detail": "Movement cancelled", "status": movement.status.value}


@movement_router.post("/{movement_id}/depart")
async def record_departure(
    movement_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    movement = await _get_movement_or_404(db, movement_id)
    is_owner = current_user.staff_id is not None and current_user.staff_id == movement.staff_id
    if not is_owner:
        if not has_role(current_user, MOVEMENT_APPROVER_ROLES):
            raise HTTPException(status_code=403, detail="Not allowed to record departure for this movement")
        await ensure_staff_in_scope(db, current_user, movement.staff_id)
    if movement.status != MovementStatus.AUTHORIZED:
        raise HTTPException(status_code=400, detail="Movement must be authorized before recording departure")
    movement.status = MovementStatus.OPEN
    movement.actual_departure = datetime.now(timezone.utc)
    await log_event(db, actor=current_user, action=AuditAction.MOVEMENT_DEPARTED, entity_type="Movement",
                    entity_id=movement_id, old_values={"status": "authorized"}, new_values={"status": "open"})
    await db.commit()
    return {"detail": "Departure recorded. Staff now shown as Outside on Official Duty."}


@movement_router.post("/{movement_id}/return")
async def record_return(
    movement_id: int,
    payload: Optional[MovementReturnIn] = None,
    notes: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    movement = await _get_movement_or_404(db, movement_id)
    is_owner = current_user.staff_id is not None and movement.staff_id == current_user.staff_id
    if not is_owner:
        if current_user.role == UserRoleEnum.STAFF or not has_role(current_user, OFFICERS):
            raise HTTPException(status_code=403, detail="Staff can only mark their own movement as returned")
        await ensure_staff_in_scope(db, current_user, movement.staff_id)
    if movement.status not in (MovementStatus.AUTHORIZED, MovementStatus.OPEN, MovementStatus.OVERDUE):
        raise HTTPException(status_code=400, detail="Movement must be open/overdue to record return")
    old = movement.status.value
    movement.status = MovementStatus.RETURNED
    movement.actual_return = datetime.now(timezone.utc)
    movement.close_notes = payload.close_notes if payload and payload.close_notes else notes
    movement.closed_by_id = current_user.id
    await resolve_alerts(db, "MOVEMENT_OVERDUE", "Movement", movement.id, current_user)
    await log_event(db, actor=current_user, action=AuditAction.MOVEMENT_RETURNED, entity_type="Movement",
                    entity_id=movement_id, old_values={"status": old},
                    new_values={"status": "returned", "was_overdue": movement.is_overdue,
                                "close_notes": movement.close_notes})
    await db.commit()
    return {"detail": "Return recorded. Staff availability recalculated."}


@movement_router.get("/")
async def list_movements(
    staff_id: Optional[int] = Query(None),
    mov_status: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = _scope_staff_query(select(Movement), current_user, Movement.staff_id)
    if staff_id and current_user.role != UserRoleEnum.STAFF:
        query = query.where(Movement.staff_id == staff_id)
    if mov_status:
        query = query.where(Movement.status == mov_status)
    result = await db.execute(query.order_by(Movement.created_at.desc()))
    movements = result.scalars().all()
    staff_map, users = await _names(
        db, [m.staff_id for m in movements],
        [m.authorizing_officer_id for m in movements] + [m.closed_by_id for m in movements])
    return [
        {
            "id": m.id, "staff_id": m.staff_id,
            "staff_name": staff_map[m.staff_id].name if m.staff_id in staff_map else None,
            "service_number": staff_map[m.staff_id].service_number if m.staff_id in staff_map else None,
            "purpose": m.purpose, "destination": m.destination, "status": m.status.value,
            "reference_remarks": m.reference_remarks,
            "expected_return": m.expected_return.isoformat() if m.expected_return else None,
            "actual_departure": m.actual_departure.isoformat() if m.actual_departure else None,
            "actual_return": m.actual_return.isoformat() if m.actual_return else None,
            "authorized_at": m.authorized_at.isoformat() if m.authorized_at else None,
            "authorizing_officer": users.get(m.authorizing_officer_id),
            "closed_by": users.get(m.closed_by_id),
            "close_notes": m.close_notes,
            "is_overdue": m.is_overdue,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in movements
    ]


async def _get_movement_or_404(db, movement_id):
    result = await db.execute(select(Movement).where(Movement.id == movement_id))
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail="Movement not found")
    return m


# ─────────────────────────────────────────────────────────────────────────────
# Attendance
# ─────────────────────────────────────────────────────────────────────────────
attendance_router = APIRouter(prefix="/attendance", tags=["Attendance"])


async def _resolve_self_staff_id(db: AsyncSession, user: User) -> Optional[int]:
    from app.services.attendance_auto import resolve_staff_id
    return await resolve_staff_id(db, user)


@attendance_router.get("/")
async def get_attendance(
    attendance_date: Optional[date_type] = Query(None),
    start_date: Optional[date_type] = Query(None),
    end_date: Optional[date_type] = Query(None),
    shift_code: Optional[ShiftCode] = Query(None),
    staff_id: Optional[int] = Query(None),
    own_only: Optional[bool] = Query(False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    resolved_self_staff_id = await _resolve_self_staff_id(db, current_user)

    query = select(Attendance).options(selectinload(Attendance.staff))

    # Date range query (e.g. for calendar view) or single date query
    if start_date and end_date:
        query = query.where(Attendance.attendance_date.between(start_date, end_date))
    else:
        target_date = attendance_date or now_local().date()
        query = query.where(Attendance.attendance_date == target_date)

    if shift_code:
        query = query.where(Attendance.shift_code == shift_code)

    # Scoping Rule 1: General Staff can ONLY view their own attendance
    if current_user.role == UserRoleEnum.STAFF:
        if not resolved_self_staff_id:
            return []
        query = query.where(Attendance.staff_id == resolved_self_staff_id)

    # Scoping Rule 2: Supervisor viewing their own personal attendance
    elif own_only:
        if not resolved_self_staff_id:
            return []
        query = query.where(Attendance.staff_id == resolved_self_staff_id)

    # Scoping Rule 3: Sector SI scoped to their assigned sector
    elif current_user.role == UserRoleEnum.SECTOR_SI:
        query = (
            query.join(Staff, Attendance.staff_id == Staff.id)
            .where(Staff.sector_id == current_user.sector_id)
        )

    # Scoping Rule 4: Optional staff_id filter for station supervisors
    elif staff_id:
        query = query.where(Attendance.staff_id == staff_id)

    query = query.order_by(Attendance.attendance_date.asc(), Attendance.id.asc())
    result = await db.execute(query)
    records = result.scalars().all()
    _, users = await _names(db, [], [a.verified_by_id for a in records] + [a.submitted_by_id for a in records])
    return [
        {
            "id": a.id,
            "staff_id": a.staff_id,
            "staff_name": a.staff.name if a.staff else f"Staff #{a.staff_id}",
            "service_number": a.staff.service_number if a.staff else "",
            "designation": a.staff.designation.value if (a.staff and hasattr(a.staff.designation, "value")) else (str(a.staff.designation) if a.staff else ""),
            "sector_id": a.staff.sector_id if a.staff else None,
            "attendance_date": str(a.attendance_date),
            "shift_code": a.shift_code.value,
            "is_scheduled": a.is_scheduled,
            "is_confirmed": a.is_confirmed,
            "submitted_by_id": a.submitted_by_id,
            "submitted_by": users.get(a.submitted_by_id),
            "submitted_at": a.submitted_at.isoformat() if a.submitted_at else None,
            "verified_by_id": a.verified_by_id,
            "verified_by": users.get(a.verified_by_id),
            "verified_at": a.verified_at.isoformat() if a.verified_at else None,
            "notes": a.notes,
            "check_in_at": a.check_in_at.isoformat() if a.check_in_at else None,
            "check_out_at": a.check_out_at.isoformat() if a.check_out_at else None,
            "is_late": bool(a.is_late),
            "source": a.source or "MANUAL",
        }
        for a in records
    ]


@attendance_router.get("/current-shift")
async def attendance_current_shift(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The shift running now (station time) and its duty date, so screens open on the right shift."""
    from app.services.shifts import current_shift, load_shift_timings
    code, duty_date = current_shift(await load_shift_timings(db))
    return {"shift_code": code.value, "date": str(duty_date)}


@attendance_router.get("/scheduled")
async def scheduled_vs_confirmed(
    attendance_date: date_type = Query(default_factory=lambda: now_local().date()),
    shift_code: ShiftCode = Query(...),
    current_user: User = Depends(require_roles(*OFFICERS)),
    db: AsyncSession = Depends(get_db),
):
    """Scheduled duty (latest published roster) side by side with confirmed attendance (guide step 16)."""
    from app.services.availability import latest_published_rosters
    latest = await latest_published_rosters(db, attendance_date, attendance_date)
    roster = latest.get((attendance_date, shift_code))
    scheduled_ids: List[int] = []
    if roster:
        res = await db.execute(select(RosterAssignment.staff_id).where(RosterAssignment.roster_id == roster.id))
        scheduled_ids = sorted(set(res.scalars().all()))
    att_q = select(Attendance).where(Attendance.attendance_date == attendance_date, Attendance.shift_code == shift_code)
    att = {a.staff_id: a for a in (await db.execute(att_q)).scalars().all()}
    ids = set(scheduled_ids) | set(att)
    staff_map, _ = await _names(db, ids)
    scope = sector_scope(current_user)
    rows = []
    for sid in sorted(ids):
        s = staff_map.get(sid)
        if scope is not None and (not s or s.sector_id != scope):
            continue
        a = att.get(sid)
        rows.append({
            "staff_id": sid, "name": s.name if s else None, "service_number": s.service_number if s else None,
            "scheduled": sid in scheduled_ids,
            "submitted": bool(a and a.submitted_at), "confirmed": bool(a and a.is_confirmed),
            "attendance_id": a.id if a else None,
            "check_in_at": a.check_in_at.isoformat() if a and a.check_in_at else None,
            "check_out_at": a.check_out_at.isoformat() if a and a.check_out_at else None,
            "is_late": bool(a and a.is_late),
        })
    return {
        "date": str(attendance_date), "shift": shift_code.value,
        "roster_id": roster.id if roster else None,
        "scheduled": sum(1 for r in rows if r["scheduled"]),
        "confirmed": sum(1 for r in rows if r["confirmed"]),
        "scheduled_not_confirmed": sum(1 for r in rows if r["scheduled"] and not r["confirmed"]),
        "confirmed_not_scheduled": sum(1 for r in rows if r["confirmed"] and not r["scheduled"]),
        "rows": rows,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Tasks
# ─────────────────────────────────────────────────────────────────────────────
task_router = APIRouter(prefix="/tasks", tags=["Tasks"])


class TaskIn(BaseModel):
    description: str
    category: str  # required for every new task
    custom_title: Optional[str] = None  # the header for category OTHERS
    assignee_id: int
    reporting_officer_id: Optional[int] = None
    start_time: Optional[datetime] = None
    expected_completion: Optional[datetime] = None


class TaskUpdateIn(BaseModel):
    description: Optional[str] = None
    category: Optional[str] = None
    custom_title: Optional[str] = None
    assignee_id: Optional[int] = None
    reporting_officer_id: Optional[int] = None
    expected_completion: Optional[datetime] = None


class TaskStatusUpdate(BaseModel):
    new_status: TaskStatus
    notes: Optional[str] = None


def _task_out(t: Task, staff_map: Dict[int, Staff]) -> dict:
    a = staff_map.get(t.assignee_id)
    r = staff_map.get(t.reporting_officer_id) if t.reporting_officer_id else None
    return {
        "id": t.id, "description": t.description,
        "category": t.category, "category_label": CATEGORY_LABELS.get(t.category, "Others"),
        "custom_title": t.custom_title,
        "group_title": (t.custom_title or CATEGORY_LABELS.get(t.category, "Others")) if t.category == "OTHERS"
        else CATEGORY_LABELS.get(t.category, "Others"),
        "assignee_id": t.assignee_id,
        "assignee_name": a.name if a else None,
        "assignee_service_number": a.service_number if a else None,
        "assignee_sector_id": a.sector_id if a else None,
        "reporting_officer_id": t.reporting_officer_id,
        "reporting_officer_name": r.name if r else None,
        "status": t.status.value, "is_overdue": t.is_overdue,
        "start_time": t.start_time.isoformat() if t.start_time else None,
        "expected_completion": t.expected_completion.isoformat() if t.expected_completion else None,
        "actual_completion": t.actual_completion.isoformat() if t.actual_completion else None,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


@task_router.post("/", status_code=201)
async def create_task(
    payload: TaskIn,
    current_user: User = Depends(require_roles(*SUPERVISORS)),
    db: AsyncSession = Depends(get_db),
):
    await ensure_staff_in_scope(db, current_user, payload.assignee_id)
    if payload.expected_completion and payload.start_time and payload.expected_completion < payload.start_time:
        raise HTTPException(status_code=422, detail="Expected completion cannot be before the start time")
    try:
        category, custom_title = normalise_category(payload.category, payload.custom_title)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    fields = payload.model_dump()
    fields.update(category=category, custom_title=custom_title)
    task = Task(**fields, created_by_id=current_user.id)
    if task.start_time is None:
        task.start_time = datetime.now(timezone.utc)
    db.add(task)
    await db.flush()
    await log_event(db, actor=current_user, action=AuditAction.TASK_CREATED, entity_type="Task",
                    entity_id=task.id, new_values=payload.model_dump(mode="json"))
    heading = custom_title if category == "OTHERS" else CATEGORY_LABELS[category]
    await notify_staff(db, payload.assignee_id, f"New task assigned · {heading}", payload.description[:200],
                       category="task", entity_type="Task", entity_id=task.id)
    await db.commit()
    return {"id": task.id, "status": task.status.value}


@task_router.patch("/{task_id}")
async def update_task(
    task_id: int,
    payload: TaskUpdateIn,
    current_user: User = Depends(require_roles(*SUPERVISORS)),
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await ensure_staff_in_scope(db, current_user, task.assignee_id)
    changes = payload.model_dump(exclude_none=True)
    if "category" in changes or "custom_title" in changes:
        try:
            changes["category"], changes["custom_title"] = normalise_category(
                changes.get("category", task.category), changes.get("custom_title", task.custom_title))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
    if "assignee_id" in changes:
        await ensure_staff_in_scope(db, current_user, changes["assignee_id"])
    old = {k: getattr(task, k) for k in changes}
    for k, v in changes.items():
        setattr(task, k, v)
    if "expected_completion" in changes:
        task.is_overdue = False
    await log_event(db, actor=current_user, action=AuditAction.TASK_UPDATED, entity_type="Task",
                    entity_id=task_id, old_values=old, new_values=changes)
    await db.commit()
    return {"detail": "Task updated", "task_id": task_id}


@task_router.patch("/{task_id}/status")
async def update_task_status(
    task_id: int,
    payload: TaskStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # The assignee (responsible user) may update progress; supervisors within scope may update any task.
    is_assignee = current_user.staff_id is not None and current_user.staff_id == task.assignee_id
    if not is_assignee:
        if not has_role(current_user, SUPERVISORS):
            raise HTTPException(status_code=403, detail="Only the assignee or a supervising officer can update this task")
        await ensure_staff_in_scope(db, current_user, task.assignee_id)
    if is_assignee and not has_role(current_user, SUPERVISORS) and payload.new_status == TaskStatus.CANCELLED:
        raise HTTPException(status_code=403, detail="Only a supervising officer can cancel a task")

    old_status = task.status
    task.status = payload.new_status
    if payload.new_status == TaskStatus.COMPLETED:
        task.actual_completion = datetime.now(timezone.utc)
        task.is_overdue = False
    if payload.new_status in (TaskStatus.COMPLETED, TaskStatus.CANCELLED):
        await resolve_alerts(db, "TASK_OVERDUE", "Task", task.id, current_user)

    await log_event(db, actor=current_user, action=AuditAction.TASK_UPDATED, entity_type="Task",
                    entity_id=task_id, old_values={"status": old_status.value},
                    new_values={"status": payload.new_status.value, "notes": payload.notes})
    await db.commit()
    return {"detail": "Task status updated", "task_id": task_id, "new_status": payload.new_status.value}


@task_router.get("/")
async def list_tasks(
    assignee_id: Optional[int] = Query(None),
    task_status: Optional[str] = Query(None),
    overdue_only: bool = Query(False),
    category: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = _scope_staff_query(select(Task), current_user, Task.assignee_id)
    if assignee_id and current_user.role != UserRoleEnum.STAFF:
        query = query.where(Task.assignee_id == assignee_id)
    if task_status:
        query = query.where(Task.status == task_status)
    if overdue_only:
        query = query.where(Task.is_overdue == True)
    if category:
        query = query.where(Task.category == category.strip().upper())
    result = await db.execute(query.order_by(Task.created_at.desc()))
    tasks = result.scalars().all()
    staff_map, _ = await _names(db, [t.assignee_id for t in tasks] + [t.reporting_officer_id for t in tasks])
    return [_task_out(t, staff_map) for t in tasks]


@task_router.get("/current")
async def current_task_per_person(
    current_user: User = Depends(require_roles(*OFFICERS)),
    db: AsyncSession = Depends(get_db),
):
    """Current task per person (guide §10 Tasks): the most recent open task for each assignee."""
    query = _scope_staff_query(
        select(Task).where(Task.status.in_([TaskStatus.NOT_STARTED, TaskStatus.IN_PROGRESS, TaskStatus.ON_HOLD])),
        current_user, Task.assignee_id,
    )
    tasks = (await db.execute(query.order_by(Task.created_at.desc()))).scalars().all()
    latest: Dict[int, Task] = {}
    for t in tasks:
        latest.setdefault(t.assignee_id, t)
    staff_map, _ = await _names(db, list(latest) + [t.reporting_officer_id for t in latest.values()])
    return [_task_out(t, staff_map) for t in latest.values()]
