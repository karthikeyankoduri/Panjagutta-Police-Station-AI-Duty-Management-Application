"""
Dashboard API — 14 summary cards from the availability engine.
PDF page 13, Section 12.
"""
from __future__ import annotations

from datetime import date as date_type
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.auth.dependencies import get_current_user
from app.db.database import get_db
from app.models.models import Staff, User, UserRoleEnum, StaffStatus, DutyMaster, Roster, RosterAssignment, RosterStatus, ShiftCode
from app.services.availability import compute_staff_status

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/summary")
async def dashboard_summary(
    for_date: Optional[date_type] = Query(None, description="Date for summary (default: today)"),
    shift_code: Optional[ShiftCode] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns 14 summary counts for dashboard cards.
    Sector SI sees only their sector's counts.
    """
    target_date = for_date or date_type.today()

    # Build staff query with sector scoping
    staff_query = select(Staff).where(Staff.is_active == True)
    if current_user.role == UserRoleEnum.SECTOR_SI:
        staff_query = staff_query.where(Staff.sector_id == current_user.sector_id)

    result = await db.execute(staff_query)
    all_staff = result.scalars().all()

    # Compute status for each staff member
    counts = {status.value: 0 for status in StaffStatus}
    counts["total"] = len(all_staff)

    status_list = []
    for staff in all_staff:
        availability = await compute_staff_status(db, staff.id, target_date, shift_code)
        counts[availability.status.value] = counts.get(availability.status.value, 0) + 1
        status_list.append({
            "staff_id": staff.id,
            "name": staff.name,
            "service_number": staff.service_number,
            "designation": staff.designation.value,
            "sector_id": staff.sector_id,
            **availability.as_dict(),
        })

    # Vacant positions — count from duty_master vs active roster assignments
    vacancy_count = await _compute_vacancies(db, target_date, shift_code)

    # Scheduled for current shift
    scheduled_count = await _count_scheduled(db, target_date, shift_code)

    return {
        "date": str(target_date),
        "shift": shift_code.value if shift_code else "all",
        "sector_scoped": current_user.role == UserRoleEnum.SECTOR_SI,
        "cards": {
            "total_staff": counts["total"],
            "scheduled_current_shift": scheduled_count,
            "present": counts.get(StaffStatus.PRESENT_AVAILABLE.value, 0),
            "on_duty": counts.get(StaffStatus.ON_DUTY.value, 0),
            "available": counts.get(StaffStatus.PRESENT_AVAILABLE.value, 0),
            "field_duty": counts.get(StaffStatus.FIELD_DUTY.value, 0),
            "court_duty": counts.get(StaffStatus.COURT_DUTY.value, 0),
            "patrol_beat": counts.get(StaffStatus.PATROL_BEAT.value, 0),
            "on_leave": counts.get(StaffStatus.ON_LEAVE.value, 0),
            "duty_off_rest": counts.get(StaffStatus.DUTY_OFF.value, 0),
            "attached_other_wing": counts.get(StaffStatus.ATTACHED_OTHER_WING.value, 0),
            "official_movement": counts.get(StaffStatus.OFFICIAL_MOVEMENT.value, 0),
            "absent": counts.get(StaffStatus.ABSENT.value, 0),
            "vacant_positions": vacancy_count,
        },
        "staff_status_list": status_list,
    }


async def _compute_vacancies(db: AsyncSession, for_date: date_type, shift_code: Optional[ShiftCode]) -> int:
    """
    Count positions where required_strength > allocated (valid assignments in published roster).
    """
    duty_query = select(DutyMaster).where(DutyMaster.is_active == True, DutyMaster.is_configured == True)
    if shift_code:
        from sqlalchemy import or_
        duty_query = duty_query.where(
            or_(DutyMaster.shift_code == shift_code, DutyMaster.shift_code == None)
        )

    duties = (await db.execute(duty_query)).scalars().all()
    total_vacancies = 0

    for duty in duties:
        if duty.required_strength is None:
            continue
        # Count active assignments for this duty in published roster
        assign_query = (
            select(func.count(RosterAssignment.id))
            .join(Roster, RosterAssignment.roster_id == Roster.id)
            .where(
                RosterAssignment.duty_master_id == duty.id,
                Roster.roster_date == for_date,
                Roster.status == RosterStatus.PUBLISHED,
            )
        )
        if shift_code:
            assign_query = assign_query.where(Roster.shift_code == shift_code)

        assigned = (await db.execute(assign_query)).scalar() or 0
        if assigned < duty.required_strength:
            total_vacancies += duty.required_strength - assigned

    return total_vacancies


async def _count_scheduled(db: AsyncSession, for_date: date_type, shift_code: Optional[ShiftCode]) -> int:
    from sqlalchemy import func
    from app.models.models import Attendance
    query = select(func.count(Attendance.id)).where(
        Attendance.attendance_date == for_date,
        Attendance.is_scheduled == True,
    )
    if shift_code:
        query = query.where(Attendance.shift_code == shift_code)
    result = await db.execute(query)
    return result.scalar() or 0


@router.get("/alerts")
async def get_active_alerts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.models import Alert
    result = await db.execute(select(Alert).where(Alert.is_resolved == False).order_by(Alert.created_at.desc()).limit(50))
    alerts = result.scalars().all()
    return [
        {
            "id": a.id,
            "alert_type": a.alert_type,
            "entity_type": a.entity_type,
            "entity_id": a.entity_id,
            "message": a.message,
            "severity": a.severity,
            "created_at": a.created_at.isoformat(),
        }
        for a in alerts
    ]
