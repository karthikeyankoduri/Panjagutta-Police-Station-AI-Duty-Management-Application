"""
API contract: every endpoint (method, path, roles allowed) is pinned in api_contract.snapshot.json.

Why: the web app and the Android app both call this API. If a route is added, removed or its roles
change, this test fails until the snapshot is regenerated, so the change shows up in code review and
the author is reminded to update BOTH clients (see docs/feature-parity.md).

Regenerate after an intentional change:   UPDATE_CONTRACT=1 pytest tests/test_api_contract.py
"""
import json
import os
from pathlib import Path

from fastapi.routing import APIRoute

from app.main import app

SNAPSHOT = Path(__file__).with_name("api_contract.snapshot.json")


def _roles_for(route: APIRoute):
    found = []

    def walk(dependant):
        for dep in dependant.dependencies:
            roles = getattr(dep.call, "allowed_roles", None)
            if roles is not None:
                found.append(sorted(roles))
            walk(dep)

    walk(route.dependant)
    if not found:
        return "any signed-in user" if _needs_auth(route) else "public"
    return " + ".join(",".join(r) for r in found)


def _needs_auth(route: APIRoute) -> bool:
    def walk(dependant):
        for dep in dependant.dependencies:
            if getattr(dep.call, "__name__", "") == "get_current_user":
                return True
            if walk(dep):
                return True
        return False

    return walk(route.dependant)


def current_contract():
    rows = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api"):
            continue
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            rows.append(f"{method} {route.path} :: {_roles_for(route)}")
    return sorted(set(rows))


def test_api_contract_matches_snapshot():
    now = current_contract()
    if os.environ.get("UPDATE_CONTRACT"):
        SNAPSHOT.write_text(json.dumps(now, indent=1) + "\n", encoding="utf-8")
    assert SNAPSHOT.exists(), "No snapshot yet - run with UPDATE_CONTRACT=1 to create it."
    saved = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    added = sorted(set(now) - set(saved))
    removed = sorted(set(saved) - set(now))
    assert not added and not removed, (
        "The API changed. Update the web app AND the Android app if needed (docs/feature-parity.md), "
        "then regenerate the snapshot with UPDATE_CONTRACT=1.\n"
        f"  added/changed: {added}\n  removed/changed: {removed}"
    )
