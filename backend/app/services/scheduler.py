"""
APScheduler background jobs:
- Check overdue movements (expected return passed, movement still open)
- Flag overdue tasks (past expected_completion)
- Alert on stalled approvals (submitted rosters not approved within threshold)
Deduplicates alerts to avoid spam.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select, and_

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")


def start_scheduler(session_factory):
    """Call this from the FastAPI lifespan startup."""

    @scheduler.scheduled_job("interval", minutes=15, id="check_overdue_movements")
    async def check_overdue_movements():
        async with session_factory() as db:
            try:
                from app.models.models import Movement, MovementStatus, Alert
                now = datetime.now(timezone.utc)
                result = await db.execute(
                    select(Movement).where(
                        and_(
                            Movement.status == MovementStatus.OPEN,
                            Movement.expected_return < now,
                            Movement.is_overdue == False,
                        )
                    )
                )
                overdue = result.scalars().all()
                for movement in overdue:
                    movement.is_overdue = True
                    # Deduplicated alert
                    existing = await db.execute(
                        select(Alert).where(
                            Alert.alert_type == "MOVEMENT_OVERDUE",
                            Alert.entity_id == movement.id,
                            Alert.is_resolved == False,
                        )
                    )
                    if not existing.scalar_one_or_none():
                        alert = Alert(
                            alert_type="MOVEMENT_OVERDUE",
                            entity_type="Movement",
                            entity_id=movement.id,
                            message=f"Staff movement (ID {movement.id}) overdue — expected return was {movement.expected_return.isoformat()}",
                            severity="warning",
                        )
                        db.add(alert)
                await db.commit()
                if overdue:
                    logger.info(f"Scheduler: flagged {len(overdue)} overdue movements")
            except Exception as e:
                logger.error(f"Scheduler overdue movement check failed: {e}")
                await db.rollback()

    @scheduler.scheduled_job("interval", minutes=15, id="check_overdue_tasks")
    async def check_overdue_tasks():
        async with session_factory() as db:
            try:
                from app.models.models import Task, TaskStatus, Alert
                now = datetime.now(timezone.utc)
                result = await db.execute(
                    select(Task).where(
                        and_(
                            Task.status.in_([TaskStatus.NOT_STARTED, TaskStatus.IN_PROGRESS]),
                            Task.expected_completion < now,
                            Task.is_overdue == False,
                        )
                    )
                )
                overdue_tasks = result.scalars().all()
                for task in overdue_tasks:
                    task.is_overdue = True
                    existing = await db.execute(
                        select(Alert).where(
                            Alert.alert_type == "TASK_OVERDUE",
                            Alert.entity_id == task.id,
                            Alert.is_resolved == False,
                        )
                    )
                    if not existing.scalar_one_or_none():
                        alert = Alert(
                            alert_type="TASK_OVERDUE",
                            entity_type="Task",
                            entity_id=task.id,
                            message=f"Task (ID {task.id}) is overdue: {task.description[:80]}",
                            severity="warning",
                        )
                        db.add(alert)
                await db.commit()
                if overdue_tasks:
                    logger.info(f"Scheduler: flagged {len(overdue_tasks)} overdue tasks")
            except Exception as e:
                logger.error(f"Scheduler overdue task check failed: {e}")
                await db.rollback()

    @scheduler.scheduled_job("interval", hours=1, id="check_stalled_approvals")
    async def check_stalled_approvals():
        from datetime import timedelta
        async with session_factory() as db:
            try:
                from app.models.models import Roster, RosterStatus, Alert
                threshold = datetime.now(timezone.utc) - timedelta(hours=24)
                result = await db.execute(
                    select(Roster).where(
                        and_(
                            Roster.status == RosterStatus.SUBMITTED,
                            Roster.updated_at < threshold,
                        )
                    )
                )
                stalled = result.scalars().all()
                for roster in stalled:
                    existing = await db.execute(
                        select(Alert).where(
                            Alert.alert_type == "ROSTER_STALLED",
                            Alert.entity_id == roster.id,
                            Alert.is_resolved == False,
                        )
                    )
                    if not existing.scalar_one_or_none():
                        alert = Alert(
                            alert_type="ROSTER_STALLED",
                            entity_type="Roster",
                            entity_id=roster.id,
                            message=f"Roster {roster.roster_date} Shift {roster.shift_code.value} v{roster.version} has been awaiting approval for >24h",
                            severity="warning",
                        )
                        db.add(alert)
                await db.commit()
            except Exception as e:
                logger.error(f"Scheduler stalled approval check failed: {e}")
                await db.rollback()

    scheduler.start()
    logger.info("APScheduler started with jobs: overdue movements, overdue tasks, stalled approvals")
