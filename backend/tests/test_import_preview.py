"""The import preview reads CSV and Excel into an editable grid without saving anything."""
import io

import openpyxl
from sqlalchemy import func, select

from app.models.models import Staff, UserRoleEnum
from conftest import login

HEADER = ["S.No", "PG ID", "Rank", "Employee name", "Mobile no"]


def _xlsx() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Panjagutta PS staff list"])
    ws.append(HEADER)
    ws.append([1, "pg-901", "PC", "Test One", 9000000001])
    ws.append([2, "pg-902", "HC", "Test Two", 9000000002])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def test_preview_excel_returns_headers_and_rows_and_saves_nothing(client, db, make):
    h = await login(client, await make.user(UserRoleEnum.ADMIN_SI))
    res = await client.post("/api/staff/import-preview", headers=h,
                            files={"file": ("staff.xlsx", _xlsx())})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["headers"] == HEADER + ["Username"]  # a pre-filled, editable Username column is added
    assert body["rows"][0] == ["1", "pg-901", "PC", "Test One", "9000000001", "pgpc0001"]
    assert body["rows"][1][-1] == "pghc0002"
    assert body["row_count"] == 2
    assert (await db.execute(select(func.count()).select_from(Staff))).scalar_one() == 0


async def test_preview_csv(client, make):
    h = await login(client, await make.user(UserRoleEnum.ADMIN_SI))
    csv_bytes = ("\r\n".join([",".join(HEADER), "1,pg-903,PC,Test Three,9000000003"])).encode()
    res = await client.post("/api/staff/import-preview", headers=h, files={"file": ("s.csv", csv_bytes)})
    assert res.status_code == 200
    assert res.json()["rows"] == [["1", "pg-903", "PC", "Test Three", "9000000003", "pgpc0003"]]


async def test_preview_requires_admin_si(client, make):
    h = await login(client, await make.user(UserRoleEnum.SHO))
    res = await client.post("/api/staff/import-preview", headers=h, files={"file": ("s.csv", b"a,b\n1,2")})
    assert res.status_code == 403
