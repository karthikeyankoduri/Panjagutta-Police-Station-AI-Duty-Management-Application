"""
Shared test fixtures: an isolated SQLite database per test, the FastAPI app
served in-process, and helpers to create staff, users and published rosters.
The developer database (panjagutta_local.db) is never touched.
"""
from __future__ import annotations

import os
import sys
import tempfile

_TMP = tempfile.mkdtemp(prefix="panjagutta_test_")
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{os.path.join(_TMP, 'test.db')}"
os.environ["APP_DEBUG"] = "false"
os.environ["APP_ENV"] = "test"
os.environ["SEED_DEMO_DATA"] = "false"
os.environ["JWT_SECRET_KEY"] = "test-secret-key-for-automated-tests-only-0123456789"
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from datetime import date, datetime, timedelta, timezone  # noqa: E402
from typing import Optional  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402

from app.auth.jwt import hash_password  # noqa: E402
from app.db.bootstrap import ensure_config  # noqa: E402
from app.db.database import AsyncSessionLocal, Base, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models.models import (  # noqa: E402
    DutyMaster, PolicyStatus, Roster, RosterAssignment, RosterStatus, RotationRule, ShiftCode, Staff,
    StaffCategory, StaffDesignation, User, UserRoleEnum,
)

PASSWORD = "Strong#Pass2026"
_bcrypt_cache: dict = {}


def fast_hash(pw: str) -> str:
    if pw not in _bcrypt_cache:
        _bcrypt_cache[pw] = hash_password(pw)
    return _bcrypt_cache[pw]


@pytest_asyncio.fixture
async def db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with AsyncSessionLocal() as session:
        await ensure_config(session)
        yield session


@pytest_asyncio.fixture
async def client(db):
    from app import main as app_main
    app_main._auth_attempts.clear()  # the per-IP login limiter is tested separately
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


class Factory:
    def __init__(self, db):
        self.db = db
        self.n = 0

    async def staff(self, name="Officer", designation=StaffDesignation.PC, sector_id: Optional[int] = 1,
                    category=StaffCategory.SECTOR_STAFF, **kw) -> Staff:
        self.n += 1
        s = Staff(service_number=f"T{self.n:04d}", name=f"{name} {self.n}", designation=designation,
                  category=category, sector_id=sector_id, is_active=True, **kw)
        self.db.add(s)
        await self.db.commit()
        return s

    async def user(self, role: UserRoleEnum, staff: Optional[Staff] = None, sector_id: Optional[int] = None,
                   password: str = PASSWORD, must_change=False, username: Optional[str] = None) -> User:
        self.n += 1
        u = User(username=username or f"{role.value.lower()}_{self.n}", hashed_password=fast_hash(password),
                 role=role, staff_id=staff.id if staff else None, sector_id=sector_id,
                 is_active=True, must_change_password=must_change)
        self.db.add(u)
        await self.db.commit()
        return u

    async def policy(self, status=PolicyStatus.CONFIRMED, rest=16.0, after_b=24.0, authorizer_role=None):
        self.db.add(RotationRule(version=99, rotation_sequence="A->B->C", min_rest_hours_after_shift=rest,
                                 duty_off_after_shift_b_hours=after_b, policy_status=status,
                                 exception_authorizer_role=authorizer_role))
        await self.db.commit()

    async def duty(self, category: str, shift: Optional[ShiftCode] = None) -> DutyMaster:
        from sqlalchemy import select
        q = select(DutyMaster).where(DutyMaster.category == category)
        rows = (await self.db.execute(q)).scalars().all()
        for d in rows:
            if shift is None or d.shift_code in (shift, None):
                return d
        raise AssertionError(f"duty {category} not seeded")

    async def roster(self, day: date, shift: ShiftCode, assignments, status=RosterStatus.PUBLISHED,
                     version=1) -> Roster:
        r = Roster(roster_date=day, shift_code=shift, version=version, status=status)
        self.db.add(r)
        await self.db.flush()
        for staff, duty in assignments:
            self.db.add(RosterAssignment(roster_id=r.id, staff_id=staff.id, duty_master_id=duty.id))
        await self.db.commit()
        return r


@pytest_asyncio.fixture
async def make(db):
    return Factory(db)


async def login(client, user: User, password: str = PASSWORD) -> dict:
    res = await client.post("/api/auth/login", json={"username": user.username, "password": password})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def today() -> date:
    from app.services.shifts import now_local
    return now_local().date()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


__all__ = ["login", "today", "utcnow", "PASSWORD", "timedelta"]
