"""
Weekly duty allocation — a staff x day grid on top of the per-date/per-shift rosters.

No new tables: every grid cell (staff, date) is a RosterAssignment on the roster for that
date and shift. A week save fans out to the per-day rosters inside ONE transaction, in date
order, so rest/overlap rules see the neighbouring days that are being saved at the same time.

- Only staff the grid manages (`staff_ids` + staff in `cells`) are touched; other officers'
  allocations on the same rosters are preserved.
- Approved/published rosters are never edited here (they need /revise with a reason); they are
  reported as skipped.
- Blocking violations are refused unless an authorized exception is recorded, exactly like the
  single-roster save.
"""
from __future__ import annotations

from datetime import date as date_type, timedelta
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.roster import (
    DRAFT_VIEWERS, AssignmentIn, _get_active_rotation_policy, store_assignments,
)
from app.auth.dependencies import require_roles, sector_scope
from app.db.database import get_db
from app.models.models import (
    DutyMaster, PolicyStatus, Roster, RosterAssignment, RosterStatus, ShiftCode, Staff, User, UserRoleEnum,
)
from app.services.audit import AuditAction, log_event
from app.services.validation import validate_assignments

# Registered before the main roster router so "/rosters/week" is not read as "/rosters/{roster_id}".
router = APIRouter(prefix="/rosters/week", tags=["Roster"])

WRITERS = (UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)
EDITABLE = (RosterStatus.DRAFT, RosterStatus.SUBMITTED)


class WeekCell(BaseModel):
    staff_id: int
    date: date_type
    shift_code: ShiftCode
    duty_master_id: int
    notes: Optional[str] = None
    is_exception: bool = False
    exception_reason: Optional[str] = None
    exception_authorized_by_id: Optional[int] = None


class WeekIn(BaseModel):
    week_start: date_type
    # Staff rows shown in the grid. A staff member listed here with no cell on a day is
    # removed from that day's roster, so "clear a cell" works.
    staff_ids: List[int] = []
    cells: List[WeekCell] = []
    change_reason: Optional[str] = None


def monday_of(d: date_type) -> date_type:
    return d - timedelta(days=d.weekday())


def _latest_by_slot(rosters: List[Roster]) -> Dict[Tuple[date_type, ShiftCode], Roster]:
    best: Dict[Tuple[date_type, ShiftCode], Roster] = {}
    for r in rosters:
        key = (r.roster_date, r.shift_code)
        if key not in best or r.version > best[key].version:
            best[key] = r
    return best


@router.get("")
async def get_week(
    start: date_type = Query(..., description="Any date in the week; the week runs Monday to Sunday"),
    current_user: User = Depends(require_roles(*DRAFT_VIEWERS)),
    db: AsyncSession = Depends(get_db),
):
    """Staff x day cells for the week, from the newest version of every date/shift roster."""
    week_start = monday_of(start)
    week_end = week_start + timedelta(days=6)
    rosters = list((await db.execute(select(Roster).where(
        Roster.roster_date >= week_start, Roster.roster_date <= week_end))).scalars().all())
    best = _latest_by_slot(rosters)

    cells: List[dict] = []
    if best:
        by_id = {r.id: r for r in best.values()}
        scope = sector_scope(current_user)
        rows = (await db.execute(
            select(RosterAssignment, Staff, DutyMaster)
            .join(Staff, RosterAssignment.staff_id == Staff.id)
            .join(DutyMaster, RosterAssignment.duty_master_id == DutyMaster.id)
            .where(RosterAssignment.roster_id.in_(list(by_id)))
            .order_by(RosterAssignment.id.asc()))).all()
        for asn, staff, duty in rows:
            if scope is not None and staff.sector_id != scope:
                continue
            r = by_id[asn.roster_id]
            cells.append({
                "staff_id": staff.id, "staff_name": staff.name, "service_number": staff.service_number,
                "designation": staff.designation.value if hasattr(staff.designation, "value") else str(staff.designation),
                "date": str(r.roster_date), "shift_code": r.shift_code.value,
                "duty_master_id": duty.id, "duty_category": duty.category,
                "roster_id": r.id, "roster_status": r.status.value,
                "notes": asn.notes, "is_exception": asn.is_exception,
                "exception_reason": asn.exception_reason,
                "exception_authorized_by_id": asn.exception_authorized_by_id,
                "editable": r.status in EDITABLE,
            })
    return {
        "week_start": str(week_start), "week_end": str(week_end),
        "days": [str(week_start + timedelta(days=i)) for i in range(7)],
        "rosters": [
            {"id": r.id, "date": str(d), "shift_code": s.value, "version": r.version,
             "status": r.status.value, "editable": r.status in EDITABLE}
            for (d, s), r in sorted(best.items(), key=lambda kv: (kv[0][0], kv[0][1].value))
        ],
        "cells": cells,
    }


async def _apply_week(db: AsyncSession, payload: WeekIn, user: User) -> dict:
    """Write the week into the session (flushed, not committed). The caller commits or rolls back."""
    week_start = monday_of(payload.week_start)
    week_end = week_start + timedelta(days=6)

    seen = set()
    for c in payload.cells:
        if not (week_start <= c.date <= week_end):
            raise HTTPException(status_code=422, detail=f"{c.date} is outside the week {week_start} to {week_end}")
        if (c.staff_id, c.date) in seen:
            raise HTTPException(status_code=422, detail=f"Staff #{c.staff_id} has more than one duty on {c.date}")
        seen.add((c.staff_id, c.date))
    managed = set(payload.staff_ids) | {c.staff_id for c in payload.cells}

    by_slot: Dict[Tuple[date_type, ShiftCode], List[Tuple[int, WeekCell]]] = {}
    for idx, c in enumerate(payload.cells):
        by_slot.setdefault((c.date, c.shift_code), []).append((idx, c))

    rosters = list((await db.execute(select(Roster).where(
        Roster.roster_date >= week_start, Roster.roster_date <= week_end))).scalars().all())
    latest = _latest_by_slot(rosters)

    policy = None
    if payload.cells:
        policy = await _get_active_rotation_policy(db)
        if not policy:
            raise HTTPException(
                status_code=403,
                detail="Roster creation is gated on policy confirmation. An SHO must confirm or demo-simulate "
                       "the rotation/rest policy before drafting operational rosters.")

    days: List[dict] = []
    issues: List[dict] = []

    for offset in range(7):
        day = week_start + timedelta(days=offset)
        for shift in ShiftCode:
            desired = by_slot.get((day, shift), [])
            roster = latest.get((day, shift))
            old_rows: List[RosterAssignment] = []
            if roster:
                old_rows = list((await db.execute(select(RosterAssignment).where(
                    RosterAssignment.roster_id == roster.id).order_by(RosterAssignment.id.asc()))).scalars().all())
            managed_old = {(a.staff_id, a.duty_master_id) for a in old_rows if a.staff_id in managed}
            wanted = {(c.staff_id, c.duty_master_id) for _, c in desired}

            if not roster and not desired:
                continue
            slot = {"date": str(day), "shift_code": shift.value}
            if managed_old == wanted and roster:
                days.append({**slot, "action": "unchanged", "roster_id": roster.id, "status": roster.status.value})
                continue
            if roster and roster.status not in EDITABLE:
                days.append({**slot, "action": "skipped", "roster_id": roster.id, "status": roster.status.value,
                             "reason": f"Roster v{roster.version} is {roster.status.value}; revise it from the "
                                       f"Rosters tab to change it."})
                continue

            # Desired cells first so a validation index maps straight back to payload.cells;
            # other officers' existing allocations on this roster are carried over untouched.
            assignments = [AssignmentIn(
                duty_master_id=c.duty_master_id, staff_id=c.staff_id, notes=c.notes, is_exception=c.is_exception,
                exception_reason=c.exception_reason, exception_authorized_by_id=c.exception_authorized_by_id,
            ) for _, c in desired]
            n_desired = len(assignments)
            assignments += [AssignmentIn(
                duty_master_id=a.duty_master_id, staff_id=a.staff_id, sector_id=a.sector_id, notes=a.notes,
                is_exception=a.is_exception, exception_reason=a.exception_reason,
                exception_authorized_by_id=a.exception_authorized_by_id,
            ) for a in old_rows if a.staff_id not in managed]

            result = await validate_assignments(db, day, shift, assignments, user)
            for issue in result.issues:
                d = issue.as_dict()
                if issue.index is not None and issue.index < n_desired:
                    d["cell_index"] = desired[issue.index][0]
                elif issue.index is not None:
                    continue  # pre-existing allocation of an officer this grid is not editing
                else:
                    d["cell_index"] = None
                d["date"], d["shift_code"] = str(day), shift.value
                issues.append(d)

            if roster:
                await db.execute(delete(RosterAssignment).where(RosterAssignment.roster_id == roster.id))
                action, old_status = "updated", roster.status.value
                roster.modified_by_id = user.id
                if roster.status == RosterStatus.SUBMITTED:
                    roster.status = RosterStatus.DRAFT  # edited after submission: must be re-submitted
                if payload.change_reason:
                    roster.change_reason = payload.change_reason
            else:
                action, old_status = "created", None
                roster = Roster(
                    roster_date=day, shift_code=shift, version=1, status=RosterStatus.DRAFT,
                    change_reason=payload.change_reason, prepared_by_id=user.id,
                    is_demo_policy=policy.policy_status == PolicyStatus.DEMO_SIMULATED,
                )
                db.add(roster)
                await db.flush()
                latest[(day, shift)] = roster

            await store_assignments(db, roster, assignments, result, user)
            added = sorted(wanted - managed_old)
            removed = sorted(managed_old - wanted)
            await log_event(
                db, actor=user,
                action=AuditAction.ROSTER_CREATED if action == "created" else AuditAction.ROSTER_ASSIGNMENTS_UPDATED,
                entity_type="Roster", entity_id=roster.id,
                old_values={"status": old_status} if old_status else None,
                new_values={"via": "weekly allocation", "date": str(day), "shift": shift.value,
                            "added": [list(x) for x in added], "removed": [list(x) for x in removed],
                            "reason": payload.change_reason},
            )
            await db.flush()  # later days must see this roster when checking rest and overlap
            days.append({**slot, "action": action, "roster_id": roster.id, "status": roster.status.value})

    blocking = [i for i in issues if i["blocking"]]
    return {
        "week_start": str(week_start), "week_end": str(week_end), "days": days, "issues": issues,
        "blocking_count": len(blocking), "can_save": not blocking,
        "warnings": [i["message"] for i in issues],
    }


@router.post("/validate")
async def validate_week(
    payload: WeekIn,
    current_user: User = Depends(require_roles(*DRAFT_VIEWERS)),
    db: AsyncSession = Depends(get_db),
):
    """Dry run: the exact save pipeline, rolled back, so cross-day rules are checked against the proposed week."""
    try:
        return await _apply_week(db, payload, current_user)
    finally:
        await db.rollback()


@router.put("")
async def save_week(
    payload: WeekIn,
    current_user: User = Depends(require_roles(*WRITERS)),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await _apply_week(db, payload, current_user)
    except BaseException:
        await db.rollback()
        raise
    if result["blocking_count"]:
        await db.rollback()
        raise HTTPException(status_code=422, detail={
            "message": f"{result['blocking_count']} rule violation(s) must be fixed or authorized as exceptions "
                       f"before saving. Nothing was saved.", **result})
    await db.commit()
    changed = [d for d in result["days"] if d["action"] in ("created", "updated")]
    skipped = [d for d in result["days"] if d["action"] == "skipped"]
    result["detail"] = (f"Saved {len(changed)} roster(s) for the week of {result['week_start']}."
                        + (f" {len(skipped)} approved/published roster(s) were left unchanged." if skipped else ""))
    return result
