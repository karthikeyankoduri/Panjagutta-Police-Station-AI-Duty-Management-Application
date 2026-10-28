"""
Append-only audit service. Every material change must call log_event().
Ordinary users cannot edit or delete audit records (enforced at API layer).
"""
from __future__ import annotations

from typing import Optional, Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import AuditLog, User


async def log_event(
    db: AsyncSession,
    *,
    actor: User,
    action: str,
    entity_type: str,
    entity_id: Optional[int] = None,
    old_values: Optional[dict] = None,
    new_values: Optional[dict] = None,
    authorizer: Optional[User] = None,
    exception_reason: Optional[str] = None,
    request_id: Optional[str] = None,
    ip_address: Optional[str] = None,
) -> AuditLog:
    """
    Write an immutable audit entry. Never logs passwords, tokens or secrets.
    Caller is responsible for sanitizing new_values / old_values before passing.
    """
    entry = AuditLog(
        actor_id=actor.id,
        actor_username=actor.username,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        old_values=old_values,
        new_values=new_values,
        authorizer_id=authorizer.id if authorizer else None,
        authorizer_username=authorizer.username if authorizer else None,
        exception_reason=exception_reason,
        request_id=request_id,
        ip_address=ip_address,
    )
    db.add(entry)
    # We don't commit here — caller's transaction boundary handles it
    return entry


# Common action constants
class AuditAction:
    LOGIN = "LOGIN"
    LOGIN_FAILED = "LOGIN_FAILED"
    LOGOUT = "LOGOUT"
    LOCKOUT = "LOCKOUT"
    PASSWORD_CHANGED = "PASSWORD_CHANGED"

    STAFF_CREATED = "STAFF_CREATED"
    STAFF_UPDATED = "STAFF_UPDATED"
    STAFF_DEACTIVATED = "STAFF_DEACTIVATED"

    ROSTER_CREATED = "ROSTER_CREATED"
    ROSTER_UPDATED = "ROSTER_UPDATED"
    ROSTER_SUBMITTED = "ROSTER_SUBMITTED"
    ROSTER_APPROVED = "ROSTER_APPROVED"
    ROSTER_PUBLISHED = "ROSTER_PUBLISHED"

    ATTENDANCE_SUBMITTED = "ATTENDANCE_SUBMITTED"
    ATTENDANCE_VERIFIED = "ATTENDANCE_VERIFIED"

    LEAVE_REQUESTED = "LEAVE_REQUESTED"
    LEAVE_APPROVED = "LEAVE_APPROVED"
    LEAVE_REJECTED = "LEAVE_REJECTED"
    LEAVE_CANCELLED = "LEAVE_CANCELLED"

    MOVEMENT_CREATED = "MOVEMENT_CREATED"
    MOVEMENT_AUTHORIZED = "MOVEMENT_AUTHORIZED"
    MOVEMENT_DEPARTED = "MOVEMENT_DEPARTED"
    MOVEMENT_RETURNED = "MOVEMENT_RETURNED"
    MOVEMENT_CLOSED = "MOVEMENT_CLOSED"

    TASK_CREATED = "TASK_CREATED"
    TASK_UPDATED = "TASK_UPDATED"

    ATTACHMENT_CREATED = "ATTACHMENT_CREATED"
    ATTACHMENT_ENDED = "ATTACHMENT_ENDED"

    POLICY_UPDATED = "POLICY_UPDATED"
    POLICY_DEMO_ACKNOWLEDGED = "POLICY_DEMO_ACKNOWLEDGED"

    CONFIG_UPDATED = "CONFIG_UPDATED"

    ALERT_RESOLVED = "ALERT_RESOLVED"
    EXCEPTION_AUTHORIZED = "EXCEPTION_AUTHORIZED"
