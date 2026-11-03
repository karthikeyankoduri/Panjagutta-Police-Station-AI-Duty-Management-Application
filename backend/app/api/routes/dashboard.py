"""
Dashboard API — 14 summary cards, per-card staff lists, filters and operational
views (current shift, rest & upcoming shift, vacancy & shortage), alerts and the
approvals inbox. Guide §10 and blueprint steps 21, 23 and 24.
"""
from __future__ import annotations

from datetime import date as date_type, datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import or_, select

from app.auth.dependencies import (
    OFFICERS, STATION_ADMINS, SUPERVISORS, get_current_user, has_role, require_roles, sector_scope,
)
from app.db.database import get_db
from app.models.models import (
    Alert, Attendance, DutyMaster, LeaveRequest, LeaveStatus, Movement, MovementStatus, Roster,
    RosterAssignment, RosterStatus, ShiftCode, Staff, StaffStatus, Task, User, UserRoleEnum,
)
from app.services.audit import AuditAction, log_event
from app.services.availability import compute_statuses, latest_published_rosters
from app.services.shifts import current_shift, load_shift_timings, next_shift, now_local

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

# Mutually exclusive status cards (each person appears in exactly one).
EXCLUSIVE_CARDS = {
    "available": StaffStatus.PRESENT_AVAILABLE,
    "on_duty": StaffStatus.ON_DUTY,
    "field_duty": StaffStatus.FIELD_DUTY,
    "court_duty": StaffStatus.COURT_DUTY,
    "patrol_beat": StaffStatus.PATROL_BEAT,
    "on_leave": StaffStatus.ON_LEAVE,
    "duty_off_rest": StaffStatus.DUTY_OFF,
    "attached_other_wing": StaffStatus.ATTACHED_OTHER_WING,
    "official_movement": StaffStatus.OFFICIAL_MOVEMENT,
    "absent": StaffStatus.ABSENT,
    "emergency_deployment": StaffStatus.EMERGENCY_DEPLOYMENT,
    "shift_change_pending": StaffStatus.SHIFT_CHANGE_PENDING,
}


async def _scoped_staff(db: AsyncSession, user: User, designation=None, sector_id=None, section=None, category=None):
    q = select(Staff).where(Staff.is_active == True)
    scope = sector_scope(user)
    if scope is not None:
        q = q.where(Staff.sector_id == scope)
    elif sector_id:
        q = q.where(Staff.sector_id == sector_id)
    if designation:
        q = q.where(Staff.designation == designation)
    if section:
        q = q.where(Staff.section == section)
    if category:
        q = q.where(Staff.category == category)
    return list((await db.execute(q.order_by(Staff.name))).scalars().all())


async def _published_assignments(db: AsyncSession, day: date_type, shift: ShiftCode):
    latest = await latest_published_rosters(db, day, day)
    roster = latest.get((day, shift))
    if not roster:
        return None, []
    rows = (await db.execute(
        select(RosterAssignment, DutyMaster, Staff)
        .join(DutyMaster, RosterAssignment.duty_master_id == DutyMaster.id)
        .join(Staff, RosterAssignment.staff_id == Staff.id)
        .where(RosterAssignment.roster_id == roster.id)
    )).all()
    return roster, rows


@router.get("/summary")
async def dashboard_summary(
    for_date: Optional[date_type] = Query(None, description="Date for summary (default: today)"),
    shift_code: Optional[ShiftCode] = Query(None),
    designation: Optional[str] = Query(None),
    sector_id: Optional[int] = Query(None),
    section: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    duty_category: Optional[str] = Query(None),
    status: Optional[str] = Query(None, description="Filter list by current status label"),
    current_user: User = Depends(require_roles(*OFFICERS)),
    db: AsyncSession = Depends(get_db),
):
    """
    14 summary counts, one status per person from the availability engine, and the
    staff list behind every card. Sector SI sees only their sector.
    """
    timings = await load_shift_timings(db)
    running_shift, running_date = current_shift(timings)
    target_date = for_date or now_local().date()
    focus_shift = shift_code or (running_shift if target_date == running_date else None)

    staff = await _scoped_staff(db, current_user, designation, sector_id, section, category)
    statuses = await compute_statuses(db, [s.id for s in staff], target_date, shift_code)

    rows = []
    for s in staff:
        st = statuses[s.id]
        row = {
            "staff_id": s.id, "name": s.name, "service_number": s.service_number,
            "designation": s.designation.value, "category": s.category.value,
            "sector_id": s.sector_id, "section": s.section, **st.as_dict(),
        }
        if duty_category and (st.duty_category or "").lower() != duty_category.lower():
            continue
        if status and st.status.value != status:
            continue
        rows.append(row)

    # Scheduled = staff on the newest published roster for the focus shift (not attendance rows).
    scheduled_ids: set = set()
    if focus_shift:
        _, asn_rows = await _published_assignments(db, target_date, focus_shift)
        scheduled_ids = {a.staff_id for a, _, _ in asn_rows}
    else:
        for code in timings:
            _, asn_rows = await _published_assignments(db, target_date, code)
            scheduled_ids |= {a.staff_id for a, _, _ in asn_rows}
    visible_ids = {r["staff_id"] for r in rows}

    members: Dict[str, List[int]] = {key: [] for key in EXCLUSIVE_CARDS}
    for r in rows:
        for key, st in EXCLUSIVE_CARDS.items():
            if r["status"] == st.value:
                members[key].append(r["staff_id"])
    members["total_staff"] = sorted(visible_ids)
    members["present"] = [r["staff_id"] for r in rows if r["attendance_confirmed"]]
    members["scheduled_current_shift"] = sorted(scheduled_ids & visible_ids)

    vacancy = await _vacancy_rows(db, target_date, [focus_shift] if focus_shift else list(timings))
    cards = {key: len(ids) for key, ids in members.items()}
    cards["vacant_positions"] = sum(v["vacant"] for v in vacancy)

    return {
        "date": str(target_date),
        "shift": shift_code.value if shift_code else "all",
        "current_shift": {"code": running_shift.value, "date": str(running_date),
                          "time": timings[running_shift].label()},
        "focus_shift": focus_shift.value if focus_shift else None,
        "sector_scoped": current_user.role == UserRoleEnum.SECTOR_SI,
        "cards": cards,
        "card_members": members,
        "exclusive_cards": list(EXCLUSIVE_CARDS),
        "staff_status_list": rows,
        "filters": {"designation": designation, "sector_id": sector_id, "section": section,
                    "category": category, "duty_category": duty_category, "status": status},
    }


async def _vacancy_rows(db: AsyncSession, day: date_type, shifts: List[ShiftCode]) -> List[dict]:
    duties = (await db.execute(select(DutyMaster).where(
        DutyMaster.is_active == True, DutyMaster.is_configured == True))).scalars().all()
    latest = await latest_published_rosters(db, day, day)
    out = []
    for code in shifts:
        roster = latest.get((day, code))
        counts: Dict[int, int] = {}
        if roster:
            for did in (await db.execute(select(RosterAssignment.duty_master_id)
                                         .where(RosterAssignment.roster_id == roster.id))).scalars().all():
                counts[did] = counts.get(did, 0) + 1
        for d in duties:
            if d.required_strength is None or (d.shift_code is not None and d.shift_code != code):
                continue
            allocated = counts.get(d.id, 0)
            out.append({
                "date": str(day), "shift_code": code.value, "duty_master_id": d.id,
                "category": d.category, "section": d.section, "required": d.required_strength,
                "allocated": allocated, "vacant": max(0, d.required_strength - allocated),
                "roster_id": roster.id if roster else None, "roster_published": roster is not None,
            })
    return out


@router.get("/views")
async def dashboard_views(
    for_date: Optional[date_type] = Query(None),
    shift_code: Optional[ShiftCode] = Query(None),
    current_user: User = Depends(require_roles(*OFFICERS)),
    db: AsyncSession = Depends(get_db),
):
    """Current shift deployment, rest & upcoming shift, and vacancy/shortage views."""
    timings = await load_shift_timings(db)
    running_shift, running_date = current_shift(timings)
    day = for_date or running_date
    shift = shift_code or running_shift
    nxt_shift, nxt_date = next_shift(timings, shift, day)
    scope = sector_scope(current_user)

    def deployment(rows):
        out = []
        for asn, duty, person in rows:
            if scope is not None and person.sector_id != scope:
                continue
            out.append({"staff_id": person.id, "name": person.name, "service_number": person.service_number,
                        "designation": person.designation.value, "sector_id": person.sector_id,
                        "duty": duty.category, "section": duty.section, "notes": asn.notes})
        return sorted(out, key=lambda r: (r["duty"], r["name"]))

    cur_roster, cur_rows = await _published_assignments(db, day, shift)
    nxt_roster, nxt_rows = await _published_assignments(db, nxt_date, nxt_shift)

    staff = await _scoped_staff(db, current_user)
    statuses = await compute_statuses(db, [s.id for s in staff], day, shift)
    names = {s.id: s for s in staff}
    resting = [
        {"staff_id": sid, "name": names[sid].name, "service_number": names[sid].service_number,
         "reason": st.reason, "rest_until": st.rest_until.isoformat() if st.rest_until else None}
        for sid, st in statuses.items() if st.status == StaffStatus.DUTY_OFF
    ]
    vacancies = await _vacancy_rows(db, day, [shift])
    upcoming_vacancies = await _vacancy_rows(db, nxt_date, [nxt_shift])
    return {
        "current": {"date": str(day), "shift_code": shift.value, "time": timings[shift].label(),
                    "roster_id": cur_roster.id if cur_roster else None,
                    "roster_version": cur_roster.version if cur_roster else None,
                    "deployment": deployment(cur_rows)},
        "upcoming": {"date": str(nxt_date), "shift_code": nxt_shift.value, "time": timings[nxt_shift].label(),
                     "roster_id": nxt_roster.id if nxt_roster else None,
                     "roster_version": nxt_roster.version if nxt_roster else None,
                     "deployment": deployment(nxt_rows),
                     "vacancies": [v for v in upcoming_vacancies if v["vacant"]]},
        "rest": resting,
        "vacancy": {
            "rows": vacancies,
            "total_required": sum(v["required"] for v in vacancies),
            "total_allocated": sum(v["allocated"] for v in vacancies),
            "total_vacant": sum(v["vacant"] for v in vacancies),
            "shortages": [v for v in vacancies if v["vacant"]],
        },
    }


async def _alert_staff_id(db: AsyncSession, alert: Alert) -> Optional[int]:
    model = {"Movement": Movement, "Task": Task, "RosterAssignment": RosterAssignment, "LeaveRequest": LeaveRequest}.get(alert.entity_type)
    if not model:
        return None
    obj = await db.get(model, alert.entity_id)
    if obj is None:
        return None
    return getattr(obj, "staff_id", None) or getattr(obj, "assignee_id", None)


@router.get("/alerts")
async def get_active_alerts(
    include_resolved: bool = Query(False),
    current_user: User = Depends(require_roles(*OFFICERS)),
    db: AsyncSession = Depends(get_db),
):
    q = select(Alert)
    if not include_resolved:
        q = q.where(Alert.is_resolved == False)
    alerts = (await db.execute(q.order_by(Alert.created_at.desc()).limit(100))).scalars().all()
    scope = sector_scope(current_user)
    out = []
    for a in alerts:
        if scope is not None:
            sid = await _alert_staff_id(db, a)
            if sid is None:
                continue
            person = await db.get(Staff, sid)
            if not person or person.sector_id != scope:
                continue
        out.append({
            "id": a.id, "alert_type": a.alert_type, "entity_type": a.entity_type, "entity_id": a.entity_id,
            "message": a.message, "severity": a.severity, "is_resolved": a.is_resolved,
            "resolved_at": a.resolved_at.isoformat() if a.resolved_at else None,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        })
    return out[:50]


@router.post("/alerts/{alert_id}/resolve")
async def resolve_alert(
    alert_id: int,
    current_user: User = Depends(require_roles(*SUPERVISORS)),
    db: AsyncSession = Depends(get_db),
):
    alert = await db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    if alert.is_resolved:
        return {"detail": "Alert already resolved"}
    scope = sector_scope(current_user)
    if scope is not None:
        sid = await _alert_staff_id(db, alert)
        person = await db.get(Staff, sid) if sid else None
        if not person or person.sector_id != scope:
            raise HTTPException(status_code=403, detail="Sector SI can only resolve alerts for their sector")
    alert.is_resolved = True
    alert.resolved_by_id = current_user.id
    alert.resolved_at = datetime.now(timezone.utc)
    await log_event(db, actor=current_user, action=AuditAction.ALERT_RESOLVED, entity_type="Alert", entity_id=alert.id,
                    old_values={"is_resolved": False}, new_values={"is_resolved": True, "alert_type": alert.alert_type})
    await db.commit()
    return {"detail": "Alert acknowledged and resolved"}


@router.get("/inbox")
async def approvals_inbox(
    current_user: User = Depends(require_roles(*OFFICERS)),
    db: AsyncSession = Depends(get_db),
):
    """Everything waiting on this officer: approvals they can act on, plus alerts (guide §9.1 step 3)."""
    scope = sector_scope(current_user)

    def in_scope(q, col):
        if scope is None:
            return q
        return q.join(Staff, col == Staff.id).where(Staff.sector_id == scope)

    items: Dict[str, list] = {"rosters": [], "leave": [], "movements": [], "attendance": []}
    if has_role(current_user, (UserRoleEnum.SHO,)):
        for r in (await db.execute(select(Roster).where(Roster.status == RosterStatus.SUBMITTED)
                                   .order_by(Roster.roster_date))).scalars().all():
            items["rosters"].append({"id": r.id, "date": str(r.roster_date), "shift_code": r.shift_code.value,
                                     "version": r.version, "change_reason": r.change_reason,
                                     "waiting_since": r.updated_at.isoformat() if r.updated_at else None})
    if has_role(current_user, STATION_ADMINS):
        q = in_scope(select(LeaveRequest).where(LeaveRequest.status == LeaveStatus.PENDING), LeaveRequest.staff_id)
        for l in (await db.execute(q.order_by(LeaveRequest.submitted_at))).scalars().all():
            items["leave"].append({"id": l.id, "staff_id": l.staff_id, "leave_type": l.leave_type,
                                   "start_date": str(l.start_date), "end_date": str(l.end_date),
                                   "reference_number": l.reference_number,
                                   "submitted_at": l.submitted_at.isoformat() if l.submitted_at else None})
    if has_role(current_user, SUPERVISORS):
        q = in_scope(select(Movement).where(Movement.status == MovementStatus.PENDING_AUTHORIZATION), Movement.staff_id)
        for m in (await db.execute(q.order_by(Movement.created_at))).scalars().all():
            items["movements"].append({"id": m.id, "staff_id": m.staff_id, "destination": m.destination,
                                       "purpose": m.purpose,
                                       "expected_return": m.expected_return.isoformat() if m.expected_return else None})
        q = in_scope(select(Attendance).where(Attendance.is_confirmed == False, Attendance.submitted_at != None,
                                              Attendance.attendance_date >= now_local().date().replace(day=1)),
                     Attendance.staff_id)
        for a in (await db.execute(q.order_by(Attendance.attendance_date.desc()).limit(100))).scalars().all():
            items["attendance"].append({"id": a.id, "staff_id": a.staff_id, "date": str(a.attendance_date),
                                        "shift_code": a.shift_code.value})
    alerts = await get_active_alerts(False, current_user, db)
    staff_ids = {i["staff_id"] for k in ("leave", "movements", "attendance") for i in items[k]}
    if staff_ids:
        names = {s.id: s for s in (await db.execute(select(Staff).where(Staff.id.in_(staff_ids)))).scalars().all()}
        for k in ("leave", "movements", "attendance"):
            for i in items[k]:
                s = names.get(i["staff_id"])
                i["staff_name"] = s.name if s else None
                i["service_number"] = s.service_number if s else None
    counts = {k: len(v) for k, v in items.items()}
    counts["alerts"] = len(alerts)
    counts["total"] = sum(counts.values())
    return {"counts": counts, **items, "alerts": alerts}
