"""
FastAPI main application — registers all routers, lifespan, middleware.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.api.routes.auth import router as auth_router
from app.api.routes.staff import router as staff_router
from app.api.routes.dashboard import router as dashboard_router
from app.api.routes.roster import router as roster_router
from app.api.routes.operations import (
    leave_router, movement_router, attendance_router, task_router
)
from app.api.routes.attachments import router as attachments_router
from app.api.routes.policy import router as policy_router
from app.api.routes.reports import router as reports_router
from app.api.routes.audit import router as audit_router
from app.api.routes.ai import router as ai_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting Panjagutta Duty Management API...")
    from app.services.scheduler import start_scheduler
    start_scheduler(AsyncSessionLocal)
    yield
    # Shutdown
    from app.services.scheduler import scheduler
    if scheduler.running:
        scheduler.shutdown()
    logger.info("API shutdown complete")


app = FastAPI(
    title="Panjagutta Police Station — AI Duty Management API",
    description=(
        "Centralized duty management for Panjagutta Police Station. "
        "⚠ PROTOTYPE — Demo data only. Not for operational/production use without department security review."
    ),
    version="0.1.0-stage-AB",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled server exception: %s", exc)
    origin = request.headers.get("origin") or "*"
    return JSONResponse(
        status_code=500,
        content={"detail": f"An internal server error occurred: {str(exc)}"},
        headers={
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "*",
        },
    )


# Request ID middleware
import uuid
@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


# Rate limiting for auth endpoints (simple in-memory — use Redis in production)
from collections import defaultdict
from datetime import datetime, timezone, timedelta
_auth_attempts: dict = defaultdict(list)

@app.middleware("http")
async def auth_rate_limit(request: Request, call_next):
    if request.url.path == "/auth/login":
        client_ip = request.client.host if request.client else "unknown"
        now = datetime.now(timezone.utc)
        window = timedelta(minutes=5)
        _auth_attempts[client_ip] = [t for t in _auth_attempts[client_ip] if now - t < window]
        if len(_auth_attempts[client_ip]) >= 20:
            return JSONResponse({"detail": "Too many login attempts. Try again later."}, status_code=429)
        _auth_attempts[client_ip].append(now)
    return await call_next(request)


# Routers
app.include_router(auth_router, prefix="/api")
app.include_router(staff_router, prefix="/api")
app.include_router(dashboard_router, prefix="/api")
app.include_router(roster_router, prefix="/api")
app.include_router(leave_router, prefix="/api")
app.include_router(movement_router, prefix="/api")
app.include_router(attendance_router, prefix="/api")
app.include_router(task_router, prefix="/api")
app.include_router(attachments_router, prefix="/api")
app.include_router(policy_router, prefix="/api")
app.include_router(reports_router, prefix="/api")
app.include_router(audit_router, prefix="/api")
app.include_router(ai_router, prefix="/api")


@app.get("/", tags=["Health"])
async def root():
    return {
        "application": "Panjagutta Police Station AI Duty Management",
        "version": "0.1.0-stage-AB",
        "status": "running",
        "docs": "/api/docs",
        "warning": "PROTOTYPE - DEMO DATA ONLY. Requires department security review before operational use.",
    }


@app.get("/api/health", tags=["Health"])
async def health():
    return {"status": "healthy", "environment": settings.APP_ENV}
