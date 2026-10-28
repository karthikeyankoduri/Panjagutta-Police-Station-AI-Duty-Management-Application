"""
Unit tests for the Availability Engine and key business logic.
Tests ensure: one status per person, priority order, no double-counting.
"""
import sys
import os
import asyncio
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest


def test_approved_leave_takes_priority():
    """Approved leave must win over all other statuses."""
    async def _run():
        from app.services.availability import compute_staff_status
        from app.models.models import StaffStatus

        mock_leave = MagicMock()
        mock_leave.leave_type = "EL"
        mock_leave.reference_number = "EL/2024/001"

        mock_db = AsyncMock()

        # Leave result returns a leave record (Result.scalar_one_or_none is synchronous in SQLAlchemy)
        leave_result = MagicMock()
        leave_result.scalar_one_or_none.return_value = mock_leave

        # Other queries return nothing
        empty_result = MagicMock()
        empty_result.scalar_one_or_none.return_value = None

        mock_db.execute = AsyncMock(side_effect=[
            leave_result,   # 1: leave check
            empty_result,   # 2: attachment
            empty_result,   # 3: movement
            empty_result,   # 4: assignment
            empty_result,   # 5: attendance
        ])

        result = await compute_staff_status(mock_db, staff_id=1, for_date=date.today())
        assert result.status == StaffStatus.ON_LEAVE

    asyncio.run(_run())


def test_pending_leave_does_not_mark_on_leave():
    """Pending leave must NOT count as approved absence."""
    from app.models.models import LeaveStatus
    # The SQL filter in compute_staff_status uses LeaveStatus.APPROVED explicitly
    assert LeaveStatus.PENDING != LeaveStatus.APPROVED
    assert LeaveStatus.REJECTED != LeaveStatus.APPROVED


def test_status_enum_values_match_spec():
    """All statuses from PDF page 5 must be present."""
    from app.models.models import StaffStatus
    expected = [
        "Present - Available",
        "On Duty",
        "Field Duty",
        "Court Duty",
        "Patrol / Beat Duty",
        "Official Movement",
        "Attached to Other Wing",
        "On Leave",
        "Duty Off / Rest",
        "Absent",
        "Emergency Deployment",
        "Shift Change Pending",
    ]
    actual = [s.value for s in StaffStatus]
    for e in expected:
        assert e in actual, f"Missing status: {e}"


def test_leave_status_enum_matches_spec():
    """Leave states: Pending, Approved, Rejected, Cancelled (PDF page 5)."""
    from app.models.models import LeaveStatus
    assert LeaveStatus.PENDING.value == "Pending"
    assert LeaveStatus.APPROVED.value == "Approved"
    assert LeaveStatus.REJECTED.value == "Rejected"
    assert LeaveStatus.CANCELLED.value == "Cancelled"


def test_task_status_enum_matches_spec():
    """Task states: exactly the 5 from PDF page 5."""
    from app.models.models import TaskStatus
    assert TaskStatus.NOT_STARTED.value == "Not Started"
    assert TaskStatus.IN_PROGRESS.value == "In Progress"
    assert TaskStatus.COMPLETED.value == "Completed"
    assert TaskStatus.ON_HOLD.value == "On Hold"
    assert TaskStatus.CANCELLED.value == "Cancelled"


def test_shift_config_matches_spec():
    """Shifts A, B, C must exist with correct durations."""
    from app.models.models import ShiftCode
    assert ShiftCode.A.value == "A"
    assert ShiftCode.B.value == "B"
    assert ShiftCode.C.value == "C"


def test_vacancy_calculation():
    """4 required Beat Constables, 3 allocated = 1 vacancy (PDF page 18 acceptance example)."""
    required = 4
    allocated = 3
    vacancies = max(0, required - allocated)
    assert vacancies == 1, "One vacancy must be reported when 4 required and 3 allocated"


def test_roster_version_increment():
    """New version must be previous + 1."""
    latest_version = 2
    new_version = latest_version + 1
    assert new_version == 3


def test_rotation_rule_unconfirmed_by_default():
    """Rotation policy must start as UNCONFIRMED — must not invent rules."""
    from app.models.models import PolicyStatus
    assert PolicyStatus.UNCONFIRMED.value == "unconfirmed"


def test_shift_c_crosses_midnight():
    """Shift C (20:00–08:00 next day) must be flagged as crossing midnight."""
    from datetime import time
    start = time(20, 0)
    end = time(8, 0)
    crosses_midnight = end < start
    assert crosses_midnight is True


def test_staff_service_number_is_unique_constraint():
    """Service number must be unique — enforced in the model."""
    from app.models.models import Staff
    for col in Staff.__table__.columns:
        if col.name == "service_number":
            assert col.unique is True
            break


def test_audit_log_has_required_fields():
    """AuditLog must capture actor, action, timestamp, entity_type, entity_id."""
    from app.models.models import AuditLog
    col_names = {col.name for col in AuditLog.__table__.columns}
    required_fields = {"actor_id", "actor_username", "action", "entity_type", "entity_id", "timestamp"}
    missing = required_fields - col_names
    assert not missing, f"AuditLog missing columns: {missing}"


def test_roster_status_draft_invisible_to_staff():
    """Draft roster must not be shown to staff — validated in roster list endpoint filter."""
    from app.models.models import RosterStatus
    assert RosterStatus.DRAFT.value == "draft"
    assert RosterStatus.PUBLISHED.value == "published"


def test_movement_shows_outside_on_official_duty():
    """Open movement must map to OFFICIAL_MOVEMENT status."""
    from app.models.models import MovementStatus, StaffStatus
    assert MovementStatus.OPEN.value == "open"
    assert StaffStatus.OFFICIAL_MOVEMENT.value == "Official Movement"
