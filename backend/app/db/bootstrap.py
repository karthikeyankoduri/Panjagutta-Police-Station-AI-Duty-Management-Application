"""
Database bootstrap — makes a fresh deployment start with one command.

`ensure_schema()` creates any missing tables (Alembic remains the tool for
changing existing tables; see migrations/). `ensure_config()` loads the
configuration from Build Guide §4 when the tables are empty: five sectors,
shifts A/B/C, duty requirements, an UNCONFIRMED rotation rule, sections and the
status/state lists. Existing rows are never overwritten.
"""
from __future__ import annotations

import logging
from datetime import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    ConfigListItem, DutyMaster, LeaveStatus, PolicyStatus, RotationRule, Section, Sector,
    ShiftCode, ShiftConfig, StaffCategory, StaffDesignation, StaffStatus, TaskStatus,
)

logger = logging.getLogger(__name__)

SHIFTS = [
    (ShiftCode.A, time(8, 0), time(14, 0), 6.0, False),
    (ShiftCode.B, time(14, 0), time(20, 0), 6.0, False),
    (ShiftCode.C, time(20, 0), time(8, 0), 12.0, True),
]

DUTIES = [
    dict(category="Summons", section="Court", required_strength=2, eligible_designations=["PC", "WPC"]),
    dict(category="Warrants", section="Court", required_strength=2, eligible_designations=["PC", "WPC"]),
    dict(category="Sessions Court", section="Court", required_strength=2, eligible_designations=["ASI", "AWSI", "HC", "WHC"]),
    dict(category="JFCM Staff", section="Court", required_strength=2, eligible_designations=["PC", "WPC"]),
    dict(category="Reception", section="Reception", required_strength=2),
    dict(category="eCOPS", section="Station Office", required_strength=2),
    dict(category="CCTNS", section="Station Office", required_strength=1),
    dict(category="Section In-charges", section="Station Office", required_strength=3),
    *[dict(category="Patrol Vehicles", section="Patrol", shift_code=s, required_strength=3) for s in ShiftCode],
    *[dict(category="Beat Constables", section="Beat", shift_code=s, required_strength=4,
           eligible_designations=["PC", "WPC", "ARPC", "ARWPC"]) for s in ShiftCode],
    dict(category="SHO Driver", section="Drivers"),
    dict(category="DI Driver", section="Drivers"),
    dict(category="Pilot Driver", section="Drivers"),
    dict(category="Station Writer", section="Station Office"),
]

# Dashboard KPI cards an administrator can show or hide (code = card key used by the dashboard API).
DASHBOARD_CARDS = [
    ("total_staff", "Total Staff"), ("scheduled_current_shift", "Scheduled"), ("present", "Present"),
    ("on_duty", "On Duty"), ("available", "Available"), ("field_duty", "Field Duty"),
    ("court_duty", "Court Duty"), ("patrol_beat", "Patrol / Beat"), ("on_leave", "On Leave"),
    ("duty_off_rest", "Duty Off / Rest"), ("attached_other_wing", "Attached"),
    ("official_movement", "Official Movement"), ("absent", "Absent"), ("vacant_positions", "Vacant Positions"),
]

SECTIONS = ["Court", "Reception", "Station Office", "Patrol", "Beat", "Drivers", "Sector", "Attached"]

LEAVE_TYPES = [
    ("CL", "Casual Leave"), ("EL", "Earned Leave"), ("ML", "Medical Leave"),
    ("DUTY_OFF", "Duty Off"), ("REST_DAY", "Rest day"), ("SPECIAL", "Special Leave"),
]


async def ensure_schema(engine) -> None:
    from app.db.database import Base
    from app.models import models  # noqa: F401  (register all tables)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def ensure_config(db: AsyncSession) -> None:
    if not (await db.execute(select(Sector.id).limit(1))).first():
        for i in range(1, 6):
            db.add(Sector(name=f"Sector {i}", code=f"SEC{i}", description=f"Panjagutta PS Sector {i}"))
        logger.info("Bootstrap: created sectors 1-5")

    if not (await db.execute(select(ShiftConfig.id).limit(1))).first():
        for code, start, end, hours, crosses in SHIFTS:
            db.add(ShiftConfig(shift_code=code, start_time=start, end_time=end, duration_hours=hours,
                               crosses_midnight=crosses))
        logger.info("Bootstrap: created shift configuration A/B/C")

    if not (await db.execute(select(DutyMaster.id).limit(1))).first():
        for d in DUTIES:
            db.add(DutyMaster(**d, is_configured=bool(d.get("required_strength"))))
        logger.info("Bootstrap: created duty master")

    if not (await db.execute(select(RotationRule.id).limit(1))).first():
        db.add(RotationRule(
            version=1, policy_status=PolicyStatus.UNCONFIRMED,
            notes=("POLICY UNCONFIRMED — rotation sequence, rest hours and approvers must be confirmed by the SHO "
                   "(Build Guide §14). Roster drafting is blocked until confirmed or demo-simulated."),
        ))

    if not (await db.execute(select(Section.id).limit(1))).first():
        for name in SECTIONS:
            db.add(Section(name=name))

    existing = {(i.list_name, i.code) for i in (await db.execute(select(ConfigListItem))).scalars().all()}

    def item(list_name, code, label, order):
        if (list_name, code) not in existing:
            db.add(ConfigListItem(list_name=list_name, code=code, label=label, sort_order=order))

    for n, s in enumerate(StaffStatus):
        item("staff_status", s.value, s.value, n)
    for n, s in enumerate(LeaveStatus):
        item("leave_status", s.value, s.value, n)
    for n, s in enumerate(TaskStatus):
        item("task_status", s.value, s.value, n)
    for n, (code, label) in enumerate(LEAVE_TYPES):
        item("leave_type", code, label, n)
    for n, d in enumerate(StaffDesignation):
        item("designation", d.value, d.value, n)
    for n, c in enumerate(StaffCategory):
        item("staff_category", c.value, c.value.replace("_", " ").title(), n)
    # All cards start shown so nothing disappears on upgrade until an administrator hides it.
    for n, (code, label) in enumerate(DASHBOARD_CARDS):
        item("dashboard_card", code, label, n)

    await db.commit()


async def bootstrap(engine, session_factory) -> None:
    await ensure_schema(engine)
    async with session_factory() as db:
        await ensure_config(db)
