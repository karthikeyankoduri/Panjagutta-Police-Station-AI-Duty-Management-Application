"""
Reports and exports (Build Guide §10 Reports, blueprint step 25).

Shift-end, daily, vacancy and workload reports are generated from records (the
latest *published* roster version, attendance, movements, tasks and leave) using
the same availability engine as the dashboard, so a report matches the dashboard
for the same shift. Every report exports to CSV, Excel (.xlsx) and PDF.
Sector SIs receive their own sector's figures only.
"""
from __future__ import annotations

import csv
import io
from datetime import date as date_type, datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.auth.dependencies import OFFICERS, require_roles, sector_scope
from app.db.database import get_db
from app.models.models import (
    Attendance, DutyMaster, LeaveRequest, LeaveStatus, Movement, MovementStatus, RosterAssignment,
    Sector, ShiftCode, Staff, StaffStatus, Task, TaskStatus, User, UserRoleEnum,
)
from app.services.availability import compute_statuses, latest_published_rosters
from app.services.shifts import STATION_TZ, load_shift_timings

router = APIRouter(prefix="/reports", tags=["Reports"])
STATION = "Panjagutta Police Station, Hyderabad City Police"


def _aware(dt):
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def _staff_in_scope(db: AsyncSession, user: User) -> Dict[int, Staff]:
    q = select(Staff).where(Staff.is_active == True)
    scope = sector_scope(user)
    if scope is not None:
        q = q.where(Staff.sector_id == scope)
    return {s.id: s for s in (await db.execute(q)).scalars().all()}


def _header(title: str, user: User, **meta) -> dict:
    return {
        "report_type": title, "station": STATION,
        "generated_at": datetime.now(timezone.utc).isoformat(), "generated_by": user.username,
        "sector_scoped": user.role == UserRoleEnum.SECTOR_SI,
        "sector_id": user.sector_id if user.role == UserRoleEnum.SECTOR_SI else None,
        **meta,
    }


async def _assignments(db, day: date_type, code: ShiftCode, staff: Dict[int, Staff]):
    latest = await latest_published_rosters(db, day, day)
    roster = latest.get((day, code))
    if not roster:
        return None, []
    rows = (await db.execute(
        select(RosterAssignment, DutyMaster).join(DutyMaster, RosterAssignment.duty_master_id == DutyMaster.id)
        .where(RosterAssignment.roster_id == roster.id))).all()
    return roster, [(a, d) for a, d in rows if a.staff_id in staff]


# ─────────────────────────────────────────────────────────────────────────────
# Report builders (return JSON plus a tabular `sections` list used by exports)
# ─────────────────────────────────────────────────────────────────────────────

async def build_shift_end(db, user, report_date: date_type, shift_code: ShiftCode) -> dict:
    staff = await _staff_in_scope(db, user)
    timings = await load_shift_timings(db)
    start, end = timings[shift_code].window(report_date)
    roster, asns = await _assignments(db, report_date, shift_code, staff)
    scheduled = {a.staff_id for a, _ in asns}

    att = (await db.execute(select(Attendance).where(
        Attendance.attendance_date == report_date, Attendance.shift_code == shift_code,
        Attendance.staff_id.in_(list(staff) or [-1])))).scalars().all()
    confirmed = {a.staff_id for a in att if a.is_confirmed}
    statuses = await compute_statuses(db, list(staff), report_date, shift_code)

    movs = (await db.execute(select(Movement).where(Movement.staff_id.in_(list(staff) or [-1])))).scalars().all()
    in_shift = []
    for m in movs:
        dep = _aware(m.actual_departure or m.authorized_at)
        ret = _aware(m.actual_return)
        if dep and dep < end and (ret is None or ret > start) and m.status != MovementStatus.CANCELLED:
            in_shift.append(m)
    tasks = (await db.execute(select(Task).where(Task.assignee_id.in_(list(staff) or [-1])))).scalars().all()
    shift_tasks = [t for t in tasks if (_aware(t.start_time or t.created_at) or start) < end and
                   (t.actual_completion is None or _aware(t.actual_completion) >= start)]

    counts: Dict[str, int] = {}
    for st in statuses.values():
        counts[st.status.value] = counts.get(st.status.value, 0) + 1

    deployments = [{
        "staff_name": staff[a.staff_id].name, "service_number": staff[a.staff_id].service_number,
        "duty_name": d.category, "section": d.section, "notes": a.notes,
        "attendance": "Confirmed" if a.staff_id in confirmed else "Not confirmed",
    } for a, d in sorted(asns, key=lambda x: (x[1].category, staff[x[0].staff_id].name))]

    data = _header("Shift-End Handover Report", user, report_date=str(report_date), shift_code=shift_code.value,
                   shift_window=f"{start:%d %b %H:%M} – {end.astimezone(STATION_TZ):%d %b %H:%M}",
                   roster_id=roster.id if roster else None, roster_version=roster.version if roster else None)
    data.update({
        "headcount": {
            "total_sanctioned_strength": len(staff),
            "scheduled_for_shift": len(scheduled),
            "confirmed_present": len(confirmed & scheduled),
            "confirmed_not_scheduled": len(confirmed - scheduled),
            "deficit": len(scheduled - confirmed),
        },
        "status_breakdown": counts,
        "movements": {
            "total": len(in_shift),
            "open": sum(1 for m in in_shift if m.status in (MovementStatus.AUTHORIZED, MovementStatus.OPEN, MovementStatus.OVERDUE)),
            "returned": sum(1 for m in in_shift if m.status == MovementStatus.RETURNED),
            "overdue": sum(1 for m in in_shift if m.is_overdue),
        },
        "tasks": {
            "total": len(shift_tasks),
            "completed": sum(1 for t in shift_tasks if t.status == TaskStatus.COMPLETED),
            "in_progress": sum(1 for t in shift_tasks if t.status == TaskStatus.IN_PROGRESS),
            "not_started": sum(1 for t in shift_tasks if t.status == TaskStatus.NOT_STARTED),
            "overdue": sum(1 for t in shift_tasks if t.is_overdue),
        },
        "deployments": deployments,
        "deployments_sample": deployments[:10],
        "total_deployments": len(deployments),
        "disclaimer": "Generated from records by the Panjagutta Duty Management System. To be verified by the Station Officer.",
    })
    h, m, t = data["headcount"], data["movements"], data["tasks"]
    data["sections"] = [
        {"title": "Headcount", "columns": ["Metric", "Count"], "rows": [
            ["Total station strength", h["total_sanctioned_strength"]], ["Scheduled for shift", h["scheduled_for_shift"]],
            ["Confirmed present (scheduled)", h["confirmed_present"]], ["Confirmed, not scheduled", h["confirmed_not_scheduled"]],
            ["Scheduled, not confirmed", h["deficit"]]]},
        {"title": "Current status", "columns": ["Status", "Staff"], "rows": sorted([[k, v] for k, v in counts.items()])},
        {"title": "Movements and tasks", "columns": ["Metric", "Count"], "rows": [
            ["Movements during shift", m["total"]], ["Still outside", m["open"]], ["Returned", m["returned"]],
            ["Overdue movements", m["overdue"]], ["Tasks", t["total"]], ["Completed", t["completed"]],
            ["In progress", t["in_progress"]], ["Overdue tasks", t["overdue"]]]},
        {"title": "Deployment", "columns": ["Name", "Service No", "Duty", "Section", "Attendance", "Notes"],
         "rows": [[d["staff_name"], d["service_number"], d["duty_name"], d["section"] or "", d["attendance"], d["notes"] or ""]
                  for d in deployments]},
    ]
    return data


async def build_daily(db, user, report_date: date_type) -> dict:
    staff = await _staff_in_scope(db, user)
    timings = await load_shift_timings(db)
    per_shift = []
    for code in sorted(timings, key=lambda c: timings[c].start):
        roster, asns = await _assignments(db, report_date, code, staff)
        att = (await db.execute(select(Attendance).where(
            Attendance.attendance_date == report_date, Attendance.shift_code == code,
            Attendance.staff_id.in_(list(staff) or [-1])))).scalars().all()
        sched = {a.staff_id for a, _ in asns}
        conf = {a.staff_id for a in att if a.is_confirmed}
        per_shift.append({"shift_code": code.value, "time": timings[code].label(),
                          "roster_version": roster.version if roster else None,
                          "scheduled": len(sched), "confirmed": len(conf & sched), "not_confirmed": len(sched - conf)})
    statuses = await compute_statuses(db, list(staff), report_date, None)
    counts: Dict[str, int] = {}
    for st in statuses.values():
        counts[st.status.value] = counts.get(st.status.value, 0) + 1
    leaves = (await db.execute(select(LeaveRequest).where(
        LeaveRequest.staff_id.in_(list(staff) or [-1]), LeaveRequest.start_date <= report_date,
        LeaveRequest.end_date >= report_date))).scalars().all()
    on_leave = [l for l in leaves if l.status == LeaveStatus.APPROVED]
    pending = [l for l in leaves if l.status == LeaveStatus.PENDING]
    movs = [s for s in statuses.values() if s.status == StaffStatus.OFFICIAL_MOVEMENT]

    data = _header("Daily Station Report", user, report_date=str(report_date))
    data.update({"shifts": per_shift, "status_breakdown": counts, "total_staff": len(staff),
                 "approved_leave": len(on_leave), "pending_leave": len(pending), "outside_on_duty": len(movs)})
    data["sections"] = [
        {"title": "Shifts", "columns": ["Shift", "Time", "Roster version", "Scheduled", "Confirmed", "Not confirmed"],
         "rows": [[s["shift_code"], s["time"], s["roster_version"] or "not published", s["scheduled"], s["confirmed"],
                   s["not_confirmed"]] for s in per_shift]},
        {"title": "Status of all staff", "columns": ["Status", "Staff"], "rows": sorted([[k, v] for k, v in counts.items()])},
        {"title": "Leave and movements", "columns": ["Item", "Count"], "rows": [
            ["Total staff", len(staff)], ["On approved leave", len(on_leave)],
            ["Leave pending (still counted available)", len(pending)], ["Outside on official duty", len(movs)]]},
        {"title": "On leave today", "columns": ["Name", "Service No", "Type", "From", "To", "Reference"],
         "rows": [[staff[l.staff_id].name, staff[l.staff_id].service_number, l.leave_type, str(l.start_date),
                   str(l.end_date), l.reference_number or ""] for l in on_leave if l.staff_id in staff]},
    ]
    return data


async def build_vacancy(db, user, report_date: date_type) -> dict:
    staff = await _staff_in_scope(db, user)
    timings = await load_shift_timings(db)
    duties = (await db.execute(select(DutyMaster).where(DutyMaster.is_active == True))).scalars().all()
    rows = []
    for code in sorted(timings, key=lambda c: timings[c].start):
        roster, asns = await _assignments(db, report_date, code, staff)
        counts: Dict[int, int] = {}
        for a, _ in asns:
            counts[a.duty_master_id] = counts.get(a.duty_master_id, 0) + 1
        for d in duties:
            if d.shift_code is not None and d.shift_code != code:
                continue
            req = d.required_strength if d.is_configured else None
            alloc = counts.get(d.id, 0)
            rows.append({"shift_code": code.value, "category": d.category, "section": d.section,
                         "required": req, "allocated": alloc,
                         "vacant": max(0, req - alloc) if req is not None else None,
                         "configured": bool(d.is_configured), "roster_published": roster is not None})
    sectors = (await db.execute(select(Sector).where(Sector.is_active == True))).scalars().all()
    scope = sector_scope(user)
    sector_rows = [{"sector_id": s.id, "sector_name": s.name, "code": s.code,
                    "assigned_staff": sum(1 for p in staff.values() if p.sector_id == s.id)}
                   for s in sectors if scope is None or s.id == scope]

    data = _header("Daily Vacancy Report", user, report_date=str(report_date))
    data.update({
        "duties": rows,
        "total_required": sum(r["required"] or 0 for r in rows),
        "total_allocated": sum(r["allocated"] for r in rows),
        "total_vacant": sum(r["vacant"] or 0 for r in rows),
        "sectors": sector_rows,
        "key_duties_configured": sum(1 for d in duties if d.is_configured),
        "note": "Required strength comes from duty_master; allocations from the latest published roster version. "
                "Station-wide duties are reported even for a Sector SI; allocations count only that sector's staff.",
    })
    data["sections"] = [
        {"title": "Required vs allocated by duty", "columns": ["Shift", "Duty", "Section", "Required", "Allocated", "Vacant"],
         "rows": [[r["shift_code"], r["category"], r["section"] or "",
                   r["required"] if r["required"] is not None else "not configured", r["allocated"],
                   r["vacant"] if r["vacant"] is not None else ""] for r in rows]},
        {"title": "Sector strength", "columns": ["Sector", "Code", "Assigned staff"],
         "rows": [[s["sector_name"], s["code"], s["assigned_staff"]] for s in sector_rows]},
    ]
    return data


async def build_workload(db, user, start_date: date_type, end_date: date_type) -> dict:
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="End date cannot be before start date")
    if (end_date - start_date).days > 92:
        raise HTTPException(status_code=422, detail="Workload range cannot exceed 93 days")
    staff = await _staff_in_scope(db, user)
    timings = await load_shift_timings(db)
    latest = await latest_published_rosters(db, start_date, end_date)
    by_id = {r.id: r for r in latest.values()}
    load: Dict[int, dict] = {sid: {"shifts": 0, "hours": 0.0, "night": 0, "duties": {}} for sid in staff}
    if by_id:
        rows = (await db.execute(
            select(RosterAssignment, DutyMaster).join(DutyMaster, RosterAssignment.duty_master_id == DutyMaster.id)
            .where(RosterAssignment.roster_id.in_(list(by_id))))).all()
        for a, d in rows:
            if a.staff_id not in load:
                continue
            r = by_id[a.roster_id]
            w = load[a.staff_id]
            w["shifts"] += 1
            w["hours"] += timings[r.shift_code].duration_hours
            w["night"] += 1 if timings[r.shift_code].window(r.roster_date)[1].date() > r.roster_date else 0
            w["duties"][d.category] = w["duties"].get(d.category, 0) + 1
    tasks = (await db.execute(select(Task).where(Task.assignee_id.in_(list(staff) or [-1])))).scalars().all()
    done: Dict[int, int] = {}
    for t in tasks:
        if t.status == TaskStatus.COMPLETED and t.actual_completion and \
                start_date <= _aware(t.actual_completion).astimezone(STATION_TZ).date() <= end_date:
            done[t.assignee_id] = done.get(t.assignee_id, 0) + 1
    people = sorted((
        {"staff_id": sid, "name": staff[sid].name, "service_number": staff[sid].service_number,
         "designation": staff[sid].designation.value, "sector_id": staff[sid].sector_id,
         "shifts": w["shifts"], "hours": round(w["hours"], 1), "night_shifts": w["night"],
         "tasks_completed": done.get(sid, 0),
         "top_duty": max(w["duties"], key=w["duties"].get) if w["duties"] else None}
        for sid, w in load.items()), key=lambda p: (-p["hours"], p["name"]))
    worked = [p for p in people if p["shifts"]]
    avg = round(sum(p["hours"] for p in worked) / len(worked), 1) if worked else 0
    data = _header("Workload Report", user, start_date=str(start_date), end_date=str(end_date))
    data.update({"staff": people, "average_hours_worked": avg, "staff_with_duty": len(worked),
                 "heaviest": people[:5], "unused": [p for p in people if not p["shifts"]][:20]})
    data["sections"] = [
        {"title": f"Duty load {start_date} to {end_date} (average {avg} h for staff on duty)",
         "columns": ["Name", "Service No", "Rank", "Shifts", "Hours", "Night shifts", "Tasks completed", "Most frequent duty"],
         "rows": [[p["name"], p["service_number"], p["designation"], p["shifts"], p["hours"], p["night_shifts"],
                   p["tasks_completed"], p["top_duty"] or ""] for p in people]},
    ]
    return data


# ─────────────────────────────────────────────────────────────────────────────
# JSON endpoints
# ─────────────────────────────────────────────────────────────────────────────

def _strip(data: dict) -> dict:
    """JSON responses keep the tabular sections so the web view shows exactly what the exports contain."""
    return data


@router.get("/shift-end")
async def get_shift_end_report(
    report_date: date_type = Query(default_factory=date_type.today),
    shift_code: ShiftCode = Query(ShiftCode.A),
    current_user: User = Depends(require_roles(*OFFICERS)),
    db: AsyncSession = Depends(get_db),
):
    return _strip(await build_shift_end(db, current_user, report_date, shift_code))


@router.get("/daily")
async def get_daily_report(
    report_date: date_type = Query(default_factory=date_type.today),
    current_user: User = Depends(require_roles(*OFFICERS)),
    db: AsyncSession = Depends(get_db),
):
    return _strip(await build_daily(db, current_user, report_date))


@router.get("/daily-vacancy")
async def get_daily_vacancy_report(
    report_date: date_type = Query(default_factory=date_type.today),
    current_user: User = Depends(require_roles(*OFFICERS)),
    db: AsyncSession = Depends(get_db),
):
    return _strip(await build_vacancy(db, current_user, report_date))


@router.get("/workload")
async def get_workload_report(
    start_date: date_type = Query(default_factory=lambda: date_type.today() - timedelta(days=6)),
    end_date: date_type = Query(default_factory=date_type.today),
    current_user: User = Depends(require_roles(*OFFICERS)),
    db: AsyncSession = Depends(get_db),
):
    return _strip(await build_workload(db, current_user, start_date, end_date))


# ─────────────────────────────────────────────────────────────────────────────
# Export: CSV / Excel / PDF
# ─────────────────────────────────────────────────────────────────────────────

def _meta_lines(data: dict) -> List[List[str]]:
    keys = [("Station", "station"), ("Report", "report_type"), ("Date", "report_date"), ("Shift", "shift_code"),
            ("Shift window", "shift_window"), ("From", "start_date"), ("To", "end_date"),
            ("Roster version", "roster_version"), ("Generated by", "generated_by"), ("Generated at", "generated_at")]
    lines = [[label, str(data[k])] for label, k in keys if data.get(k) not in (None, "")]
    if data.get("sector_scoped"):
        lines.append(["Scope", f"Sector {data.get('sector_id')} only"])
    return lines


def to_csv(data: dict) -> bytes:
    out = io.StringIO()
    w = csv.writer(out)
    for line in _meta_lines(data):
        w.writerow(line)
    for sec in data["sections"]:
        w.writerow([])
        w.writerow([sec["title"]])
        w.writerow(sec["columns"])
        w.writerows(sec["rows"])
    return out.getvalue().encode("utf-8-sig")


def to_xlsx(data: dict) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    wb = Workbook()
    ws = wb.active
    ws.title = "Report"
    bold = Font(bold=True)
    head_fill = PatternFill("solid", fgColor="0F2238")
    head_font = Font(bold=True, color="FFFFFF")
    for line in _meta_lines(data):
        ws.append(line)
        ws.cell(ws.max_row, 1).font = bold
    for sec in data["sections"]:
        ws.append([])
        ws.append([sec["title"]])
        ws.cell(ws.max_row, 1).font = Font(bold=True, size=12)
        ws.append(sec["columns"])
        for c in range(1, len(sec["columns"]) + 1):
            ws.cell(ws.max_row, c).font = head_font
            ws.cell(ws.max_row, c).fill = head_fill
        for row in sec["rows"]:
            ws.append(list(row))
    for col in ws.columns:
        width = max(len(str(c.value or "")) for c in col)
        ws.column_dimensions[col[0].column_letter].width = min(max(10, width + 2), 50)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def to_pdf(data: dict) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buf = io.BytesIO()
    wide = any(len(s["columns"]) > 5 for s in data["sections"])
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4) if wide else A4, leftMargin=14 * mm, rightMargin=14 * mm,
                            topMargin=14 * mm, bottomMargin=14 * mm, title=data["report_type"])
    styles = getSampleStyleSheet()
    cell = styles["BodyText"].clone("cell", fontSize=8, leading=10)
    story = [Paragraph("HYDERABAD CITY POLICE — PANJAGUTTA POLICE STATION", styles["Title"]),
             Paragraph(data["report_type"], styles["Heading2"])]
    meta = Table([[Paragraph(f"<b>{k}</b>", cell), Paragraph(v, cell)] for k, v in _meta_lines(data)[2:]],
                 colWidths=[40 * mm, 120 * mm], hAlign="LEFT")
    story += [meta, Spacer(1, 6 * mm)]
    for sec in data["sections"]:
        story.append(Paragraph(sec["title"], styles["Heading3"]))
        rows = [[Paragraph(f"<b>{c}</b>", cell) for c in sec["columns"]]]
        rows += [[Paragraph(str(v), cell) for v in r] for r in sec["rows"]] or [[Paragraph("No records", cell)] + [""] * (len(sec["columns"]) - 1)]
        t = Table(rows, repeatRows=1, hAlign="LEFT")
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8EEF7")),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#B8C4D6")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F6F8FB")]),
        ]))
        story += [t, Spacer(1, 5 * mm)]
    story.append(Paragraph(data.get("disclaimer") or "Generated from records by the Panjagutta Duty Management System.", cell))
    doc.build(story)
    return buf.getvalue()


@router.get("/export")
async def export_report(
    report_type: str = Query("shift-end", pattern="^(shift-end|daily|daily-vacancy|vacancy|workload)$"),
    format: str = Query("csv", pattern="^(csv|xlsx|pdf)$"),
    report_date: date_type = Query(default_factory=date_type.today),
    shift_code: ShiftCode = Query(ShiftCode.A),
    start_date: Optional[date_type] = Query(None),
    end_date: Optional[date_type] = Query(None),
    current_user: User = Depends(require_roles(*OFFICERS)),
    db: AsyncSession = Depends(get_db),
):
    """Export any report as CSV, Excel or PDF (server-side generation)."""
    if report_type == "shift-end":
        data = await build_shift_end(db, current_user, report_date, shift_code)
        stem = f"shift_end_{report_date}_{shift_code.value}"
    elif report_type == "daily":
        data = await build_daily(db, current_user, report_date)
        stem = f"daily_{report_date}"
    elif report_type in ("daily-vacancy", "vacancy"):
        data = await build_vacancy(db, current_user, report_date)
        stem = f"vacancy_{report_date}"
    else:
        s = start_date or report_date - timedelta(days=6)
        e = end_date or report_date
        data = await build_workload(db, current_user, s, e)
        stem = f"workload_{s}_{e}"

    if format == "xlsx":
        body, media = to_xlsx(data), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    elif format == "pdf":
        body, media = to_pdf(data), "application/pdf"
    else:
        body, media = to_csv(data), "text/csv; charset=utf-8"
    return Response(content=body, media_type=media,
                    headers={"Content-Disposition": f"attachment; filename=panjagutta_{stem}.{format}"})
