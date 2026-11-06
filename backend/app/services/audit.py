"""
Append-only audit service. Every material change must call log_event().

Protection layers:
- No API route updates or deletes audit rows.
- An ORM guard (below) refuses any UPDATE or DELETE of AuditLog objects made
  through the application session.
- The Alembic baseline migration adds a PostgreSQL trigger that rejects UPDATE.
- Sensitive keys (passwords, tokens, secrets) are stripped before storage.
"""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.models.models import AuditLog, User

SENSITIVE_KEYS = ("password", "token", "secret", "hashed", "otp")


def sanitize(values: Any) -> Any:
    """Recursively drop sensitive keys from a dict/list before it is written to the audit log."""
    if isinstance(values, dict):
        return {
            k: sanitize(v)
            for k, v in values.items()
            if not any(s in str(k).lower() for s in SENSITIVE_KEYS)
        }
    if isinstance(values, (list, tuple)):
        return [sanitize(v) for v in values]
    if hasattr(values, "isoformat"):
        return values.isoformat()
    if hasattr(values, "value") and not isinstance(values, (str, int, float, bool)):
        return values.value
    return values


async def log_event(
    db: AsyncSession,
    *,
    actor: Optional[User],
    action: str,
    entity_type: str,
    entity_id: Optional[int] = None,
    old_values: Optional[dict] = None,
    new_values: Optional[dict] = None,
    authorizer: Optional[User] = None,
    exception_reason: Optional[str] = None,
    request_id: Optional[str] = None,
    ip_address: Optional[str] = None,
    actor_username: Optional[str] = None,
) -> AuditLog:
    """
    Write an immutable audit entry. `actor` may be None for system jobs or for
    failed logins against unknown usernames (pass actor_username instead).
    Passwords, tokens and secrets are always stripped.
    """
    entry = AuditLog(
        actor_id=actor.id if actor else None,
        actor_username=(actor.username if actor else None) or actor_username or "system",
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        old_values=sanitize(old_values) if old_values is not None else None,
        new_values=sanitize(new_values) if new_values is not None else None,
        authorizer_id=authorizer.id if authorizer else None,
        authorizer_username=authorizer.username if authorizer else None,
        exception_reason=exception_reason,
        request_id=request_id,
        ip_address=ip_address,
    )
    db.add(entry)
    # We don't commit here — caller's transaction boundary handles it
    return entry


@event.listens_for(Session, "before_flush")
def _protect_audit_rows(session, flush_context, instances):  # pragma: no cover - exercised in tests
    for obj in list(session.dirty) + list(session.deleted):
        if isinstance(obj, AuditLog):
            raise PermissionError("Audit log entries are append-only and cannot be modified or deleted.")


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
    ATTENDANCE_SIGNED_IN = "ATTENDANCE_SIGNED_IN"
    ATTENDANCE_SIGNED_OUT = "ATTENDANCE_SIGNED_OUT"

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
    ALERT_RAISED = "ALERT_RAISED"
    EXCEPTION_AUTHORIZED = "EXCEPTION_AUTHORIZED"

    ROSTER_REJECTED = "ROSTER_REJECTED"
    ROSTER_REVISED = "ROSTER_REVISED"
    ROSTER_ASSIGNMENTS_UPDATED = "ROSTER_ASSIGNMENTS_UPDATED"
    ATTENDANCE_BULK_CONFIRMED = "ATTENDANCE_BULK_CONFIRMED"
    MOVEMENT_REJECTED = "MOVEMENT_REJECTED"
    MOVEMENT_CANCELLED = "MOVEMENT_CANCELLED"
    LOGIN_FAILED_UNKNOWN = "LOGIN_FAILED_UNKNOWN"
    LOGIN_BLOCKED_LOCKED = "LOGIN_BLOCKED_LOCKED"
    LOGIN_BLOCKED_INACTIVE = "LOGIN_BLOCKED_INACTIVE"
    SESSION_EXPIRED = "SESSION_EXPIRED"
    DUTY_CREATED = "DUTY_CREATED"
    DUTY_UPDATED = "DUTY_MASTER_UPDATED"
