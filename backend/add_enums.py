import asyncio
from app.db.database import AsyncSessionLocal
from sqlalchemy import text

async def main():
    async with AsyncSessionLocal() as session:
        for val in ['SI', 'WSI']:
            try:
                await session.execute(text(f"ALTER TYPE staffdesignation ADD VALUE IF NOT EXISTS '{val}'"))
                await session.commit()
                print(f"Added {val} to staffdesignation")
            except Exception as e:
                await session.rollback()
                print(f"Could not add {val}: {e}")

if __name__ == '__main__':
    asyncio.run(main())
