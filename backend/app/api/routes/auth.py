"""
Authentication routes — login, logout, password change.
Implements: lockout, audit trail, server-side session invalidation.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import case, func, or_, select

from app.auth.jwt import verify_password, create_access_token, hash_password
from app.auth.dependencies import get_current_user
from app.core.config import settings
from app.db.database import get_db
from app.models.models import Staff, User, UserSession
from app.services.audit import log_event, AuditAction

router = APIRouter(prefix="/auth", tags=["Authentication"])


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    must_change_password: bool
    username: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    # Neutral error — do not reveal whether user exists
    auth_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
    )

    identifier = (payload.username or "").strip()
    identifier_lower = identifier.lower()
    identifier_hyphen = identifier_lower.replace("_", "-")
    identifier_underscore = identifier_lower.replace("-", "_")

    # Match User by username, alternate hyphen/underscore, email,
    # or via linked Staff profile (service_number, phone, or proforma notes e.g. Emp ID / Gen No)
    user_query = (
        select(User)
        .outerjoin(Staff, User.staff_id == Staff.id)
        .where(
            or_(
                func.lower(User.username) == identifier_lower,
                func.lower(User.username) == identifier_underscore,
                func.lower(User.username) == identifier_hyphen,
                func.lower(User.email) == identifier_lower,
                func.lower(Staff.service_number) == identifier_lower,
                func.lower(Staff.service_number) == identifier_hyphen,
                func.lower(Staff.service_number) == identifier_underscore,
                Staff.contact_phone == identifier,
                Staff.notes.ilike(f"%Emp ID: {identifier}%"),
                Staff.notes.ilike(f"%Gen No: {identifier}%"),
                Staff.notes.ilike(f"%Dept No: {identifier}%"),
            )
        )
        .order_by(
            case(
                (func.lower(User.username) == identifier_lower, 1),
                (func.lower(User.username) == identifier_underscore, 2),
                (func.lower(Staff.service_number) == identifier_hyphen, 3),
                (func.lower(Staff.service_number) == identifier_lower, 4),
                (func.lower(User.email) == identifier_lower, 5),
                else_=6,
            )
        )
    )
    result = await db.execute(user_query)
    user: Optional[User] = result.scalars().first()

    if not user or not user.is_active:
        raise auth_error

    # Check lockout
    if user.locked_until and user.locked_until > datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Account locked. Try again after {user.locked_until.isoformat()}",
        )

    if not verify_password(payload.password, user.hashed_password):
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= settings.AUTH_MAX_FAILED_ATTEMPTS:
            user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=settings.AUTH_LOCKOUT_MINUTES)
            await log_event(db, actor=user, action=AuditAction.LOCKOUT, entity_type="User", entity_id=user.id,
                            ip_address=request.client.host if request.client else None)
        else:
            await log_event(db, actor=user, action=AuditAction.LOGIN_FAILED, entity_type="User", entity_id=user.id,
                            ip_address=request.client.host if request.client else None)
        await db.commit()
        raise auth_error

    # Successful login
    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login = datetime.now(timezone.utc)
    user.last_activity = datetime.now(timezone.utc)

    token = create_access_token({"sub": str(user.id), "role": user.role.value})

    # Decode JTI from token to store session
    from app.auth.jwt import decode_token
    payload_decoded = decode_token(token)
    jti = payload_decoded["jti"]
    expires_at = datetime.fromtimestamp(payload_decoded["exp"], tz=timezone.utc)

    session = UserSession(user_id=user.id, token_jti=jti, expires_at=expires_at)
    db.add(session)

    await log_event(db, actor=user, action=AuditAction.LOGIN, entity_type="User", entity_id=user.id,
                    ip_address=request.client.host if request.client else None)
    await db.commit()

    return LoginResponse(
        access_token=token,
        role=user.role.value,
        must_change_password=user.must_change_password,
        username=user.username,
    )


@router.post("/logout")
async def logout(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Invalidate server-side session. Drafts are preserved in session.draft_payload."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "").strip()

    from app.auth.jwt import extract_jti
    jti = extract_jti(token)
    if jti:
        result = await db.execute(select(UserSession).where(UserSession.token_jti == jti))
        session = result.scalar_one_or_none()
        if session:
            session.is_valid = False
            session.invalidated_at = datetime.now(timezone.utc)

    await log_event(db, actor=current_user, action=AuditAction.LOGOUT, entity_type="User", entity_id=current_user.id,
                    ip_address=request.client.host if request.client else None)
    await db.commit()
    return {"detail": "Logged out successfully"}


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    if len(payload.new_password) < 8:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Password must be at least 8 characters")

    current_user.hashed_password = hash_password(payload.new_password)
    current_user.must_change_password = False

    await log_event(db, actor=current_user, action=AuditAction.PASSWORD_CHANGED, entity_type="User",
                    entity_id=current_user.id)
    await db.commit()
    return {"detail": "Password changed successfully"}


@router.get("/me")
async def get_me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    staff_name = None
    service_number = None
    if current_user.staff_id:
        st_res = await db.execute(select(Staff).where(Staff.id == current_user.staff_id))
        st = st_res.scalar_one_or_none()
        if st:
            staff_name = st.name
            service_number = st.service_number

    return {
        "id": current_user.id,
        "username": current_user.username,
        "role": current_user.role.value,
        "sector_id": current_user.sector_id,
        "is_demo": current_user.is_demo,
        "must_change_password": current_user.must_change_password,
        "staff_id": current_user.staff_id,
        "staff_name": staff_name,
        "service_number": service_number,
    }
