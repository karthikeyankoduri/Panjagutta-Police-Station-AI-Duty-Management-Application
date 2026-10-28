"""
Demo seed script — FABRICATED DATA ONLY.
⚠ DEMO DATA — Not for operational use. All names, service numbers and IDs are fictional.

Run:  python -m app.db.seed
Reset: python -m app.db.seed --reset
"""
from __future__ import annotations

import asyncio
import sys
from datetime import date, datetime, timezone, time

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.core.config import settings
from app.auth.jwt import hash_password
from app.models.models import (
    User, UserRoleEnum, Staff, StaffDesignation, StaffCategory,
    Sector, ShiftConfig, ShiftCode, DutyMaster, RotationRule, PolicyStatus,
)

engine = create_async_engine(settings.DATABASE_URL, echo=False)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def seed(reset: bool = False):
    from app.db.database import engine, Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        if reset:
            print("[RESET] Resetting demo data...")
            from sqlalchemy import text
            for table in [
                "audit_log", "alerts", "attachment_orders", "movements",
                "leave_requests", "tasks", "attendance", "roster_assignments",
                "rosters", "user_sessions", "users", "staff",
                "duty_master", "shift_config", "rotation_rules", "sectors",
            ]:
                try:
                    await db.execute(text(f'TRUNCATE TABLE "{table}" RESTART IDENTITY CASCADE'))
                except Exception:
                    await db.execute(text(f'DELETE FROM "{table}"'))
            await db.commit()

        # ── Sectors ──────────────────────────────────────────────────────────
        sectors = []
        for i in range(1, 6):
            s = Sector(name=f"Sector {i}", code=f"SEC{i}", description=f"Panjagutta PS Sector {i}")
            db.add(s)
            sectors.append(s)
        await db.flush()

        # ── Shift Configuration (PDF page 4) ─────────────────────────────────
        shifts = [
            ShiftConfig(shift_code=ShiftCode.A, start_time=time(8, 0), end_time=time(14, 0), duration_hours=6.0),
            ShiftConfig(shift_code=ShiftCode.B, start_time=time(14, 0), end_time=time(20, 0), duration_hours=6.0),
            ShiftConfig(shift_code=ShiftCode.C, start_time=time(20, 0), end_time=time(8, 0), duration_hours=12.0, crosses_midnight=True),
        ]
        for s in shifts:
            db.add(s)

        # ── Duty Master (PDF pages 4-5) ───────────────────────────────────────
        duties = [
            DutyMaster(category="Summons", section="Court", required_strength=2,
                       eligible_designations=["PC", "WPC"], is_configured=True),
            DutyMaster(category="Warrants", section="Court", required_strength=2,
                       eligible_designations=["PC", "WPC"], is_configured=True),
            DutyMaster(category="Sessions Court", section="Court", required_strength=2,
                       eligible_designations=["ASI", "AWSI", "HC", "WHC"], is_configured=True),
            DutyMaster(category="JFCM Staff", section="Court", required_strength=2,
                       eligible_designations=["PC", "WPC"], is_configured=True),
            DutyMaster(category="Reception", required_strength=2, is_configured=True),
            DutyMaster(category="eCOPS", required_strength=2, is_configured=True),
            DutyMaster(category="CCTNS", required_strength=1, is_configured=True),
            DutyMaster(category="Section In-charges", required_strength=3, is_configured=True),
            DutyMaster(category="Patrol Vehicles", shift_code=ShiftCode.A, required_strength=3, is_configured=True),
            DutyMaster(category="Patrol Vehicles", shift_code=ShiftCode.B, required_strength=3, is_configured=True),
            DutyMaster(category="Patrol Vehicles", shift_code=ShiftCode.C, required_strength=3, is_configured=True),
            DutyMaster(category="Beat Constables", shift_code=ShiftCode.A, required_strength=4,
                       eligible_designations=["PC", "WPC", "ARPC", "ARWPC"], is_configured=True),
            DutyMaster(category="Beat Constables", shift_code=ShiftCode.B, required_strength=4,
                       eligible_designations=["PC", "WPC", "ARPC", "ARWPC"], is_configured=True),
            DutyMaster(category="Beat Constables", shift_code=ShiftCode.C, required_strength=4,
                       eligible_designations=["PC", "WPC", "ARPC", "ARWPC"], is_configured=True),
            # Not-configured categories
            DutyMaster(category="SHO Driver", section="Drivers", is_configured=False),
            DutyMaster(category="DI Driver", section="Drivers", is_configured=False),
            DutyMaster(category="Pilot Driver", section="Drivers", is_configured=False),
            DutyMaster(category="Station Writer", is_configured=False),
        ]
        for d in duties:
            db.add(d)

        # ── Rotation Rule — UNCONFIRMED ───────────────────────────────────────
        rotation = RotationRule(
            version=1,
            rotation_sequence=None,  # Unconfirmed — do not invent
            min_rest_hours_after_shift=None,
            policy_status=PolicyStatus.UNCONFIRMED,
            notes=(
                "⚠ POLICY UNCONFIRMED — Rotation sequence and mandatory rest hours must be confirmed by the SHO. "
                "Roster publishing is blocked until demo-simulated or formally confirmed. "
                "See docs/policy-confirmation.md for full list of open decisions."
            ),
        )
        db.add(rotation)
        await db.flush()

        # ── Demo Staff — FABRICATED ───────────────────────────────────────────
        demo_staff_data = [
            ("SHO001", "Ramesh Kumar Sharma", StaffDesignation.INSPECTOR, StaffCategory.SECTION_DUTY, None),
            ("ADSI001", "Venkatesh Reddy", StaffDesignation.ASI, StaffCategory.SECTION_DUTY, None),
            ("SEC1SI001", "Priya Devi", StaffDesignation.ASI, StaffCategory.SECTOR_STAFF, 1),
            ("SEC2SI001", "Anil Kumar", StaffDesignation.ASI, StaffCategory.SECTOR_STAFF, 2),
            ("SEC3SI001", "Sunita Rao", StaffDesignation.ASI, StaffCategory.SECTOR_STAFF, 3),
            ("SEC4SI001", "Mohammed Irfan", StaffDesignation.HC, StaffCategory.SECTOR_STAFF, 4),
            ("SEC5SI001", "Lakshmi Narayana", StaffDesignation.HC, StaffCategory.SECTOR_STAFF, 5),
            ("PC001", "Rajesh Babu", StaffDesignation.PC, StaffCategory.SECTOR_STAFF, 1),
            ("PC002", "Srinivas Murthy", StaffDesignation.PC, StaffCategory.SECTOR_STAFF, 1),
            ("PC003", "Deepa Kumari", StaffDesignation.WPC, StaffCategory.SECTOR_STAFF, 2),
            ("PC004", "Suresh Goud", StaffDesignation.PC, StaffCategory.SECTOR_STAFF, 2),
            ("PC005", "Anitha Begum", StaffDesignation.WPC, StaffCategory.SECTOR_STAFF, 3),
            ("PC006", "Ravi Shankar", StaffDesignation.PC, StaffCategory.SECTOR_STAFF, 3),
            ("PC007", "Kavitha Devi", StaffDesignation.WPC, StaffCategory.SECTOR_STAFF, 4),
            ("PC008", "Nagaraju Yadav", StaffDesignation.PC, StaffCategory.SECTOR_STAFF, 4),
            ("PC009", "Vasantha Kumar", StaffDesignation.PC, StaffCategory.SECTOR_STAFF, 5),
            ("PC010", "Rekha Shankar", StaffDesignation.WPC, StaffCategory.SECTOR_STAFF, 5),
            ("HC001", "Balakrishna Reddy", StaffDesignation.HC, StaffCategory.SECTION_DUTY, None),
            ("ASI002", "Nagamma Devi", StaffDesignation.AWSI, StaffCategory.SECTION_DUTY, None),
            ("DRV001", "Syed Hussain", StaffDesignation.PC, StaffCategory.DRIVER, None),
        ]

        staff_objs = []
        for svc, name, desig, cat, sector_idx in demo_staff_data:
            s = Staff(
                service_number=svc, name=name, designation=desig, category=cat,
                sector_id=sectors[sector_idx - 1].id if sector_idx else None,
                is_demo=True, date_of_joining=date(2015, 1, 1),
            )
            db.add(s)
            staff_objs.append(s)
        await db.flush()

        # ── Demo Users ────────────────────────────────────────────────────────
        # ⚠ Demo passwords are not production-safe. Change before any real deployment.
        demo_users = [
            ("sho_demo", "Demo@SHO#2024!", UserRoleEnum.SHO, None, staff_objs[0].id),
            ("admin_si_demo", "Demo@AdminSI#2024!", UserRoleEnum.ADMIN_SI, None, staff_objs[1].id),
            ("sector1_si_demo", "Demo@Sec1SI#2024!", UserRoleEnum.SECTOR_SI, sectors[0].id, staff_objs[2].id),
            ("sector2_si_demo", "Demo@Sec2SI#2024!", UserRoleEnum.SECTOR_SI, sectors[1].id, staff_objs[3].id),
            ("di_demo", "Demo@DI#2024!", UserRoleEnum.DI, None, None),
            ("dsi_demo", "Demo@DSI#2024!", UserRoleEnum.DSI, None, None),
            ("staff_demo", "Demo@Staff#2024!", UserRoleEnum.STAFF, None, staff_objs[7].id),
        ]

        for username, pwd, role, sector, staff_id in demo_users:
            sec_id = sector if isinstance(sector, int) else (sector.id if sector else None)
            u = User(
                username=username,
                hashed_password=hash_password(pwd),
                role=role,
                sector_id=sec_id,
                staff_id=staff_id,
                must_change_password=False,
                is_demo=True,
                is_active=True,
            )
            db.add(u)

        await db.commit()
        print("[SUCCESS] Demo seed complete. All data is FABRICATED for demonstration only.")
        print("\n[DEMO ACCOUNTS]")
        print("  Username         | Role       | Password")
        print("  -----------------------------------------------------")
        for username, pwd, role, *_ in demo_users:
            print(f"  {username:<16} | {role.value:<10} | {pwd}")
        print("\n[WARNING] These accounts are NOT production-safe. Disable SEED_DEMO_DATA in .env before deployment.")


if __name__ == "__main__":
    reset = "--reset" in sys.argv
    asyncio.run(seed(reset=reset))
