"""Authentication, lockout, logout invalidation, audit integrity and report exports."""
from sqlalchemy import select

from app.models.models import AuditLog, UserRoleEnum
from conftest import PASSWORD, login


async def test_wrong_password_locks_account(client, make):
    u = await make.user(UserRoleEnum.ADMIN_SI)
    for _ in range(4):
        r = await client.post("/api/auth/login", json={"username": u.username, "password": "wrong-pass1"})
        assert r.status_code == 401
    r = await client.post("/api/auth/login", json={"username": u.username, "password": "wrong-pass1"})
    assert r.status_code == 429 and "locked" in r.json()["detail"].lower()
    r = await client.post("/api/auth/login", json={"username": u.username, "password": PASSWORD})
    assert r.status_code == 429  # still locked even with the right password


async def test_no_backdoor_passwords(client, make):
    u = await make.user(UserRoleEnum.ADMIN_SI, username="admin_si_demo")
    for pw in ("admin123", "staff123", "Password@PJ2024!"):
        assert (await client.post("/api/auth/login", json={"username": u.username, "password": pw})).status_code == 401


async def test_default_password_forces_change(client, make):
    u = await make.user(UserRoleEnum.STAFF, password="Password@PJ2024!")
    r = await client.post("/api/auth/login", json={"username": u.username, "password": "Password@PJ2024!"})
    assert r.json()["must_change_password"] is True
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert (await client.get("/api/leave/", headers=h)).status_code == 403
    weak = await client.post("/api/auth/change-password", headers=h,
                             json={"current_password": "Password@PJ2024!", "new_password": "short"})
    assert weak.status_code == 422


async def test_logout_makes_token_unusable(client, make):
    u = await make.user(UserRoleEnum.SHO)
    h = await login(client, u)
    assert (await client.get("/api/auth/me", headers=h)).status_code == 200
    assert (await client.post("/api/auth/logout", headers=h)).status_code == 200
    assert (await client.get("/api/auth/me", headers=h)).status_code == 401


async def test_every_login_attempt_is_audited(client, db, make):
    await client.post("/api/auth/login", json={"username": "nobody", "password": "x"})
    u = await make.user(UserRoleEnum.SHO)
    await client.post("/api/auth/login", json={"username": u.username, "password": "bad-password1"})
    await login(client, u)
    actions = {a.action for a in (await db.execute(select(AuditLog))).scalars().all()}
    assert {"LOGIN_FAILED_UNKNOWN", "LOGIN_FAILED", "LOGIN"} <= actions


async def test_audit_rows_cannot_be_modified_through_the_app(db, make):
    from app.services.audit import log_event
    entry = await log_event(db, actor=None, action="TEST", entity_type="X")
    await db.commit()
    entry.action = "TAMPERED"
    try:
        await db.commit()
        raise AssertionError("audit update should be refused")
    except PermissionError:
        await db.rollback()
    await db.delete(entry)
    try:
        await db.commit()
        raise AssertionError("audit delete should be refused")
    except PermissionError:
        await db.rollback()


async def test_staff_create_never_logs_password(client, db, make):
    admin = await make.user(UserRoleEnum.ADMIN_SI)
    h = await login(client, admin)
    r = await client.post("/api/staff/", headers=h, json={
        "service_number": "NEW-1", "name": "New PC", "designation": "PC", "category": "SECTOR_STAFF",
        "create_user": True, "username": "new_pc", "password": "Secret#Pass99"})
    assert r.status_code == 201
    row = (await db.execute(select(AuditLog).where(AuditLog.action == "STAFF_CREATED"))).scalar_one()
    assert "password" not in str(row.new_values).lower()


async def test_report_exports_csv_xlsx_pdf_with_auth(client, make):
    sho = await make.user(UserRoleEnum.SHO)
    h = await login(client, sho)
    for rtype in ("shift-end", "daily", "vacancy", "workload"):
        for fmt, magic in (("csv", None), ("xlsx", b"PK"), ("pdf", b"%PDF")):
            r = await client.get(f"/api/reports/export?report_type={rtype}&format={fmt}", headers=h)
            assert r.status_code == 200, (rtype, fmt, r.text[:200])
            if magic:
                assert r.content.startswith(magic)
    assert (await client.get("/api/reports/export?format=pdf")).status_code in (401, 403)
