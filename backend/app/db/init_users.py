import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.models import User, UserRoleEnum
from app.auth.jwt import hash_password

logger = logging.getLogger(__name__)

DEMO_USERS = [
    {
        "username": "admin_si_demo",
        "email": "admin_si_demo@panjaguttaps.gov.in",
        "password": "Demo@AdminSI#2024!",
        "role": UserRoleEnum.ADMIN_SI,
    },
    {
        "username": "sho_panjagutta",
        "email": "sho@panjaguttaps.gov.in",
        "password": "Password@PJ2024!",
        "role": UserRoleEnum.SHO,
    },
    {
        "username": "sho_demo",
        "email": "sho_demo@panjaguttaps.gov.in",
        "password": "Demo@SHO#2024!",
        "role": UserRoleEnum.SHO,
    },
    {
        "username": "sector1_si_demo",
        "email": "sector1_si@panjaguttaps.gov.in",
        "password": "Demo@Sec1SI#2024!",
        "role": UserRoleEnum.SECTOR_SI,
        "sector_id": 1,
    },
    {
        "username": "di_demo",
        "email": "di_demo@panjaguttaps.gov.in",
        "password": "Demo@DI#2024!",
        "role": UserRoleEnum.DI,
    },
    {
        "username": "dsi_demo",
        "email": "dsi_demo@panjaguttaps.gov.in",
        "password": "Demo@DSI#2024!",
        "role": UserRoleEnum.DSI,
    },
    {
        "username": "staff_demo",
        "email": "staff_demo@panjaguttaps.gov.in",
        "password": "Demo@Staff#2024!",
        "role": UserRoleEnum.STAFF,
    },
]


async def ensure_demo_users(db: AsyncSession):
    """
    Ensures that essential demo role accounts exist and are active.
    This guarantees that wiping demo data or running tests never disables admin or role accounts.
    """
    for u_data in DEMO_USERS:
        result = await db.execute(select(User).where(User.username == u_data["username"]))
        existing = result.scalar_one_or_none()
        if not existing:
            u = User(
                username=u_data["username"],
                email=u_data["email"],
                hashed_password=hash_password(u_data["password"]),
                role=u_data["role"],
                sector_id=u_data.get("sector_id"),
                is_active=True,
                is_demo=True,
                must_change_password=False,
            )
            db.add(u)
            logger.info("Initialized system account: %s", u_data["username"])
        else:
            if not existing.is_active or existing.locked_until is not None:
                existing.is_active = True
                existing.locked_until = None
                existing.failed_login_attempts = 0
    await db.commit()

