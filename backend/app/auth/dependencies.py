"""
FastAPI dependencies for authentication and RBAC.
All permission checks are enforced server-side — never only by hiding UI.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import decode_token
from app.core.config import settings
from app.db.database import get_db
from app.models.models import Staff, User, UserRoleEnum, UserSession

bearer_scheme = HTTPBearer()

# ── Role groups (provisional matrix — guide §3.2; reconcile with SOP §10) ────
STATION_ADMINS = (UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)
SUPERVISORS = (UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI, UserRoleEnum.SECTOR_SI)
OFFICERS = (UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI, UserRoleEnum.SECTOR_SI, UserRoleEnum.DI, UserRoleEnum.DSI)

# Endpoints reachable while a first-time password change is still pending.
PASSWORD_CHANGE_ALLOWED_PATHS = (
    "/api/auth/change-password",
    "/api/auth/me",
    "/api/auth/logout",
    "/api/mobile/me",
)


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = credentials.credentials
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
        jti: str = payload.get("jti")
        user_id: int = payload.get("sub")
        if not jti or not user_id:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # Check server-side session validity (invalidated on logout)
    result = await db.execute(
        select(UserSession).where(
            UserSession.token_jti == jti,
            UserSession.is_valid == True,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise credentials_exception

    result2 = await db.execute(select(User).where(User.id == int(user_id), User.is_active == True))
    user = result2.scalar_one_or_none()
    if not user:
        raise credentials_exception

    # Inactivity timeout — the session is invalidated server-side and audited.
    inactivity_limit = settings.AUTH_INACTIVITY_TIMEOUT_MINUTES
    if user.last_activity:
        last = user.last_activity if user.last_activity.tzinfo else user.last_activity.replace(tzinfo=timezone.utc)
        elapsed = (datetime.now(timezone.utc) - last).total_seconds() / 60
        if elapsed > inactivity_limit:
            session.is_valid = False
            session.invalidated_at = datetime.now(timezone.utc)
            from app.services.audit import AuditAction, log_event
            await log_event(db, actor=user, action=AuditAction.SESSION_EXPIRED, entity_type="User", entity_id=user.id)
            await db.commit()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired due to inactivity")

    # First-time / admin-reset password must be changed before any other action.
    if user.must_change_password and request.url.path.rstrip("/") not in PASSWORD_CHANGE_ALLOWED_PATHS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Password change required before continuing.",
            headers={"X-Password-Change-Required": "true"},
        )

    user.last_activity = datetime.now(timezone.utc)
    await db.commit()
    return user


def has_role(user: User, roles) -> bool:
    return user.role == UserRoleEnum.SUPER_ADMIN or user.role in roles


def require_roles(*roles: UserRoleEnum):
    """Dependency factory — returns 403 if user's role is not in allowed list."""
    async def check(current_user: User = Depends(get_current_user)) -> User:
        if not has_role(current_user, roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {[r.value for r in roles]}",
            )
        return current_user
    return check


def sector_scope(user: User) -> Optional[int]:
    """The sector a user is limited to, or None for station-wide roles. -1 means 'no sector assigned'."""
    if user.role == UserRoleEnum.SECTOR_SI:
        return user.sector_id if user.sector_id is not None else -1
    return None


async def ensure_staff_in_scope(db: AsyncSession, user: User, staff_id: Optional[int]) -> None:
    """403 when a Sector SI acts on staff outside their sector, or a STAFF user acts on someone else."""
    if staff_id is None:
        return
    if user.role == UserRoleEnum.STAFF:
        if user.staff_id != staff_id:
            raise HTTPException(status_code=403, detail="Staff can only act on their own records")
        return
    scope = sector_scope(user)
    if scope is None:
        return
    result = await db.execute(select(Staff.sector_id).where(Staff.id == staff_id))
    if result.scalar_one_or_none() != scope:
        raise HTTPException(status_code=403, detail="Sector SI can only act on staff in their own sector")


def can_view_contact(user: User, staff: Staff) -> bool:
    """Contact details are shown only where authorized (guide §12)."""
    if has_role(user, STATION_ADMINS):
        return True
    if user.staff_id is not None and user.staff_id == staff.id:
        return True
    if user.role == UserRoleEnum.SECTOR_SI and staff.sector_id is not None and staff.sector_id == user.sector_id:
        return True
    return False


def require_sector_scope(sector_id_param: str = "sector_id"):
    """
    Dependency for Sector SI — ensures they can only access their own sector
    when a sector id is supplied in the path or query string.
    """
    async def check(
        request: Request,
        current_user: User = Depends(get_current_user),
    ) -> User:
        if current_user.role == UserRoleEnum.SECTOR_SI:
            requested_sector = (
                request.path_params.get(sector_id_param)
                or request.query_params.get(sector_id_param)
            )
            if requested_sector and int(requested_sector) != current_user.sector_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Sector SI can only access their own sector.",
                )
        return current_user
    return check
