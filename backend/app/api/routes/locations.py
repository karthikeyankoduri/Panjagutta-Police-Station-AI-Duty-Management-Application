"""Admin-only live officer locations (feeds the "Live Locations" map)."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_roles
from app.db.database import get_db
from app.models.models import Sector, Staff, StaffLocation, User, UserRoleEnum

router = APIRouter(prefix="/locations", tags=["Live Locations"])


class LiveLocationOut(BaseModel):
    staff_id: int
    service_number: str
    name: str
    designation: str
    sector_name: Optional[str] = None
    latitude: float
    longitude: float
    location_name: Optional[str] = None
    last_updated: datetime


@router.get("/", response_model=List[LiveLocationOut])
async def list_live_locations(
    _: User = Depends(require_roles(UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(StaffLocation, Staff, Sector.name)
        .join(Staff, Staff.id == StaffLocation.staff_id)
        .outerjoin(Sector, Sector.id == Staff.sector_id)
        .where(Staff.is_active == True)
        .order_by(Staff.name.asc())
    )).all()
    return [
        LiveLocationOut(
            staff_id=s.id,
            service_number=s.service_number,
            name=s.name,
            designation=s.designation.value if hasattr(s.designation, "value") else str(s.designation),
            sector_name=sector_name,
            latitude=loc.latitude,
            longitude=loc.longitude,
            location_name=loc.location_name,
            last_updated=loc.recorded_at,
        )
        for loc, s, sector_name in rows
    ]
