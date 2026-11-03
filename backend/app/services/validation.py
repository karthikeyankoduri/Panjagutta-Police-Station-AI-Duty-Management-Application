"""
Roster allocation validation (Build Guide §9.2 step 5, blueprint steps 13–14).

Hard rules are plain code. Every rule reads shift times from shift_config and
rest periods from the active rotation rule — nothing is hard-coded.

Blocking issues (cannot be saved unless an authorized exception is recorded):
  DUPLICATE, SHIFT_CONFLICT, REST_VIOLATION, APPROVED_LEAVE, ATTACHED,
  OPEN_MOVEMENT, INACTIVE_STAFF
Advisory issues (shown before saving, never block):
  DESIGNATION_MISMATCH, VACANCY, UNCONFIRMED_AVAILABILITY, UNCONFIGURED_DUTY,
  UNCONFIRMED_POLICY, OPEN_TASK
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    Attendance, DutyMaster, Roster, RosterAssignment, ShiftCode, Staff, StaffStatus,
    Task, TaskStatus, User, UserRoleEnum,
)
from app.services.availability import compute_statuses
from app.services.shifts import (
    ShiftTiming, load_rest_policy, load_shift_timings, now_local, required_rest_hours,
)

# Blocking, but may be overridden by an authorized exception.
BLOCKING = {
    "DUPLICATE", "SHIFT_CONFLICT", "REST_VIOLATION", "APPROVED_LEAVE",
    "ATTACHED", "OPEN_MOVEMENT",
}
# Duplicates of the same person on the same duty violate a DB constraint and can never be overridden.
NEVER_OVERRIDABLE = {"DUPLICATE_SAME_DUTY", "INACTIVE_STAFF"}

DEFAULT_EXCEPTION_AUTHORIZER_ROLES = (UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)


@dataclass
class Issue:
    code: str
    message: str
    staff_id: Optional[int] = None
    duty_master_id: Optional[int] = None
    index: Optional[int] = None  # position of the assignment in the submitted list
    overridden: bool = False

    @property
    def blocking(self) -> bool:
        return (self.code in BLOCKING or self.code in NEVER_OVERRIDABLE) and not self.overridden

    def as_dict(self) -> dict:
        return {
            "code": self.code, "message": self.message, "staff_id": self.staff_id,
            "duty_master_id": self.duty_master_id, "index": self.index,
            "blocking": self.blocking, "overridden": self.overridden,
            "severity": "violation" if (self.code in BLOCKING or self.code in NEVER_OVERRIDABLE) else "warning",
        }

    def text(self) -> str:
        prefix = "[OVERRIDDEN EXCEPTION] " if self.overridden else ""
        return f"{prefix}{self.code.replace('_', ' ')}: {self.message}"


@dataclass
class ValidationResult:
    issues: List[Issue] = field(default_factory=list)
    authorizers: Dict[int, User] = field(default_factory=dict)  # assignment index -> authorizing officer

    @property
    def blocking(self) -> List[Issue]:
        return [i for i in self.issues if i.blocking]

    def as_dict(self) -> dict:
        return {
            "issues": [i.as_dict() for i in self.issues],
            "warnings": [i.text() for i in self.issues],
            "blocking_count": len(self.blocking),
            "can_save": not self.blocking,
        }


async def _latest_rosters_near(db: AsyncSession, day: date, exclude: Tuple[date, ShiftCode]) -> Dict[int, Roster]:
    """Latest version (any status) of every other date/shift roster within a day either side."""
    result = await db.execute(select(Roster).where(
        Roster.roster_date >= day - timedelta(days=2), Roster.roster_date <= day + timedelta(days=2)))
    latest: Dict[Tuple[date, ShiftCode], Roster] = {}
    for r in result.scalars().all():
        key = (r.roster_date, r.shift_code)
        if key == exclude:
            continue
        if key not in latest or r.version > latest[key].version:
            latest[key] = r
    return {r.id: r for r in latest.values()}


async def validate_assignments(
    db: AsyncSession,
    roster_date: date,
    shift_code: ShiftCode,
    assignments: Sequence,  # objects with duty_master_id, staff_id, is_exception, exception_reason, exception_authorized_by_id
    actor: User,
) -> ValidationResult:
    out = ValidationResult()
    timings = await load_shift_timings(db)
    policy = await load_rest_policy(db)
    this_timing: ShiftTiming = timings[shift_code]
    this_start, this_end = this_timing.window(roster_date)

    staff_ids = list({a.staff_id for a in assignments})
    duty_ids = list({a.duty_master_id for a in assignments})
    staff_map: Dict[int, Staff] = {}
    if staff_ids:
        staff_map = {s.id: s for s in (await db.execute(select(Staff).where(Staff.id.in_(staff_ids)))).scalars().all()}
    duty_map: Dict[int, DutyMaster] = {}
    if duty_ids:
        duty_map = {d.id: d for d in (await db.execute(select(DutyMaster).where(DutyMaster.id.in_(duty_ids)))).scalars().all()}

    def name(sid: int) -> str:
        s = staff_map.get(sid)
        return f"{s.name} ({s.service_number})" if s else f"Staff #{sid}"

    def add(code, msg, a=None, idx=None):
        out.issues.append(Issue(code, msg, getattr(a, "staff_id", None), getattr(a, "duty_master_id", None), idx))

    if not policy.is_active:
        add("UNCONFIRMED_POLICY", "No confirmed or demo-simulated rotation rule — rest periods cannot be checked.")
    elif not policy.is_confirmed:
        add("UNCONFIRMED_POLICY", "Rest checks use DEMO-SIMULATED rotation rules that the SHO has not signed off.")

    # Duplicates inside the submitted list
    seen_pair, seen_staff = set(), {}
    for idx, a in enumerate(assignments):
        if (a.staff_id, a.duty_master_id) in seen_pair:
            add("DUPLICATE_SAME_DUTY", f"{name(a.staff_id)} is listed twice for the same duty.", a, idx)
        elif a.staff_id in seen_staff:
            other = duty_map.get(seen_staff[a.staff_id])
            add("DUPLICATE", f"{name(a.staff_id)} is already allocated to "
                             f"'{other.category if other else 'another duty'}' in this shift.", a, idx)
        seen_pair.add((a.staff_id, a.duty_master_id))
        seen_staff.setdefault(a.staff_id, a.duty_master_id)

    # Other rosters around this date (shift overlap and rest)
    others = await _latest_rosters_near(db, roster_date, (roster_date, shift_code))
    other_asns: Dict[int, List[Tuple[Roster, datetime, datetime]]] = {}
    if others and staff_ids:
        rows = await db.execute(select(RosterAssignment).where(
            RosterAssignment.roster_id.in_(list(others)), RosterAssignment.staff_id.in_(staff_ids)))
        for ra in rows.scalars().all():
            r = others[ra.roster_id]
            s, e = timings[r.shift_code].window(r.roster_date)
            other_asns.setdefault(ra.staff_id, []).append((r, s, e))

    statuses = await compute_statuses(db, staff_ids, roster_date, shift_code)

    # Open tasks overlapping the shift (existing commitment, advisory)
    open_tasks: Dict[int, List[Task]] = {}
    if staff_ids:
        rows = await db.execute(select(Task).where(
            Task.assignee_id.in_(staff_ids),
            Task.status.in_([TaskStatus.NOT_STARTED, TaskStatus.IN_PROGRESS]),
            or_(Task.expected_completion == None, Task.expected_completion > this_start),
        ))
        for t in rows.scalars().all():
            open_tasks.setdefault(t.assignee_id, []).append(t)

    confirmed_today = set()
    if roster_date <= now_local().date() and staff_ids:
        rows = await db.execute(select(Attendance.staff_id).where(
            Attendance.staff_id.in_(staff_ids), Attendance.attendance_date == roster_date,
            Attendance.is_confirmed == True))
        confirmed_today = set(rows.scalars().all())

    for idx, a in enumerate(assignments):
        person = staff_map.get(a.staff_id)
        duty = duty_map.get(a.duty_master_id)
        if not person or not person.is_active:
            add("INACTIVE_STAFF", f"Staff ID {a.staff_id} not found or inactive.", a, idx)
            continue
        if not duty or not duty.is_active:
            add("INACTIVE_STAFF", f"Duty ID {a.duty_master_id} not found or inactive.", a, idx)
            continue
        if not duty.is_configured:
            add("UNCONFIGURED_DUTY", f"'{duty.category}' has no authorized required strength yet.", a, idx)

        for r, s, e in other_asns.get(a.staff_id, []):
            label = f"Shift {r.shift_code.value} on {r.roster_date} (Roster #{r.id} v{r.version}, {r.status.value})"
            if s < this_end and this_start < e:
                add("SHIFT_CONFLICT", f"{name(a.staff_id)} is already on {label}; the shift times overlap.", a, idx)
                continue
            if e <= this_start:
                need = required_rest_hours(policy, r.shift_code)
                gap = (this_start - e).total_seconds() / 3600
                if need and gap < need:
                    add("REST_VIOLATION", f"{name(a.staff_id)} finishes {label} at {e:%d %b %H:%M}; only "
                                          f"{gap:.0f}h rest before this shift ({need:.0f}h required).", a, idx)
            elif s >= this_end:
                need = required_rest_hours(policy, shift_code)
                gap = (s - this_end).total_seconds() / 3600
                if need and gap < need:
                    add("REST_VIOLATION", f"{name(a.staff_id)} starts {label} only {gap:.0f}h after this shift "
                                          f"ends ({need:.0f}h rest required).", a, idx)

        st = statuses.get(a.staff_id)
        if st:
            if st.status == StaffStatus.ON_LEAVE or (st.status == StaffStatus.DUTY_OFF and st.reason.startswith("Approved")):
                add("APPROVED_LEAVE", f"{name(a.staff_id)}: {st.reason} on {roster_date}.", a, idx)
            elif st.status == StaffStatus.ATTACHED_OTHER_WING:
                add("ATTACHED", f"{name(a.staff_id)}: {st.reason}. Exclude from routine assignment.", a, idx)
            elif st.status == StaffStatus.OFFICIAL_MOVEMENT:
                add("OPEN_MOVEMENT", f"{name(a.staff_id)}: {st.reason}.", a, idx)

        for t in open_tasks.get(a.staff_id, [])[:1]:
            add("OPEN_TASK", f"{name(a.staff_id)} has an open task: {t.description[:80]}", a, idx)

        if roster_date <= now_local().date() and a.staff_id not in confirmed_today:
            add("UNCONFIRMED_AVAILABILITY", f"{name(a.staff_id)} has no confirmed attendance on {roster_date}.", a, idx)

        if duty.eligible_designations and person.designation.value not in duty.eligible_designations:
            add("DESIGNATION_MISMATCH", f"{name(a.staff_id)} ({person.designation.value}) is not eligible for "
                                        f"'{duty.category}'. Eligible: {', '.join(duty.eligible_designations)}", a, idx)

    # Vacancies against required strength for this shift
    duties = (await db.execute(select(DutyMaster).where(
        DutyMaster.is_active == True, DutyMaster.is_configured == True,
        or_(DutyMaster.shift_code == shift_code, DutyMaster.shift_code == None),
    ))).scalars().all()
    for d in duties:
        if not d.required_strength:
            continue
        count = len({a.staff_id for a in assignments if a.duty_master_id == d.id})
        if count < d.required_strength:
            out.issues.append(Issue("VACANCY", f"'{d.category}' needs {d.required_strength}, {count} allocated "
                                               f"({d.required_strength - count} vacant).", None, d.id))

    await _apply_exceptions(db, out, assignments, actor, policy.exception_authorizer_role)
    return out


async def _apply_exceptions(db: AsyncSession, out: ValidationResult, assignments, actor: User,
                            authorizer_role: Optional[str]) -> None:
    """Mark blocking issues as overridden only when a valid, distinct authorizing officer is recorded."""
    allowed_roles = DEFAULT_EXCEPTION_AUTHORIZER_ROLES
    if authorizer_role:
        try:
            allowed_roles = (UserRoleEnum(authorizer_role),)
        except ValueError:
            pass
    for idx, a in enumerate(assignments):
        mine = [i for i in out.issues if i.index == idx and (i.code in BLOCKING)]
        if not mine or not getattr(a, "is_exception", False):
            continue
        reason = (getattr(a, "exception_reason", None) or "").strip()
        auth_id = getattr(a, "exception_authorized_by_id", None)
        problem = None
        authorizer = await db.get(User, auth_id) if auth_id else None
        if not reason:
            problem = "an exception reason is required"
        elif not authorizer or not authorizer.is_active:
            problem = "an authorizing officer must be selected"
        elif authorizer.role not in allowed_roles and authorizer.role != UserRoleEnum.SUPER_ADMIN:
            problem = f"the authorizing officer must hold role {', '.join(r.value for r in allowed_roles)}"
        elif authorizer.id == actor.id and actor.role != UserRoleEnum.SHO:
            problem = "the authorizing officer must be someone other than the person allocating"
        if problem:
            for i in mine:
                i.message += f" Override not accepted: {problem}."
            continue
        for i in mine:
            i.overridden = True
            i.message += f" Authorized by {authorizer.username}: {reason}"
        out.authorizers[idx] = authorizer
