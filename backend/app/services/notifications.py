"""
Notification routing (Build Guide §9.1 steps 3 and 5, §9.5 step 2, phase 5).

Requests are routed to the designated approver role(s); decisions and published
rosters are routed back to the individual staff member's login. Notifications
are read by the web app and polled by the Android app.
"""
from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Notification, Staff, User, UserRoleEnum

# Provisional routing (guide §14 item 4 — to be confirmed by the SHO).
LEAVE_APPROVER_ROLES = (UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)
MOVEMENT_APPROVER_ROLES = (UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI, UserRoleEnum.SECTOR_SI)


async def notify_roles(
    db: AsyncSession,
    roles: Iterable[UserRoleEnum],
    title: str,
    message: str,
    *,
    category: str = "info",
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    sector_id: Optional[int] = None,
) -> None:
    for role in roles:
        db.add(Notification(
            role=role.value, sector_id=sector_id if role == UserRoleEnum.SECTOR_SI else None,
            title=title, message=message, category=category,
            entity_type=entity_type, entity_id=entity_id, read_by=[],
        ))


async def notify_user(
    db: AsyncSession,
    user_id: Optional[int],
    title: str,
    message: str,
    *,
    category: str = "info",
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
) -> None:
    if not user_id:
        return
    db.add(Notification(
        user_id=user_id, title=title, message=message, category=category,
        entity_type=entity_type, entity_id=entity_id,
    ))


async def notify_staff(db: AsyncSession, staff_id: int, title: str, message: str, **kwargs) -> None:
    """Notify the login linked to a staff profile (no-op when the person has no login)."""
    result = await db.execute(select(User.id).where(User.staff_id == staff_id, User.is_active == True))
    for user_id in result.scalars().all():
        await notify_user(db, user_id, title, message, **kwargs)


async def staff_sector(db: AsyncSession, staff_id: int) -> Optional[int]:
    result = await db.execute(select(Staff.sector_id).where(Staff.id == staff_id))
    return result.scalar_one_or_none()


def visible_to(user: User):
    """SQL filter: notifications addressed to this user, or to this user's role (sector-scoped for Sector SI)."""
    role_clause = Notification.role == user.role.value
    if user.role == UserRoleEnum.SECTOR_SI:
        role_clause = role_clause & or_(Notification.sector_id == None, Notification.sector_id == user.sector_id)
    return or_(Notification.user_id == user.id, role_clause)


def is_read_by(n: Notification, user: User) -> bool:
    if n.user_id is not None:
        return bool(n.is_read)
    return user.id in (n.read_by or [])
