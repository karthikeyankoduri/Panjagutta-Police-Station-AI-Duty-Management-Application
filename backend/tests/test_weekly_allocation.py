"""Weekly duty allocation: staff x day grid saved as per-day rosters."""
from datetime import timedelta

from sqlalchemy import select

from app.models.models import AuditLog, LeaveRequest, LeaveStatus, Roster, RosterAssignment, RosterStatus, ShiftCode, UserRoleEnum
from conftest import login, today


def monday():
    d = today() + timedelta(days=14)
    return d - timedelta(days=d.weekday())


def cell(staff, day, duty, shift="A", **extra):
    return {"staff_id": staff.id, "date": str(day), "shift_code": shift, "duty_master_id": duty.id, **extra}


def week_days(mon):
    return [mon + timedelta(days=i) for i in range(7)]


async def test_week_save_creates_a_draft_roster_per_day_and_get_returns_the_grid(client, db, make):
    await make.policy()
    admin = await make.user(UserRoleEnum.ADMIN_SI)
    s1, s2 = await make.staff(), await make.staff()
    rec = await make.duty("Reception")
    h = await login(client, admin)
    mon = monday()
    cells = [cell(s, d, rec) for s in (s1, s2) for d in week_days(mon)]
    # s2 is a second person on the same duty: raise strength so this is not just a vacancy warning
    res = await client.put("/api/rosters/week", headers=h, json={"week_start": str(mon), "cells": cells})
    assert res.status_code == 200, res.text
    body = res.json()
    assert [d["action"] for d in body["days"]] == ["created"] * 7

    rosters = (await db.execute(select(Roster).where(Roster.roster_date >= mon, Roster.roster_date <= mon + timedelta(days=6)))).scalars().all()
    assert len(rosters) == 7 and all(r.status == RosterStatus.DRAFT for r in rosters)

    grid = (await client.get(f"/api/rosters/week?start={mon + timedelta(days=3)}", headers=h)).json()
    assert grid["week_start"] == str(mon) and len(grid["days"]) == 7
    assert len(grid["cells"]) == 14 and all(c["editable"] for c in grid["cells"])
    assert {c["staff_id"] for c in grid["cells"]} == {s1.id, s2.id}


async def test_resave_replaces_only_managed_staff_and_clearing_a_cell_removes_it(client, db, make):
    await make.policy()
    admin = await make.user(UserRoleEnum.ADMIN_SI)
    s1, s2, other = await make.staff(), await make.staff(), await make.staff()
    rec, cctns = await make.duty("Reception"), await make.duty("CCTNS")
    h = await login(client, admin)
    mon = monday()
    wed = mon + timedelta(days=2)
    # 'other' is already on Wednesday's roster, outside this grid
    await make.roster(wed, ShiftCode.A, [(other, cctns)], status=RosterStatus.DRAFT)

    days = week_days(mon)
    await client.put("/api/rosters/week", headers=h, json={
        "week_start": str(mon), "staff_ids": [s1.id, s2.id],
        "cells": [cell(s1, d, rec) for d in days]})
    # second save: s1 loses Wednesday, s2 gets Wednesday on a different duty
    cells = [cell(s1, d, rec) for d in days if d != wed] + [cell(s2, wed, cctns)]
    res = await client.put("/api/rosters/week", headers=h, json={
        "week_start": str(mon), "staff_ids": [s1.id, s2.id], "cells": cells})
    assert res.status_code == 200, res.text

    r = (await db.execute(select(Roster).where(Roster.roster_date == wed, Roster.shift_code == ShiftCode.A))).scalars().one()
    rows = (await db.execute(select(RosterAssignment).where(RosterAssignment.roster_id == r.id))).scalars().all()
    assert {(a.staff_id, a.duty_master_id) for a in rows} == {(other.id, cctns.id), (s2.id, cctns.id)}


async def test_moving_a_day_to_another_shift_removes_the_old_assignment(client, db, make):
    await make.policy()
    admin = await make.user(UserRoleEnum.ADMIN_SI)
    s = await make.staff()
    rec = await make.duty("Reception")
    h = await login(client, admin)
    mon = monday()
    await client.put("/api/rosters/week", headers=h, json={
        "week_start": str(mon), "staff_ids": [s.id], "cells": [cell(s, mon, rec, "A")]})
    res = await client.put("/api/rosters/week", headers=h, json={
        "week_start": str(mon), "staff_ids": [s.id], "cells": [cell(s, mon, rec, "B")]})
    assert res.status_code == 200, res.text
    grid = (await client.get(f"/api/rosters/week?start={mon}", headers=h)).json()
    assert [(c["date"], c["shift_code"]) for c in grid["cells"]] == [(str(mon), "B")]


async def test_published_roster_is_skipped_not_edited(client, db, make):
    await make.policy()
    admin = await make.user(UserRoleEnum.ADMIN_SI)
    s1, s2 = await make.staff(), await make.staff()
    rec = await make.duty("Reception")
    h = await login(client, admin)
    mon = monday()
    tue = mon + timedelta(days=1)
    await make.roster(tue, ShiftCode.A, [(s1, rec)], status=RosterStatus.PUBLISHED)

    res = await client.put("/api/rosters/week", headers=h, json={
        "week_start": str(mon), "staff_ids": [s1.id, s2.id],
        "cells": [cell(s2, mon, rec), cell(s2, tue, rec)]})
    assert res.status_code in (200, 422), res.text
    body = res.json() if res.status_code == 200 else res.json()["detail"]
    skipped = [d for d in body["days"] if d["action"] == "skipped"]
    assert [d["date"] for d in skipped] == [str(tue)]
    # the published roster still has only s1
    r = (await db.execute(select(Roster).where(Roster.roster_date == tue))).scalars().one()
    rows = (await db.execute(select(RosterAssignment).where(RosterAssignment.roster_id == r.id))).scalars().all()
    assert [a.staff_id for a in rows] == [s1.id]


async def test_blocking_violation_refuses_the_whole_week_and_saves_nothing(client, db, make):
    await make.policy()
    admin = await make.user(UserRoleEnum.ADMIN_SI)
    s = await make.staff()
    rec = await make.duty("Reception")
    h = await login(client, admin)
    mon = monday()
    thu = mon + timedelta(days=3)
    db.add(LeaveRequest(staff_id=s.id, leave_type="CL", start_date=thu, end_date=thu, status=LeaveStatus.APPROVED))
    await db.commit()

    payload = {"week_start": str(mon), "cells": [cell(s, d, rec) for d in week_days(mon)]}
    dry = (await client.post("/api/rosters/week/validate", headers=h, json=payload)).json()
    leave_issues = [i for i in dry["issues"] if i["code"] == "APPROVED_LEAVE"]
    assert dry["can_save"] is False and [i["date"] for i in leave_issues] == [str(thu)]
    assert leave_issues[0]["cell_index"] == 3  # points back at the Thursday cell

    res = await client.put("/api/rosters/week", headers=h, json=payload)
    assert res.status_code == 422
    assert (await db.execute(select(Roster))).scalars().all() == []  # nothing saved, not even the clean days

    # an authorized exception from the SHO lets the week save
    sho = await make.user(UserRoleEnum.SHO)
    payload["cells"][3].update(is_exception=True, exception_reason="Recalled from leave",
                               exception_authorized_by_id=sho.id)
    assert (await client.put("/api/rosters/week", headers=h, json=payload)).status_code == 200
    audit = (await db.execute(select(AuditLog).where(AuditLog.action == "EXCEPTION_AUTHORIZED"))).scalars().all()
    assert len(audit) == 1


async def test_dry_run_does_not_write(client, db, make):
    await make.policy()
    admin = await make.user(UserRoleEnum.ADMIN_SI)
    s = await make.staff()
    rec = await make.duty("Reception")
    h = await login(client, admin)
    mon = monday()
    res = await client.post("/api/rosters/week/validate", headers=h, json={
        "week_start": str(mon), "cells": [cell(s, mon, rec)]})
    assert res.status_code == 200
    assert (await db.execute(select(Roster))).scalars().all() == []


async def test_cells_must_be_inside_the_week_and_unique(client, db, make):
    await make.policy()
    admin = await make.user(UserRoleEnum.ADMIN_SI)
    s = await make.staff()
    rec = await make.duty("Reception")
    h = await login(client, admin)
    mon = monday()
    out = await client.put("/api/rosters/week", headers=h, json={
        "week_start": str(mon), "cells": [cell(s, mon + timedelta(days=7), rec)]})
    assert out.status_code == 422
    dup = await client.put("/api/rosters/week", headers=h, json={
        "week_start": str(mon), "cells": [cell(s, mon, rec, "A"), cell(s, mon, rec, "B")]})
    assert dup.status_code == 422


async def test_week_roles(client, db, make):
    await make.policy()
    s = await make.staff()
    rec = await make.duty("Reception")
    mon = monday()
    body = {"week_start": str(mon), "cells": [cell(s, mon, rec)]}

    sector = await make.user(UserRoleEnum.SECTOR_SI, sector_id=1)
    hs = await login(client, sector)
    assert (await client.get(f"/api/rosters/week?start={mon}", headers=hs)).status_code == 200  # read-only view
    assert (await client.put("/api/rosters/week", headers=hs, json=body)).status_code == 403

    staff_user = await make.user(UserRoleEnum.STAFF, staff=s)
    hu = await login(client, staff_user)
    assert (await client.get(f"/api/rosters/week?start={mon}", headers=hu)).status_code == 403
    assert (await client.put("/api/rosters/week", headers=hu, json=body)).status_code == 403
    assert (await client.post("/api/rosters/week/validate", headers=hu, json=body)).status_code == 403
