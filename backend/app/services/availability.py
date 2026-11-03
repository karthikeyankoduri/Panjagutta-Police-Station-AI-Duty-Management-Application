"""
Availability Engine — single source of truth for current staff status (Build Guide §8).

Availability is calculated, never typed in. It is derived from approved leave,
attachment orders, rest rules, recorded movements, published roster assignments
and attendance. Each person receives exactly ONE current status, chosen by the
priority order below (PROVISIONAL until the SHO confirms it, guide §14 item 5):

  1. On Leave (approved only; pending requests do not count)
     – an approved "Duty Off" / "Rest day" request yields Duty Off / Rest
  2. Attached to Other Wing
  3. Duty Off / Rest (rest window after the last worked shift, from the active rotation rule)
  4. Official Movement (open)
     – Shift Change Pending (a newer roster version awaiting approval changes the person's duty)
  5. Emergency / Patrol / Beat / Court / Field / On Duty (latest published roster version)
  6. Present – Available (confirmed attendance, no assignment)
  7. Absent (no confirmed attendance and nothing above applies)

All records are loaded in bulk (a fixed number of queries regardless of staff
count) and resolved by the pure function `resolve_status`, which is unit-tested
across every combination of records.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    Attendance, AttachmentOrder, DutyMaster, LeaveRequest, LeaveStatus, Movement,
    MovementStatus, Roster, RosterAssignment, RosterStatus, ShiftCode, StaffStatus,
)
from app.services.shifts import (
    STATION_TZ, RestPolicy, ShiftTiming, load_rest_policy, load_shift_timings,
    now_local, required_rest_hours,
)

DUTY_OFF_LEAVE_KEYWORDS = ("duty off", "duty_off", "rest day", "rest", "weekly off")


class AvailabilityResult:
    def __init__(
        self,
        staff_id: int,
        status: StaffStatus,
        reason: str,
        is_conflicting: bool = False,
        conflict_detail: Optional[str] = None,
        duty_category: Optional[str] = None,
        duty_section: Optional[str] = None,
        shift_code: Optional[str] = None,
        attendance_confirmed: bool = False,
        rest_until: Optional[datetime] = None,
    ):
        self.staff_id = staff_id
        self.status = status
        self.reason = reason
        self.is_conflicting = is_conflicting
        self.conflict_detail = conflict_detail
        self.duty_category = duty_category
        self.duty_section = duty_section
        self.shift_code = shift_code
        self.attendance_confirmed = attendance_confirmed
        self.rest_until = rest_until

    def as_dict(self) -> dict:
        return {
            "staff_id": self.staff_id,
            "status": self.status.value,
            "reason": self.reason,
            "is_conflicting": self.is_conflicting,
            "conflict_detail": self.conflict_detail,
            "duty_category": self.duty_category,
            "duty_section": self.duty_section,
            "assigned_shift": self.shift_code,
            "attendance_confirmed": self.attendance_confirmed,
            "rest_until": self.rest_until.isoformat() if self.rest_until else None,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Plain data passed to the resolver (keeps the priority logic DB-independent)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class AssignmentFact:
    roster_date: date
    shift_code: ShiftCode
    duty_category: str
    duty_section: Optional[str]
    notes: Optional[str]
    start: datetime
    end: datetime


@dataclass
class StaffFacts:
    approved_leaves: List[Tuple[str, Optional[str]]] = field(default_factory=list)  # (type, reference)
    attachment: Optional[Tuple[str, Optional[str]]] = None  # (wing, order ref)
    open_movement: Optional[Tuple[str, str]] = None  # (destination, purpose)
    assignments: List[AssignmentFact] = field(default_factory=list)  # published, latest versions, nearby dates
    pending_change: Optional[str] = None  # description of a pending roster change
    attendance_confirmed: bool = False
    attendance_scheduled: bool = False


def _duty_status(category: str, section: Optional[str], notes: Optional[str]) -> StaffStatus:
    text = f"{category} {notes or ''}".lower()
    sec = (section or "").lower()
    if "emergency" in text:
        return StaffStatus.EMERGENCY_DEPLOYMENT
    if "patrol" in text or "beat" in text:
        return StaffStatus.PATROL_BEAT
    if "court" in text or sec == "court":
        return StaffStatus.COURT_DUTY
    if "field" in text or sec == "field":
        return StaffStatus.FIELD_DUTY
    return StaffStatus.ON_DUTY


def resolve_status(
    staff_id: int,
    facts: StaffFacts,
    for_date: date,
    shift_code: Optional[ShiftCode],
    reference: datetime,
    policy: RestPolicy,
) -> AvailabilityResult:
    """Apply the priority order to one person's records. Pure function — no I/O."""
    attended = facts.attendance_confirmed

    # 1. Approved leave (a duty-off/rest request yields Duty Off / Rest)
    if facts.approved_leaves:
        leave_type, ref = facts.approved_leaves[0]
        if any(k in (leave_type or "").lower() for k in DUTY_OFF_LEAVE_KEYWORDS):
            return AvailabilityResult(staff_id, StaffStatus.DUTY_OFF,
                                      f"Approved {leave_type} (ref: {ref or 'N/A'})", attendance_confirmed=attended)
        return AvailabilityResult(staff_id, StaffStatus.ON_LEAVE,
                                  f"Approved leave: {leave_type} (ref: {ref or 'N/A'})", attendance_confirmed=attended)

    # 2. Attachment to another wing
    if facts.attachment:
        wing, order = facts.attachment
        return AvailabilityResult(staff_id, StaffStatus.ATTACHED_OTHER_WING,
                                  f"Attached to {wing} (order: {order or 'N/A'})", attendance_confirmed=attended)

    # Assignments that define "current duty" for the requested date/shift
    current = [
        a for a in facts.assignments
        if a.roster_date == for_date and (shift_code is None or a.shift_code == shift_code)
    ]

    # 3. Duty Off / Rest — only when a rotation rule is active; never invented.
    if policy.is_active and not any(a.start <= reference < a.end for a in current):
        finished = [a for a in facts.assignments if a.end <= reference]
        if finished:
            last = max(finished, key=lambda a: a.end)
            hours = required_rest_hours(policy, last.shift_code)
            if hours:
                rest_until = last.end + timedelta(hours=hours)
                if reference < rest_until:
                    return AvailabilityResult(
                        staff_id, StaffStatus.DUTY_OFF,
                        f"Rest after Shift {last.shift_code.value} on {last.roster_date} "
                        f"(ended {last.end.astimezone(STATION_TZ):%d %b %H:%M}); rest until "
                        f"{rest_until.astimezone(STATION_TZ):%d %b %H:%M}",
                        attendance_confirmed=attended, rest_until=rest_until,
                    )

    # 4. Open official movement
    if facts.open_movement:
        destination, purpose = facts.open_movement
        return AvailabilityResult(staff_id, StaffStatus.OFFICIAL_MOVEMENT,
                                  f"Outside on official duty: {destination} (purpose: {purpose})",
                                  attendance_confirmed=attended)

    # 4b. A newer roster version awaiting approval changes this person's duty
    if facts.pending_change:
        return AvailabilityResult(staff_id, StaffStatus.SHIFT_CHANGE_PENDING, facts.pending_change,
                                  attendance_confirmed=attended)

    # 5. Published duty assignment
    if current:
        a = sorted(current, key=lambda x: x.start)[0]
        status = _duty_status(a.duty_category, a.duty_section, a.notes)
        conflict = len({(x.shift_code, x.duty_category) for x in current}) > 1
        return AvailabilityResult(
            staff_id, status, f"Assigned to {a.duty_category} (Shift {a.shift_code.value})",
            is_conflicting=conflict,
            conflict_detail=("Multiple assignments: " + ", ".join(
                f"{x.duty_category} (Shift {x.shift_code.value})" for x in current)) if conflict else None,
            duty_category=a.duty_category, duty_section=a.duty_section, shift_code=a.shift_code.value,
            attendance_confirmed=attended,
        )

    # 6. Present – Available
    if attended:
        return AvailabilityResult(staff_id, StaffStatus.PRESENT_AVAILABLE,
                                  "Attendance confirmed; no duty assigned", attendance_confirmed=True)

    # 7. Absent
    if facts.attendance_scheduled:
        return AvailabilityResult(staff_id, StaffStatus.ABSENT, "Scheduled but attendance not confirmed")
    return AvailabilityResult(staff_id, StaffStatus.ABSENT,
                              "No attendance, assignment, leave or movement record for this date")


# ─────────────────────────────────────────────────────────────────────────────
# Bulk loading
# ─────────────────────────────────────────────────────────────────────────────

def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def reference_time(for_date: date, shift_code: Optional[ShiftCode], timings: Dict[ShiftCode, ShiftTiming]) -> datetime:
    if shift_code and shift_code in timings:
        return timings[shift_code].window(for_date)[0] + timedelta(minutes=1)
    now = now_local()
    if for_date == now.date():
        return now
    return datetime.combine(for_date, time(12, 0), tzinfo=STATION_TZ)


async def latest_published_rosters(db: AsyncSession, start: date, end: date) -> Dict[Tuple[date, ShiftCode], Roster]:
    """The newest published version per date/shift — older published versions are superseded."""
    result = await db.execute(
        select(Roster).where(
            Roster.status == RosterStatus.PUBLISHED,
            Roster.roster_date >= start,
            Roster.roster_date <= end,
        )
    )
    latest: Dict[Tuple[date, ShiftCode], Roster] = {}
    for r in result.scalars().all():
        key = (r.roster_date, r.shift_code)
        if key not in latest or r.version > latest[key].version:
            latest[key] = r
    return latest


async def compute_statuses(
    db: AsyncSession,
    staff_ids: Sequence[int],
    for_date: date,
    shift_code: Optional[ShiftCode] = None,
) -> Dict[int, AvailabilityResult]:
    staff_ids = list(dict.fromkeys(staff_ids))
    if not staff_ids:
        return {}
    timings = await load_shift_timings(db)
    policy = await load_rest_policy(db)
    reference = reference_time(for_date, shift_code, timings)
    facts: Dict[int, StaffFacts] = {sid: StaffFacts() for sid in staff_ids}

    # 1. approved leave
    rows = await db.execute(select(LeaveRequest).where(
        LeaveRequest.staff_id.in_(staff_ids),
        LeaveRequest.status == LeaveStatus.APPROVED,
        LeaveRequest.start_date <= for_date,
        LeaveRequest.end_date >= for_date,
    ))
    for leave in rows.scalars().all():
        facts[leave.staff_id].approved_leaves.append((leave.leave_type, leave.reference_number))

    # 2. attachments
    rows = await db.execute(select(AttachmentOrder).where(
        AttachmentOrder.staff_id.in_(staff_ids),
        AttachmentOrder.is_active == True,
        AttachmentOrder.start_date <= for_date,
    ).order_by(AttachmentOrder.start_date.desc()))
    for order in rows.scalars().all():
        if facts[order.staff_id].attachment is None:
            facts[order.staff_id].attachment = (order.attached_wing, order.order_reference)

    # 4. movements open on the date
    today = now_local().date()
    rows = await db.execute(select(Movement).where(
        Movement.staff_id.in_(staff_ids),
        Movement.status.in_([MovementStatus.AUTHORIZED, MovementStatus.OPEN, MovementStatus.OVERDUE]),
    ))
    for m in rows.scalars().all():
        started = _aware(m.actual_departure or m.authorized_at or m.created_at)
        start_day = started.astimezone(STATION_TZ).date() if started else for_date
        expected = _aware(m.expected_return)
        applies = start_day <= for_date and (
            for_date <= today or expected is None or expected.astimezone(STATION_TZ).date() >= for_date
        )
        if applies and facts[m.staff_id].open_movement is None:
            facts[m.staff_id].open_movement = (m.destination, m.purpose)

    # 5. published assignments for the date and the two previous days (for rest)
    latest = await latest_published_rosters(db, for_date - timedelta(days=2), for_date)
    latest_ids = {r.id: r for r in latest.values()}
    published_duties: Dict[Tuple[int, date, ShiftCode], set] = {}
    if latest_ids:
        rows = await db.execute(
            select(RosterAssignment, DutyMaster)
            .outerjoin(DutyMaster, RosterAssignment.duty_master_id == DutyMaster.id)
            .where(RosterAssignment.roster_id.in_(list(latest_ids)), RosterAssignment.staff_id.in_(staff_ids))
        )
        for asn, duty in rows.all():
            roster = latest_ids[asn.roster_id]
            timing = timings[roster.shift_code]
            start, end = timing.window(roster.roster_date)
            category = duty.category if duty else "Assigned duty"
            facts[asn.staff_id].assignments.append(AssignmentFact(
                roster.roster_date, roster.shift_code, category, duty.section if duty else None,
                asn.notes, start, end,
            ))
            published_duties.setdefault((asn.staff_id, roster.roster_date, roster.shift_code), set()).add(category)

    # 4b. pending roster versions (submitted/approved, newer than the published one)
    rows = await db.execute(select(Roster).where(
        Roster.roster_date == for_date,
        Roster.status.in_([RosterStatus.SUBMITTED, RosterStatus.APPROVED]),
        *( [Roster.shift_code == shift_code] if shift_code else [] ),
    ))
    pending = [r for r in rows.scalars().all()
               if (r.roster_date, r.shift_code) in latest and r.version > latest[(r.roster_date, r.shift_code)].version]
    if pending:
        pend_ids = {r.id: r for r in pending}
        rows = await db.execute(
            select(RosterAssignment, DutyMaster)
            .outerjoin(DutyMaster, RosterAssignment.duty_master_id == DutyMaster.id)
            .where(RosterAssignment.roster_id.in_(list(pend_ids)))
        )
        pending_duties: Dict[Tuple[int, ShiftCode], set] = {}
        for asn, duty in rows.all():
            r = pend_ids[asn.roster_id]
            pending_duties.setdefault((asn.staff_id, r.shift_code), set()).add(duty.category if duty else "duty")
        for r in pending:
            for sid in staff_ids:
                before = published_duties.get((sid, r.roster_date, r.shift_code), set())
                after = pending_duties.get((sid, r.shift_code), set())
                if before != after and facts[sid].pending_change is None:
                    facts[sid].pending_change = (
                        f"Roster v{r.version} for Shift {r.shift_code.value} ({r.status.value}) changes duty "
                        f"from {', '.join(sorted(before)) or 'none'} to {', '.join(sorted(after)) or 'none'}"
                    )

    # 6/7. attendance
    att_q = select(Attendance).where(Attendance.staff_id.in_(staff_ids), Attendance.attendance_date == for_date)
    if shift_code:
        att_q = att_q.where(Attendance.shift_code == shift_code)
    rows = await db.execute(att_q)
    for a in rows.scalars().all():
        facts[a.staff_id].attendance_confirmed |= bool(a.is_confirmed)
        facts[a.staff_id].attendance_scheduled |= bool(a.is_scheduled)

    return {sid: resolve_status(sid, facts[sid], for_date, shift_code, reference, policy) for sid in staff_ids}


async def compute_staff_status(
    db: AsyncSession,
    staff_id: int,
    for_date: date,
    shift_code: Optional[ShiftCode] = None,
    policy_confirmed: bool = False,  # kept for backwards compatibility; policy is read from rotation_rules
) -> AvailabilityResult:
    return (await compute_statuses(db, [staff_id], for_date, shift_code))[staff_id]
