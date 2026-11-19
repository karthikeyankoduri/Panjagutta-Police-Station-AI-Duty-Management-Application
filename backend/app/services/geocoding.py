"""Reverse geocoding via OpenStreetMap Nominatim (free, no API key).

Respects Nominatim's usage policy: descriptive User-Agent, at most one request per
second, and results are cached by rounded coordinates.
"""
from __future__ import annotations

import asyncio
import logging
import math
import time
from typing import Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_EARTH_RADIUS_M = 6371000.0
_MIN_INTERVAL_S = 1.0
_CACHE_MAX = 2000

_lock = asyncio.Lock()
_last_call = 0.0
_cache: dict[tuple[float, float], str] = {}


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * _EARTH_RADIUS_M * math.asin(math.sqrt(a))


def _short_name(data: dict) -> Optional[str]:
    addr = data.get("address") or {}
    parts = []
    for key in ("road", "neighbourhood", "suburb", "city_district", "city", "town", "village", "state_district"):
        v = addr.get(key)
        if v and v not in parts:
            parts.append(v)
        if len(parts) == 3:
            break
    if parts:
        return ", ".join(parts)[:500]
    name = data.get("display_name")
    return name[:500] if name else None


async def reverse_geocode(lat: float, lng: float) -> Optional[str]:
    """Return a human-readable place name, or None on any failure."""
    global _last_call
    key = (round(lat, 4), round(lng, 4))  # ~11 m cells
    if key in _cache:
        return _cache[key]
    async with _lock:
        if key in _cache:
            return _cache[key]
        wait = _MIN_INTERVAL_S - (time.monotonic() - _last_call)
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    settings.NOMINATIM_URL,
                    params={"lat": lat, "lon": lng, "format": "jsonv2", "zoom": 16, "addressdetails": 1},
                    headers={"User-Agent": settings.NOMINATIM_USER_AGENT, "Accept-Language": "en"},
                )
            resp.raise_for_status()
            name = _short_name(resp.json())
        except Exception as exc:  # never let geocoding break location reporting
            logger.warning("Reverse geocoding failed: %s", exc)
            return None
        finally:
            _last_call = time.monotonic()
        if name:
            if len(_cache) >= _CACHE_MAX:
                _cache.clear()
            _cache[key] = name
        return name
