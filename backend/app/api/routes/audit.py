"""
Audit Trail API — Immutable log of all sensitive operational actions.
Restricted to SHO and Admin SI.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.auth.dependencies import require_roles
from app.db.database import get_db
from app.models.models import AuditLog, User, UserRoleEnum

router = APIRouter(prefix="/audit", tags=["Audit Log"])


@router.get("/")
async def list_audit_logs(
    actor_username: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    entity_type: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    query = select(AuditLog)
    if actor_username:
        query = query.where(AuditLog.actor_username.ilike(f"%{actor_username}%"))
    if action:
        query = query.where(AuditLog.action.ilike(f"%{action}%"))
    if entity_type:
        query = query.where(AuditLog.entity_type.ilike(f"%{entity_type}%"))

    result = await db.execute(query.order_by(AuditLog.timestamp.desc()).offset(offset).limit(limit))
    logs = result.scalars().all()

    return [
        {
            "id": l.id,
            "timestamp": l.timestamp.isoformat(),
            "actor_username": l.actor_username,
            "action": l.action,
            "entity_type": l.entity_type,
            "entity_id": l.entity_id,
            "old_values": l.old_values,
            "new_values": l.new_values,
            "request_id": l.request_id,
            "ip_address": l.ip_address,
        }
        for l in logs
    ]
