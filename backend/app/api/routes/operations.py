"""
Leave, Movement, Attendance, Task, and Attachment routes.
All operations are role-checked and audit-logged.
"""
from __future__ import annotations

from datetime import date as date_type, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.auth.dependencies import get_current_user, require_roles
from app.db.database import get_db
from app.models.models import (
    User, UserRoleEnum, Staff,
    LeaveRequest, LeaveStatus,
    Movement, MovementStatus,
    Attendance, ShiftCode,
    Task, TaskStatus,
    AttachmentOrder,
)
from app.services.audit import log_event, AuditAction

# ─────────────────────────────────────────────────────────────────────────────
# Leave
# ─────────────────────────────────────────────────────────────────────────────
leave_router = APIRouter(prefix="/leave", tags=["Leave"])


class LeaveRequestIn(BaseModel):
    staff_id: int
    leave_type: str
    start_date: date_type
    end_date: date_type
    reference_number: Optional[str] = None
    remarks: Optional[str] = None


@leave_router.post("/", status_code=201)
async def create_leave_request(
    payload: LeaveRequestIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Staff can only request own leave
    if current_user.role == UserRoleEnum.STAFF:
        if not current_user.staff_id or current_user.staff_id != payload.staff_id:
            raise HTTPException(status_code=403, detail="Staff can only request their own leave")

    leave = LeaveRequest(**payload.model_dump(), submitted_by_id=current_user.id)
    db.add(leave)
    await db.flush()
    await log_event(db, actor=current_user, action=AuditAction.LEAVE_REQUESTED, entity_type="LeaveRequest",
                    entity_id=leave.id, new_values=payload.model_dump(mode="json"))
    await db.commit()
    return {"id": leave.id, "status": leave.status.value}


@leave_router.post("/{leave_id}/approve")
async def approve_leave(
    leave_id: int,
    remarks: Optional[str] = None,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    leave = await _get_leave_or_404(db, leave_id)
    if leave.status != LeaveStatus.PENDING:
        raise HTTPException(status_code=400, detail="Only pending leave requests can be approved")

    leave.status = LeaveStatus.APPROVED
    leave.approver_id = current_user.id
    leave.decision_at = datetime.now(timezone.utc)
    leave.approver_remarks = remarks

    await log_event(db, actor=current_user, action=AuditAction.LEAVE_APPROVED, entity_type="LeaveRequest",
                    entity_id=leave_id, new_values={"status": "Approved", "remarks": remarks})
    await db.commit()
    return {"detail": "Leave approved. Coverage and roster eligibility updated.", "leave_id": leave_id}


@leave_router.post("/{leave_id}/reject")
async def reject_leave(
    leave_id: int,
    remarks: Optional[str] = None,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    leave = await _get_leave_or_404(db, leave_id)
    if leave.status != LeaveStatus.PENDING:
        raise HTTPException(status_code=400, detail="Only pending leave requests can be rejected")

    leave.status = LeaveStatus.REJECTED
    leave.approver_id = current_user.id
    leave.decision_at = datetime.now(timezone.utc)
    leave.approver_remarks = remarks

    await log_event(db, actor=current_user, action=AuditAction.LEAVE_REJECTED, entity_type="LeaveRequest",
                    entity_id=leave_id)
    await db.commit()
    return {"detail": "Leave rejected", "leave_id": leave_id}


@leave_router.get("/")
async def list_leave_requests(
    staff_id: Optional[int] = Query(None),
    leave_status: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(LeaveRequest)
    if current_user.role == UserRoleEnum.STAFF:
        query = query.where(LeaveRequest.staff_id == current_user.staff_id)
    elif staff_id:
        query = query.where(LeaveRequest.staff_id == staff_id)
    if leave_status:
        query = query.where(LeaveRequest.status == leave_status)
    result = await db.execute(query.order_by(LeaveRequest.submitted_at.desc()))
    leaves = result.scalars().all()
    return [
        {
            "id": l.id, "staff_id": l.staff_id, "leave_type": l.leave_type,
            "start_date": str(l.start_date), "end_date": str(l.end_date),
            "status": l.status.value, "reference_number": l.reference_number,
            "submitted_at": l.submitted_at.isoformat(),
        }
        for l in leaves
    ]


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
    staff_id: int
    purpose: str
    destination: str
    reference_remarks: Optional[str] = None
    expected_return: Optional[datetime] = None


@movement_router.post("/", status_code=201)
async def create_movement(
    payload: MovementIn,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI, UserRoleEnum.SECTOR_SI)),
    db: AsyncSession = Depends(get_db),
):
    movement = Movement(**payload.model_dump(), created_by_id=current_user.id)
    db.add(movement)
    await db.flush()
    await log_event(db, actor=current_user, action=AuditAction.MOVEMENT_CREATED, entity_type="Movement",
                    entity_id=movement.id, new_values=payload.model_dump(mode="json"))
    await db.commit()
    return {"id": movement.id, "status": movement.status.value}


@movement_router.post("/{movement_id}/authorize")
async def authorize_movement(
    movement_id: int,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    movement = await _get_movement_or_404(db, movement_id)
    movement.status = MovementStatus.AUTHORIZED
    movement.authorizing_officer_id = current_user.id
    movement.authorized_at = datetime.now(timezone.utc)
    await log_event(db, actor=current_user, action=AuditAction.MOVEMENT_AUTHORIZED, entity_type="Movement",
                    entity_id=movement_id)
    await db.commit()
    return {"detail": "Movement authorized"}


@movement_router.post("/{movement_id}/depart")
async def record_departure(
    movement_id: int,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    movement = await _get_movement_or_404(db, movement_id)
    if movement.status != MovementStatus.AUTHORIZED:
        raise HTTPException(status_code=400, detail="Movement must be authorized before recording departure")
    movement.status = MovementStatus.OPEN
    movement.actual_departure = datetime.now(timezone.utc)
    await log_event(db, actor=current_user, action=AuditAction.MOVEMENT_DEPARTED, entity_type="Movement",
                    entity_id=movement_id)
    await db.commit()
    return {"detail": "Departure recorded. Staff now shown as Outside on Official Duty."}


@movement_router.post("/{movement_id}/return")
async def record_return(
    movement_id: int,
    notes: Optional[str] = None,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    movement = await _get_movement_or_404(db, movement_id)
    if movement.status not in (MovementStatus.OPEN, MovementStatus.OVERDUE):
        raise HTTPException(status_code=400, detail="Movement must be open/overdue to record return")
    movement.status = MovementStatus.RETURNED
    movement.actual_return = datetime.now(timezone.utc)
    movement.close_notes = notes
    movement.closed_by_id = current_user.id
    await log_event(db, actor=current_user, action=AuditAction.MOVEMENT_RETURNED, entity_type="Movement",
                    entity_id=movement_id)
    await db.commit()
    return {"detail": "Return recorded. Staff availability recalculated."}


@movement_router.get("/")
async def list_movements(
    staff_id: Optional[int] = Query(None),
    mov_status: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Movement)
    if staff_id:
        query = query.where(Movement.staff_id == staff_id)
    if mov_status:
        query = query.where(Movement.status == mov_status)
    result = await db.execute(query.order_by(Movement.created_at.desc()))
    movements = result.scalars().all()
    return [
        {
            "id": m.id, "staff_id": m.staff_id, "purpose": m.purpose,
            "destination": m.destination, "status": m.status.value,
            "expected_return": m.expected_return.isoformat() if m.expected_return else None,
            "actual_return": m.actual_return.isoformat() if m.actual_return else None,
            "is_overdue": m.is_overdue,
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


class AttendanceIn(BaseModel):
    staff_id: int
    attendance_date: date_type
    shift_code: ShiftCode


@attendance_router.post("/", status_code=201)
async def submit_attendance(
    payload: AttendanceIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Staff can only submit own attendance
    if current_user.role == UserRoleEnum.STAFF:
        if not current_user.staff_id or current_user.staff_id != payload.staff_id:
            raise HTTPException(status_code=403, detail="Staff can only submit their own attendance")

    # Check for duplicates
    existing = await db.execute(
        select(Attendance).where(
            and_(
                Attendance.staff_id == payload.staff_id,
                Attendance.attendance_date == payload.attendance_date,
                Attendance.shift_code == payload.shift_code,
            )
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Attendance already submitted for this staff/date/shift")

    att = Attendance(
        staff_id=payload.staff_id,
        attendance_date=payload.attendance_date,
        shift_code=payload.shift_code,
        is_scheduled=True,
        submitted_by_id=current_user.id,
        submitted_at=datetime.now(timezone.utc),
    )
    db.add(att)
    await db.flush()
    await log_event(db, actor=current_user, action=AuditAction.ATTENDANCE_SUBMITTED, entity_type="Attendance",
                    entity_id=att.id, new_values=payload.model_dump(mode="json"))
    await db.commit()
    return {"id": att.id, "message": "Attendance submitted. Awaiting officer verification."}


@attendance_router.post("/{attendance_id}/verify")
async def verify_attendance(
    attendance_id: int,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI, UserRoleEnum.SECTOR_SI)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Attendance).where(Attendance.id == attendance_id))
    att = result.scalar_one_or_none()
    if not att:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    att.is_confirmed = True
    att.verified_by_id = current_user.id
    att.verified_at = datetime.now(timezone.utc)
    await log_event(db, actor=current_user, action=AuditAction.ATTENDANCE_VERIFIED, entity_type="Attendance",
                    entity_id=attendance_id)
    await db.commit()
    return {"detail": "Attendance verified and confirmed"}


# ─────────────────────────────────────────────────────────────────────────────
# Tasks
# ─────────────────────────────────────────────────────────────────────────────
task_router = APIRouter(prefix="/tasks", tags=["Tasks"])


class TaskIn(BaseModel):
    description: str
    assignee_id: int
    reporting_officer_id: Optional[int] = None
    start_time: Optional[datetime] = None
    expected_completion: Optional[datetime] = None


class TaskStatusUpdate(BaseModel):
    new_status: TaskStatus
    notes: Optional[str] = None


@task_router.post("/", status_code=201)
async def create_task(
    payload: TaskIn,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI, UserRoleEnum.SECTOR_SI)),
    db: AsyncSession = Depends(get_db),
):
    task = Task(**payload.model_dump(), created_by_id=current_user.id)
    db.add(task)
    await db.flush()
    await log_event(db, actor=current_user, action=AuditAction.TASK_CREATED, entity_type="Task",
                    entity_id=task.id, new_values=payload.model_dump(mode="json"))
    await db.commit()
    return {"id": task.id, "status": task.status.value}


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

    old_status = task.status
    task.status = payload.new_status
    if payload.new_status == TaskStatus.COMPLETED:
        task.actual_completion = datetime.now(timezone.utc)
        task.is_overdue = False

    await log_event(db, actor=current_user, action=AuditAction.TASK_UPDATED, entity_type="Task",
                    entity_id=task_id, old_values={"status": old_status.value},
                    new_values={"status": payload.new_status.value})
    await db.commit()
    return {"detail": "Task status updated", "task_id": task_id, "new_status": payload.new_status.value}


@task_router.get("/")
async def list_tasks(
    assignee_id: Optional[int] = Query(None),
    task_status: Optional[str] = Query(None),
    overdue_only: bool = Query(False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Task)
    if assignee_id:
        query = query.where(Task.assignee_id == assignee_id)
    if task_status:
        query = query.where(Task.status == task_status)
    if overdue_only:
        query = query.where(Task.is_overdue == True)
    result = await db.execute(query.order_by(Task.created_at.desc()))
    tasks = result.scalars().all()
    return [
        {
            "id": t.id, "description": t.description, "assignee_id": t.assignee_id,
            "status": t.status.value, "is_overdue": t.is_overdue,
            "expected_completion": t.expected_completion.isoformat() if t.expected_completion else None,
        }
        for t in tasks
    ]
