"""Every new task has a category; 'Others' needs a custom header."""
import pytest
from sqlalchemy import select

from app.models.models import Task, UserRoleEnum
from conftest import login

CATEGORIES = ["REGULAR_DUTY", "BANDOBAST", "VIP_MOVEMENT", "TRAFFIC_DUTY", "VEHICLE_CHECKING"]


@pytest.fixture
async def world(db, make):
    staff = await make.staff(name="Assignee")
    return {"staff": staff, "sho": await make.user(UserRoleEnum.SHO),
            "user": await make.user(UserRoleEnum.STAFF, staff=staff)}


def body(staff, **kw):
    return {"description": "Cover the junction", "assignee_id": staff.id, **kw}


@pytest.mark.parametrize("code", CATEGORIES)
async def test_fixed_categories_are_accepted_and_ignore_any_header(client, world, code):
    h = await login(client, world["sho"])
    res = await client.post("/api/tasks/", json=body(world["staff"], category=code, custom_title="ignored"), headers=h)
    assert res.status_code == 201, res.text
    t = [x for x in (await client.get("/api/tasks/", headers=h)).json()][0]
    assert t["category"] == code and t["custom_title"] is None
    assert t["group_title"] == t["category_label"]


async def test_category_is_required_for_a_new_task(client, world):
    h = await login(client, world["sho"])
    res = await client.post("/api/tasks/", json=body(world["staff"]), headers=h)
    assert res.status_code == 422


async def test_unknown_category_is_rejected(client, world):
    h = await login(client, world["sho"])
    res = await client.post("/api/tasks/", json=body(world["staff"], category="PARTY"), headers=h)
    assert res.status_code == 422


@pytest.mark.parametrize("title", [None, "", "   "])
async def test_others_requires_a_header(client, world, title):
    h = await login(client, world["sho"])
    res = await client.post("/api/tasks/", json=body(world["staff"], category="OTHERS", custom_title=title), headers=h)
    assert res.status_code == 422
    assert "header" in res.text.lower()


async def test_others_header_is_trimmed_stored_and_used_as_group_title(client, world):
    h = await login(client, world["sho"])
    res = await client.post("/api/tasks/", json=body(world["staff"], category="others", custom_title="  Election duty "), headers=h)
    assert res.status_code == 201
    t = (await client.get("/api/tasks/", headers=h)).json()[0]
    assert (t["category"], t["custom_title"], t["group_title"]) == ("OTHERS", "Election duty", "Election duty")


async def test_header_length_is_limited(client, world):
    h = await login(client, world["sho"])
    res = await client.post("/api/tasks/", json=body(world["staff"], category="OTHERS", custom_title="x" * 121), headers=h)
    assert res.status_code == 422


async def test_assignee_notification_names_the_category(client, world):
    from app.models.models import Notification
    h = await login(client, world["sho"])
    await client.post("/api/tasks/", json=body(world["staff"], category="VIP_MOVEMENT"), headers=h)
    uh = await login(client, world["user"])
    notes = (await client.get("/api/notifications/?limit=10", headers=uh)).json()
    items = notes["items"] if isinstance(notes, dict) else notes
    assert any("VIP Movement" in n["title"] for n in items)


async def test_filter_by_category(client, world):
    h = await login(client, world["sho"])
    await client.post("/api/tasks/", json=body(world["staff"], category="BANDOBAST"), headers=h)
    await client.post("/api/tasks/", json=body(world["staff"], category="TRAFFIC_DUTY"), headers=h)
    res = (await client.get("/api/tasks/?category=BANDOBAST", headers=h)).json()
    assert [t["category"] for t in res] == ["BANDOBAST"]


async def test_category_can_be_corrected_later_with_the_same_rules(client, db, world):
    # A task created before categories existed defaults to OTHERS with no header.
    db.add(Task(description="legacy", assignee_id=world["staff"].id))
    await db.commit()
    h = await login(client, world["sho"])
    legacy = (await client.get("/api/tasks/", headers=h)).json()[0]
    assert legacy["category"] == "OTHERS" and legacy["custom_title"] is None
    bad = await client.patch(f"/api/tasks/{legacy['id']}", json={"category": "OTHERS", "custom_title": " "}, headers=h)
    assert bad.status_code == 422
    ok = await client.patch(f"/api/tasks/{legacy['id']}", json={"category": "TRAFFIC_DUTY"}, headers=h)
    assert ok.status_code == 200
    assert (await client.get("/api/tasks/", headers=h)).json()[0]["category"] == "TRAFFIC_DUTY"


async def test_staff_cannot_create_tasks(client, world):
    h = await login(client, world["user"])
    res = await client.post("/api/tasks/", json=body(world["staff"], category="BANDOBAST"), headers=h)
    assert res.status_code == 403
