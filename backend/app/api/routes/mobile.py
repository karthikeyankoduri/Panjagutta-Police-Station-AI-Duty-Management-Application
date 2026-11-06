"""Staff-scoped endpoints for the native Android application."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db.database import get_db
from app.models.models import (
    Attendance,
    DutyMaster,
    LeaveRequest,
    Movement,
    Task,
    TaskStatus,
    Roster,
    RosterAssignment,
    RosterStatus,
    ShiftConfig,
    Staff,
    User,
    UserRoleEnum,
)
from app.services.audit import AuditAction, log_event
from app.services.shifts import now_local

router = APIRouter(prefix="/mobile", tags=["Mobile Staff"])


class MobileLeaveIn(BaseModel):
    start: date
    end: date
    kind: str = Field(min_length=1, max_length=100)


class MobileMovementIn(BaseModel):
    purpose: str = Field(min_length=1, max_length=500)
    destination: str = Field(min_length=1, max_length=255)
    expected_return: Optional[datetime] = None
    remarks: Optional[str] = None


class MobileTaskStatusIn(BaseModel):
    status: str


async def _linked_staff(db: AsyncSession, user: User) -> Staff:
    # Any role may use the mobile app, but only for its own linked staff profile
    # (imported officers such as SI/Inspector have non-STAFF roles).
    if not user.staff_id:
        raise HTTPException(status_code=403, detail="This login is not linked to a staff profile")
    result = await db.execute(
        select(Staff).where(Staff.id == user.staff_id, Staff.is_active == True)
    )
    person = result.scalar_one_or_none()
    if not person:
        raise HTTPException(status_code=403, detail="This account is not linked to an active staff profile")
    return person


async def _shift_times(db: AsyncSession) -> dict[str, tuple[str, str]]:
    result = await db.execute(
        select(ShiftConfig)
        .where(ShiftConfig.is_active == True)
        .order_by(ShiftConfig.version.desc())
    )
    times = {}
    for config in result.scalars().all():
        code = config.shift_code.value
        times.setdefault(
            code,
            (config.start_time.strftime("%H:%M"), config.end_time.strftime("%H:%M")),
        )
    return times


def _diary_entry(roster, assignment, duty, attendance, shift_times):
    shift_code = roster.shift_code.value
    start_time, end_time = shift_times.get(shift_code, ("", ""))
    submitted_at = attendance.submitted_at.isoformat() if attendance and attendance.submitted_at else None
    verified_at = attendance.verified_at.isoformat() if attendance and attendance.verified_at else None
    return {
        "roster_id": roster.id,
        "duty_date": roster.roster_date.isoformat(),
        "shift_name": shift_code,
        "start_time": start_time,
        "end_time": end_time,
        "duty_category": duty.category,
        "current_task": assignment.notes or duty.description,
        "attendance_submitted_at": submitted_at,
        "attendance_confirmed": bool(attendance and attendance.is_confirmed),
        "attendance_verified_at": verified_at,
        "check_in_at": attendance.check_in_at.isoformat() if attendance and attendance.check_in_at else None,
        "check_out_at": attendance.check_out_at.isoformat() if attendance and attendance.check_out_at else None,
        "is_late": bool(attendance and attendance.is_late),
    }


async def _assigned_diary_rows(
    db: AsyncSession,
    staff_id: int,
    start_date: date,
    end_date: date,
):
    return await db.execute(
        select(Roster, RosterAssignment, DutyMaster, Attendance)
        .join(RosterAssignment, RosterAssignment.roster_id == Roster.id)
        .join(DutyMaster, DutyMaster.id == RosterAssignment.duty_master_id)
        .outerjoin(
            Attendance,
            and_(
                Attendance.staff_id == staff_id,
                Attendance.attendance_date == Roster.roster_date,
                Attendance.shift_code == Roster.shift_code,
            ),
        )
        .where(
            RosterAssignment.staff_id == staff_id,
            Roster.status == RosterStatus.PUBLISHED,
            Roster.roster_date >= start_date,
            Roster.roster_date <= end_date,
        )
        .order_by(Roster.roster_date, Roster.shift_code, Roster.id, DutyMaster.category)
    )


@router.get("/me")
async def mobile_me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    person = await _linked_staff(db, user)
    return {
        "id": user.id,
        "staff_id": person.id,
        "username": user.username,
        "role": user.role.value,
        "name": person.name,
        "service_number": person.service_number,
        "designation": person.designation.value,
        "sector": f"Sector {person.sector_id}" if person.sector_id else None,
        "sector_id": person.sector_id,
        "section": person.section,
        "must_change_password": user.must_change_password,
    }


@router.get("/rosters")
async def mobile_rosters(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    person = await _linked_staff(db, user)
    shift_times = await _shift_times(db)
    rows = await _assigned_diary_rows(db, person.id, date.today(), date.max)
    return [
        _diary_entry(roster, assignment, duty, attendance, shift_times)
        for roster, assignment, duty, attendance in rows.all()
    ]


@router.get("/diary")
async def mobile_duty_diary(
    start_date: date,
    end_date: date,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="End date cannot be before start date")
    if end_date - start_date > timedelta(days=30):
        raise HTTPException(status_code=422, detail="Duty diary date range cannot exceed 31 days")
    person = await _linked_staff(db, user)
    shift_times = await _shift_times(db)
    rows = await _assigned_diary_rows(db, person.id, start_date, end_date)
    return [
        _diary_entry(roster, assignment, duty, attendance, shift_times)
        for roster, assignment, duty, attendance in rows.all()
    ]


@router.get("/attendance")
async def mobile_attendance(
    attendance_date: date = Query(default_factory=lambda: now_local().date()),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    person = await _linked_staff(db, user)
    shift_times = await _shift_times(db)
    rows = await _assigned_diary_rows(db, person.id, attendance_date, attendance_date)
    return [
        _diary_entry(roster, assignment, duty, attendance, shift_times)
        for roster, assignment, duty, attendance in rows.all()
    ]


@router.get("/leave")
async def mobile_leave(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    person = await _linked_staff(db, user)
    result = await db.execute(
        select(LeaveRequest)
        .where(LeaveRequest.staff_id == person.id)
        .order_by(LeaveRequest.submitted_at.desc())
    )
    return [
        {
            "id": item.id,
            "staff_id": item.staff_id,
            "kind": item.leave_type,
            "start": item.start_date.isoformat(),
            "end": item.end_date.isoformat(),
            "status": item.status.value,
            "remarks": item.remarks,
            "reference_number": item.reference_number,
            "approver_remarks": item.approver_remarks,
            "decision_at": item.decision_at.isoformat() if item.decision_at else None,
            "can_cancel": item.status.value == "Pending" or (item.status.value == "Approved" and item.start_date > date.today()),
            "submitted_at": item.submitted_at.isoformat() if item.submitted_at else None,
        }
        for item in result.scalars().all()
    ]


@router.post("/leave", status_code=201)
async def submit_mobile_leave(
    payload: MobileLeaveIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    person = await _linked_staff(db, user)
    from app.api.routes.operations import create_leave
    leave = await create_leave(db, user, person.id, payload.kind, payload.start, payload.end)
    await db.commit()
    return {"id": leave.id, "status": leave.status.value, "reference_number": leave.reference_number}


@router.post("/leave/{leave_id}/cancel")
async def cancel_mobile_leave(
    leave_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _linked_staff(db, user)
    from app.api.routes.operations import cancel_leave
    return await cancel_leave(leave_id, None, user, db)


@router.get("/attendance/history")
async def mobile_attendance_history(
    start_date: date = Query(default_factory=lambda: date.today() - timedelta(days=30)),
    end_date: date = Query(default_factory=date.today),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Own scheduled duties and attendance for a period (max 92 days)."""
    if end_date < start_date or end_date - start_date > timedelta(days=92):
        raise HTTPException(status_code=422, detail="Choose a range of up to 92 days")
    person = await _linked_staff(db, user)
    shift_times = await _shift_times(db)
    rows = await _assigned_diary_rows(db, person.id, start_date, end_date)
    entries = [_diary_entry(r, a, d, att, shift_times) for r, a, d, att in rows.all()]
    entries.sort(key=lambda e: (e["duty_date"], e["shift_name"]), reverse=True)
    return {
        "start_date": str(start_date), "end_date": str(end_date),
        "scheduled": len(entries),
        "submitted": sum(1 for e in entries if e["attendance_submitted_at"]),
        "verified": sum(1 for e in entries if e["attendance_confirmed"]),
        "present": sum(1 for e in entries if e["attendance_confirmed"]),
        "late": sum(1 for e in entries if e["is_late"]),
        "items": entries,
    }


@router.get("/movements")
async def mobile_movements(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    person = await _linked_staff(db, user)
    result = await db.execute(
        select(Movement).where(Movement.staff_id == person.id).order_by(Movement.created_at.desc()).limit(50))
    return [
        {
            "id": m.id, "purpose": m.purpose, "destination": m.destination, "status": m.status.value,
            "expected_return": m.expected_return.isoformat() if m.expected_return else None,
            "actual_departure": m.actual_departure.isoformat() if m.actual_departure else None,
            "actual_return": m.actual_return.isoformat() if m.actual_return else None,
            "is_overdue": m.is_overdue, "close_notes": m.close_notes,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in result.scalars().all()
    ]


@router.post("/movements", status_code=201)
async def request_mobile_movement(
    payload: MobileMovementIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Request permission to leave the station on official work (routed to the authorizing officers)."""
    person = await _linked_staff(db, user)
    from app.api.routes.operations import MovementIn, create_movement_record
    movement = await create_movement_record(db, user, MovementIn(
        staff_id=person.id, purpose=payload.purpose, destination=payload.destination,
        reference_remarks=payload.remarks, expected_return=payload.expected_return))
    await db.commit()
    return {"id": movement.id, "status": movement.status.value}


@router.post("/movements/{movement_id}/cancel")
async def cancel_mobile_movement(
    movement_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _linked_staff(db, user)
    from app.api.routes.operations import cancel_movement
    return await cancel_movement(movement_id, None, user, db)


@router.post("/movements/{movement_id}/return")
async def mobile_movement_return(
    movement_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _linked_staff(db, user)
    from app.api.routes.operations import record_return
    return await record_return(movement_id, None, None, user, db)


@router.get("/tasks")
async def mobile_tasks(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    person = await _linked_staff(db, user)
    result = await db.execute(select(Task).where(Task.assignee_id == person.id).order_by(Task.created_at.desc()).limit(50))
    return [
        {
            "id": t.id, "description": t.description, "status": t.status.value, "is_overdue": t.is_overdue,
            "category": t.category, "custom_title": t.custom_title,
            "expected_completion": t.expected_completion.isoformat() if t.expected_completion else None,
            "actual_completion": t.actual_completion.isoformat() if t.actual_completion else None,
        }
        for t in result.scalars().all()
    ]


@router.post("/tasks/{task_id}/status")
async def mobile_task_status(
    task_id: int,
    payload: MobileTaskStatusIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _linked_staff(db, user)
    from app.api.routes.operations import TaskStatusUpdate, update_task_status
    try:
        new_status = TaskStatus(payload.status)
    except ValueError:
        raise HTTPException(status_code=422, detail="Unknown task status")
    return await update_task_status(task_id, TaskStatusUpdate(new_status=new_status), user, db)
