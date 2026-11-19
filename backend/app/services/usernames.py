"""
Login usernames for staff: "pg" + designation code + last 4 digits of the personal mobile.

    PC  with 98765 43210  ->  pgpc3210
    INSPECTOR  ...  9999  ->  pginsp9999

Rules (agreed with the station):
  * INSPECTOR is written "insp"; every other designation uses its own code in lower case.
  * Two people who would get the same name both move to the last 5 digits (then 6, ...).
  * A person with no usable phone gets no generated name (caller keeps the old pg_xxx name).
  * Existing accounts are never renamed here; callers pass their names in `taken`.
"""
from __future__ import annotations

import re
from typing import Dict, Hashable, Iterable, Optional, Set, Tuple

PREFIX = "pg"
DESIGNATION_CODES = {"INSPECTOR": "insp"}


def designation_code(designation) -> str:
    raw = getattr(designation, "value", designation)
    raw = str(raw or "").strip().upper()
    return DESIGNATION_CODES.get(raw, re.sub(r"[^a-z0-9]", "", raw.lower()))


def phone_digits(phone: Optional[str]) -> str:
    return re.sub(r"\D", "", phone or "")


def username_for(designation, phone: Optional[str], digits: int = 4) -> Optional[str]:
    """The name for one person using the last `digits` phone digits, or None if the phone is too short."""
    d = phone_digits(phone)
    code = designation_code(designation)
    if not code or len(d) < digits:
        return None
    return f"{PREFIX}{code}{d[-digits:]}"


def normalise_login(value: str) -> str:
    """What a person typed at sign-in, folded for comparison: no spaces, lower case."""
    return re.sub(r"\s+", "", (value or "")).lower()


def generate_usernames(
    items: Iterable[Tuple[Hashable, object, Optional[str]]],
    taken: Iterable[str] = (),
) -> Dict[Hashable, Tuple[Optional[str], str]]:
    """
    items: (key, designation, phone) for every person who needs a new name.
    taken: names already in use (lower case) that must not be reused.
    Returns {key: (username or None, note)}; note is "" when the 4-digit name was free,
    "clash" when more digits were needed, "no-phone" when no name could be built.
    """
    used: Set[str] = {t.lower() for t in taken}
    result: Dict[Hashable, Tuple[Optional[str], str]] = {}
    pending = []
    for key, desig, phone in items:
        if len(phone_digits(phone)) < 4 or not designation_code(desig):
            result[key] = (None, "no-phone")
        else:
            pending.append((key, desig, phone))

    n = 4
    clashed: Set[Hashable] = set()
    while pending:
        groups: Dict[str, list] = {}
        exhausted = []
        for key, desig, phone in pending:
            name = username_for(desig, phone, n)
            if name is None:
                exhausted.append((key, desig, phone))
            else:
                groups.setdefault(name, []).append((key, desig, phone))
        pending = []
        for name, members in groups.items():
            if len(members) == 1 and name not in used:
                key = members[0][0]
                used.add(name)
                result[key] = (name, "clash" if key in clashed else "")
            else:
                clashed.update(m[0] for m in members)
                pending.extend(members)
        # people whose phone has no more digits to add get a numeric suffix
        for key, desig, phone in exhausted:
            base = username_for(desig, phone, len(phone_digits(phone))) or ""
            i = 2
            while f"{base}{i}" in used:
                i += 1
            used.add(f"{base}{i}")
            result[key] = (f"{base}{i}", "clash")
        if pending and n >= 12:  # safety stop: identical phones
            for key, desig, phone in pending:
                base = username_for(desig, phone, n) or ""
                i = 2
                while f"{base}{i}" in used:
                    i += 1
                used.add(f"{base}{i}")
                result[key] = (f"{base}{i}", "clash")
            break
        n += 1
    return result
