import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import text
import os

DATABASE_URL = os.environ["DATABASE_URL"]
engine = create_async_engine(DATABASE_URL, echo=False)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def check():
    async with SessionLocal() as db:
        r1 = await db.execute(text("SELECT COUNT(*) FROM attendance WHERE attendance_date = CURRENT_DATE"))
        total = r1.scalar()

        r2 = await db.execute(text("SELECT COUNT(*) FROM attendance WHERE attendance_date = CURRENT_DATE AND check_in_at IS NULL"))
        no_checkin = r2.scalar()

        r3 = await db.execute(text("SELECT source, COUNT(*) FROM attendance GROUP BY source"))
        sources = r3.fetchall()

        r4 = await db.execute(text("SELECT submitted_by_id, COUNT(*) FROM attendance WHERE attendance_date = CURRENT_DATE GROUP BY submitted_by_id"))
        submitters = r4.fetchall()

        r5 = await db.execute(text(
            "SELECT a.attendance_date, a.is_confirmed, a.check_in_at, a.source, u.username "
            "FROM attendance a LEFT JOIN users u ON u.id = a.submitted_by_id "
            "WHERE a.attendance_date = CURRENT_DATE LIMIT 5"
        ))
        sample = r5.fetchall()

        print("Total today:", total)
        print("No check_in_at (no actual login):", no_checkin)
        print("Source breakdown (all time):", sources)
        print("Submitted_by for today's records:", submitters)
        print("Sample rows:", sample)

asyncio.run(check())

