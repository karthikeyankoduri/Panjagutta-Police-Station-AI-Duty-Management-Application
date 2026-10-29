import asyncio
from datetime import date, datetime, time, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.api.routes.mobile import mobile_duty_diary, mobile_me
from app.main import app
from app.models.models import UserRoleEnum


def test_mobile_routes_are_mounted_under_api_prefix():
    mounted = {
        (route.path, method)
        for route in app.routes
        for method in getattr(route, "methods", set())
    }

    assert ("/api/mobile/me", "GET") in mounted
    assert ("/api/mobile/diary", "GET") in mounted
    assert ("/api/mobile/attendance", "POST") in mounted
    assert ("/api/mobile/leave", "POST") in mounted


class ScalarRows:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows


class QueryResult:
    def __init__(self, scalar=None, rows=None):
        self.scalar = scalar
        self.rows = rows or []

    def scalar_one_or_none(self):
        return self.scalar

    def scalars(self):
        return ScalarRows(self.rows)

    def all(self):
        return self.rows


def staff_user():
    return SimpleNamespace(
        id=12,
        username="officer",
        role=UserRoleEnum.STAFF,
        staff_id=34,
        must_change_password=False,
    )


def active_staff():
    return SimpleNamespace(
        id=34,
        name="Test Officer",
        service_number="TEST-034",
        designation=SimpleNamespace(value="PC"),
        sector_id=2,
        is_active=True,
    )


def test_mobile_profile_returns_linked_staff_identity():
    user = staff_user()
    db = MagicMock()
    db.execute = AsyncMock(return_value=QueryResult(scalar=active_staff()))

    result = asyncio.run(mobile_me(user=user, db=db))

    assert result["staff_id"] == 34
    assert result["name"] == "Test Officer"
    assert result["service_number"] == "TEST-034"
    assert result["role"] == "STAFF"


def test_mobile_endpoints_reject_non_staff_accounts():
    user = SimpleNamespace(id=1, username="manager", role=UserRoleEnum.SHO, staff_id=None)
    db = MagicMock()
    db.execute = AsyncMock()

    with pytest.raises(HTTPException) as error:
        asyncio.run(mobile_me(user=user, db=db))

    assert error.value.status_code == 403
    db.execute.assert_not_awaited()


def test_mobile_diary_serializes_assigned_roster_and_attendance():
    duty_date = date(2026, 10, 15)
    roster = SimpleNamespace(
        id=91,
        roster_date=duty_date,
        shift_code=SimpleNamespace(value="B"),
    )
    assignment = SimpleNamespace(notes="Community patrol route")
    duty = SimpleNamespace(category="Patrol", description="General patrol")
    attendance = SimpleNamespace(
        submitted_at=datetime(2026, 10, 15, 14, 2, tzinfo=timezone.utc),
        is_confirmed=True,
        verified_at=datetime(2026, 10, 15, 14, 5, tzinfo=timezone.utc),
    )
    shift = SimpleNamespace(
        shift_code=SimpleNamespace(value="B"),
        start_time=time(14, 0),
        end_time=time(20, 0),
    )

    staff_result = QueryResult(scalar=active_staff())
    shifts_result = QueryResult(rows=[shift])
    diary_result = QueryResult(rows=[(roster, assignment, duty, attendance)])
    db = MagicMock()
    db.execute = AsyncMock(side_effect=[staff_result, shifts_result, diary_result])

    result = asyncio.run(mobile_duty_diary(
        start_date=duty_date,
        end_date=duty_date,
        user=staff_user(),
        db=db,
    ))

    assert result == [{
        "roster_id": 91,
        "duty_date": "2026-10-15",
        "shift_name": "B",
        "start_time": "14:00",
        "end_time": "20:00",
        "duty_category": "Patrol",
        "current_task": "Community patrol route",
        "attendance_submitted_at": "2026-10-15T14:02:00+00:00",
        "attendance_confirmed": True,
        "attendance_verified_at": "2026-10-15T14:05:00+00:00",
    }]


@pytest.mark.parametrize("start_date,end_date", [
    (date(2026, 10, 16), date(2026, 10, 15)),
    (date(2026, 9, 1), date(2026, 10, 2)),
])
def test_mobile_diary_rejects_invalid_or_oversized_ranges(start_date, end_date):
    with pytest.raises(HTTPException) as error:
        asyncio.run(mobile_duty_diary(
            start_date=start_date,
            end_date=end_date,
            user=staff_user(),
            db=MagicMock(),
        ))

    assert error.value.status_code == 422
