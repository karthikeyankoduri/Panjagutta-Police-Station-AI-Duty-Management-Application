"""
Scenario tests named in guide §15: emergency deployment, leave approved mid-roster,
late return from movement, shift change pending — plus the full roster lifecycle.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.models import (
    Alert, AuditLog, LeaveRequest, Movement, MovementStatus, Notification, RosterStatus, ShiftCode, StaffStatus,
    UserRoleEnum,
)
from app.services.availability import compute_staff_status
from app.services.scheduler import check_overdue_movements, check_stalled_approvals
from conftest import login, today


async def test_full_roster_lifecycle_with_versions(client, db, make):
    await make.policy()
    admin, sho = await make.user(UserRoleEnum.ADMIN_SI), await make.user(UserRoleEnum.SHO)
    s1, s2 = await make.staff(), await make.staff()
    su = await make.user(UserRoleEnum.STAFF, staff=s1)
    rec = await make.duty("Reception")
    ha, hs = await login(client, admin), await login(client, sho)
    day = today() + timedelta(days=3)

    r = (await client.post("/api/rosters/", headers=ha, json={"roster_date": str(day), "shift_code": "A",
         "assignments": [{"duty_master_id": rec.id, "staff_id": s1.id}]})).json()
    assert (await client.post(f"/api/rosters/{r['id']}/submit", headers=ha)).status_code == 200
    assert (await client.post(f"/api/rosters/{r['id']}/reject", headers=hs, json={})).status_code == 422  # needs comments
    assert (await client.post(f"/api/rosters/{r['id']}/reject", headers=hs, json={"comments": "Add CCTNS"})).status_code == 200
    await client.post(f"/api/rosters/{r['id']}/submit", headers=ha)
    await client.post(f"/api/rosters/{r['id']}/approve", headers=hs, json={"comments": "OK"})
    pub = await client.post(f"/api/rosters/{r['id']}/publish", headers=ha)
    assert pub.status_code == 200

    # staff were notified, and now see the published roster
    hu = await login(client, su)
    notes = (await client.get("/api/notifications/", headers=hu)).json()
    assert any(n["title"] == "Duty published" for n in notes["items"])

    # a change creates v2; v1 stays viewable
    v2 = (await client.post(f"/api/rosters/{r['id']}/revise", headers=ha, json={"change_reason": "Swap"})).json()
    await client.put(f"/api/rosters/{v2['id']}/assignments", headers=ha, json={
        "change_reason": "Swap", "assignments": [{"duty_master_id": rec.id, "staff_id": s2.id}]})
    await client.post(f"/api/rosters/{v2['id']}/submit", headers=ha)
    versions = (await client.get(f"/api/rosters/{r['id']}/versions", headers=ha)).json()
    assert [v["version"] for v in versions] == [2, 1]
    # pending v2 marks s1 as shift change pending
    assert (await compute_staff_status(db, s1.id, day, ShiftCode.A)).status == StaffStatus.SHIFT_CHANGE_PENDING
    await client.post(f"/api/rosters/{v2['id']}/approve", headers=hs, json={})
    res = (await client.post(f"/api/rosters/{v2['id']}/publish", headers=ha)).json()
    assert res["superseded_versions"] == [1]
    assert (await compute_staff_status(db, s1.id, day, ShiftCode.A)).status != StaffStatus.ON_DUTY
    assert (await compute_staff_status(db, s2.id, day, ShiftCode.A)).status == StaffStatus.ON_DUTY
    v1 = (await client.get(f"/api/rosters/{r['id']}", headers=ha)).json()
    assert v1["assignments"][0]["staff_id"] == s1.id and not v1["is_latest"]


async def test_leave_approved_mid_roster_creates_vacancy_alert(client, db, make):
    sho = await make.user(UserRoleEnum.SHO)
    s = await make.staff()
    rec = await make.duty("Reception")
    day = today() + timedelta(days=1)
    await make.roster(day, ShiftCode.B, [(s, rec)])
    leave = LeaveRequest(staff_id=s.id, leave_type="ML", start_date=day, end_date=day)
    db.add(leave)
    await db.commit()
    h = await login(client, sho)
    impact = (await client.get(f"/api/leave/{leave.id}/impact", headers=h)).json()
    assert impact["vacancies_if_approved"] == 1
    res = (await client.post(f"/api/leave/{leave.id}/approve", headers=h, json={"remarks": "Get well"})).json()
    assert len(res["replacement_alerts"]) == 1
    assert (await compute_staff_status(db, s.id, day, ShiftCode.B)).status == StaffStatus.ON_LEAVE


async def test_late_return_from_movement(client, db, make):
    s = await make.staff()
    su = await make.user(UserRoleEnum.STAFF, staff=s)
    past = datetime.now(timezone.utc) - timedelta(hours=2)
    m = Movement(staff_id=s.id, purpose="Court", destination="Nampally", status=MovementStatus.OPEN,
                 expected_return=past, actual_departure=past - timedelta(hours=3))
    db.add(m)
    await db.commit()
    assert await check_overdue_movements(db) == 1
    await db.commit()
    alert = (await db.execute(select(Alert).where(Alert.entity_id == m.id))).scalar_one()
    assert not alert.is_resolved
    assert (await check_overdue_movements(db)) == 0  # flagged once, no duplicate alerts
    res = await client.post(f"/api/movements/{m.id}/return", headers=await login(client, su), json={"close_notes": "Back"})
    assert res.status_code == 200
    await db.refresh(alert)
    assert alert.is_resolved
    assert (await compute_staff_status(db, s.id, today())).status != StaffStatus.OFFICIAL_MOVEMENT


async def test_emergency_deployment_status(db, make):
    s = await make.staff()
    from app.models.models import DutyMaster
    d = DutyMaster(category="Emergency Bandobast", required_strength=None, is_configured=False)
    db.add(d)
    await db.commit()
    await make.roster(today(), ShiftCode.A, [(s, d)])
    assert (await compute_staff_status(db, s.id, today(), ShiftCode.A)).status == StaffStatus.EMERGENCY_DEPLOYMENT


async def test_leave_routing_cancel_and_overlap(client, db, make):
    s = await make.staff()
    su = await make.user(UserRoleEnum.STAFF, staff=s)
    admin = await make.user(UserRoleEnum.ADMIN_SI)
    hu = await login(client, su)
    start = today() + timedelta(days=10)
    res = await client.post("/api/leave/", headers=hu, json={"leave_type": "CL", "start_date": str(start), "end_date": str(start)})
    assert res.status_code == 201 and res.json()["reference_number"].startswith("LV/")
    clash = await client.post("/api/leave/", headers=hu, json={"leave_type": "EL", "start_date": str(start), "end_date": str(start + timedelta(days=1))})
    assert clash.status_code == 409
    bad = await client.post("/api/leave/", headers=hu, json={"leave_type": "EL", "start_date": str(start), "end_date": str(start - timedelta(days=1))})
    assert bad.status_code == 422
    inbox = (await client.get("/api/notifications/", headers=await login(client, admin))).json()
    assert any("Leave request" in n["title"] for n in inbox["items"])
    assert (await client.post(f"/api/leave/{res.json()['id']}/cancel", headers=hu, json={})).status_code == 200
    rows = (await client.get("/api/leave/", headers=hu)).json()
    assert rows[0]["status"] == "Cancelled"


async def test_stalled_leave_raises_alert(db, make):
    s = await make.staff()
    db.add(LeaveRequest(staff_id=s.id, leave_type="CL", start_date=today(), end_date=today(),
                        submitted_at=datetime.now(timezone.utc) - timedelta(days=3)))
    await db.commit()
    assert await check_stalled_approvals(db) >= 1
    await db.commit()
    assert (await db.execute(select(Alert).where(Alert.alert_type == "LEAVE_STALLED"))).scalars().first()
    assert (await db.execute(select(AuditLog).where(AuditLog.action == "ALERT_RAISED"))).scalars().first()
    assert (await db.execute(select(Notification))).scalars().first()


async def test_dashboard_cards_are_exclusive(client, db, make):
    sho = await make.user(UserRoleEnum.SHO)
    for _ in range(5):
        await make.staff()
    data = (await client.get("/api/dashboard/summary", headers=await login(client, sho))).json()
    members = data["card_members"]
    seen = [sid for key in data["exclusive_cards"] for sid in members[key]]
    assert len(seen) == len(set(seen)) == data["cards"]["total_staff"] == 5


async def test_mobile_movement_request_and_password_change(client, db, make):
    s = await make.staff()
    su = await make.user(UserRoleEnum.STAFF, staff=s, must_change=True)
    h = await login(client, su)
    assert (await client.get("/api/mobile/rosters", headers=h)).status_code == 403  # must change password first
    assert (await client.get("/api/mobile/me", headers=h)).status_code == 200
    res = await client.post("/api/auth/change-password", headers=h,
                            json={"current_password": "Strong#Pass2026", "new_password": "NewPass#2026x"})
    assert res.status_code == 200
    res = await client.post("/api/mobile/movements", headers=h, json={
        "purpose": "Evidence", "destination": "FSL", "expected_return": (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()})
    assert res.status_code == 201 and res.json()["status"] == "pending_authorization"
    assert (await client.post(f"/api/mobile/movements/{res.json()['id']}/cancel", headers=h)).status_code == 200
