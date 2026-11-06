"""
APScheduler background jobs (Build Guide §5.2 Scheduler, blueprint step 21):
- Overdue movements (expected return passed, movement still open)
- Tasks past expected completion
- Stalled approvals: submitted rosters, pending leave, unauthorized movement requests
- Attachment orders past their expected end date
Alerts are de-duplicated (one open alert per condition), written to the audit
log as system actions, and routed to the responsible officers as notifications.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import and_, select

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")

STALLED_ROSTER_HOURS = 24
STALLED_LEAVE_HOURS = 48
STALLED_MOVEMENT_HOURS = 4


async def raise_alert(db, alert_type: str, entity_type: str, entity_id: int, message: str,
                      severity: str = "warning", roles=None, sector_id=None) -> bool:
    """Create an alert unless an open one already exists for the same condition. Returns True if created."""
    from app.models.models import Alert, UserRoleEnum
    from app.services.audit import AuditAction, log_event
    from app.services.notifications import notify_roles

    existing = await db.execute(select(Alert).where(
        Alert.alert_type == alert_type, Alert.entity_type == entity_type,
        Alert.entity_id == entity_id, Alert.is_resolved == False))
    if existing.scalars().first():
        return False
    alert = Alert(alert_type=alert_type, entity_type=entity_type, entity_id=entity_id,
                  message=message, severity=severity)
    db.add(alert)
    await db.flush()
    await log_event(db, actor=None, actor_username="system:scheduler", action=AuditAction.ALERT_RAISED,
                    entity_type=entity_type, entity_id=entity_id,
                    new_values={"alert_id": alert.id, "alert_type": alert_type, "message": message})
    await notify_roles(db, roles or (UserRoleEnum.ADMIN_SI, UserRoleEnum.SHO), alert_type.replace("_", " ").title(),
                       message, category="alert", entity_type=entity_type, entity_id=entity_id, sector_id=sector_id)
    return True


async def check_overdue_movements(db) -> int:
    from app.models.models import Movement, MovementStatus, Staff, UserRoleEnum
    from app.services.audit import log_event
    now = datetime.now(timezone.utc)
    rows = (await db.execute(select(Movement).where(and_(
        Movement.status.in_([MovementStatus.AUTHORIZED, MovementStatus.OPEN]),
        Movement.expected_return < now,
        Movement.is_overdue == False,
    )))).scalars().all()
    for m in rows:
        m.is_overdue = True
        person = await db.get(Staff, m.staff_id)
        who = f"{person.name} ({person.service_number})" if person else f"Staff #{m.staff_id}"
        await log_event(db, actor=None, actor_username="system:scheduler", action="MOVEMENT_FLAGGED_OVERDUE",
                        entity_type="Movement", entity_id=m.id, old_values={"is_overdue": False},
                        new_values={"is_overdue": True})
        await raise_alert(db, "MOVEMENT_OVERDUE", "Movement", m.id,
                          f"{who} has not returned from {m.destination}; expected back {m.expected_return.isoformat()}",
                          roles=(UserRoleEnum.ADMIN_SI, UserRoleEnum.SHO, UserRoleEnum.SECTOR_SI),
                          sector_id=person.sector_id if person else None)
    return len(rows)


async def check_overdue_tasks(db) -> int:
    from app.models.models import Staff, Task, TaskStatus, UserRoleEnum
    from app.services.audit import log_event
    now = datetime.now(timezone.utc)
    rows = (await db.execute(select(Task).where(and_(
        Task.status.in_([TaskStatus.NOT_STARTED, TaskStatus.IN_PROGRESS]),
        Task.expected_completion < now,
        Task.is_overdue == False,
    )))).scalars().all()
    for t in rows:
        t.is_overdue = True
        person = await db.get(Staff, t.assignee_id)
        await log_event(db, actor=None, actor_username="system:scheduler", action="TASK_FLAGGED_OVERDUE",
                        entity_type="Task", entity_id=t.id, old_values={"is_overdue": False},
                        new_values={"is_overdue": True})
        await raise_alert(db, "TASK_OVERDUE", "Task", t.id,
                          f"Task overdue ({person.name if person else 'Staff #' + str(t.assignee_id)}): {t.description[:80]}",
                          roles=(UserRoleEnum.ADMIN_SI, UserRoleEnum.SECTOR_SI),
                          sector_id=person.sector_id if person else None)
    return len(rows)


async def check_stalled_approvals(db) -> int:
    from app.models.models import (
        AttachmentOrder, LeaveRequest, LeaveStatus, Movement, MovementStatus, Roster, RosterStatus, Staff, UserRoleEnum,
    )
    now = datetime.now(timezone.utc)
    raised = 0
    for r in (await db.execute(select(Roster).where(
            Roster.status == RosterStatus.SUBMITTED,
            Roster.updated_at < now - timedelta(hours=STALLED_ROSTER_HOURS)))).scalars().all():
        raised += await raise_alert(db, "ROSTER_STALLED", "Roster", r.id,
                                    f"Roster {r.roster_date} Shift {r.shift_code.value} v{r.version} has awaited approval for over {STALLED_ROSTER_HOURS}h",
                                    roles=(UserRoleEnum.SHO,))
    for l in (await db.execute(select(LeaveRequest).where(
            LeaveRequest.status == LeaveStatus.PENDING,
            LeaveRequest.submitted_at < now - timedelta(hours=STALLED_LEAVE_HOURS)))).scalars().all():
        raised += await raise_alert(db, "LEAVE_STALLED", "LeaveRequest", l.id,
                                    f"Leave request {l.reference_number or l.id} ({l.start_date} to {l.end_date}) has awaited a decision for over {STALLED_LEAVE_HOURS}h",
                                    roles=(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI))
    for m in (await db.execute(select(Movement).where(
            Movement.status == MovementStatus.PENDING_AUTHORIZATION,
            Movement.created_at < now - timedelta(hours=STALLED_MOVEMENT_HOURS)))).scalars().all():
        person = await db.get(Staff, m.staff_id)
        raised += await raise_alert(db, "MOVEMENT_AUTHORIZATION_STALLED", "Movement", m.id,
                                    f"Movement request to {m.destination} has awaited authorization for over {STALLED_MOVEMENT_HOURS}h",
                                    roles=(UserRoleEnum.ADMIN_SI, UserRoleEnum.SECTOR_SI),
                                    sector_id=person.sector_id if person else None)
    for a in (await db.execute(select(AttachmentOrder).where(
            AttachmentOrder.is_active == True, AttachmentOrder.expected_end_date < date.today()))).scalars().all():
        raised += await raise_alert(db, "ATTACHMENT_PAST_END_DATE", "AttachmentOrder", a.id,
                                    f"Attachment to {a.attached_wing} (order {a.order_reference or a.id}) passed its expected end date {a.expected_end_date}; repatriate or extend",
                                    severity="info", roles=(UserRoleEnum.ADMIN_SI,))
    return raised


async def close_idle_sessions(db) -> int:
    """Sign out abandoned sessions and stamp their last activity as the attendance check-out."""
    from app.services.attendance_auto import expire_idle_sessions
    return await expire_idle_sessions(db)


async def _run(session_factory, job, label: str):
    async with session_factory() as db:
        try:
            n = await job(db)
            await db.commit()
            if n:
                logger.info("Scheduler %s: %s item(s) flagged", label, n)
        except Exception as e:  # pragma: no cover - logged, never crashes the app
            logger.error("Scheduler %s failed: %s", label, e)
            await db.rollback()


def start_scheduler(session_factory):
    """Call this from the FastAPI lifespan startup."""
    scheduler.add_job(_run, "interval", minutes=15, id="check_overdue_movements", replace_existing=True,
                      args=[session_factory, check_overdue_movements, "overdue movements"])
    scheduler.add_job(_run, "interval", minutes=15, id="check_overdue_tasks", replace_existing=True,
                      args=[session_factory, check_overdue_tasks, "overdue tasks"])
    scheduler.add_job(_run, "interval", hours=1, id="check_stalled_approvals", replace_existing=True,
                      args=[session_factory, check_stalled_approvals, "stalled approvals"])
    scheduler.add_job(_run, "interval", minutes=5, id="close_idle_sessions", replace_existing=True,
                      args=[session_factory, close_idle_sessions, "idle sessions"])
    scheduler.start()
    logger.info("APScheduler started: overdue movements/tasks every 15 min, idle sessions every 5 min, "
                "stalled approvals hourly")
