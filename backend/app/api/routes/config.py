"""
Configuration API — sectors, sections and status/state lists (Build Guide §4,
blueprint step 5: "An admin can view and edit every value, nothing is hard-coded").
Shift timings, duty requirements and rotation rules have their own routes
(/policy, /duties).
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import STATION_ADMINS, get_current_user, require_roles
from app.db.database import get_db
from app.models.models import ConfigListItem, Section, Sector, Staff, User
from app.services.audit import AuditAction, log_event

router = APIRouter(prefix="/config", tags=["Configuration"])

LIST_NAMES = ("staff_status", "leave_status", "task_status", "leave_type", "designation", "staff_category")


class SectorIn(BaseModel):
    name: str
    code: str
    description: Optional[str] = None
    is_active: bool = True


class SectorUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class SectionIn(BaseModel):
    name: str
    description: Optional[str] = None
    is_active: bool = True


class SectionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class ListItemUpdate(BaseModel):
    label: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class ListItemIn(BaseModel):
    code: str
    label: str
    description: Optional[str] = None
    sort_order: int = 0


# ── Officers who may authorize exceptions ────────────────────────────────────

@router.get("/authorizers")
async def list_authorizers(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Active SHO / Admin SI logins (or the role set in the confirmed rotation rule) for exception sign-off."""
    from app.models.models import UserRoleEnum
    from app.services.shifts import load_rest_policy
    from app.services.validation import DEFAULT_EXCEPTION_AUTHORIZER_ROLES
    policy = await load_rest_policy(db)
    roles = DEFAULT_EXCEPTION_AUTHORIZER_ROLES
    if policy.exception_authorizer_role:
        try:
            roles = (UserRoleEnum(policy.exception_authorizer_role),)
        except ValueError:
            pass
    rows = (await db.execute(select(User).where(User.is_active == True, User.role.in_(roles)))).scalars().all()
    names = {}
    staff_ids = [u.staff_id for u in rows if u.staff_id]
    if staff_ids:
        names = {s.id: s.name for s in (await db.execute(select(Staff).where(Staff.id.in_(staff_ids)))).scalars().all()}
    return [{"user_id": u.id, "username": u.username, "role": u.role.value, "name": names.get(u.staff_id) or u.username,
             "is_self": u.id == current_user.id} for u in rows]


# ── Sectors ──────────────────────────────────────────────────────────────────

@router.get("/sectors")
async def list_sectors(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sectors = (await db.execute(select(Sector).order_by(Sector.id))).scalars().all()
    counts = {}
    for sid in (await db.execute(select(Staff.sector_id).where(Staff.is_active == True))).scalars().all():
        counts[sid] = counts.get(sid, 0) + 1
    return [{"id": s.id, "name": s.name, "code": s.code, "description": s.description,
             "is_active": s.is_active, "staff_count": counts.get(s.id, 0)} for s in sectors]


@router.post("/sectors", status_code=201)
async def create_sector(payload: SectorIn, current_user: User = Depends(require_roles(*STATION_ADMINS)),
                        db: AsyncSession = Depends(get_db)):
    if (await db.execute(select(Sector).where((Sector.name == payload.name) | (Sector.code == payload.code)))).scalars().first():
        raise HTTPException(status_code=409, detail="A sector with this name or code already exists")
    sector = Sector(**payload.model_dump())
    db.add(sector)
    await db.flush()
    await log_event(db, actor=current_user, action=AuditAction.CONFIG_UPDATED, entity_type="Sector",
                    entity_id=sector.id, new_values=payload.model_dump())
    await db.commit()
    return {"id": sector.id}


@router.patch("/sectors/{sector_id}")
async def update_sector(sector_id: int, payload: SectorUpdate,
                        current_user: User = Depends(require_roles(*STATION_ADMINS)),
                        db: AsyncSession = Depends(get_db)):
    sector = await db.get(Sector, sector_id)
    if not sector:
        raise HTTPException(status_code=404, detail="Sector not found")
    changes = payload.model_dump(exclude_none=True)
    old = {k: getattr(sector, k) for k in changes}
    for k, v in changes.items():
        setattr(sector, k, v)
    await log_event(db, actor=current_user, action=AuditAction.CONFIG_UPDATED, entity_type="Sector",
                    entity_id=sector_id, old_values=old, new_values=changes)
    await db.commit()
    return {"detail": "Sector updated"}


# ── Sections ─────────────────────────────────────────────────────────────────

@router.get("/sections")
async def list_sections(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Section).order_by(Section.name))).scalars().all()
    return [{"id": s.id, "name": s.name, "description": s.description, "is_active": s.is_active} for s in rows]


@router.post("/sections", status_code=201)
async def create_section(payload: SectionIn, current_user: User = Depends(require_roles(*STATION_ADMINS)),
                         db: AsyncSession = Depends(get_db)):
    if (await db.execute(select(Section).where(Section.name == payload.name))).scalars().first():
        raise HTTPException(status_code=409, detail="A section with this name already exists")
    section = Section(**payload.model_dump())
    db.add(section)
    await db.flush()
    await log_event(db, actor=current_user, action=AuditAction.CONFIG_UPDATED, entity_type="Section",
                    entity_id=section.id, new_values=payload.model_dump())
    await db.commit()
    return {"id": section.id}


@router.patch("/sections/{section_id}")
async def update_section(section_id: int, payload: SectionUpdate,
                         current_user: User = Depends(require_roles(*STATION_ADMINS)),
                         db: AsyncSession = Depends(get_db)):
    section = await db.get(Section, section_id)
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")
    changes = payload.model_dump(exclude_none=True)
    old = {k: getattr(section, k) for k in changes}
    for k, v in changes.items():
        setattr(section, k, v)
    await log_event(db, actor=current_user, action=AuditAction.CONFIG_UPDATED, entity_type="Section",
                    entity_id=section_id, old_values=old, new_values=changes)
    await db.commit()
    return {"detail": "Section updated"}


# ── Status / state lists ─────────────────────────────────────────────────────

@router.get("/lists")
async def get_lists(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(ConfigListItem).order_by(ConfigListItem.list_name, ConfigListItem.sort_order))).scalars().all()
    out = {name: [] for name in LIST_NAMES}
    for r in rows:
        out.setdefault(r.list_name, []).append({
            "id": r.id, "code": r.code, "label": r.label, "description": r.description,
            "sort_order": r.sort_order, "is_active": r.is_active,
        })
    return out


@router.post("/lists/{list_name}", status_code=201)
async def add_list_item(list_name: str, payload: ListItemIn,
                        current_user: User = Depends(require_roles(*STATION_ADMINS)),
                        db: AsyncSession = Depends(get_db)):
    """Only free-form lists (leave types) accept new codes; status codes are fixed by the rules engine."""
    if list_name != "leave_type":
        raise HTTPException(status_code=400, detail="New codes can only be added to leave_type. Status codes drive the rules engine; edit their labels instead.")
    if (await db.execute(select(ConfigListItem).where(ConfigListItem.list_name == list_name,
                                                      ConfigListItem.code == payload.code))).scalars().first():
        raise HTTPException(status_code=409, detail="This code already exists")
    item = ConfigListItem(list_name=list_name, **payload.model_dump())
    db.add(item)
    await db.flush()
    await log_event(db, actor=current_user, action=AuditAction.CONFIG_UPDATED, entity_type="ConfigListItem",
                    entity_id=item.id, new_values={"list": list_name, **payload.model_dump()})
    await db.commit()
    return {"id": item.id}


@router.patch("/lists/items/{item_id}")
async def update_list_item(item_id: int, payload: ListItemUpdate,
                           current_user: User = Depends(require_roles(*STATION_ADMINS)),
                           db: AsyncSession = Depends(get_db)):
    item = await db.get(ConfigListItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="List item not found")
    changes = payload.model_dump(exclude_none=True)
    old = {k: getattr(item, k) for k in changes}
    for k, v in changes.items():
        setattr(item, k, v)
    await log_event(db, actor=current_user, action=AuditAction.CONFIG_UPDATED, entity_type="ConfigListItem",
                    entity_id=item_id, old_values=old, new_values={"list": item.list_name, "code": item.code, **changes})
    await db.commit()
    return {"detail": "List item updated"}
