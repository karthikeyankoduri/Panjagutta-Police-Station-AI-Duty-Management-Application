"""
Attendance recorded automatically from sign-in and sign-out (no manual marking).
"""
from datetime import datetime, time, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.models import Attendance, AuditLog, ShiftCode, StaffDesignation, UserRoleEnum, UserSession
from app.services import attendance_auto
from app.services.shifts import STATION_TZ
from conftest import login, today


def at(day, hh, mm=0):
    """A station-local (IST) moment."""
    return datetime.combine(day, time(hh, mm), tzinfo=STATION_TZ)


@pytest.fixture
def clock(monkeypatch):
    """Pin the station clock used by the attendance service."""
    state = {"now": at(today(), 9, 0)}
    monkeypatch.setattr(attendance_auto, "now_local", lambda: state["now"])

    def set_now(moment):
        state["now"] = moment
    return set_now


async def _rows(db, staff_id=None):
    q = select(Attendance).execution_options(populate_existing=True)
    if staff_id:
        q = q.where(Attendance.staff_id == staff_id)
    return (await db.execute(q.order_by(Attendance.id))).scalars().all()


@pytest.fixture
async def duty_a(db, make):
    """A staff member rostered on a published Shift A today, with a linked login."""
    staff = await make.staff(name="Rostered", designation=StaffDesignation.PC)
    user = await make.user(UserRoleEnum.STAFF, staff=staff)
    duty = await make.duty("Patrol Vehicles", ShiftCode.A)
    await make.roster(today(), ShiftCode.A, [(staff, duty)])
    return staff, user, duty


async def test_sign_in_during_shift_marks_present(client, db, duty_a, clock):
    staff, user, _ = duty_a
    clock(at(today(), 8, 5))
    await login(client, user)
    rows = await _rows(db, staff.id)
    assert len(rows) == 1
    a = rows[0]
    assert (a.shift_code, a.attendance_date) == (ShiftCode.A, today())
    assert a.is_scheduled and a.is_confirmed and not a.is_late
    assert a.source == "LOGIN" and a.check_in_at is not None and a.check_out_at is None


async def test_sign_in_shortly_before_start_counts_for_the_shift(client, db, duty_a, clock):
    staff, user, _ = duty_a
    clock(at(today(), 7, 15))  # 45 min early, inside the 60 min margin
    await login(client, user)
    (a,) = await _rows(db, staff.id)
    assert a.shift_code == ShiftCode.A and a.is_confirmed and not a.is_late


async def test_sign_in_after_grace_is_flagged_late_but_still_present(client, db, duty_a, clock):
    staff, user, _ = duty_a
    clock(at(today(), 9, 0))  # 60 min after 08:00 start
    await login(client, user)
    (a,) = await _rows(db, staff.id)
    assert a.is_confirmed and a.is_late


async def test_repeat_sign_in_keeps_the_first_check_in(client, db, duty_a, clock):
    staff, user, _ = duty_a
    clock(at(today(), 8, 2))
    await login(client, user)
    first = (await _rows(db, staff.id))[0].check_in_at
    clock(at(today(), 10, 30))
    await login(client, user)
    rows = await _rows(db, staff.id)
    assert len(rows) == 1
    assert rows[0].check_in_at == first and not rows[0].is_late


async def test_night_shift_after_midnight_belongs_to_the_day_it_started(client, db, make, clock):
    staff = await make.staff(name="Night")
    user = await make.user(UserRoleEnum.STAFF, staff=staff)
    duty = await make.duty("Patrol Vehicles", ShiftCode.C)
    await make.roster(today(), ShiftCode.C, [(staff, duty)])
    clock(at(today() + timedelta(days=1), 2, 0))  # 02:00 the next morning
    await login(client, user)
    (a,) = await _rows(db, staff.id)
    assert a.shift_code == ShiftCode.C and a.attendance_date == today() and a.is_confirmed


async def test_sign_in_without_a_rostered_shift_still_counts_as_present(client, db, make, clock):
    staff = await make.staff(name="Off duty")
    user = await make.user(UserRoleEnum.STAFF, staff=staff)
    clock(at(today(), 10, 0))
    await login(client, user)
    (a,) = await _rows(db, staff.id)
    assert a.source == "LOGIN" and not a.is_scheduled and a.is_confirmed and not a.is_late


async def test_unpublished_roster_is_present_but_not_scheduled(client, db, make, clock):
    from app.models.models import RosterStatus
    staff = await make.staff(name="Draft")
    user = await make.user(UserRoleEnum.STAFF, staff=staff)
    duty = await make.duty("Patrol Vehicles", ShiftCode.A)
    await make.roster(today(), ShiftCode.A, [(staff, duty)], status=RosterStatus.DRAFT)
    clock(at(today(), 8, 5))
    await login(client, user)
    (a,) = await _rows(db, staff.id)
    assert a.is_confirmed and not a.is_scheduled


async def test_accounts_without_a_staff_record_are_not_tracked(client, db, make, clock):
    clock(at(today(), 9, 0))
    await login(client, await make.user(UserRoleEnum.SUPER_ADMIN))
    await login(client, await make.user(UserRoleEnum.SHO))
    assert await _rows(db) == []


async def test_officer_with_a_staff_record_is_tracked(client, db, make, clock):
    staff = await make.staff(name="Sector SI", designation=StaffDesignation.SI)
    user = await make.user(UserRoleEnum.SECTOR_SI, staff=staff, sector_id=1)
    duty = await make.duty("Patrol Vehicles", ShiftCode.A)
    await make.roster(today(), ShiftCode.A, [(staff, duty)])
    clock(at(today(), 8, 0))
    await login(client, user)
    (a,) = await _rows(db, staff.id)
    assert a.is_confirmed


async def test_recording_failure_never_blocks_login(client, db, duty_a, clock, monkeypatch):
    _, user, _ = duty_a

    async def boom(*a, **k):
        raise RuntimeError("db hiccup")
    monkeypatch.setattr(attendance_auto, "_record_sign_in", boom)
    h = await login(client, user)
    assert (await client.get("/api/auth/me", headers=h)).status_code == 200


async def test_logout_records_the_check_out(client, db, duty_a, clock):
    staff, user, _ = duty_a
    clock(at(today(), 8, 5))
    h = await login(client, user)
    clock(at(today(), 13, 45))
    assert (await client.post("/api/auth/logout", headers=h)).status_code == 200
    (a,) = await _rows(db, staff.id)
    out = a.check_out_at if a.check_out_at.tzinfo else a.check_out_at.replace(tzinfo=timezone.utc)
    assert out == at(today(), 13, 45).astimezone(timezone.utc)


async def test_idle_session_sweep_uses_last_activity_as_check_out(client, db, duty_a, clock):
    staff, user, _ = duty_a
    clock(at(today(), 8, 5))
    await login(client, user)
    last = datetime.now(timezone.utc) - timedelta(hours=3)
    user_row = await db.get(type(user), user.id, populate_existing=True)
    user_row.last_activity = last
    await db.commit()

    assert await attendance_auto.expire_idle_sessions(db) == 1
    await db.commit()
    (a,) = await _rows(db, staff.id)
    out = a.check_out_at if a.check_out_at.tzinfo else a.check_out_at.replace(tzinfo=timezone.utc)
    assert abs((out - last).total_seconds()) < 1
    sessions = (await db.execute(select(UserSession).where(UserSession.user_id == user.id))).scalars().all()
    assert all(not s.is_valid for s in sessions)
    # Idempotent: nothing left to close, nothing changes.
    assert await attendance_auto.expire_idle_sessions(db) == 0


async def test_sign_in_and_out_are_audited(client, db, duty_a, clock):
    _, user, _ = duty_a
    clock(at(today(), 8, 5))
    h = await login(client, user)
    await client.post("/api/auth/logout", headers=h)
    actions = {r.action for r in (await db.execute(select(AuditLog))).scalars().all()}
    assert {"ATTENDANCE_SIGNED_IN", "ATTENDANCE_SIGNED_OUT"} <= actions


async def test_manual_marking_endpoints_are_gone(client, make, duty_a):
    staff, user, duty = duty_a
    sho = await make.user(UserRoleEnum.SHO)
    h = await login(client, sho)
    body = {"staff_id": staff.id, "attendance_date": str(today()), "shift_code": "A"}
    for method, url in (("post", "/api/attendance/mark"), ("post", "/api/attendance/bulk"),
                        ("post", "/api/attendance/"), ("post", "/api/attendance/1/verify")):
        res = await getattr(client, method)(url, json=body, headers=h)
        assert res.status_code in (404, 405), (url, res.status_code)
    assert (await client.post("/api/mobile/attendance", json={"roster_id": 1}, headers=h)).status_code in (404, 405)


async def test_attendance_listing_returns_times_and_keeps_role_scoping(client, db, make, duty_a, clock):
    staff, user, duty = duty_a
    other = await make.staff(name="Other")
    other_user = await make.user(UserRoleEnum.STAFF, staff=other)
    await make.roster(today(), ShiftCode.A, [(other, duty)], version=2)
    clock(at(today(), 8, 5))
    h = await login(client, user)
    await login(client, other_user)

    mine = (await client.get("/api/attendance/", headers=h)).json()
    assert [r["staff_id"] for r in mine] == [staff.id]
    assert mine[0]["check_in_at"] and mine[0]["source"] == "LOGIN" and mine[0]["is_late"] is False

    sho = await make.user(UserRoleEnum.SHO)
    everyone = (await client.get("/api/attendance/", headers=await login(client, sho))).json()
    assert {r["staff_id"] for r in everyone} == {staff.id, other.id}


async def test_current_shift_endpoint_returns_the_running_shift(client, make):
    sho = await make.user(UserRoleEnum.SHO)
    res = await client.get("/api/attendance/current-shift", headers=await login(client, sho))
    assert res.status_code == 200
    body = res.json()
    assert body["shift_code"] in {"A", "B", "C"} and len(body["date"]) == 10


async def test_signed_in_staff_appear_when_the_screen_asks_for_that_shift(client, db, make, clock):
    """Regression: the screens defaulted to Shift A while sign-ins were stored under the running shift (B)."""
    staff = await make.staff(name="Evening")
    user = await make.user(UserRoleEnum.STAFF, staff=staff)
    clock(at(today(), 16, 30))  # Shift B, nobody rostered
    await login(client, user)
    sho = await make.user(UserRoleEnum.SHO)
    h = await login(client, sho)
    day = str(today())
    assert (await client.get(f"/api/attendance/?attendance_date={day}&shift_code=A", headers=h)).json() == []
    rows = (await client.get(f"/api/attendance/?attendance_date={day}&shift_code=B", headers=h)).json()
    assert [r["staff_id"] for r in rows] == [staff.id] and rows[0]["is_confirmed"] is True
