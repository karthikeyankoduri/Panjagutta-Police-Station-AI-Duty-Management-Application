"""
Validation rule tests (blueprint step 13: "Each rule has a test that fails without it")
and exception authorization (step 14: "An override cannot be saved without an authorizer").
"""
from datetime import timedelta
from types import SimpleNamespace

from app.models.models import (
    AttachmentOrder, Attendance, LeaveRequest, LeaveStatus, Movement, MovementStatus, PolicyStatus,
    RosterStatus, ShiftCode, StaffDesignation, Task, TaskStatus, UserRoleEnum,
)
from app.services.validation import validate_assignments
from conftest import login, today

DAY = today() + timedelta(days=7)


def A(staff, duty, **kw):
    return SimpleNamespace(staff_id=staff.id, duty_master_id=duty.id, is_exception=kw.get("ex", False),
                           exception_reason=kw.get("reason"), exception_authorized_by_id=kw.get("auth"))


def codes(result, blocking_only=False):
    return {i.code for i in result.issues if (i.blocking or not blocking_only)}


async def _admin(make):
    return await make.user(UserRoleEnum.ADMIN_SI)


async def test_duplicate_in_same_shift(db, make):
    s = await make.staff()
    r1, r2 = await make.duty("Reception"), await make.duty("CCTNS")
    res = await validate_assignments(db, DAY, ShiftCode.A, [A(s, r1), A(s, r2)], await _admin(make))
    assert "DUPLICATE" in codes(res, True)


async def test_same_person_same_duty_twice_can_never_be_overridden(db, make):
    s = await make.staff()
    d = await make.duty("Reception")
    sho = await make.user(UserRoleEnum.SHO)
    res = await validate_assignments(db, DAY, ShiftCode.A, [A(s, d), A(s, d, ex=True, reason="x", auth=sho.id)], sho)
    assert "DUPLICATE_SAME_DUTY" in codes(res, True)


async def test_shift_time_overlap_uses_configured_times(db, make):
    # C on DAY-1 runs 20:00 → 08:00 on DAY; A on DAY starts 08:00 → touching, not overlapping.
    # B on DAY (14-20) and C on DAY (20-08) touch; make an overlap by putting someone on C the night before
    # and testing a duty at 07:00? Use the same date: A (08-14) vs a hand-made overlap: C of DAY-1 vs A of DAY-1? No:
    s = await make.staff()
    d_c = await make.duty("Patrol Vehicles", ShiftCode.C)
    await make.roster(DAY - timedelta(days=1), ShiftCode.C, [(s, d_c)])
    # Shift C of DAY-1 (20:00 DAY-1 → 08:00 DAY) overlaps Shift C of DAY-1? Validate Shift B of DAY-1 + C overlap via edit:
    from app.models.models import ShiftConfig
    from sqlalchemy import select
    a_cfg = (await db.execute(select(ShiftConfig).where(ShiftConfig.shift_code == ShiftCode.A))).scalar_one()
    from datetime import time
    a_cfg.start_time, a_cfg.duration_hours = time(7, 0), 7.0  # A now 07:00-14:00 overlaps C until 08:00
    await db.commit()
    res = await validate_assignments(db, DAY, ShiftCode.A, [A(s, await make.duty("Reception"))], await _admin(make))
    assert "SHIFT_CONFLICT" in codes(res, True)


async def test_insufficient_rest_after_night_shift(db, make):
    await make.policy(rest=16)
    s = await make.staff()
    await make.roster(DAY - timedelta(days=1), ShiftCode.C, [(s, await make.duty("Patrol Vehicles", ShiftCode.C))])
    res = await validate_assignments(db, DAY, ShiftCode.B, [A(s, await make.duty("Reception"))], await _admin(make))
    assert "REST_VIOLATION" in codes(res, True)  # C ends 08:00, B starts 14:00 → 6h < 16h


async def test_rest_not_checked_without_policy_but_flagged(db, make):
    s = await make.staff()
    await make.roster(DAY - timedelta(days=1), ShiftCode.C, [(s, await make.duty("Patrol Vehicles", ShiftCode.C))])
    res = await validate_assignments(db, DAY, ShiftCode.B, [A(s, await make.duty("Reception"))], await _admin(make))
    assert "REST_VIOLATION" not in codes(res) and "UNCONFIRMED_POLICY" in codes(res)


async def test_rest_violation_for_following_shift(db, make):
    await make.policy(rest=16)
    s = await make.staff()
    await make.roster(DAY + timedelta(days=1), ShiftCode.A, [(s, await make.duty("Reception"))])
    res = await validate_assignments(db, DAY, ShiftCode.C, [A(s, await make.duty("Patrol Vehicles", ShiftCode.C))],
                                     await _admin(make))
    assert "REST_VIOLATION" in codes(res, True) or "SHIFT_CONFLICT" in codes(res, True)


async def test_approved_leave_blocks(db, make):
    s = await make.staff()
    db.add(LeaveRequest(staff_id=s.id, leave_type="EL", start_date=DAY, end_date=DAY, status=LeaveStatus.APPROVED))
    await db.commit()
    res = await validate_assignments(db, DAY, ShiftCode.A, [A(s, await make.duty("Reception"))], await _admin(make))
    assert "APPROVED_LEAVE" in codes(res, True)


async def test_pending_leave_does_not_block(db, make):
    s = await make.staff()
    db.add(LeaveRequest(staff_id=s.id, leave_type="EL", start_date=DAY, end_date=DAY, status=LeaveStatus.PENDING))
    await db.commit()
    res = await validate_assignments(db, DAY, ShiftCode.A, [A(s, await make.duty("Reception"))], await _admin(make))
    assert "APPROVED_LEAVE" not in codes(res)


async def test_existing_commitments_attachment_movement_task(db, make):
    a, m, t = await make.staff(), await make.staff(), await make.staff()
    db.add(AttachmentOrder(staff_id=a.id, parent_unit="PS", attached_wing="SB", start_date=today() - timedelta(days=3)))
    db.add(Movement(staff_id=m.id, purpose="Court", destination="Nampally", status=MovementStatus.OPEN))
    db.add(Task(description="Verify passport", assignee_id=t.id, status=TaskStatus.IN_PROGRESS))
    await db.commit()
    d = await make.duty("Reception")
    res = await validate_assignments(db, today(), ShiftCode.A, [A(a, d), A(m, d), A(t, d)], await _admin(make))
    found = codes(res)
    assert {"ATTACHED", "OPEN_MOVEMENT", "OPEN_TASK"} <= found


async def test_vacancy_reported_against_required_strength(db, make):
    s = await make.staff()
    beat = await make.duty("Beat Constables", ShiftCode.A)
    res = await validate_assignments(db, DAY, ShiftCode.A, [A(s, beat)], await _admin(make))
    msg = [i.message for i in res.issues if i.code == "VACANCY" and "Beat" in i.message][0]
    assert "needs 4, 1 allocated (3 vacant)" in msg


async def test_unconfirmed_availability_for_today(db, make):
    s, p = await make.staff(), await make.staff()
    db.add(Attendance(staff_id=p.id, attendance_date=today(), shift_code=ShiftCode.A, is_confirmed=True))
    await db.commit()
    d = await make.duty("Reception")
    res = await validate_assignments(db, today(), ShiftCode.A, [A(s, d), A(p, d)], await _admin(make))
    flagged = {i.staff_id for i in res.issues if i.code == "UNCONFIRMED_AVAILABILITY"}
    assert s.id in flagged and p.id not in flagged


async def test_designation_mismatch_is_advisory(db, make):
    hc = await make.staff(designation=StaffDesignation.HC)
    res = await validate_assignments(db, DAY, ShiftCode.A, [A(hc, await make.duty("Beat Constables", ShiftCode.A))],
                                     await _admin(make))
    issue = [i for i in res.issues if i.code == "DESIGNATION_MISMATCH"][0]
    assert not issue.blocking


async def test_override_requires_distinct_authorized_officer(db, make):
    s = await make.staff()
    db.add(LeaveRequest(staff_id=s.id, leave_type="EL", start_date=DAY, end_date=DAY, status=LeaveStatus.APPROVED))
    await db.commit()
    d = await make.duty("Reception")
    admin = await _admin(make)
    sho = await make.user(UserRoleEnum.SHO)
    staff_user = await make.user(UserRoleEnum.STAFF)
    # no authorizer → still blocking
    r1 = await validate_assignments(db, DAY, ShiftCode.A, [A(s, d, ex=True, reason="Emergency")], admin)
    assert r1.blocking
    # self-authorization by the Admin SI → refused
    r2 = await validate_assignments(db, DAY, ShiftCode.A, [A(s, d, ex=True, reason="Emergency", auth=admin.id)], admin)
    assert r2.blocking
    # a STAFF user cannot authorize
    r3 = await validate_assignments(db, DAY, ShiftCode.A, [A(s, d, ex=True, reason="Emergency", auth=staff_user.id)], admin)
    assert r3.blocking
    # SHO authorizes → accepted
    r4 = await validate_assignments(db, DAY, ShiftCode.A, [A(s, d, ex=True, reason="Emergency", auth=sho.id)], admin)
    assert not r4.blocking and r4.authorizers[0].id == sho.id


async def test_save_refused_without_authorizer_and_audited_with_one(client, db, make):
    await make.policy()
    admin = await _admin(make)
    sho = await make.user(UserRoleEnum.SHO)
    s = await make.staff()
    db.add(LeaveRequest(staff_id=s.id, leave_type="EL", start_date=DAY, end_date=DAY, status=LeaveStatus.APPROVED))
    await db.commit()
    d = await make.duty("Reception")
    h = await login(client, admin)
    body = {"roster_date": str(DAY), "shift_code": "A",
            "assignments": [{"duty_master_id": d.id, "staff_id": s.id, "is_exception": True, "exception_reason": "VIP visit"}]}
    res = await client.post("/api/rosters/", json=body, headers=h)
    assert res.status_code == 422 and res.json()["detail"]["blocking_count"] == 1
    body["assignments"][0]["exception_authorized_by_id"] = sho.id
    res = await client.post("/api/rosters/", json=body, headers=h)
    assert res.status_code == 201, res.text
    audit = (await client.get("/api/audit/?action=EXCEPTION_AUTHORIZED", headers=h)).json()
    assert audit and audit[0]["authorizer_username"] == sho.username and audit[0]["exception_reason"] == "VIP visit"


async def test_dry_run_validate_endpoint_saves_nothing(client, db, make):
    await make.policy()
    admin = await _admin(make)
    s = await make.staff()
    d = await make.duty("Reception")
    h = await login(client, admin)
    res = await client.post("/api/rosters/validate", headers=h, json={
        "roster_date": str(DAY), "shift_code": "A", "assignments": [{"duty_master_id": d.id, "staff_id": s.id}]})
    assert res.status_code == 200 and res.json()["can_save"]
    assert (await client.get("/api/rosters/", headers=h)).json() == []
