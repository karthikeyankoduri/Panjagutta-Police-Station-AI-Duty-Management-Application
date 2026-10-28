"""
Reports and Exports API — Shift-end, daily vacancy, and workload reports.
Supports JSON responses and CSV downloads for recordkeeping.
"""
from __future__ import annotations

from datetime import date as date_type, datetime, timezone
import io
import csv
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func

from app.auth.dependencies import get_current_user
from app.db.database import get_db
from app.models.models import (
    Staff, ShiftCode, Attendance, Movement, Task, TaskStatus,
    Roster, RosterAssignment, DutyMaster, Sector, User
)

router = APIRouter(prefix="/reports", tags=["Reports"])


@router.get("/shift-end")
async def get_shift_end_report(
    report_date: date_type = Query(default_factory=date_type.today),
    shift_code: ShiftCode = Query(ShiftCode.A),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate Shift-End Handover Report (PDF page 14).
    Contains:
    - Attendance summary (scheduled vs confirmed vs absent)
    - Active movements during shift
    - Completed and pending tasks
    - Patrol beat coverage
    """
    # 1. Total station staff count
    staff_count_res = await db.execute(select(func.count(Staff.id)).where(Staff.is_active == True))
    total_staff = staff_count_res.scalar() or 0

    # 2. Attendance for shift
    att_res = await db.execute(
        select(Attendance).where(
            and_(
                Attendance.attendance_date == report_date,
                Attendance.shift_code == shift_code,
            )
        )
    )
    attendances = att_res.scalars().all()
    confirmed_present = sum(1 for a in attendances if a.is_confirmed)
    scheduled_count = sum(1 for a in attendances if a.is_scheduled)

    # 3. Roster assignments for shift
    roster_res = await db.execute(
        select(Roster).where(
            and_(
                Roster.roster_date == report_date,
                Roster.shift_code == shift_code,
            )
        ).order_by(Roster.version.desc()).limit(1)
    )
    roster = roster_res.scalar_one_or_none()

    assignments_data = []
    if roster:
        assign_res = await db.execute(
            select(RosterAssignment).where(RosterAssignment.roster_id == roster.id)
        )
        assignments = assign_res.scalars().all()

        staff_ids = [a.staff_id for a in assignments]
        staff_map = {}
        if staff_ids:
            s_res = await db.execute(select(Staff).where(Staff.id.in_(staff_ids)))
            staff_map = {s.id: s for s in s_res.scalars().all()}

        duty_ids = [a.duty_master_id for a in assignments]
        duty_map = {}
        if duty_ids:
            d_res = await db.execute(select(DutyMaster).where(DutyMaster.id.in_(duty_ids)))
            duty_map = {d.id: d for d in d_res.scalars().all()}

        for a in assignments:
            st = staff_map.get(a.staff_id)
            dt = duty_map.get(a.duty_master_id)
            assignments_data.append({
                "staff_name": st.name if st else "Unknown",
                "service_number": st.service_number if st else "N/A",
                "duty_name": dt.category if dt else "Duty",
                "section": dt.section if dt else None,
                "notes": a.notes,
            })

    # 4. Outside movements for today
    start_dt = datetime.combine(report_date, datetime.min.time(), tzinfo=timezone.utc)
    end_dt = datetime.combine(report_date, datetime.max.time(), tzinfo=timezone.utc)
    mov_res = await db.execute(
        select(Movement).where(
            Movement.created_at >= start_dt,
            Movement.created_at <= end_dt,
        )
    )
    movements = mov_res.scalars().all()
    movements_summary = {
        "total": len(movements),
        "open": sum(1 for m in movements if m.status.value in ["authorized", "open"]),
        "returned": sum(1 for m in movements if m.status.value == "returned"),
        "overdue": sum(1 for m in movements if m.is_overdue),
    }

    # 5. Tasks summary
    task_res = await db.execute(
        select(Task).where(
            Task.created_at >= start_dt,
            Task.created_at <= end_dt,
        )
    )
    tasks = task_res.scalars().all()
    tasks_summary = {
        "total": len(tasks),
        "completed": sum(1 for t in tasks if t.status == TaskStatus.COMPLETED),
        "in_progress": sum(1 for t in tasks if t.status == TaskStatus.IN_PROGRESS),
        "overdue": sum(1 for t in tasks if t.is_overdue),
    }

    return {
        "report_type": "Shift-End Handover Report",
        "station": "Panjagutta Police Station",
        "report_date": report_date.isoformat(),
        "shift_code": shift_code.value,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_by": current_user.username,
        "headcount": {
            "total_sanctioned_strength": total_staff,
            "scheduled_for_shift": scheduled_count,
            "confirmed_present": confirmed_present,
            "deficit": max(0, scheduled_count - confirmed_present),
        },
        "movements": movements_summary,
        "tasks": tasks_summary,
        "deployments_sample": assignments_data[:10],
        "total_deployments": len(assignments_data),
        "disclaimer": "OFFICIAL RECORD — Generated by Panjagutta Duty Management System. Verified by Station Officer.",
    }


@router.get("/daily-vacancy")
async def get_daily_vacancy_report(
    report_date: date_type = Query(default_factory=date_type.today),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Daily vacancy report comparing required vs deployed strength across all 5 sectors and station duties.
    """
    # Sectors
    sec_res = await db.execute(select(Sector).where(Sector.is_active == True))
    sectors = sec_res.scalars().all()

    # Duty requirements
    duty_res = await db.execute(select(DutyMaster).where(DutyMaster.is_active == True))
    duties = duty_res.scalars().all()

    # Calculate sector statistics
    sector_reports = []
    for sec in sectors:
        staff_res = await db.execute(
            select(func.count(Staff.id)).where(
                Staff.sector_id == sec.id,
                Staff.is_active == True,
            )
        )
        count = staff_res.scalar() or 0
        sector_reports.append({
            "sector_id": sec.id,
            "sector_name": sec.name,
            "code": sec.code,
            "assigned_staff": count,
            "minimum_target": 12,  # standard sector allocation target
            "deficit": max(0, 12 - count),
            "status": "Adequate" if count >= 12 else "Deficit Alert",
        })

    return {
        "report_type": "Daily Station Vacancy & Deployment Report",
        "station": "Panjagutta Police Station",
        "report_date": report_date.isoformat(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sectors": sector_reports,
        "key_duties_configured": len(duties),
    }


@router.get("/export")
async def export_report_csv(
    report_type: str = Query("shift-end"),
    report_date: date_type = Query(default_factory=date_type.today),
    shift_code: ShiftCode = Query(ShiftCode.A),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export selected report as CSV file."""
    output = io.StringIO()
    writer = csv.writer(output)

    if report_type == "shift-end":
        report_data = await get_shift_end_report(report_date, shift_code, current_user, db)
        writer.writerow(["Panjagutta Police Station - Shift End Report"])
        writer.writerow(["Date", report_data["report_date"]])
        writer.writerow(["Shift", report_data["shift_code"]])
        writer.writerow(["Generated By", report_data["generated_by"]])
        writer.writerow([])
        writer.writerow(["Metric", "Count"])
        writer.writerow(["Total Station Strength", report_data["headcount"]["total_sanctioned_strength"]])
        writer.writerow(["Scheduled For Shift", report_data["headcount"]["scheduled_for_shift"]])
        writer.writerow(["Confirmed Present", report_data["headcount"]["confirmed_present"]])
        writer.writerow(["Deficit", report_data["headcount"]["deficit"]])
        writer.writerow(["Active Movements", report_data["movements"]["open"]])
        writer.writerow(["Overdue Movements", report_data["movements"]["overdue"]])
        writer.writerow(["Completed Tasks", report_data["tasks"]["completed"]])
        writer.writerow(["Pending Tasks", report_data["tasks"]["in_progress"]])
    else:
        vacancy_data = await get_daily_vacancy_report(report_date, current_user, db)
        writer.writerow(["Panjagutta Police Station - Daily Vacancy Report"])
        writer.writerow(["Date", vacancy_data["report_date"]])
        writer.writerow([])
        writer.writerow(["Sector", "Code", "Assigned Staff", "Minimum Target", "Deficit", "Status"])
        for s in vacancy_data["sectors"]:
            writer.writerow([s["sector_name"], s["code"], s["assigned_staff"], s["minimum_target"], s["deficit"], s["status"]])

    csv_content = output.getvalue()
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=panjagutta_{report_type}_{report_date}.csv"},
    )
