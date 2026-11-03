"""
Duty Master API — querying and configuring standard station duties and requirements.
Based on SOP Section 4 & Build Guide Section 4.2.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from app.auth.dependencies import OFFICERS, get_current_user, require_roles
from app.db.database import get_db
from app.models.models import DutyMaster, ShiftCode, User, UserRoleEnum
from app.services.audit import log_event, AuditAction

router = APIRouter(prefix="/duties", tags=["Duty Master"])


class DutyMasterOut(BaseModel):
    id: int
    category: str
    section: Optional[str] = None
    shift_code: Optional[str] = None
    required_strength: Optional[int] = None
    eligible_designations: Optional[List[str]] = None
    description: Optional[str] = None
    is_active: bool
    is_configured: bool

    class Config:
        from_attributes = True


class DutyMasterCreate(BaseModel):
    category: str
    section: Optional[str] = None
    shift_code: Optional[ShiftCode] = None
    required_strength: Optional[int] = None
    eligible_designations: Optional[List[str]] = None
    description: Optional[str] = None


class DutyMasterUpdate(BaseModel):
    category: Optional[str] = None
    section: Optional[str] = None
    shift_code: Optional[ShiftCode] = None
    clear_shift: bool = False
    required_strength: Optional[int] = None
    eligible_designations: Optional[List[str]] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/", response_model=List[DutyMasterOut])
async def list_duties(
    shift_code: Optional[ShiftCode] = Query(None),
    section: Optional[str] = Query(None),
    active_only: bool = Query(True),
    current_user: User = Depends(require_roles(*OFFICERS)),
    db: AsyncSession = Depends(get_db),
):
    """
    List station duty master definitions.
    If shift_code is provided, returns duties applicable to that shift (or all shifts).
    """
    query = select(DutyMaster)
    if active_only:
        query = query.where(DutyMaster.is_active == True)
    if section:
        query = query.where(DutyMaster.section == section)
    if shift_code:
        query = query.where(
            or_(DutyMaster.shift_code == shift_code, DutyMaster.shift_code == None)
        )

    result = await db.execute(query.order_by(DutyMaster.id.asc()))
    duties = result.scalars().all()

    return [
        DutyMasterOut(
            id=d.id,
            category=d.category,
            section=d.section,
            shift_code=d.shift_code.value if d.shift_code else None,
            required_strength=d.required_strength,
            eligible_designations=d.eligible_designations,
            description=d.description,
            is_active=d.is_active,
            is_configured=d.is_configured,
        )
        for d in duties
    ]


@router.get("/{duty_id}", response_model=DutyMasterOut)
async def get_duty(
    duty_id: int,
    current_user: User = Depends(require_roles(*OFFICERS)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(DutyMaster).where(DutyMaster.id == duty_id))
    duty = result.scalar_one_or_none()
    if not duty:
        raise HTTPException(status_code=404, detail="Duty not found")

    return DutyMasterOut(
        id=duty.id,
        category=duty.category,
        section=duty.section,
        shift_code=duty.shift_code.value if duty.shift_code else None,
        required_strength=duty.required_strength,
        eligible_designations=duty.eligible_designations,
        description=duty.description,
        is_active=duty.is_active,
        is_configured=duty.is_configured,
    )


@router.post("/", response_model=DutyMasterOut, status_code=201)
async def create_duty(
    payload: DutyMasterCreate,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    if not payload.category.strip():
        raise HTTPException(status_code=422, detail="Duty category is required")
    if payload.required_strength is not None and payload.required_strength < 0:
        raise HTTPException(status_code=422, detail="Required strength cannot be negative")
    duty = DutyMaster(
        category=payload.category.strip(), section=payload.section, shift_code=payload.shift_code,
        required_strength=payload.required_strength, eligible_designations=payload.eligible_designations,
        description=payload.description, is_active=True,
        is_configured=bool(payload.required_strength and payload.required_strength > 0),
    )
    db.add(duty)
    await db.flush()
    await log_event(db, actor=current_user, action=AuditAction.DUTY_CREATED, entity_type="DutyMaster",
                    entity_id=duty.id, new_values=payload.model_dump(mode="json"))
    await db.commit()
    await db.refresh(duty)
    return DutyMasterOut(
        id=duty.id, category=duty.category, section=duty.section,
        shift_code=duty.shift_code.value if duty.shift_code else None,
        required_strength=duty.required_strength, eligible_designations=duty.eligible_designations,
        description=duty.description, is_active=duty.is_active, is_configured=duty.is_configured,
    )


@router.patch("/{duty_id}", response_model=DutyMasterOut)
async def update_duty(
    duty_id: int,
    payload: DutyMasterUpdate,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(DutyMaster).where(DutyMaster.id == duty_id))
    duty = result.scalar_one_or_none()
    if not duty:
        raise HTTPException(status_code=404, detail="Duty not found")

    dump = payload.model_dump(exclude_none=True)
    clear_shift = dump.pop("clear_shift", False)
    if dump.get("required_strength") is not None and dump["required_strength"] < 0:
        raise HTTPException(status_code=422, detail="Required strength cannot be negative")
    old_values = {k: getattr(duty, k) for k in dump}
    if clear_shift:
        old_values["shift_code"] = duty.shift_code
        dump["shift_code"] = None

    for key, val in dump.items():
        setattr(duty, key, val)

    duty.is_configured = duty.required_strength is not None and duty.required_strength > 0

    await log_event(
        db,
        actor=current_user,
        action="DUTY_MASTER_UPDATED",
        entity_type="DutyMaster",
        entity_id=duty_id,
        old_values={k: (v.value if hasattr(v, "value") else v) for k, v in old_values.items()},
        new_values={k: (v.value if hasattr(v, "value") else v) for k, v in dump.items()},
    )
    await db.commit()
    await db.refresh(duty)

    return DutyMasterOut(
        id=duty.id,
        category=duty.category,
        section=duty.section,
        shift_code=duty.shift_code.value if duty.shift_code else None,
        required_strength=duty.required_strength,
        eligible_designations=duty.eligible_designations,
        description=duty.description,
        is_active=duty.is_active,
        is_configured=duty.is_configured,
    )

