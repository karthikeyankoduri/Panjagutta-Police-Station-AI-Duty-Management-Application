"""
Station chat (text only).

* Station channel (thread_user_id NULL): every signed-in user can read and post. Superiors can also
  broadcast, which additionally raises a notification for everyone.
* Private thread per user: visible only to that user and to the superiors (Super Admin, SHO, Admin SI).
  A user can never read or post into another user's thread; the server returns 404 for it.
Everything is kept (no purge). Posting is rate-limited per user.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import STATION_ADMINS, get_current_user, has_role
from app.db.database import get_db
from app.models.models import ChatMessage, ChatRead, Staff, User, UserRoleEnum
from app.services.audit import log_event
from app.services.notifications import notify_roles, notify_user

router = APIRouter(prefix="/chat", tags=["Chat"])

MAX_LEN = 1000
RATE_WINDOW = timedelta(minutes=1)
RATE_LIMIT = 30
_posts: Dict[int, List[datetime]] = defaultdict(list)
SUPERIOR_ROLES = [UserRoleEnum.SUPER_ADMIN, UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI]


def is_superior(user: User) -> bool:
    return has_role(user, STATION_ADMINS)  # SHO, Admin SI and Super Admin


def _check_rate(user: User) -> None:
    now = datetime.now(timezone.utc)
    recent = [t for t in _posts[user.id] if now - t < RATE_WINDOW]
    if len(recent) >= RATE_LIMIT:
        _posts[user.id] = recent
        raise HTTPException(status_code=429, detail="You are sending messages too fast. Wait a moment.")
    recent.append(now)
    _posts[user.id] = recent


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=MAX_LEN)
    thread_user_id: Optional[int] = None  # None / 0 = Station channel


class BroadcastIn(BaseModel):
    body: str = Field(min_length=1, max_length=MAX_LEN)


class ReadIn(BaseModel):
    thread_user_id: Optional[int] = None


def _key(thread_user_id: Optional[int]) -> int:
    return thread_user_id or 0


def _in_thread(thread_user_id: Optional[int]):
    return ChatMessage.thread_user_id.is_(None) if not thread_user_id else ChatMessage.thread_user_id == thread_user_id


async def _names(db: AsyncSession, user_ids) -> Dict[int, dict]:
    ids = {i for i in user_ids if i}
    if not ids:
        return {}
    rows = (await db.execute(
        select(User, Staff.name).outerjoin(Staff, Staff.id == User.staff_id).where(User.id.in_(ids))
    )).all()
    return {u.id: {"name": n or u.username, "role": u.role.value} for u, n in rows}


async def _thread_owner(db: AsyncSession, me: User, thread_user_id: Optional[int]) -> Optional[User]:
    """Validate access to a thread. Returns the owner user, or None for the Station channel."""
    tid = thread_user_id or None
    if tid is None:
        return None
    if tid != me.id and not is_superior(me):
        raise HTTPException(status_code=404, detail="Conversation not found")  # never reveal other threads
    owner = (await db.execute(select(User).where(User.id == tid, User.is_active == True))).scalar_one_or_none()
    if owner is None or is_superior(owner):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return owner


def _out(m: ChatMessage, me: User, names: Dict[int, dict]) -> dict:
    who = names.get(m.sender_user_id, {"name": "Unknown", "role": ""})
    return {
        "id": m.id, "thread_user_id": m.thread_user_id, "kind": m.kind, "body": m.body,
        "sender_user_id": m.sender_user_id, "sender_name": who["name"], "sender_role": who["role"],
        "mine": m.sender_user_id == me.id,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


async def _unread(db: AsyncSession, me: User, thread_user_id: Optional[int]) -> int:
    last = (await db.execute(select(ChatRead.last_read_id).where(
        ChatRead.user_id == me.id, ChatRead.thread_key == _key(thread_user_id)))).scalar_one_or_none() or 0
    q = select(func.count(ChatMessage.id)).where(
        ChatMessage.id > last, ChatMessage.sender_user_id != me.id, _in_thread(thread_user_id))
    return (await db.execute(q)).scalar_one()


async def _last(db: AsyncSession, thread_user_id: Optional[int]) -> Optional[dict]:
    m = (await db.execute(
        select(ChatMessage).where(_in_thread(thread_user_id)).order_by(ChatMessage.id.desc()).limit(1)
    )).scalar_one_or_none()
    if m is None:
        return None
    return {"body": m.body[:120], "created_at": m.created_at.isoformat() if m.created_at else None}


@router.get("/threads")
async def list_threads(me: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    station = {"thread_user_id": None, "title": "Station channel", "kind": "station",
               "unread": await _unread(db, me, None), "last": await _last(db, None)}
    if not is_superior(me):
        mine = {"thread_user_id": me.id, "title": "Admin / SHO", "kind": "direct",
                "unread": await _unread(db, me, me.id), "last": await _last(db, me.id)}
        return {"can_broadcast": False, "threads": [station, mine]}
    rows = (await db.execute(
        select(User, Staff.name, Staff.service_number, Staff.contact_phone)
        .outerjoin(Staff, Staff.id == User.staff_id)
        .where(User.is_active == True, User.role.notin_(SUPERIOR_ROLES))
        .order_by(func.coalesce(Staff.name, User.username))
    )).all()
    threads = [station]
    for u, name, service_number, phone in rows:
        threads.append({
            "thread_user_id": u.id, "title": name or u.username, "kind": "direct", "phone": phone,
            "subtitle": " · ".join(x for x in [service_number, u.role.value] if x),
            "unread": await _unread(db, me, u.id), "last": await _last(db, u.id),
        })
    return {"can_broadcast": True, "threads": threads}


@router.get("/messages")
async def list_messages(
    thread_user_id: Optional[int] = Query(None, description="Omit or 0 for the Station channel"),
    since_id: Optional[int] = Query(None),
    limit: int = Query(100, ge=1, le=300),
    me: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _thread_owner(db, me, thread_user_id)
    q = select(ChatMessage).where(_in_thread(thread_user_id))
    if since_id:
        q = q.where(ChatMessage.id > since_id)
    rows = list(reversed((await db.execute(q.order_by(ChatMessage.id.desc()).limit(limit))).scalars().all()))
    names = await _names(db, [m.sender_user_id for m in rows])
    return {"items": [_out(m, me, names) for m in rows]}


@router.post("/messages", status_code=201)
async def send_message(body: MessageIn, me: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Message is empty")
    owner = await _thread_owner(db, me, body.thread_user_id)
    _check_rate(me)
    msg = ChatMessage(thread_user_id=owner.id if owner else None, sender_user_id=me.id, body=text,
                      kind="direct" if owner else "channel")
    db.add(msg)
    if owner is not None:
        if me.id == owner.id:
            await notify_roles(db, [UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI, UserRoleEnum.SUPER_ADMIN],
                               "New chat message", text[:120], category="chat", entity_type="chat", entity_id=owner.id)
        else:
            await notify_user(db, owner.id, "New chat message", text[:120],
                              category="chat", entity_type="chat", entity_id=owner.id)
    await db.commit()
    await db.refresh(msg)
    return _out(msg, me, await _names(db, [me.id]))


@router.post("/broadcast", status_code=201)
async def broadcast(body: BroadcastIn, me: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not is_superior(me):
        raise HTTPException(status_code=403, detail="Only the SHO, Admin SI or Super Admin can message everyone")
    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Message is empty")
    _check_rate(me)
    msg = ChatMessage(thread_user_id=None, sender_user_id=me.id, body=text, kind="broadcast")
    db.add(msg)
    recipients = (await db.execute(select(User.id).where(User.is_active == True, User.id != me.id))).scalars().all()
    for uid in recipients:
        await notify_user(db, uid, "Message to all", text[:120], category="chat", entity_type="chat", entity_id=0)
    await log_event(db, actor=me, action="CHAT_BROADCAST", entity_type="ChatMessage",
                    new_values={"recipients": len(recipients), "length": len(text)})
    await db.commit()
    await db.refresh(msg)
    return _out(msg, me, await _names(db, [me.id]))


@router.post("/read")
async def mark_read(body: ReadIn, me: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _thread_owner(db, me, body.thread_user_id)
    newest = (await db.execute(select(func.max(ChatMessage.id)).where(_in_thread(body.thread_user_id)))).scalar_one() or 0
    row = (await db.execute(select(ChatRead).where(
        ChatRead.user_id == me.id, ChatRead.thread_key == _key(body.thread_user_id)))).scalar_one_or_none()
    if row is None:
        db.add(ChatRead(user_id=me.id, thread_key=_key(body.thread_user_id), last_read_id=newest))
    else:
        row.last_read_id = max(row.last_read_id, newest)
    await db.commit()
    return {"detail": "ok"}
