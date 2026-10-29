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
    Roster,
    RosterAssignment,
    RosterStatus,
    ShiftConfig,
    Staff,
    User,
    UserRoleEnum,
)
from app.services.audit import AuditAction, log_event

router = APIRouter(prefix="/mobile", tags=["Mobile Staff"])


class MobileLeaveIn(BaseModel):
    start: date
    end: date
    kind: str = Field(min_length=1, max_length=100)


class MobileAttendanceIn(BaseModel):
    roster_id: int


async def _linked_staff(db: AsyncSession, user: User) -> Staff:
    if user.role != UserRoleEnum.STAFF or not user.staff_id:
        raise HTTPException(status_code=403, detail="A linked staff account is required")
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
        "sector": person.sector_id,
        "sector_id": person.sector_id,
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
    attendance_date: date = Query(default_factory=date.today),
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


@router.post("/attendance", status_code=201)
async def submit_mobile_attendance(
    payload: MobileAttendanceIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    person = await _linked_staff(db, user)
    roster_result = await db.execute(
        select(Roster).where(
            Roster.id == payload.roster_id,
            Roster.status == RosterStatus.PUBLISHED,
            Roster.roster_date == date.today(),
        )
    )
    roster = roster_result.scalar_one_or_none()
    if not roster:
        raise HTTPException(status_code=404, detail="Today's published roster was not found")

    assignment_result = await db.execute(
        select(RosterAssignment.id).where(
            RosterAssignment.roster_id == roster.id,
            RosterAssignment.staff_id == person.id,
        )
    )
    if assignment_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=403, detail="You are not assigned to this roster")

    existing_result = await db.execute(
        select(Attendance.id).where(
            Attendance.staff_id == person.id,
            Attendance.attendance_date == roster.roster_date,
            Attendance.shift_code == roster.shift_code,
        )
    )
    if existing_result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Attendance has already been submitted for this shift")

    attendance = Attendance(
        staff_id=person.id,
        attendance_date=roster.roster_date,
        shift_code=roster.shift_code,
        is_scheduled=True,
        submitted_by_id=user.id,
        submitted_at=datetime.now(timezone.utc),
    )
    db.add(attendance)
    await db.flush()
    await log_event(
        db,
        actor=user,
        action=AuditAction.ATTENDANCE_SUBMITTED,
        entity_type="Attendance",
        entity_id=attendance.id,
        new_values={
            "staff_id": person.id,
            "attendance_date": roster.roster_date.isoformat(),
            "shift_code": roster.shift_code.value,
        },
    )
    await db.commit()
    return {
        "id": attendance.id,
        "message": "Attendance submitted. Awaiting officer verification.",
        "submitted_at": attendance.submitted_at.isoformat(),
    }


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
    if payload.end < payload.start:
        raise HTTPException(status_code=422, detail="End date cannot be before start date")

    leave = LeaveRequest(
        staff_id=person.id,
        leave_type=payload.kind.strip(),
        start_date=payload.start,
        end_date=payload.end,
        submitted_by_id=user.id,
    )
    db.add(leave)
    await db.flush()
    await log_event(
        db,
        actor=user,
        action=AuditAction.LEAVE_REQUESTED,
        entity_type="LeaveRequest",
        entity_id=leave.id,
        new_values=payload.model_dump(mode="json"),
    )
    await db.commit()
    return {"id": leave.id, "status": leave.status.value}
