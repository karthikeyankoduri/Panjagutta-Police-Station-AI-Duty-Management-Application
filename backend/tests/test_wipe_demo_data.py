"""Wipe Demo Data must clear every operational table, not only some of them."""
from sqlalchemy import func, select

from app.models.models import (
    Attendance, Notification, Staff, User, UserRoleEnum, UserSession,
)
from conftest import login, today


async def _count(db, model):
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


async def test_wipe_clears_staff_notifications_attendance_and_other_sessions(client, db, make):
    admin = await make.user(UserRoleEnum.ADMIN_SI)
    s = await make.staff(name="To Be Wiped")
    other = await make.user(UserRoleEnum.STAFF, staff=s)
    db.add(Notification(user_id=other.id, title="t", message="m"))
    db.add(Attendance(staff_id=s.id, attendance_date=today(), shift_code="A", is_confirmed=True))
    await db.commit()
    headers = await login(client, admin)
    await login(client, other)  # creates a second session

    res = await client.post("/api/staff/clear-demo-data", headers=headers)
    assert res.status_code == 200, res.text

    assert await _count(db, Staff) == 0
    assert await _count(db, Notification) == 0
    assert await _count(db, Attendance) == 0
    sessions = (await db.execute(select(UserSession.user_id))).scalars().all()
    assert set(sessions) <= {admin.id}
    names = set((await db.execute(select(User.username))).scalars().all())
    assert other.username not in names, names
