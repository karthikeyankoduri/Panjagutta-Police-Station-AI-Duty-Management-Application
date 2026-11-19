"""
The shared access matrix (frontend/src/lib/access-matrix.json) must match what the server enforces.

The web AppShell and the Android RoleAccessTest read the same file, so if this passes, all three
clients agree with the API about who may open each module.
"""
import json
from pathlib import Path

import pytest

from app.auth.dependencies import OFFICERS, STATION_ADMINS, SUPERVISORS
from app.models.models import UserRoleEnum
from conftest import login

MATRIX = json.loads(
    (Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "access-matrix.json").read_text("utf-8")
)
ROLES = [UserRoleEnum(r) for r in MATRIX["roles"]]
PROBED = [m for m in MATRIX["modules"] if "probe" in m]


def _names(group):
    return {r.value for r in group}


def test_roles_list_is_every_backend_role():
    assert set(MATRIX["roles"]) == {r.value for r in UserRoleEnum}


def test_groups_match_backend_role_groups():
    g = MATRIX["groups"]
    # SUPER_ADMIN passes every require_roles check (has_role), so it is in every group.
    assert set(g["OFFICERS"]) == _names(OFFICERS) | {"SUPER_ADMIN"}
    assert set(g["SUPERVISORS"]) == _names(SUPERVISORS) | {"SUPER_ADMIN"}
    assert set(g["ADMINS"]) == _names(STATION_ADMINS) | {"SUPER_ADMIN"}
    # SHO is deliberately excluded from Administration and the Audit Log.
    assert set(g["ADMIN_ONLY"]) == {"ADMIN_SI", "SUPER_ADMIN"}
    assert set(g["SHO_ONLY"]) == {"SHO", "SUPER_ADMIN"}


def test_every_group_reference_exists():
    groups = MATRIX["groups"]
    for m in MATRIX["modules"]:
        assert m["group"] in groups, m["id"]
    for tabs in MATRIX["tabs"].values():
        for t in tabs:
            assert t["group"] in groups, t["id"]
    for name, group in MATRIX["actions"].items():
        assert group in groups, name


@pytest.mark.parametrize("module", PROBED, ids=lambda m: m["id"])
@pytest.mark.parametrize("role", ROLES, ids=lambda r: r.value)
async def test_server_blocks_exactly_the_roles_the_matrix_excludes(client, make, module, role):
    headers = await login(client, await make.user(role))
    probe = module["probe"]
    res = await client.request(probe["method"], probe["path"], headers=headers)
    allowed = role.value in MATRIX["groups"][module["group"]]
    if allowed:
        assert res.status_code != 403, f"{role.value} should reach {module['label']} but got 403"
    else:
        assert res.status_code == 403, f"{role.value} must not reach {module['label']} (got {res.status_code})"
