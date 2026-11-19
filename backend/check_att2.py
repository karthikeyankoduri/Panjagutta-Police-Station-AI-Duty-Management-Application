import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import text
import os

DATABASE_URL = os.environ["DATABASE_URL"]
engine = create_async_engine(DATABASE_URL, echo=False)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def check():
    async with SessionLocal() as db:
        # Find the audit events that created these attendance records
        r1 = await db.execute(text("""
            SELECT al.action, al.entity_type, al.created_at, al.actor_username, al.new_values
            FROM audit_log al
            WHERE al.entity_type = 'Attendance'
            ORDER BY al.created_at DESC
            LIMIT 10
        """))
        rows = r1.fetchall()
        print("=== Recent Attendance Audit Events ===")
        for r in rows:
            print(f"  action={r[0]} actor={r[3]} at={r[2]} vals={str(r[4])[:120]}")

        # What's the manual attendance POST endpoint?
        # Check if there are manually submitted records
        r2 = await db.execute(text("""
            SELECT COUNT(*) FROM attendance
            WHERE source IS NULL AND is_confirmed = true AND check_in_at IS NULL
        """))
        print(f"\nManually-confirmed records with no check_in: {r2.scalar()}")

        # Total attendance records
        r3 = await db.execute(text("SELECT COUNT(*) FROM attendance"))
        print(f"Total attendance records: {r3.scalar()}")

        # Check if there's a manual submission endpoint that was called
        r4 = await db.execute(text("""
            SELECT a.attendance_date, a.shift_code, COUNT(*) as cnt
            FROM attendance a
            WHERE a.source IS NULL
            GROUP BY a.attendance_date, a.shift_code
            ORDER BY a.attendance_date DESC
            LIMIT 10
        """))
        print(f"\nManual attendance by date/shift:")
        for r in r4.fetchall():
            print(f"  {r[0]} shift={r[1]} count={r[2]}")

asyncio.run(check())

