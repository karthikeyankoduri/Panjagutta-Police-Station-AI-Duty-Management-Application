"""
FastAPI dependencies for authentication and RBAC.
All permission checks enforced server-side — not just UI hiding.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, List

from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.auth.jwt import decode_token
from app.core.config import settings
from app.db.database import get_db
from app.models.models import User, UserSession, UserRoleEnum

bearer_scheme = HTTPBearer()


async def get_current_user(
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

    # Check inactivity timeout
    inactivity_limit = settings.AUTH_INACTIVITY_TIMEOUT_MINUTES
    if user.last_activity:
        elapsed = (datetime.now(timezone.utc) - user.last_activity).total_seconds() / 60
        if elapsed > inactivity_limit:
            session.is_valid = False
            await db.commit()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired due to inactivity")

    # Update last activity
    user.last_activity = datetime.now(timezone.utc)
    await db.commit()

    return user


def require_roles(*roles: UserRoleEnum):
    """Dependency factory — returns 403 if user's role is not in allowed list."""
    async def check(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {[r.value for r in roles]}",
            )
        return current_user
    return check


def require_sector_scope(sector_id_param: str = "sector_id"):
    """
    Dependency for Sector SI — ensures they can only access their own sector.
    SHO/Admin SI/DI/DSI bypass this check.
    """
    async def check(
        request: Request,
        current_user: User = Depends(get_current_user),
    ) -> User:
        if current_user.role in (UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI, UserRoleEnum.DI, UserRoleEnum.DSI):
            return current_user
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
