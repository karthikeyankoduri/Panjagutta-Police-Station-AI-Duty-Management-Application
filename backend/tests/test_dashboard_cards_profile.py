"""
Dashboard KPI card visibility (admin-controlled) and the extended /auth/me profile.
"""
import pytest
from sqlalchemy import select

from app.models.models import AuditLog, StaffDesignation, UserRoleEnum
from conftest import login

CARD_KEYS = {
    "total_staff", "scheduled_current_shift", "present", "on_duty", "available", "field_duty", "court_duty",
    "patrol_beat", "on_leave", "duty_off_rest", "attached_other_wing", "official_movement", "absent",
    "vacant_positions",
}


@pytest.fixture
async def users(db, make):
    s = await make.staff(name="Profile Officer", designation=StaffDesignation.SI, sector_id=2,
                         contact_phone="9000000009", section="Court")
    return {
        "sho": await make.user(UserRoleEnum.SHO),
        "admin": await make.user(UserRoleEnum.ADMIN_SI),
        "super": await make.user(UserRoleEnum.SUPER_ADMIN),
        "sector1": await make.user(UserRoleEnum.SECTOR_SI, sector_id=1),
        "di": await make.user(UserRoleEnum.DI),
        "dsi": await make.user(UserRoleEnum.DSI),
        "staff": await make.user(UserRoleEnum.STAFF, staff=s),
        "staff_rec": s,
    }


async def _cards(client, headers):
    res = await client.get("/api/config/lists", headers=headers)
    assert res.status_code == 200
    return {i["code"]: i["is_active"] for i in res.json()["dashboard_card"]}


async def test_all_fourteen_cards_seeded_and_shown_by_default(client, users):
    cards = await _cards(client, await login(client, users["di"]))
    assert set(cards) == CARD_KEYS
    assert all(cards.values())


@pytest.mark.parametrize("who", ["sho", "admin", "super"])
async def test_station_admins_can_hide_and_restore_cards(client, users, who):
    h = await login(client, users[who])
    res = await client.put("/api/config/dashboard-cards", headers=h,
                           json={"cards": {"court_duty": False, "vacant_positions": False}})
    assert res.status_code == 200, res.text
    assert sorted(res.json()["changed"]) == ["court_duty", "vacant_positions"]
    # Every role reads the same setting.
    for reader in ("di", "sector1", "staff"):
        cards = await _cards(client, await login(client, users[reader]))
        assert cards["court_duty"] is False and cards["vacant_positions"] is False
        assert cards["present"] is True
    res = await client.put("/api/config/dashboard-cards", headers=h, json={"cards": {"court_duty": True}})
    assert res.status_code == 200
    assert (await _cards(client, h))["court_duty"] is True


@pytest.mark.parametrize("who", ["sector1", "di", "dsi", "staff"])
async def test_other_roles_cannot_change_cards(client, users, who):
    res = await client.put("/api/config/dashboard-cards", headers=await login(client, users[who]),
                           json={"cards": {"present": False}})
    assert res.status_code == 403
    assert (await _cards(client, await login(client, users["sho"])))["present"] is True


async def test_unknown_card_is_rejected_and_nothing_changes(client, users):
    h = await login(client, users["sho"])
    res = await client.put("/api/config/dashboard-cards", headers=h,
                           json={"cards": {"present": False, "not_a_card": False}})
    assert res.status_code == 400
    assert (await _cards(client, h))["present"] is True


async def test_card_change_is_audited_and_no_change_is_not(client, users, db):
    h = await login(client, users["sho"])
    await client.put("/api/config/dashboard-cards", headers=h, json={"cards": {"absent": False}})
    await client.put("/api/config/dashboard-cards", headers=h, json={"cards": {"absent": False}})  # no-op
    rows = (await db.execute(select(AuditLog).where(AuditLog.entity_type == "DashboardCards"))).scalars().all()
    assert len(rows) == 1
    assert rows[0].new_values == {"absent": False} and rows[0].old_values == {"absent": True}


async def test_me_returns_staff_profile_for_linked_user(client, users):
    res = await client.get("/api/auth/me", headers=await login(client, users["staff"]))
    assert res.status_code == 200
    me = res.json()
    assert me["staff_name"].startswith("Profile Officer")
    assert me["designation"] == "SI" and me["section"] == "Court"
    assert me["contact_phone"] == "9000000009"
    assert me["sector_name"] == "Sector 2"
    assert me["last_login"] is not None
    assert "hashed_password" not in me and "password" not in me


async def test_me_for_role_only_account_has_no_staff_fields(client, users):
    me = (await client.get("/api/auth/me", headers=await login(client, users["sho"]))).json()
    assert me["role"] == "SHO" and me["staff_name"] is None
    assert "designation" not in me and "contact_phone" not in me
    assert me["sector_name"] is None


async def test_sector_si_profile_shows_login_sector(client, users):
    me = (await client.get("/api/auth/me", headers=await login(client, users["sector1"]))).json()
    assert me["sector_name"] == "Sector 1" and me["sector_id"] == 1
