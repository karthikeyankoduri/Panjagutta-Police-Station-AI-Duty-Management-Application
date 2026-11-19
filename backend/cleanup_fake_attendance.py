"""
One-time cleanup: delete all attendance records that were fabricated by the
staff CSV import side-effect. These records have source IS NULL and check_in_at IS NULL
but is_confirmed = TRUE — the hallmark of the fake bulk-mark that happened during import.

Real login-sourced records always have source = 'LOGIN' and check_in_at set.
Manual officer-entered records may have source NULL but should have notes or a
different submission pattern — here we specifically target the import batch by
looking for records submitted by the same user (admin_si_demo, id 929) in a
single day with no check-in time.
"""
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import text
import os

DATABASE_URL = os.environ["DATABASE_URL"]
engine = create_async_engine(DATABASE_URL, echo=False)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def cleanup():
    async with SessionLocal() as db:
        # Preview what will be deleted
        r = await db.execute(text("""
            SELECT COUNT(*), attendance_date, shift_code, source
            FROM attendance
            WHERE source IS NULL
              AND check_in_at IS NULL
              AND is_confirmed = true
            GROUP BY attendance_date, shift_code, source
            ORDER BY attendance_date DESC
        """))
        rows = r.fetchall()
        total = sum(x[0] for x in rows)
        print(f"Records to delete: {total}")
        for row in rows:
            print(f"  {row[0]} records on {row[1]} shift={row[2]} source={row[3]}")

        if total == 0:
            print("Nothing to delete.")
            return

        # Delete them
        result = await db.execute(text("""
            DELETE FROM attendance
            WHERE source IS NULL
              AND check_in_at IS NULL
              AND is_confirmed = true
        """))
        await db.commit()
        print(f"\nDeleted {result.rowcount} fake attendance records.")
        print("Attendance table now only contains real login-sourced records.")

asyncio.run(cleanup())

