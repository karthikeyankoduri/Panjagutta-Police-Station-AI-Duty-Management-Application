"""Notification inbox for the web app and the Android app (polled)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db.database import get_db
from app.models.models import Notification, User
from app.services.notifications import is_read_by, visible_to

router = APIRouter(prefix="/notifications", tags=["Notifications"])


def _out(n: Notification, user: User) -> dict:
    return {
        "id": n.id, "title": n.title, "message": n.message, "category": n.category,
        "entity_type": n.entity_type, "entity_id": n.entity_id,
        "is_read": is_read_by(n, user),
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


@router.get("/")
async def list_notifications(
    unread_only: bool = Query(False),
    since_id: Optional[int] = Query(None, description="Only notifications newer than this id (for polling)"),
    limit: int = Query(50, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(Notification).where(visible_to(current_user))
    if since_id:
        q = q.where(Notification.id > since_id)
    rows = (await db.execute(q.order_by(Notification.id.desc()).limit(limit))).scalars().all()
    items = [_out(n, current_user) for n in rows]
    if unread_only:
        items = [i for i in items if not i["is_read"]]
    unread = sum(1 for n in rows if not is_read_by(n, current_user))
    return {"unread": unread, "items": items}


async def _mark(n: Notification, user: User):
    if n.user_id is not None:
        n.is_read = True
    else:
        readers = list(n.read_by or [])
        if user.id not in readers:
            readers.append(user.id)
            n.read_by = readers


@router.post("/{notification_id}/read")
async def mark_read(notification_id: int, current_user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    n = (await db.execute(select(Notification).where(Notification.id == notification_id, visible_to(current_user)))).scalar_one_or_none()
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    await _mark(n, current_user)
    await db.commit()
    return {"detail": "Marked as read"}


@router.post("/read-all")
async def mark_all_read(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Notification).where(visible_to(current_user)).limit(500))).scalars().all()
    for n in rows:
        await _mark(n, current_user)
    await db.commit()
    return {"detail": f"Marked {len(rows)} notification(s) as read"}
