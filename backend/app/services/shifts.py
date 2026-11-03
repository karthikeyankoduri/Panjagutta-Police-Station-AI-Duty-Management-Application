"""
Shift timing and rotation-policy helpers.

Every rule that depends on shift times or rest periods reads them from the
configuration tables (shift_config, rotation_rules) through this module, so that
nothing about shift timing is hard-coded (Build Guide §4.1, §5.3 principle 5).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Dict, Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import PolicyStatus, RotationRule, ShiftCode, ShiftConfig

STATION_TZ = ZoneInfo("Asia/Kolkata")

# Used only when shift_config has no row for a code (fresh database before bootstrap).
_FALLBACK = {
    ShiftCode.A: (time(8, 0), 6.0),
    ShiftCode.B: (time(14, 0), 6.0),
    ShiftCode.C: (time(20, 0), 12.0),
}


@dataclass(frozen=True)
class ShiftTiming:
    code: ShiftCode
    start: time
    end: time
    duration_hours: float

    def window(self, on: date) -> Tuple[datetime, datetime]:
        """Start and end (station local time, tz-aware) of this shift on the given duty date."""
        start = datetime.combine(on, self.start, tzinfo=STATION_TZ)
        return start, start + timedelta(hours=self.duration_hours)

    def label(self) -> str:
        return f"{self.start.strftime('%H:%M')}–{self.end.strftime('%H:%M')}"


@dataclass(frozen=True)
class RestPolicy:
    status: PolicyStatus
    min_rest_hours: Optional[float]
    duty_off_after_b_hours: Optional[float]
    rotation_sequence: Optional[str]
    exception_authorizer_role: Optional[str]

    @property
    def is_active(self) -> bool:
        return self.status in (PolicyStatus.CONFIRMED, PolicyStatus.DEMO_SIMULATED)

    @property
    def is_confirmed(self) -> bool:
        return self.status == PolicyStatus.CONFIRMED


async def load_shift_timings(db: AsyncSession) -> Dict[ShiftCode, ShiftTiming]:
    result = await db.execute(
        select(ShiftConfig).where(ShiftConfig.is_active == True).order_by(ShiftConfig.version.desc())
    )
    timings: Dict[ShiftCode, ShiftTiming] = {}
    for cfg in result.scalars().all():
        if cfg.shift_code not in timings:
            timings[cfg.shift_code] = ShiftTiming(cfg.shift_code, cfg.start_time, cfg.end_time, float(cfg.duration_hours))
    for code, (start, hours) in _FALLBACK.items():
        if code not in timings:
            end = (datetime.combine(date.today(), start) + timedelta(hours=hours)).time()
            timings[code] = ShiftTiming(code, start, end, hours)
    return timings


async def load_rest_policy(db: AsyncSession) -> RestPolicy:
    result = await db.execute(select(RotationRule).order_by(RotationRule.id.desc()).limit(1))
    rule = result.scalar_one_or_none()
    if not rule:
        return RestPolicy(PolicyStatus.UNCONFIRMED, None, None, None, None)
    return RestPolicy(
        rule.policy_status,
        rule.min_rest_hours_after_shift,
        rule.duty_off_after_shift_b_hours,
        rule.rotation_sequence,
        rule.exception_authorizer_role,
    )


def now_local() -> datetime:
    return datetime.now(STATION_TZ)


def current_shift(timings: Dict[ShiftCode, ShiftTiming], at: Optional[datetime] = None) -> Tuple[ShiftCode, date]:
    """Return the shift running at `at` and its duty date (a night shift belongs to the date it started)."""
    at = at or now_local()
    for duty_date in (at.date(), at.date() - timedelta(days=1)):
        for code, timing in timings.items():
            start, end = timing.window(duty_date)
            if start <= at < end:
                return code, duty_date
    # Gap between configured shifts: report the next one to start today.
    upcoming = sorted(timings.values(), key=lambda t: t.start)
    for timing in upcoming:
        if timing.window(at.date())[0] > at:
            return timing.code, at.date()
    return upcoming[0].code, at.date() + timedelta(days=1)


def next_shift(timings: Dict[ShiftCode, ShiftTiming], code: ShiftCode, duty_date: date) -> Tuple[ShiftCode, date]:
    ordered = sorted(timings.values(), key=lambda t: t.start)
    codes = [t.code for t in ordered]
    idx = codes.index(code)
    if idx + 1 < len(codes):
        return codes[idx + 1], duty_date
    return codes[0], duty_date + timedelta(days=1)


def required_rest_hours(policy: RestPolicy, previous_shift: ShiftCode) -> Optional[float]:
    """Rest required after `previous_shift`, per the active rotation rule (None when no rule is active)."""
    if not policy.is_active:
        return None
    hours = policy.min_rest_hours
    if previous_shift == ShiftCode.B and policy.duty_off_after_b_hours:
        hours = max(hours or 0, policy.duty_off_after_b_hours)
    return hours
