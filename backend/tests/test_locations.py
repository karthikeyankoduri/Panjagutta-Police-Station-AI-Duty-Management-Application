"""Live GPS tracking: reporting, >50 m re-geocode rule, admin-only listing."""
import pytest

from app.models.models import UserRoleEnum
from app.services import geocoding
from conftest import login


@pytest.fixture
def geocoder(monkeypatch):
    calls = []

    async def fake(lat, lng):
        calls.append((lat, lng))
        return f"Place {len(calls)}"

    monkeypatch.setattr(geocoding, "reverse_geocode", fake)
    return calls


@pytest.fixture
async def world(db, make):
    s1 = await make.staff(sector_id=1)
    return dict(
        officer=await make.user(UserRoleEnum.STAFF, staff=s1),
        admin=await make.user(UserRoleEnum.ADMIN_SI),
        sho=await make.user(UserRoleEnum.SHO),
        staff=s1,
    )


def test_haversine():
    assert geocoding.haversine_m(17.4, 78.4, 17.4, 78.4) == 0
    # ~111 km per degree of latitude
    assert 110_000 < geocoding.haversine_m(17.0, 78.0, 18.0, 78.0) < 112_000


async def test_geocodes_first_fix_then_only_after_moving_50m(client, world, geocoder):
    h = await login(client, world["officer"])
    r = await client.post("/api/mobile/location", headers=h, json={"latitude": 17.4000, "longitude": 78.4000})
    assert r.status_code == 200 and r.json()["location_name"] == "Place 1"
    # ~11 m north: no new lookup
    r = await client.post("/api/mobile/location", headers=h, json={"latitude": 17.4001, "longitude": 78.4000})
    assert r.json()["location_name"] == "Place 1" and len(geocoder) == 1
    # ~222 m north of origin: new lookup
    r = await client.post("/api/mobile/location", headers=h, json={"latitude": 17.4020, "longitude": 78.4000})
    assert r.json()["location_name"] == "Place 2" and len(geocoder) == 2


async def test_geocoder_failure_still_stores_fix(client, world, monkeypatch):
    async def none(lat, lng):
        return None

    monkeypatch.setattr(geocoding, "reverse_geocode", none)
    h = await login(client, world["officer"])
    assert (await client.post("/api/mobile/location", headers=h, json={"latitude": 1, "longitude": 2})).status_code == 200
    ha = await login(client, world["admin"])
    rows = (await client.get("/api/locations/", headers=ha)).json()
    assert rows[0]["latitude"] == 1 and rows[0]["location_name"] is None


@pytest.mark.parametrize("lat,lng", [(91, 0), (0, 181), (-91, 0)])
async def test_rejects_invalid_coordinates(client, world, lat, lng):
    h = await login(client, world["officer"])
    r = await client.post("/api/mobile/location", headers=h, json={"latitude": lat, "longitude": lng})
    assert r.status_code == 422


@pytest.mark.parametrize("who,expected", [("officer", 403), ("sho", 403), ("admin", 200)])
async def test_live_locations_admin_only(client, world, who, expected):
    h = await login(client, world[who])
    assert (await client.get("/api/locations/", headers=h)).status_code == expected


async def test_staff_list_includes_location_for_admin_only(client, world, geocoder):
    await client.post("/api/mobile/location", headers=await login(client, world["officer"]),
                      json={"latitude": 17.4, "longitude": 78.4})
    admin_rows = (await client.get("/api/staff/", headers=await login(client, world["admin"]))).json()
    mine = next(r for r in admin_rows if r["id"] == world["staff"].id)
    assert mine["location_name"] == "Place 1" and mine["location_lat"] == 17.4
    sho_rows = (await client.get("/api/staff/", headers=await login(client, world["sho"]))).json()
    assert next(r for r in sho_rows if r["id"] == world["staff"].id)["location_name"] is None
