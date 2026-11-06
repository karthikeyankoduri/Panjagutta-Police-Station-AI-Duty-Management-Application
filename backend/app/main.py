"""
FastAPI main application — registers all routers, lifespan, middleware.
"""
from __future__ import annotations

import logging
import uuid
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.db.database import AsyncSessionLocal, engine
from app.api.routes.auth import router as auth_router
from app.api.routes.staff import router as staff_router
from app.api.routes.dashboard import router as dashboard_router
from app.api.routes.roster import router as roster_router
from app.api.routes.operations import (
    leave_router, movement_router, attendance_router, task_router
)
from app.api.routes.attachments import router as attachments_router
from app.api.routes.duties import router as duties_router
from app.api.routes.policy import router as policy_router
from app.api.routes.reports import router as reports_router
from app.api.routes.audit import router as audit_router
from app.api.routes.ai import router as ai_router
from app.api.routes.mobile import router as mobile_router
from app.api.routes.config import router as config_router
from app.api.routes.notifications import router as notifications_router
from app.api.routes.duty_changes import change_request_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def check_production_settings() -> None:
    """Refuse to run in production with placeholder secrets or demo accounts enabled."""
    if settings.APP_ENV.lower() != "production":
        return
    problems = []
    secret = settings.JWT_SECRET_KEY
    if len(secret) < 32 or any(m in secret.lower() for m in ("change", "replace", "secret_key_here", "demo")):
        problems.append("JWT_SECRET_KEY is missing, too short or a placeholder")
    if settings.SEED_DEMO_DATA:
        problems.append("SEED_DEMO_DATA must be false")
    if settings.APP_DEBUG:
        problems.append("APP_DEBUG must be false")
    if "sqlite" in settings.DATABASE_URL:
        problems.append("DATABASE_URL must point to PostgreSQL")
    if problems:
        raise RuntimeError("Unsafe production configuration: " + "; ".join(problems))


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Panjagutta Duty Management API...")
    check_production_settings()
    from app.db.bootstrap import bootstrap
    await bootstrap(engine, AsyncSessionLocal)
    from app.services.scheduler import start_scheduler
    start_scheduler(AsyncSessionLocal)
    if settings.SEED_DEMO_DATA and settings.APP_ENV.lower() != "production":
        from app.db.init_users import ensure_demo_users
        try:
            async with AsyncSessionLocal() as session:
                await ensure_demo_users(session)
        except Exception as e:
            logger.warning("Could not auto-ensure demo users: %s", e)
    yield
    from app.services.scheduler import scheduler
    if scheduler.running:
        scheduler.shutdown()
    logger.info("API shutdown complete")


app = FastAPI(
    title="Panjagutta Police Station — AI Duty Management API",
    description=(
        "Centralized duty management for Panjagutta Police Station. "
        "Requires department security review before operational use."
    ),
    version="0.2.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# CORS — allow localhost and all private LAN subnets (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
LAN_ORIGIN = r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:[0-9]+)?$"
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=LAN_ORIGIN,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Request-ID", "X-Password-Change-Required", "X-Locked-Until"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # Never return internal error text to clients; the request id ties the log entry to the report.
    request_id = getattr(request.state, "request_id", None)
    logger.exception("Unhandled server exception (request %s): %s", request_id, exc)
    if isinstance(exc, PermissionError):
        return JSONResponse(status_code=403, content={"detail": str(exc), "request_id": request_id})
    import re
    origin = request.headers.get("origin")
    headers = {}
    if origin and (origin in settings.cors_origins_list or re.match(LAN_ORIGIN, origin)):
        headers = {"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true"}
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal server error occurred. Quote the request id to IT support.",
                 "request_id": request_id},
        headers=headers,
    )


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    if settings.APP_ENV.lower() == "production":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


# Login rate limiting per client IP (in-memory; use a shared store when running several workers).
LOGIN_PATHS = {"/api/auth/login", "/api/auth/login/"}
LOGIN_WINDOW = timedelta(minutes=5)
LOGIN_LIMIT = 20
_auth_attempts: dict = defaultdict(list)


@app.middleware("http")
async def auth_rate_limit(request: Request, call_next):
    if request.method == "POST" and request.url.path in LOGIN_PATHS:
        client_ip = request.client.host if request.client else "unknown"
        now = datetime.now(timezone.utc)
        _auth_attempts[client_ip] = [t for t in _auth_attempts[client_ip] if now - t < LOGIN_WINDOW]
        if len(_auth_attempts[client_ip]) >= LOGIN_LIMIT:
            return JSONResponse({"detail": "Too many login attempts from this device. Try again in a few minutes."},
                                status_code=429, headers={"Retry-After": "300"})
        _auth_attempts[client_ip].append(now)
    return await call_next(request)


# Routers
for r in (auth_router, staff_router, dashboard_router, roster_router, leave_router, movement_router,
          attendance_router, task_router, attachments_router, duties_router, policy_router, reports_router,
          audit_router, ai_router, mobile_router, config_router, notifications_router, change_request_router):
    app.include_router(r, prefix="/api")


@app.get("/", tags=["Health"])
async def root():
    return {
        "application": "Panjagutta Police Station AI Duty Management",
        "version": "0.2.0",
        "status": "running",
        "docs": "/api/docs",
    }


@app.get("/api/health", tags=["Health"])
async def health():
    return {"status": "healthy", "environment": settings.APP_ENV}
