"""Approved duty / shift change requests must actually change the roster."""
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.models.models import DutyMaster, Roster, RosterAssignment, ShiftCode, UserRoleEnum
from conftest import login

DAY = date.today() + timedelta(days=2)


async def two_duties(db):
    rows = (await db.execute(
        select(DutyMaster).where(DutyMaster.is_active == True, DutyMaster.shift_code.is_(None)).order_by(DutyMaster.id)
    )).scalars().all()
    by_cat = {}
    for d in rows:
        by_cat.setdefault(d.category, d)
    assert len(by_cat) >= 2, "need two duty points that apply to every shift"
    first, second = list(by_cat.values())[:2]
    return first, second


@pytest.fixture
async def world(db, make):
    d1, d2 = await two_duties(db)
    d1_cat, d2_cat, d2_id = d1.category, d2.category, d2.id
    staff = await make.staff()
    other = await make.staff()
    roster_a = await make.roster(DAY, ShiftCode.A, [(staff, d1)])
    return dict(
        staff_id=staff.id, d1_cat=d1_cat, d2_cat=d2_cat, d2_id=d2_id, roster_a_id=roster_a.id,
        officer=await make.user(UserRoleEnum.STAFF, staff=staff),
        stranger=await make.user(UserRoleEnum.STAFF, staff=other),
        sho=await make.user(UserRoleEnum.SHO),
    )


def body(w, **over):
    data = dict(
        roster_id=w["roster_a_id"], current_roster_date=DAY.isoformat(), current_shift_code="A",
        current_duty_category=w["d1_cat"], requested_shift_code="B", reason="Court appearance",
    )
    data.update(over)
    return data


async def submit(client, w, **over):
    h = await login(client, w["officer"])
    return await client.post("/api/rosters/change-requests/", headers=h, json=body(w, **over))


async def assignment(db, staff_id):
    return (await db.execute(select(RosterAssignment).where(RosterAssignment.staff_id == staff_id))).scalars().one()


async def test_submit_links_the_officers_assignment(client, db, world):
    r = await submit(client, world)
    assert r.status_code == 201, r.text
    from app.models.models import DutyChangeRequest
    dcr = (await db.execute(select(DutyChangeRequest))).scalars().one()
    assert dcr.roster_assignment_id == (await assignment(db, world["staff_id"])).id


async def test_cannot_request_a_change_on_someone_elses_roster(client, world):
    h = await login(client, world["stranger"])
    r = await client.post("/api/rosters/change-requests/", headers=h, json=body(world))
    assert r.status_code == 422


async def test_approved_shift_change_moves_the_officer_to_the_other_roster(client, db, make, world):
    roster_b_id = (await make.roster(DAY, ShiftCode.B, [])).id
    req = (await submit(client, world)).json()
    h = await login(client, world["sho"])
    officer_headers = await login(client, world["officer"])
    r = await client.post(f"/api/rosters/change-requests/{req['id']}/approve", headers=h, json={})
    assert r.status_code == 200, r.text
    db.expire_all()
    assert (await assignment(db, world["staff_id"])).roster_id == roster_b_id
    # The officer's own published duties now show shift B for that date.
    mine = (await client.get("/api/mobile/rosters", headers=officer_headers)).json()
    assert [(d["duty_date"], d["shift_name"]) for d in mine] == [(DAY.isoformat(), "B")]


async def test_approved_duty_change_swaps_the_duty_point(client, db, world):
    req = (await submit(client, world, requested_shift_code=None, requested_duty_category=world["d2_cat"])).json()
    h = await login(client, world["sho"])
    r = await client.post(f"/api/rosters/change-requests/{req['id']}/approve", headers=h, json={})
    assert r.status_code == 200, r.text
    db.expire_all()
    assert (await assignment(db, world["staff_id"])).duty_master_id == world["d2_id"]


async def test_approval_that_cannot_be_applied_stays_pending(client, db, world):
    req = (await submit(client, world)).json()  # shift B has no published roster
    h = await login(client, world["sho"])
    r = await client.post(f"/api/rosters/change-requests/{req['id']}/approve", headers=h, json={})
    assert r.status_code == 409 and "No published roster" in r.json()["detail"]
    pending = (await client.get("/api/rosters/change-requests/?status=pending", headers=h)).json()
    assert [p["id"] for p in pending] == [req["id"]]
    db.expire_all()
    assert (await assignment(db, world["staff_id"])).roster_id == world["roster_a_id"]
