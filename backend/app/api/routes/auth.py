"""
Authentication routes — login, logout, password change, saved drafts.
Implements: lockout, full audit trail of every attempt, server-side session
invalidation, forced change of shared default passwords.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import case, func, or_, select

from app.auth.jwt import verify_password, create_access_token, hash_password, decode_token, extract_jti
from app.auth.dependencies import get_current_user
from app.core.config import settings
from app.db.database import get_db
from app.models.models import Staff, User, UserSession
from app.services.audit import log_event, AuditAction

router = APIRouter(prefix="/auth", tags=["Authentication"])

# Shared default passwords issued at account provisioning (staff import, admin
# create/reset). Logging in with one of these forces a password change before
# any other action (guide §9.1 step 2).
KNOWN_DEFAULT_PASSWORDS = ("Password@PJ2024!",)


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    must_change_password: bool
    username: str
    sector_id: Optional[int] = None
    is_demo: bool = False
    session_timeout_minutes: int = 60


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class DraftIn(BaseModel):
    key: str
    payload: Optional[object] = None  # None clears the draft


def password_problem(password: str, username: str) -> Optional[str]:
    if len(password) < 10:
        return "Password must be at least 10 characters"
    if not any(c.isdigit() for c in password) or not any(c.isalpha() for c in password):
        return "Password must contain both letters and numbers"
    if username and username.lower() in password.lower():
        return "Password must not contain your username"
    return None


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    # Neutral error — do not reveal whether user exists
    auth_error = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    client_ip = request.client.host if request.client else None

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

    if not user:
        # Every attempt is audited, including unknown identifiers (guide §9.1 step 1).
        await log_event(db, actor=None, actor_username=identifier[:100] or "(blank)",
                        action=AuditAction.LOGIN_FAILED_UNKNOWN, entity_type="User", ip_address=client_ip)
        await db.commit()
        raise auth_error
    if not user.is_active:
        await log_event(db, actor=user, action=AuditAction.LOGIN_BLOCKED_INACTIVE, entity_type="User",
                        entity_id=user.id, ip_address=client_ip)
        await db.commit()
        raise auth_error

    # Lockout
    locked_until = _aware(user.locked_until)
    if locked_until and locked_until > datetime.now(timezone.utc):
        await log_event(db, actor=user, action=AuditAction.LOGIN_BLOCKED_LOCKED, entity_type="User",
                        entity_id=user.id, ip_address=client_ip)
        await db.commit()
        minutes = max(1, int((locked_until - datetime.now(timezone.utc)).total_seconds() // 60) + 1)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Account locked after repeated failed attempts. Try again in {minutes} minute(s).",
            headers={"X-Locked-Until": locked_until.isoformat(), "Retry-After": str(minutes * 60)},
        )

    if not verify_password(payload.password, user.hashed_password):
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        if user.failed_login_attempts >= settings.AUTH_MAX_FAILED_ATTEMPTS:
            user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=settings.AUTH_LOCKOUT_MINUTES)
            await log_event(db, actor=user, action=AuditAction.LOCKOUT, entity_type="User", entity_id=user.id,
                            ip_address=client_ip)
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(f"Account locked after {settings.AUTH_MAX_FAILED_ATTEMPTS} failed attempts. "
                        f"Try again in {settings.AUTH_LOCKOUT_MINUTES} minute(s)."),
                headers={"X-Locked-Until": user.locked_until.isoformat(),
                         "Retry-After": str(settings.AUTH_LOCKOUT_MINUTES * 60)},
            )
        await log_event(db, actor=user, action=AuditAction.LOGIN_FAILED, entity_type="User", entity_id=user.id,
                        ip_address=client_ip)
        await db.commit()
        # Same neutral message as an unknown username, so accounts cannot be enumerated.
        raise auth_error

    # Accounts still on a shared provisioning password must choose their own.
    if not user.is_demo and payload.password in KNOWN_DEFAULT_PASSWORDS:
        user.must_change_password = True

    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login = datetime.now(timezone.utc)
    user.last_activity = datetime.now(timezone.utc)

    token = create_access_token({"sub": str(user.id), "role": user.role.value})
    payload_decoded = decode_token(token)
    expires_at = datetime.fromtimestamp(payload_decoded["exp"], tz=timezone.utc)
    db.add(UserSession(user_id=user.id, token_jti=payload_decoded["jti"], expires_at=expires_at))

    await log_event(db, actor=user, action=AuditAction.LOGIN, entity_type="User", entity_id=user.id,
                    ip_address=client_ip)
    await db.commit()

    return LoginResponse(
        access_token=token,
        role=user.role.value,
        must_change_password=user.must_change_password,
        username=user.username,
        sector_id=user.sector_id,
        is_demo=user.is_demo,
        session_timeout_minutes=settings.AUTH_INACTIVITY_TIMEOUT_MINUTES,
    )


@router.post("/logout")
async def logout(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Invalidate the server-side session. Saved drafts are kept (see /auth/drafts)."""
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
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

    problem = password_problem(payload.new_password, current_user.username)
    if problem:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=problem)
    if payload.new_password in KNOWN_DEFAULT_PASSWORDS or payload.new_password == payload.current_password:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="Choose a new password that is different from the current or default password")

    current_user.hashed_password = hash_password(payload.new_password)
    current_user.must_change_password = False

    await log_event(db, actor=current_user, action=AuditAction.PASSWORD_CHANGED, entity_type="User",
                    entity_id=current_user.id, ip_address=request.client.host if request.client else None)
    await db.commit()
    return {"detail": "Password changed successfully"}


@router.get("/drafts/{key}")
async def get_draft(
    key: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the newest draft saved by this user under `key` in any session (drafts survive logout)."""
    result = await db.execute(
        select(UserSession).where(UserSession.user_id == current_user.id).order_by(UserSession.id.desc()).limit(50)
    )
    for session in result.scalars().all():
        drafts = session.draft_payload or {}
        if key in drafts:
            return {"key": key, "payload": drafts[key]}
    return {"key": key, "payload": None}


@router.put("/drafts")
async def save_draft(
    payload: DraftIn,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    jti = extract_jti(request.headers.get("Authorization", "").replace("Bearer ", "").strip())
    result = await db.execute(select(UserSession).where(UserSession.token_jti == jti))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=401, detail="Session not found")
    drafts = dict(session.draft_payload or {})
    # None is stored as an explicit "cleared" marker so older sessions' copies are not resurrected.
    drafts[payload.key] = payload.payload
    session.draft_payload = drafts
    await db.commit()
    return {"detail": "Draft saved", "key": payload.key}


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
        "session_timeout_minutes": settings.AUTH_INACTIVITY_TIMEOUT_MINUTES,
    }
