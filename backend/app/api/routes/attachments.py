"""
Attachment Orders API — tracking staff attached to outside wings/units.
Counted in station sanctioned strength, excluded from routine station duties.
"""
from __future__ import annotations

from datetime import date as date_type, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.auth.dependencies import get_current_user, require_roles
from app.db.database import get_db
from app.models.models import AttachmentOrder, Staff, User, UserRoleEnum
from app.services.audit import log_event, AuditAction

router = APIRouter(prefix="/attachments", tags=["Attachments"])


class AttachmentCreate(BaseModel):
    staff_id: int
    parent_unit: str = "Panjagutta Police Station"
    attached_wing: str
    order_reference: Optional[str] = None
    start_date: date_type
    expected_end_date: Optional[date_type] = None
    reporting_officer_id: Optional[int] = None


class AttachmentEnd(BaseModel):
    actual_end_date: date_type
    end_authority: Optional[str] = None


@router.post("/", status_code=201)
async def create_attachment(
    payload: AttachmentCreate,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    # Verify staff exists
    staff_res = await db.execute(select(Staff).where(Staff.id == payload.staff_id))
    staff = staff_res.scalar_one_or_none()
    if not staff:
        raise HTTPException(status_code=404, detail="Staff member not found")

    attachment = AttachmentOrder(
        staff_id=payload.staff_id,
        parent_unit=payload.parent_unit,
        attached_wing=payload.attached_wing,
        order_reference=payload.order_reference,
        start_date=payload.start_date,
        expected_end_date=payload.expected_end_date,
        reporting_officer_id=payload.reporting_officer_id,
        created_by_id=current_user.id,
        is_active=True,
    )
    db.add(attachment)
    await db.flush()

    await log_event(
        db,
        actor=current_user,
        action="ATTACHMENT_CREATED",
        entity_type="AttachmentOrder",
        entity_id=attachment.id,
        new_values=payload.model_dump(mode="json"),
    )
    await db.commit()
    return {"id": attachment.id, "detail": "Attachment order created"}


@router.get("/")
async def list_attachments(
    active_only: bool = Query(True),
    staff_id: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(AttachmentOrder)
    if active_only:
        query = query.where(AttachmentOrder.is_active == True)
    if staff_id:
        query = query.where(AttachmentOrder.staff_id == staff_id)

    result = await db.execute(query.order_by(AttachmentOrder.start_date.desc()))
    records = result.scalars().all()

    # Preload staff details
    staff_ids = list({r.staff_id for r in records})
    staff_map = {}
    if staff_ids:
        s_res = await db.execute(select(Staff).where(Staff.id.in_(staff_ids)))
        staff_map = {s.id: s for s in s_res.scalars().all()}

    return [
        {
            "id": r.id,
            "staff_id": r.staff_id,
            "staff_name": staff_map.get(r.staff_id).name if staff_map.get(r.staff_id) else None,
            "service_number": staff_map.get(r.staff_id).service_number if staff_map.get(r.staff_id) else None,
            "parent_unit": r.parent_unit,
            "attached_wing": r.attached_wing,
            "order_reference": r.order_reference,
            "start_date": r.start_date.isoformat(),
            "expected_end_date": r.expected_end_date.isoformat() if r.expected_end_date else None,
            "actual_end_date": r.actual_end_date.isoformat() if r.actual_end_date else None,
            "is_active": r.is_active,
        }
        for r in records
    ]


@router.post("/{attachment_id}/end")
async def end_attachment(
    attachment_id: int,
    payload: AttachmentEnd,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AttachmentOrder).where(AttachmentOrder.id == attachment_id))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Attachment order not found")

    order.is_active = False
    order.actual_end_date = payload.actual_end_date
    order.end_authority = payload.end_authority
    order.ended_by_id = current_user.id

    await log_event(
        db,
        actor=current_user,
        action="ATTACHMENT_ENDED",
        entity_type="AttachmentOrder",
        entity_id=attachment_id,
        new_values=payload.model_dump(mode="json"),
    )
    await db.commit()
    return {"detail": "Attachment ended and staff repatriated to station availability"}
