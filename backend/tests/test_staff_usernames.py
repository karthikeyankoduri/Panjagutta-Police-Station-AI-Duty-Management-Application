"""Imported staff log in with pg + designation + last 4 phone digits."""
from sqlalchemy import select

from app.models.models import AuditLog, User, UserRoleEnum
from conftest import login

CSV = "\n".join([
    "S.No,PG ID,Rank,Employee name,Mobile no",
    "1,pg-801,PC,Ravi One,9000013210",
    "2,pg-802,PC,Ravi Two,9000023210",
    "3,pg-803,HC,Hari Three,9000003210",
    "4,pg-804,INSP,Ins Four,9000009999",
    "5,pg-805,PC,No Phone,",
])


async def _import(client, h, text=CSV):
    res = await client.post("/api/staff/import-csv", headers=h, json={"csv_content": text})
    assert res.status_code == 200, res.text
    return res


async def _names(db):
    return {u.username for u in (await db.execute(select(User))).scalars().all()}


async def test_import_generates_usernames_and_they_can_log_in(client, db, make):
    h = await login(client, await make.user(UserRoleEnum.ADMIN_SI))
    await _import(client, h)
    names = await _names(db)
    assert {"pgpc13210", "pgpc23210", "pghc3210", "pginsp9999"} <= names  # clash -> 5 digits, INSP spelled insp
    assert "pg_805" in names  # no phone: keeps the PG-ID based name
    for typed in ("pghc3210", "PGHC3210", " pg hc 3210 ", "pginsp9999"):
        res = await client.post("/api/auth/login", json={"username": typed, "password": "PJ@2024"})
        assert res.status_code == 200, (typed, res.text)


async def test_reimport_never_renames_and_file_username_wins(client, db, make):
    h = await login(client, await make.user(UserRoleEnum.ADMIN_SI))
    await _import(client, h)
    before = await _names(db)
    await _import(client, h)  # same file again
    assert await _names(db) == before
    await _import(client, h, "S.No,PG ID,Rank,Employee name,Mobile no,Username\n9,pg-809,PC,Custom,9111111111,mine1")
    assert "mine1" in await _names(db)


async def test_preview_flags_clash_and_convert_flow(client, db, make):
    h = await login(client, await make.user(UserRoleEnum.ADMIN_SI))
    res = await client.post("/api/staff/import-preview", headers=h, files={"file": ("s.csv", CSV.encode())})
    body = res.json()
    assert body["rows"][0][-1] == "pgpc13210" and body["username_notes"][0] == "clash"
    assert body["username_notes"][4] == "no-phone"

    # old-style accounts (pg_xxx) are converted through preview then apply
    await _import(client, h, CSV)
    u = (await db.execute(select(User).where(User.username == "pghc3210"))).scalar_one()
    u.username = "pg_803"
    await db.commit()
    prev = (await client.post("/api/staff/usernames/preview", headers=h)).json()
    row = next(r for r in prev["rows"] if r["current_username"] == "pg_803")
    assert row["new_username"] == "pghc3210" and row["will_change"]
    ap = await client.post("/api/staff/usernames/apply", headers=h,
                           json={"changes": [{"user_id": row["user_id"], "new_username": row["new_username"]}]})
    assert ap.status_code == 200 and ap.json()["changed"] == 1
    db.expire_all()
    assert "pghc3210" in await _names(db)
    logs = (await db.execute(select(AuditLog).where(AuditLog.action == "USERNAME_CHANGED"))).scalars().all()
    assert len(logs) == 1


async def test_convert_is_admin_only(client, make):
    h = await login(client, await make.user(UserRoleEnum.SHO))
    assert (await client.post("/api/staff/usernames/preview", headers=h)).status_code == 403
    assert (await client.post("/api/staff/usernames/apply", headers=h, json={"changes": []})).status_code == 403


async def test_service_number_follows_username_and_reimport_matches(client, db, make):
    from app.models.models import Staff
    h = await login(client, await make.user(UserRoleEnum.ADMIN_SI))
    await _import(client, h)
    db.expire_all()
    svcs = {s.service_number for s in (await db.execute(select(Staff))).scalars().all()}
    assert {"pghc3210", "pginsp9999", "pgpc13210"} <= svcs and "pg-803" not in svcs
    count = len(svcs)
    await _import(client, h)  # same file: matched by the kept PG ID, no duplicates
    db.expire_all()
    assert len((await db.execute(select(Staff))).scalars().all()) == count
    # the old PG ID still signs in
    res = await client.post("/api/auth/login", json={"username": "pg-803", "password": "PJ@2024"})
    assert res.status_code == 200, res.text


async def test_convert_fixes_service_number_when_username_already_new(client, db, make):
    from app.models.models import Staff
    h = await login(client, await make.user(UserRoleEnum.ADMIN_SI))
    await _import(client, h)
    st = (await db.execute(select(Staff).where(Staff.service_number == "pghc3210"))).scalar_one()
    st.service_number = "pg-803"  # as imported before this fix: new username, old service number
    st.notes = None
    sid = st.id
    await db.commit()
    prev = (await client.post("/api/staff/usernames/preview", headers=h)).json()
    row = next(r for r in prev["rows"] if r["current_username"] == "pghc3210")
    assert row["will_change"]
    ap = await client.post("/api/staff/usernames/apply", headers=h,
                           json={"changes": [{"user_id": row["user_id"], "new_username": "pghc3210"}]})
    assert ap.status_code == 200 and ap.json()["changed"] == 1
    db.expire_all()
    st = (await db.execute(select(Staff).where(Staff.id == sid))).scalar_one()
    assert st.service_number == "pghc3210" and "PG ID: pg-803" in st.notes
