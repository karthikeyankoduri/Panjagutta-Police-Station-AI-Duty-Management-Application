"""
Role tests (guide §15, blueprint step 7): each role sees and does only what it should,
and a Sector SI cannot read another sector's staff or records.
"""
from datetime import timedelta

import pytest

from app.models.models import LeaveRequest, Movement, MovementStatus, RosterStatus, ShiftCode, Task, UserRoleEnum
from conftest import login, today


@pytest.fixture
async def world(db, make):
    s1 = await make.staff(sector_id=1, contact_phone="9000000001")
    s2 = await make.staff(sector_id=2, contact_phone="9000000002")
    users = {
        "sho": await make.user(UserRoleEnum.SHO),
        "admin": await make.user(UserRoleEnum.ADMIN_SI),
        "sector1": await make.user(UserRoleEnum.SECTOR_SI, sector_id=1),
        "di": await make.user(UserRoleEnum.DI),
        "staff1": await make.user(UserRoleEnum.STAFF, staff=s1),
        "staff2": await make.user(UserRoleEnum.STAFF, staff=s2),
    }
    l1 = LeaveRequest(staff_id=s1.id, leave_type="CL", start_date=today(), end_date=today())
    l2 = LeaveRequest(staff_id=s2.id, leave_type="CL", start_date=today(), end_date=today())
    m2 = Movement(staff_id=s2.id, purpose="Court", destination="Nampally", status=MovementStatus.PENDING_AUTHORIZATION)
    t2 = Task(description="Serve summons", assignee_id=s2.id)
    db.add_all([l1, l2, m2, t2])
    await db.commit()
    return dict(s1=s1, s2=s2, l1=l1, l2=l2, m2=m2, t2=t2, **users)


@pytest.mark.parametrize("who,expected", [("staff1", 403), ("di", 403), ("sector1", 403), ("admin", 200), ("sho", 200)])
async def test_only_approvers_decide_leave(client, world, who, expected):
    h = await login(client, world[who])
    res = await client.post(f"/api/leave/{world['l1'].id}/approve", headers=h, json={})
    assert res.status_code == expected


@pytest.mark.parametrize("who,expected", [("staff1", 403), ("staff2", 403), ("di", 403), ("sector1", 403), ("admin", 200)])
async def test_movement_authorization_roles_and_sector(client, world, who, expected):
    # sector1 is a valid role but m2 belongs to sector 2 → 403
    h = await login(client, world[who])
    res = await client.post(f"/api/movements/{world['m2'].id}/authorize", headers=h)
    assert res.status_code == expected


async def test_task_status_only_assignee_or_supervisor(client, world):
    res = await client.patch(f"/api/tasks/{world['t2'].id}/status", json={"new_status": "Completed"},
                             headers=await login(client, world["staff1"]))
    assert res.status_code == 403
    res = await client.patch(f"/api/tasks/{world['t2'].id}/status", json={"new_status": "In Progress"},
                             headers=await login(client, world["staff2"]))
    assert res.status_code == 200
    res = await client.patch(f"/api/tasks/{world['t2'].id}/status", json={"new_status": "Cancelled"},
                             headers=await login(client, world["staff2"]))
    assert res.status_code == 403


async def test_sector_si_cannot_read_other_sector(client, world):
    h = await login(client, world["sector1"])
    staff = (await client.get("/api/staff/", headers=h)).json()
    assert {s["sector_id"] for s in staff} == {1}
    assert (await client.get(f"/api/staff/{world['s2'].id}", headers=h)).status_code == 403
    assert all(l["staff_id"] == world["s1"].id for l in (await client.get("/api/leave/", headers=h)).json())
    assert (await client.get("/api/movements/", headers=h)).json() == []
    assert (await client.get("/api/tasks/", headers=h)).json() == []


async def test_staff_see_only_own_records(client, world):
    h = await login(client, world["staff1"])
    assert all(l["staff_id"] == world["s1"].id for l in (await client.get("/api/leave/", headers=h)).json())
    assert (await client.get("/api/tasks/", headers=h)).json() == []
    for path in ("/api/dashboard/summary", "/api/audit/", "/api/dashboard/alerts", "/api/attachments/",
                 "/api/duties/", "/api/reports/daily"):
        assert (await client.get(path, headers=h)).status_code == 403, path
    assert (await client.post("/api/ai/query", json={"query": "who is on leave"}, headers=h)).status_code == 403


async def test_contact_details_only_where_authorized(client, world):
    phones = lambda rows: {r["id"]: r["contact_phone"] for r in rows}  # noqa: E731
    as_staff = phones((await client.get("/api/staff/", headers=await login(client, world["staff1"]))).json())
    assert as_staff[world["s1"].id] == "9000000001" and as_staff[world["s2"].id] is None
    as_admin = phones((await client.get("/api/staff/", headers=await login(client, world["admin"]))).json())
    assert as_admin[world["s2"].id] == "9000000002"
    as_di = phones((await client.get("/api/staff/", headers=await login(client, world["di"]))).json())
    assert as_di[world["s1"].id] is None


async def test_drafts_hidden_from_staff_and_di(client, make, world):
    d = await make.duty("Reception")
    await make.roster(today(), ShiftCode.A, [(world["s1"], d)], status=RosterStatus.DRAFT)
    for who, visible in (("staff1", 0), ("di", 0), ("admin", 1), ("sector1", 1)):
        rows = (await client.get("/api/rosters/", headers=await login(client, world[who]))).json()
        assert len(rows) == visible, who


async def test_staff_cannot_create_rosters_or_approve(client, world):
    h = await login(client, world["staff1"])
    assert (await client.post("/api/rosters/", json={"roster_date": str(today()), "shift_code": "A"}, headers=h)).status_code == 403
    h = await login(client, world["admin"])
    assert (await client.post("/api/rosters/1/approve", headers=h)).status_code == 403  # only SHO approves
