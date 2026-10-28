"""
Availability Engine — single source of truth for current staff status.
Derived from attendance, roster, assignments, leave, movement and attachments.
Priority order is PROVISIONAL until SHO confirms (PDF page 9, Section 7).
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.models.models import (
    Staff, StaffStatus, Attendance, LeaveRequest, LeaveStatus,
    Movement, MovementStatus, AttachmentOrder, RosterAssignment,
    Roster, RosterStatus, ShiftCode,
)


class AvailabilityResult:
    def __init__(
        self,
        staff_id: int,
        status: StaffStatus,
        reason: str,
        is_conflicting: bool = False,
        conflict_detail: Optional[str] = None,
    ):
        self.staff_id = staff_id
        self.status = status
        self.reason = reason
        self.is_conflicting = is_conflicting
        self.conflict_detail = conflict_detail

    def as_dict(self) -> dict:
        return {
            "staff_id": self.staff_id,
            "status": self.status.value,
            "reason": self.reason,
            "is_conflicting": self.is_conflicting,
            "conflict_detail": self.conflict_detail,
        }


async def compute_staff_status(
    db: AsyncSession,
    staff_id: int,
    for_date: date,
    shift_code: Optional[ShiftCode] = None,
    policy_confirmed: bool = False,
) -> AvailabilityResult:
    """
    Compute the single current status for a staff member.
    Priority (PROVISIONAL — subject to SHO confirmation):
      1. On Leave (approved only)
      2. Attached to Other Wing
      3. Duty Off / Rest (requires confirmed policy)
      4. Official Movement (open)
      5. Patrol / Beat / Court / Field / On Duty (active assignment)
      6. Present – Available (attendance confirmed)
      7. Absent (scheduled but no confirmed attendance)
    """

    # 1. Approved leave
    leave_result = await db.execute(
        select(LeaveRequest).where(
            and_(
                LeaveRequest.staff_id == staff_id,
                LeaveRequest.status == LeaveStatus.APPROVED,
                LeaveRequest.start_date <= for_date,
                LeaveRequest.end_date >= for_date,
            )
        )
    )
    active_leave = leave_result.scalar_one_or_none()
    if active_leave:
        return AvailabilityResult(
            staff_id=staff_id,
            status=StaffStatus.ON_LEAVE,
            reason=f"Approved leave: {active_leave.leave_type} (ref: {active_leave.reference_number or 'N/A'})",
        )

    # 2. Active attachment
    attach_result = await db.execute(
        select(AttachmentOrder).where(
            and_(
                AttachmentOrder.staff_id == staff_id,
                AttachmentOrder.is_active == True,
                AttachmentOrder.start_date <= for_date,
            )
        )
    )
    attachment = attach_result.scalar_one_or_none()
    if attachment:
        return AvailabilityResult(
            staff_id=staff_id,
            status=StaffStatus.ATTACHED_OTHER_WING,
            reason=f"Attached to {attachment.attached_wing} (order: {attachment.order_reference or 'N/A'})",
        )

    # 3. Duty off / rest — only shown if policy is confirmed
    # If unconfirmed, skip this check (do not invent rest rules)
    # This is a placeholder — real logic needs confirmed rotation_rule record
    # TODO: Query RotationRule when confirmed and check last shift date

    # 4. Open official movement
    movement_result = await db.execute(
        select(Movement).where(
            and_(
                Movement.staff_id == staff_id,
                Movement.status.in_([MovementStatus.AUTHORIZED, MovementStatus.OPEN]),
            )
        )
    )
    open_movement = movement_result.scalar_one_or_none()
    if open_movement:
        return AvailabilityResult(
            staff_id=staff_id,
            status=StaffStatus.OFFICIAL_MOVEMENT,
            reason=f"On official movement to {open_movement.destination} (purpose: {open_movement.purpose})",
        )

    # 5. Active roster assignment (published roster for the date/shift)
    assignment_query = (
        select(RosterAssignment, Roster)
        .join(Roster, RosterAssignment.roster_id == Roster.id)
        .where(
            and_(
                RosterAssignment.staff_id == staff_id,
                Roster.roster_date == for_date,
                Roster.status == RosterStatus.PUBLISHED,
            )
        )
    )
    if shift_code:
        assignment_query = assignment_query.where(Roster.shift_code == shift_code)

    assignment_result = await db.execute(assignment_query)
    assignment_row = assignment_result.first()
    if assignment_row:
        assignment, roster = assignment_row
        duty = assignment.duty
        duty_cat = duty.category if duty else "assigned duty"
        # Map duty category to status
        status_map = {
            "patrol": StaffStatus.PATROL_BEAT,
            "beat": StaffStatus.PATROL_BEAT,
            "court": StaffStatus.COURT_DUTY,
            "field": StaffStatus.FIELD_DUTY,
        }
        duty_status = StaffStatus.ON_DUTY
        for key, st in status_map.items():
            if key in duty_cat.lower():
                duty_status = st
                break
        return AvailabilityResult(
            staff_id=staff_id,
            status=duty_status,
            reason=f"Assigned to {duty_cat} (Shift {roster.shift_code.value})",
        )

    # 6 & 7. Attendance-based: confirmed = present-available, scheduled but not confirmed = absent
    att_result = await db.execute(
        select(Attendance).where(
            and_(
                Attendance.staff_id == staff_id,
                Attendance.attendance_date == for_date,
            )
        )
    )
    attendance = att_result.scalar_one_or_none()
    if attendance:
        if attendance.is_confirmed:
            return AvailabilityResult(
                staff_id=staff_id,
                status=StaffStatus.PRESENT_AVAILABLE,
                reason="Attendance confirmed for today",
            )
        if attendance.is_scheduled:
            return AvailabilityResult(
                staff_id=staff_id,
                status=StaffStatus.ABSENT,
                reason="Scheduled but attendance not yet confirmed",
            )

    # Default: no record found
    return AvailabilityResult(
        staff_id=staff_id,
        status=StaffStatus.ABSENT,
        reason="No attendance, assignment, leave or movement record found for this date",
    )
