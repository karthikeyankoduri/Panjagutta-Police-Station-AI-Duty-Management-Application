"""
Availability engine tests (Build Guide §8, blueprint step 22):
"Unit tests show one status per person across every combination of records."
"""
import itertools
from datetime import date, datetime, time, timedelta

import pytest

from app.models.models import (
    AttachmentOrder, Attendance, LeaveRequest, LeaveStatus, Movement, MovementStatus, PolicyStatus,
    RosterStatus, ShiftCode, StaffStatus,
)
from app.services.availability import (
    AssignmentFact, StaffFacts, compute_statuses, compute_staff_status, resolve_status,
)
from app.services.shifts import STATION_TZ, RestPolicy

DAY = date(2026, 11, 3)
REF = datetime.combine(DAY, time(10, 0), tzinfo=STATION_TZ)
POLICY = RestPolicy(PolicyStatus.CONFIRMED, 16.0, 24.0, "A->B->C", "SHO")
NO_POLICY = RestPolicy(PolicyStatus.UNCONFIRMED, None, None, None, None)


def _asn(day, shift, category="Reception", section=None, start_h=8, hours=6, notes=None):
    start = datetime.combine(day, time(start_h, 0), tzinfo=STATION_TZ)
    return AssignmentFact(day, shift, category, section, notes, start, start + timedelta(hours=hours))


# Last night's Shift C (20:00 → 08:00 today): at 10:00 the person is inside the 16h rest window.
NIGHT_BEFORE = _asn(DAY - timedelta(days=1), ShiftCode.C, "Patrol Vehicles", "Patrol", 20, 12)
TODAY_PATROL = _asn(DAY, ShiftCode.A, "Patrol Vehicles", "Patrol", 8, 6)

PRIORITY = [
    StaffStatus.ON_LEAVE, StaffStatus.ATTACHED_OTHER_WING, StaffStatus.DUTY_OFF,
    StaffStatus.OFFICIAL_MOVEMENT, StaffStatus.SHIFT_CHANGE_PENDING, StaffStatus.PATROL_BEAT,
    StaffStatus.PRESENT_AVAILABLE, StaffStatus.ABSENT,
]


def _facts(leave, attach, rest, movement, pending, assigned, attended):
    f = StaffFacts()
    if leave:
        f.approved_leaves.append(("EL", "EL/1"))
    if attach:
        f.attachment = ("CCS", "ORD-1")
    if rest:
        f.assignments.append(NIGHT_BEFORE)
    if movement:
        f.open_movement = ("Nampally Court", "Evidence")
    if pending:
        f.pending_change = "Roster v2 changes duty"
    if assigned:
        f.assignments.append(_asn(DAY, ShiftCode.B, "Patrol Vehicles", "Patrol", 14, 6))
    f.attendance_confirmed = attended
    return f


@pytest.mark.parametrize("combo", list(itertools.product([False, True], repeat=7)))
def test_every_combination_yields_exactly_one_status_in_priority_order(combo):
    leave, attach, rest, movement, pending, assigned, attended = combo
    result = resolve_status(1, _facts(*combo), DAY, None, REF, POLICY)
    expected = (
        StaffStatus.ON_LEAVE if leave else
        StaffStatus.ATTACHED_OTHER_WING if attach else
        StaffStatus.DUTY_OFF if rest else
        StaffStatus.OFFICIAL_MOVEMENT if movement else
        StaffStatus.SHIFT_CHANGE_PENDING if pending else
        StaffStatus.PATROL_BEAT if assigned else
        StaffStatus.PRESENT_AVAILABLE if attended else
        StaffStatus.ABSENT
    )
    assert result.status == expected
    assert isinstance(result.status, StaffStatus)  # exactly one status


def test_rest_is_never_invented_without_an_active_rotation_rule():
    f = StaffFacts(assignments=[NIGHT_BEFORE])
    assert resolve_status(1, f, DAY, None, REF, NO_POLICY).status == StaffStatus.ABSENT


def test_rest_ends_after_required_hours():
    f = StaffFacts(assignments=[NIGHT_BEFORE], attendance_confirmed=True)
    late = datetime.combine(DAY + timedelta(days=1), time(1, 0), tzinfo=STATION_TZ)  # 17h after 08:00
    assert resolve_status(1, f, DAY + timedelta(days=1), None, late, POLICY).status == StaffStatus.PRESENT_AVAILABLE


def test_duty_off_after_shift_b_uses_longer_window():
    b = _asn(DAY - timedelta(days=1), ShiftCode.B, "Reception", None, 14, 6)  # ends 20:00 yesterday
    at = datetime.combine(DAY, time(18, 0), tzinfo=STATION_TZ)  # 22h later: < 24h duty off after B
    assert resolve_status(1, StaffFacts(assignments=[b]), DAY, None, at, POLICY).status == StaffStatus.DUTY_OFF


def test_person_on_shift_now_is_not_marked_resting():
    f = StaffFacts(assignments=[NIGHT_BEFORE, TODAY_PATROL])
    assert resolve_status(1, f, DAY, None, REF, POLICY).status == StaffStatus.PATROL_BEAT


def test_approved_duty_off_request_yields_duty_off_not_leave():
    f = StaffFacts(approved_leaves=[("Duty off", None)])
    assert resolve_status(1, f, DAY, None, REF, POLICY).status == StaffStatus.DUTY_OFF


@pytest.mark.parametrize("category,section,expected", [
    ("Summons", "Court", StaffStatus.COURT_DUTY),
    ("Warrants", "Court", StaffStatus.COURT_DUTY),
    ("JFCM Staff", "Court", StaffStatus.COURT_DUTY),
    ("Sessions Court", "Court", StaffStatus.COURT_DUTY),
    ("Beat Constables", "Beat", StaffStatus.PATROL_BEAT),
    ("Patrol Vehicles", "Patrol", StaffStatus.PATROL_BEAT),
    ("Field enquiry", None, StaffStatus.FIELD_DUTY),
    ("Reception", "Reception", StaffStatus.ON_DUTY),
    ("Emergency bandobast", None, StaffStatus.EMERGENCY_DEPLOYMENT),
])
def test_duty_category_maps_to_status(category, section, expected):
    f = StaffFacts(assignments=[_asn(DAY, ShiftCode.A, category, section)])
    assert resolve_status(1, f, DAY, None, REF, NO_POLICY).status == expected


def test_patrol_staff_never_counted_available_even_when_present():
    f = StaffFacts(assignments=[TODAY_PATROL], attendance_confirmed=True)
    r = resolve_status(1, f, DAY, None, REF, NO_POLICY)
    assert r.status == StaffStatus.PATROL_BEAT and r.attendance_confirmed


# ── Database-backed behaviour ───────────────────────────────────────────────

async def test_pending_leave_does_not_count_but_approved_does(db, make):
    s = await make.staff()
    db.add(LeaveRequest(staff_id=s.id, leave_type="CL", start_date=DAY, end_date=DAY, status=LeaveStatus.PENDING))
    await db.commit()
    assert (await compute_staff_status(db, s.id, DAY)).status == StaffStatus.ABSENT
    db.add(LeaveRequest(staff_id=s.id, leave_type="EL", start_date=DAY, end_date=DAY, status=LeaveStatus.APPROVED))
    await db.commit()
    assert (await compute_staff_status(db, s.id, DAY)).status == StaffStatus.ON_LEAVE


async def test_only_latest_published_version_counts(db, make):
    s = await make.staff()
    patrol = await make.duty("Patrol Vehicles", ShiftCode.A)
    reception = await make.duty("Reception")
    await make.roster(DAY, ShiftCode.A, [(s, patrol)], version=1)
    await make.roster(DAY, ShiftCode.A, [(s, reception)], version=2)
    r = await compute_staff_status(db, s.id, DAY, ShiftCode.A)
    assert r.status == StaffStatus.ON_DUTY and r.duty_category == "Reception"


async def test_draft_roster_does_not_affect_status(db, make):
    s = await make.staff()
    patrol = await make.duty("Patrol Vehicles", ShiftCode.A)
    await make.roster(DAY, ShiftCode.A, [(s, patrol)], status=RosterStatus.DRAFT)
    assert (await compute_staff_status(db, s.id, DAY, ShiftCode.A)).status == StaffStatus.ABSENT


async def test_movement_started_after_date_does_not_apply(db, make):
    s = await make.staff()
    start = datetime.combine(DAY + timedelta(days=2), time(9, 0), tzinfo=STATION_TZ)
    db.add(Movement(staff_id=s.id, purpose="Court", destination="Nampally", status=MovementStatus.AUTHORIZED,
                    authorized_at=start, actual_departure=start))
    await db.commit()
    assert (await compute_staff_status(db, s.id, DAY)).status == StaffStatus.ABSENT
    assert (await compute_staff_status(db, s.id, DAY + timedelta(days=2))).status == StaffStatus.OFFICIAL_MOVEMENT


async def test_attachment_and_attendance(db, make):
    a = await make.staff()
    b = await make.staff()
    db.add(AttachmentOrder(staff_id=a.id, parent_unit="PS", attached_wing="CCS", start_date=DAY - timedelta(days=5)))
    db.add(Attendance(staff_id=b.id, attendance_date=DAY, shift_code=ShiftCode.A, is_scheduled=False, is_confirmed=True))
    await db.commit()
    res = await compute_statuses(db, [a.id, b.id], DAY)
    assert res[a.id].status == StaffStatus.ATTACHED_OTHER_WING
    assert res[b.id].status == StaffStatus.PRESENT_AVAILABLE


async def test_rest_from_published_night_shift(db, make):
    await make.policy()
    s = await make.staff()
    patrol_c = await make.duty("Patrol Vehicles", ShiftCode.C)
    await make.roster(DAY - timedelta(days=1), ShiftCode.C, [(s, patrol_c)])
    # Shift A today starts 08:00, exactly when last night's C ends: inside the 16h rest window.
    r = await compute_staff_status(db, s.id, DAY, ShiftCode.A)
    assert r.status == StaffStatus.DUTY_OFF and r.rest_until is not None


async def test_shift_change_pending_detected(db, make):
    s = await make.staff()
    reception = await make.duty("Reception")
    cctns = await make.duty("CCTNS")
    await make.roster(DAY, ShiftCode.A, [(s, reception)], version=1)
    await make.roster(DAY, ShiftCode.A, [(s, cctns)], version=2, status=RosterStatus.SUBMITTED)
    assert (await compute_staff_status(db, s.id, DAY, ShiftCode.A)).status == StaffStatus.SHIFT_CHANGE_PENDING
