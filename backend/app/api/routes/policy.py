"""
Station Policy & Gate API — SHO sign-off, rotation rules, shift timing configuration.
Implements the required Section 1 Policy Gate:
Prevents unconfirmed operational rosters unless explicitly in DEMO_SIMULATED or CONFIRMED state.
"""
from __future__ import annotations

from datetime import datetime, timezone, time
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.auth.dependencies import get_current_user, require_roles
from app.db.database import get_db
from app.models.models import RotationRule, ShiftConfig, PolicyStatus, User, UserRoleEnum, ShiftCode
from app.services.audit import log_event, AuditAction

router = APIRouter(prefix="/policy", tags=["Policy & Gates"])


class PolicyConfirmIn(BaseModel):
    rotation_sequence: str = "A->B->C"
    min_rest_hours_after_shift: float = 16.0
    duty_off_after_shift_b_hours: float = 24.0
    permitted_exceptions: Optional[str] = None
    exception_authorizer_role: Optional[str] = "SHO"
    effective_from: Optional[str] = None
    notes: Optional[str] = "Station SHO formal sign-off on duty rotation rules."


class DemoModeIn(BaseModel):
    acknowledgement_text: str = (
        "PROTOTYPE EVALUATION ACKNOWLEDGEMENT: These duty rotation rules are simulated for demonstration "
        "purposes only and have NOT been signed off by the Station House Officer for operational duty deployment."
    )


class ShiftConfigUpdate(BaseModel):
    shift_code: str
    start_time: str  # "HH:MM"
    end_time: str    # "HH:MM"
    duration_hours: float


@router.get("/")
async def get_policy_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Fetch active rotation rule by most recent ID
    rule_res = await db.execute(
        select(RotationRule).order_by(RotationRule.id.desc()).limit(1)
    )
    rule = rule_res.scalar_one_or_none()

    # Fetch shift configs
    shifts_res = await db.execute(select(ShiftConfig).where(ShiftConfig.is_active == True))
    shifts = shifts_res.scalars().all()

    return {
        "policy_status": rule.policy_status.value if rule else PolicyStatus.UNCONFIRMED.value,
        "is_demo_mode": rule.is_demo_acknowledgement if rule else False,
        "demo_acknowledgement_text": rule.demo_acknowledgement_text if rule else None,
        "confirmed_by_id": rule.confirmed_by_id if rule else None,
        "confirmed_at": rule.confirmed_at.isoformat() if rule and rule.confirmed_at else None,
        "min_rest_hours_after_shift": rule.min_rest_hours_after_shift if rule else 16.0,
        "duty_off_after_shift_b_hours": rule.duty_off_after_shift_b_hours if rule else 24.0,
        "rotation_sequence": rule.rotation_sequence if rule else "A->B->C",
        "permitted_exceptions": rule.permitted_exceptions if rule else None,
        "exception_authorizer_role": rule.exception_authorizer_role if rule else None,
        "effective_from": rule.effective_from.isoformat() if rule and rule.effective_from else None,
        "version": rule.version if rule else None,
        "notes": rule.notes if rule else None,
        "shifts": [
            {
                "shift_code": s.shift_code.value,
                "start_time": s.start_time.strftime("%H:%M"),
                "end_time": s.end_time.strftime("%H:%M"),
                "duration_hours": s.duration_hours,
                "crosses_midnight": s.crosses_midnight,
            }
            for s in shifts
        ],
    }


@router.post("/confirm")
async def confirm_policy(
    payload: PolicyConfirmIn,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO)),
    db: AsyncSession = Depends(get_db),
):
    latest_res = await db.execute(select(RotationRule).order_by(RotationRule.id.desc()).limit(1))
    latest = latest_res.scalar_one_or_none()
    new_version = (latest.version + 1) if (latest and latest.version) else 1
    if payload.min_rest_hours_after_shift < 0 or payload.duty_off_after_shift_b_hours < 0:
        raise HTTPException(status_code=422, detail="Rest hours cannot be negative")
    if payload.exception_authorizer_role and payload.exception_authorizer_role not in {r.value for r in UserRoleEnum}:
        raise HTTPException(status_code=422, detail="Unknown exception authorizer role")
    from datetime import date as _date
    effective = _date.fromisoformat(payload.effective_from) if payload.effective_from else None

    rule = RotationRule(
        version=new_version,
        rotation_sequence=payload.rotation_sequence,
        min_rest_hours_after_shift=payload.min_rest_hours_after_shift,
        duty_off_after_shift_b_hours=payload.duty_off_after_shift_b_hours,
        permitted_exceptions=payload.permitted_exceptions,
        exception_authorizer_role=payload.exception_authorizer_role,
        effective_from=effective,
        policy_status=PolicyStatus.CONFIRMED,
        confirmed_by_id=current_user.id,
        confirmed_at=datetime.now(timezone.utc),
        is_demo_acknowledgement=False,
        notes=payload.notes,
    )
    db.add(rule)
    await db.flush()

    await log_event(
        db,
        actor=current_user,
        action="POLICY_CONFIRMED",
        entity_type="RotationRule",
        entity_id=rule.id,
        old_values={"version": latest.version, "status": latest.policy_status.value,
                    "min_rest": latest.min_rest_hours_after_shift} if latest else None,
        new_values=payload.model_dump(mode="json"),
    )
    await db.commit()
    return {
        "status": "confirmed",
        "detail": "Station policy officially confirmed by SHO. Roster publication gate cleared.",
        "rule_id": rule.id,
    }


@router.post("/demo-mode")
async def enable_demo_simulation_mode(
    payload: DemoModeIn,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    latest_res = await db.execute(select(RotationRule).order_by(RotationRule.id.desc()).limit(1))
    latest = latest_res.scalar_one_or_none()
    new_version = (latest.version + 1) if (latest and latest.version) else 1

    rule = RotationRule(
        version=new_version,
        rotation_sequence="A->B->C",
        min_rest_hours_after_shift=16.0,
        duty_off_after_shift_b_hours=24.0,
        policy_status=PolicyStatus.DEMO_SIMULATED,
        confirmed_by_id=current_user.id,
        confirmed_at=datetime.now(timezone.utc),
        is_demo_acknowledgement=True,
        demo_acknowledgement_text=payload.acknowledgement_text,
        notes="Simulation mode activated for product evaluation.",
    )
    db.add(rule)
    await db.flush()

    await log_event(
        db,
        actor=current_user,
        action="POLICY_DEMO_MODE_ACTIVATED",
        entity_type="RotationRule",
        entity_id=rule.id,
        new_values={"status": "demo_simulated"},
    )
    await db.commit()
    return {
        "status": "demo_simulated",
        "detail": "Demo simulation mode enabled. Notice banner will be displayed on all screens.",
        "rule_id": rule.id,
    }



@router.put("/shifts/{shift_code}")
async def update_shift_config(
    shift_code: str,
    payload: ShiftConfigUpdate,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    """Update shift timings. Only authorized administrators (SHO/Admin SI)."""
    try:
        sc_enum = ShiftCode(shift_code.upper())
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid shift code: {shift_code}. Must be A, B, or C.")

    try:
        sh, sm = map(int, payload.start_time.strip().split(":"))
        eh, em = map(int, payload.end_time.strip().split(":"))
        parsed_start = time(hour=sh, minute=sm)
        parsed_end = time(hour=eh, minute=em)
    except Exception:
        raise HTTPException(status_code=400, detail="start_time and end_time must be in 'HH:MM' 24-hour format.")

    crosses = parsed_end < parsed_start or (parsed_end == parsed_start and payload.duration_hours > 0)
    span = ((eh * 60 + em) - (sh * 60 + sm)) % (24 * 60) / 60 or 24
    if abs(span - payload.duration_hours) > 0.01:
        raise HTTPException(status_code=422, detail=f"Duration must match the times ({span:g} hours)")

    res = await db.execute(
        select(ShiftConfig).where(ShiftConfig.shift_code == sc_enum, ShiftConfig.is_active == True)
    )
    shift_obj = res.scalar_one_or_none()
    now_utc = datetime.now(timezone.utc)
    old_values = {}
    if shift_obj:
        old_values = {
            "start_time": shift_obj.start_time.strftime("%H:%M"),
            "end_time": shift_obj.end_time.strftime("%H:%M"),
            "duration_hours": shift_obj.duration_hours,
        }
        shift_obj.start_time = parsed_start
        shift_obj.end_time = parsed_end
        shift_obj.duration_hours = payload.duration_hours
        shift_obj.crosses_midnight = crosses
        shift_obj.modified_by_id = current_user.id
        shift_obj.modified_at = now_utc
        shift_obj.version = (shift_obj.version or 1) + 1
    else:
        shift_obj = ShiftConfig(
            shift_code=sc_enum,
            start_time=parsed_start,
            end_time=parsed_end,
            duration_hours=payload.duration_hours,
            crosses_midnight=crosses,
            is_active=True,
            modified_by_id=current_user.id,
            modified_at=now_utc,
        )
        db.add(shift_obj)

    await log_event(
        db,
        actor=current_user,
        action="SHIFT_CONFIG_UPDATED",
        entity_type="ShiftConfig",
        entity_id=shift_obj.id or 0,
        old_values=old_values,
        new_values=payload.model_dump(),
    )
    await db.commit()
    return {
        "shift_code": sc_enum.value,
        "start_time": parsed_start.strftime("%H:%M"),
        "end_time": parsed_end.strftime("%H:%M"),
        "duration_hours": payload.duration_hours,
        "crosses_midnight": crosses,
        "detail": f"Shift {sc_enum.value} timing updated successfully.",
    }
