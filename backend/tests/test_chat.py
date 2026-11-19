"""Chat privacy: a user sees only the Station channel and their own thread with the superiors."""
import pytest

from app.models.models import UserRoleEnum
from conftest import login


@pytest.fixture
async def world(db, make):
    s1, s2 = await make.staff(), await make.staff()
    return dict(
        a=await make.user(UserRoleEnum.STAFF, staff=s1), b=await make.user(UserRoleEnum.STAFF, staff=s2),
        sho=await make.user(UserRoleEnum.SHO), admin=await make.user(UserRoleEnum.ADMIN_SI),
        sup=await make.user(UserRoleEnum.SUPER_ADMIN), si=await make.user(UserRoleEnum.SECTOR_SI, sector_id=1),
    )


async def post(client, h, body, tid=None):
    return await client.post("/api/chat/messages", headers=h, json={"body": body, "thread_user_id": tid})


async def texts(client, h, tid=None):
    r = await client.get("/api/chat/messages", headers=h, params={"thread_user_id": tid} if tid else {})
    assert r.status_code == 200, r.text
    return [m["body"] for m in r.json()["items"]]


async def test_private_threads_are_isolated(client, world):
    ha, hb, hsho, hadm = [await login(client, world[k]) for k in ("a", "b", "sho", "admin")]
    assert (await post(client, hsho, "to A", world["a"].id)).status_code == 201
    assert (await post(client, ha, "A replies", world["a"].id)).status_code == 201
    assert (await post(client, hadm, "to B", world["b"].id)).status_code == 201
    # A sees only their own thread; every superior sees it too (including another superior's message).
    assert await texts(client, ha, world["a"].id) == ["to A", "A replies"]
    assert await texts(client, hadm, world["a"].id) == ["to A", "A replies"]
    assert await texts(client, hb, world["b"].id) == ["to B"]
    # B cannot read or write A's thread, and the server does not reveal it exists.
    assert (await client.get("/api/chat/messages", headers=hb, params={"thread_user_id": world["a"].id})).status_code == 404
    assert (await post(client, hb, "sneaky", world["a"].id)).status_code == 404
    assert await texts(client, ha, world["a"].id) == ["to A", "A replies"]


async def test_station_channel_is_shared_and_broadcast_is_superior_only(client, world):
    ha, hb, hsho = [await login(client, world[k]) for k in ("a", "b", "sho")]
    assert (await post(client, ha, "hello all")).status_code == 201
    assert (await client.post("/api/chat/broadcast", headers=ha, json={"body": "x"})).status_code == 403
    assert (await client.post("/api/chat/broadcast", headers=hsho, json={"body": "Briefing at 6"})).status_code == 201
    assert await texts(client, hb) == ["hello all", "Briefing at 6"]
    # The broadcast also reaches every user's notification inbox.
    inbox = (await client.get("/api/notifications/", headers=hb)).json()["items"]
    assert any(n["title"] == "Message to all" for n in inbox)


async def test_threads_listing_and_unread(client, world):
    ha, hsho = await login(client, world["a"]), await login(client, world["sho"])
    ta = (await client.get("/api/chat/threads", headers=ha)).json()
    assert not ta["can_broadcast"] and [t["kind"] for t in ta["threads"]] == ["station", "direct"]
    await post(client, hsho, "ping", world["a"].id)
    ta = (await client.get("/api/chat/threads", headers=ha)).json()["threads"]
    assert ta[1]["unread"] == 1
    await client.post("/api/chat/read", headers=ha, json={"thread_user_id": world["a"].id})
    assert (await client.get("/api/chat/threads", headers=ha)).json()["threads"][1]["unread"] == 0
    ts = (await client.get("/api/chat/threads", headers=hsho)).json()
    assert ts["can_broadcast"]
    ids = {t["thread_user_id"] for t in ts["threads"]}
    assert world["a"].id in ids and world["b"].id in ids and world["si"].id in ids
    assert world["sho"].id not in ids and world["admin"].id not in ids  # superiors have no thread of their own


async def test_validation(client, world):
    hsho = await login(client, world["sho"])
    assert (await post(client, hsho, "   ", world["a"].id)).status_code == 422
    assert (await post(client, hsho, "x" * 1001, world["a"].id)).status_code == 422
    assert (await post(client, hsho, "hi", world["admin"].id)).status_code == 404  # superiors have no private thread
