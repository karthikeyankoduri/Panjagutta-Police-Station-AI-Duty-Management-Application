"""
Attendance recorded automatically from sign-in and sign-out.

* Sign-in during (or up to ATTENDANCE_EARLY_SIGNIN_MINUTES before) a shift the person is
  rostered for on a published roster marks them Present for that shift. Signing in after the
  start plus ATTENDANCE_LATE_GRACE_MINUTES flags the row late.
* A sign-in with no rostered shift (or no published roster yet) still counts as Present for the
  shift running at that moment, but is_scheduled stays False so it can be told apart.
* Sign-out (explicit, or the idle sweep) records the check-out time. The earliest check-in of
  a shift is kept; the check-out is extended by each later session.

Only accounts linked to a staff record are tracked. Recording must never block a login, so the
public entry points swallow and log their own failures.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import (
    Attendance, Roster, RosterAssignment, RosterStatus, ShiftCode, User, UserSession,
)
from app.services.audit import AuditAction, log_event
from app.services.shifts import current_shift, load_shift_timings, now_local

logger = logging.getLogger(__name__)

SOURCE_LOGIN = "LOGIN"


async def resolve_staff_id(db: AsyncSession, user: User) -> Optional[int]:
    """The staff record behind a login: the explicit link, else username = service number."""
    if user.staff_id:
        return user.staff_id
    from app.models.models import Staff
    uname = (user.username or "").lower()
    res = await db.execute(
        select(Staff.id).where(or_(
            func.lower(Staff.service_number) == uname.replace("_", ""),
            func.lower(Staff.service_number) == uname,
            func.lower(Staff.service_number) == uname.replace("_", "-"),
        ))
    )
    return res.scalars().first()


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


async def _rostered_shift(db: AsyncSession, staff_id: int, at: datetime):
    """The (date, shift, timing) the person is rostered for at `at`, or None.

    Today and yesterday are both checked so the night shift after midnight maps to the date it started.
    """
    from app.services.availability import latest_published_rosters
    timings = await load_shift_timings(db)
    early = timedelta(minutes=settings.ATTENDANCE_EARLY_SIGNIN_MINUTES)
    days = (at.date() - timedelta(days=1), at.date(), at.date() + timedelta(days=1))
    latest = await latest_published_rosters(db, days[0], days[-1])
    for duty_date in days:
        for code, timing in sorted(timings.items(), key=lambda kv: kv[1].start):
            start, end = timing.window(duty_date)
            if not (start - early <= at < end):
                continue
            roster = latest.get((duty_date, code))
            if not roster:
                continue
            res = await db.execute(select(RosterAssignment.id).where(
                RosterAssignment.roster_id == roster.id, RosterAssignment.staff_id == staff_id))
            if res.scalars().first() is not None:
                return duty_date, code, timing, start
    return None


async def _find(db: AsyncSession, staff_id: int, duty_date, code: ShiftCode) -> Optional[Attendance]:
    res = await db.execute(select(Attendance).where(
        Attendance.staff_id == staff_id, Attendance.attendance_date == duty_date,
        Attendance.shift_code == code))
    return res.scalar_one_or_none()


async def _record_sign_in(db: AsyncSession, user: User, now: datetime) -> Optional[Attendance]:
    staff_id = await resolve_staff_id(db, user)
    if not staff_id:
        return None

    match = await _rostered_shift(db, staff_id, now)
    if match:
        duty_date, code, _timing, start = match
        scheduled = True
        late = now > start + timedelta(minutes=settings.ATTENDANCE_LATE_GRACE_MINUTES)
    else:
        timings = await load_shift_timings(db)
        code, duty_date = current_shift(timings, now)
        scheduled, late = False, False

    stamp = now.astimezone(timezone.utc)  # stored in UTC; SQLite drops the zone, Postgres keeps it
    att = await _find(db, staff_id, duty_date, code)
    if att is None:
        att = Attendance(
            staff_id=staff_id, attendance_date=duty_date, shift_code=code,
            is_scheduled=scheduled, is_confirmed=True, is_late=late,
            check_in_at=stamp, source=SOURCE_LOGIN,
            submitted_by_id=user.id, submitted_at=stamp,
        )
        db.add(att)
    else:
        # Keep the earliest check-in; a repeat sign-in only ever upgrades the row.
        if att.check_in_at is None or _aware(att.check_in_at) > stamp:
            att.check_in_at = stamp
            att.is_late = late
        att.is_confirmed = True
        if scheduled:
            att.is_scheduled = True
        att.check_out_at = None  # back on shift: the previous session's check-out no longer stands
        att.source = att.source or SOURCE_LOGIN
    await db.flush()
    await log_event(db, actor=user, action=AuditAction.ATTENDANCE_SIGNED_IN, entity_type="Attendance",
                    entity_id=att.id,
                    new_values={"staff_id": staff_id, "date": str(duty_date), "shift": code.value,
                                "scheduled": scheduled, "late": late, "check_in_at": now.isoformat()})
    return att


async def record_sign_in(db: AsyncSession, user: User) -> Optional[Attendance]:
    """Record attendance for a successful sign-in. Never raises."""
    now = now_local()
    try:
        async with db.begin_nested():
            return await _record_sign_in(db, user, now)
    except IntegrityError:
        # Two sign-ins raced on the unique (staff, date, shift) row: the other one won, so retry as an update.
        try:
            async with db.begin_nested():
                return await _record_sign_in(db, user, now)
        except Exception:
            logger.exception("Attendance sign-in retry failed for user %s", user.id)
    except Exception:
        logger.exception("Attendance sign-in recording failed for user %s", user.id)
    return None


async def record_sign_out(db: AsyncSession, user: User, when: Optional[datetime] = None,
                          actor_username: Optional[str] = None) -> int:
    """Stamp the check-out on the person's latest sign-in. Returns rows updated (0 or 1). Never raises."""
    when_utc = (when or now_local()).astimezone(timezone.utc)
    try:
        async with db.begin_nested():
            staff_id = await resolve_staff_id(db, user)
            if not staff_id:
                return 0
            horizon = (when_utc - timedelta(days=2)).date()
            res = await db.execute(select(Attendance).where(
                Attendance.staff_id == staff_id, Attendance.source == SOURCE_LOGIN,
                Attendance.check_in_at != None, Attendance.attendance_date >= horizon))
            rows = [a for a in res.scalars().all() if _aware(a.check_in_at) <= when_utc]
            if not rows:
                return 0
            latest = max(rows, key=lambda a: _aware(a.check_in_at))
            if latest.check_out_at is not None and _aware(latest.check_out_at) >= when_utc:
                return 0  # a later session already closed this shift
            latest.check_out_at = when_utc
            await db.flush()
            await log_event(db, actor=user if actor_username is None else None,
                            actor_username=actor_username or user.username,
                            action=AuditAction.ATTENDANCE_SIGNED_OUT, entity_type="Attendance",
                            entity_id=latest.id,
                            new_values={"staff_id": staff_id, "check_out_at": when_utc.isoformat()})
            return 1
    except Exception:
        logger.exception("Attendance sign-out recording failed for user %s", user.id)
        return 0


async def expire_idle_sessions(db: AsyncSession) -> int:
    """Close sessions that are past the inactivity limit or token expiry, stamping the last activity as check-out."""
    now = datetime.now(timezone.utc)
    limit = timedelta(minutes=settings.AUTH_INACTIVITY_TIMEOUT_MINUTES)
    res = await db.execute(select(UserSession).where(UserSession.is_valid == True))
    closed = 0
    for session in res.scalars().all():
        user = await db.get(User, session.user_id)
        if user is None:
            continue
        last = _aware(user.last_activity) or _aware(session.created_at) or now
        expired = _aware(session.expires_at) <= now
        idle = now - last > limit
        if not (expired or idle):
            continue
        end = min(last, _aware(session.expires_at)) if expired else last
        session.is_valid = False
        session.invalidated_at = now
        await log_event(db, actor=None, actor_username="system:scheduler", action=AuditAction.SESSION_EXPIRED,
                        entity_type="User", entity_id=user.id)
        await record_sign_out(db, user, when=end, actor_username="system:scheduler")
        closed += 1
    return closed
