"""
Staff register API — CRUD, CSV batch import, demo data wiping, user account management.
Supports:
- CSV bulk import of personnel and user logins (140 staff)
- Clear demo data
- Editing staff details & linked user credentials/roles
- Downloadable official 140 staff template
- Sector scoping and role restrictions
"""
from __future__ import annotations

import csv
import io
import logging
import os
import re
from datetime import date, datetime, timezone
from typing import List, Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import delete, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_user, require_roles
from app.auth.jwt import hash_password
from app.db.database import get_db
from app.models.models import (
    Sector,
    Staff,
    StaffCategory,
    StaffDesignation,
    User,
    UserRoleEnum,
    UserSession,
)
from app.services.audit import AuditAction, log_event

router = APIRouter(prefix="/staff", tags=["Staff Register"])


class StaffCreate(BaseModel):
    service_number: str
    name: str
    designation: StaffDesignation
    category: StaffCategory
    sector_id: Optional[int] = None
    section: Optional[str] = None
    reporting_officer_id: Optional[int] = None
    contact_phone: Optional[str] = None
    date_of_joining: Optional[date] = None
    notes: Optional[str] = None
    # Optional linked user on creation
    create_user: bool = False
    username: Optional[str] = None
    password: Optional[str] = None
    role: Optional[UserRoleEnum] = UserRoleEnum.STAFF


class StaffUpdate(BaseModel):
    name: Optional[str] = None
    designation: Optional[StaffDesignation] = None
    category: Optional[StaffCategory] = None
    sector_id: Optional[int] = None
    section: Optional[str] = None
    reporting_officer_id: Optional[int] = None
    contact_phone: Optional[str] = None
    date_of_joining: Optional[date] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None
    # User account editing
    user_role: Optional[UserRoleEnum] = None
    user_username: Optional[str] = None
    reset_password: Optional[str] = None


class StaffOut(BaseModel):
    id: int
    service_number: str
    name: str
    designation: str
    category: str
    sector_id: Optional[int] = None
    section: Optional[str] = None
    contact_phone: Optional[str] = None
    is_active: bool
    is_demo: bool
    date_of_joining: Optional[date] = None
    notes: Optional[str] = None
    user_id: Optional[int] = None
    user_username: Optional[str] = None
    user_role: Optional[str] = None

    class Config:
        from_attributes = True


class CsvImportPayload(BaseModel):
    csv_content: Optional[str] = None


@router.get("/", response_model=List[StaffOut])
async def list_staff(
    sector_id: Optional[int] = Query(None),
    designation: Optional[StaffDesignation] = Query(None),
    category: Optional[StaffCategory] = Query(None),
    section: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    search: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Staff).options(selectinload(Staff.user))
    if is_active is not None:
        query = query.where(Staff.is_active == is_active)

    # Sector SI can only see their sector
    if current_user.role == UserRoleEnum.SECTOR_SI:
        query = query.where(Staff.sector_id == current_user.sector_id)
    elif sector_id:
        query = query.where(Staff.sector_id == sector_id)

    if designation:
        query = query.where(Staff.designation == designation)
    if category:
        query = query.where(Staff.category == category)
    if section:
        query = query.where(Staff.section == section)
    if search:
        query = query.where(
            or_(
                Staff.name.ilike(f"%{search}%"),
                Staff.service_number.ilike(f"%{search}%"),
            )
        )

    query = query.order_by(Staff.id.asc())
    result = await db.execute(query)
    staff_items = result.scalars().all()

    out = []
    for s in staff_items:
        u = s.user
        out.append(
            StaffOut(
                id=s.id,
                service_number=s.service_number,
                name=s.name,
                designation=s.designation.value if hasattr(s.designation, "value") else str(s.designation),
                category=s.category.value if hasattr(s.category, "value") else str(s.category),
                sector_id=s.sector_id,
                section=s.section,
                contact_phone=s.contact_phone,
                is_active=s.is_active,
                is_demo=s.is_demo,
                date_of_joining=s.date_of_joining,
                notes=s.notes,
                user_id=u.id if u else None,
                user_username=u.username if u else None,
                user_role=u.role.value if (u and hasattr(u.role, "value")) else None,
            )
        )
    return out


@router.post("/", response_model=StaffOut, status_code=status.HTTP_201_CREATED)
async def create_staff(
    payload: StaffCreate,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(select(Staff).where(Staff.service_number == payload.service_number))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Service number {payload.service_number} already exists")

    dump = payload.model_dump(exclude={"create_user", "username", "password", "role"})
    staff = Staff(**dump, is_demo=False)
    db.add(staff)
    await db.flush()

    user_obj = None
    if payload.create_user and payload.username:
        user_obj = User(
            username=payload.username,
            hashed_password=hash_password(payload.password or "Password@PJ2024!"),
            role=payload.role or UserRoleEnum.STAFF,
            sector_id=staff.sector_id,
            staff_id=staff.id,
            is_active=True,
            is_demo=False,
            must_change_password=False,
        )
        db.add(user_obj)

    await log_event(
        db,
        actor=current_user,
        action=AuditAction.STAFF_CREATED,
        entity_type="Staff",
        entity_id=staff.id,
        new_values=payload.model_dump(),
    )
    await db.commit()
    await db.refresh(staff)

    return StaffOut(
        id=staff.id,
        service_number=staff.service_number,
        name=staff.name,
        designation=staff.designation.value if hasattr(staff.designation, "value") else str(staff.designation),
        category=staff.category.value if hasattr(staff.category, "value") else str(staff.category),
        sector_id=staff.sector_id,
        section=staff.section,
        contact_phone=staff.contact_phone,
        is_active=staff.is_active,
        is_demo=staff.is_demo,
        date_of_joining=staff.date_of_joining,
        notes=staff.notes,
        user_id=user_obj.id if user_obj else None,
        user_username=user_obj.username if user_obj else None,
        user_role=user_obj.role.value if (user_obj and hasattr(user_obj.role, "value")) else None,
    )


@router.patch("/{staff_id}", response_model=StaffOut)
async def update_staff(
    staff_id: int,
    payload: StaffUpdate,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    """
    Update staff member profile and linked user credentials/role.
    Only SHO and ADMIN_SI can update profiles and reset passwords.
    """
    res = await db.execute(
        select(Staff).options(selectinload(Staff.user)).where(Staff.id == staff_id)
    )
    staff = res.scalar_one_or_none()
    if not staff:
        raise HTTPException(status_code=404, detail=f"Staff member with ID {staff_id} not found")

    old_values = {
        "name": staff.name,
        "designation": staff.designation.value if hasattr(staff.designation, "value") else str(staff.designation),
        "is_active": staff.is_active,
    }

    # Update staff fields
    if payload.name is not None:
        staff.name = payload.name
    if payload.designation is not None:
        staff.designation = payload.designation
    if payload.category is not None:
        staff.category = payload.category
    if payload.sector_id is not None:
        staff.sector_id = payload.sector_id if payload.sector_id > 0 else None
    if payload.section is not None:
        staff.section = payload.section
    if payload.contact_phone is not None:
        staff.contact_phone = payload.contact_phone
    if payload.date_of_joining is not None:
        staff.date_of_joining = payload.date_of_joining
    if payload.notes is not None:
        staff.notes = payload.notes
    if payload.is_active is not None:
        staff.is_active = payload.is_active

    # User account handling
    user_obj = staff.user
    if not user_obj:
        user_res = await db.execute(select(User).where(User.staff_id == staff.id))
        user_obj = user_res.scalar_one_or_none()

    # If user doesn't exist yet and username or role or password provided, create it
    if not user_obj and (payload.user_username or payload.user_role or payload.reset_password):
        uname = (payload.user_username or staff.service_number).strip().lower().replace("-", "_")
        pwd = payload.reset_password or "Password@PJ2024!"
        role = payload.user_role or UserRoleEnum.STAFF
        user_obj = User(
            username=uname,
            hashed_password=hash_password(pwd),
            role=role,
            sector_id=staff.sector_id,
            staff_id=staff.id,
            is_active=staff.is_active,
            is_demo=False,
            must_change_password=False,
        )
        db.add(user_obj)
        await db.flush()
    elif user_obj:
        if payload.user_role is not None:
            user_obj.role = payload.user_role
        if payload.user_username:
            new_uname = payload.user_username.strip().lower()
            # Check unique username
            existing_uname = await db.execute(
                select(User).where(User.username == new_uname, User.id != user_obj.id)
            )
            if not existing_uname.scalar_one_or_none():
                user_obj.username = new_uname
        if payload.reset_password and payload.reset_password.strip():
            user_obj.hashed_password = hash_password(payload.reset_password.strip())
            user_obj.failed_login_attempts = 0
            user_obj.locked_until = None
            user_obj.must_change_password = False
        if payload.is_active is not None:
            user_obj.is_active = payload.is_active
        if payload.sector_id is not None:
            user_obj.sector_id = staff.sector_id

    await log_event(
        db,
        actor=current_user,
        action=AuditAction.STAFF_UPDATED,
        entity_type="Staff",
        entity_id=staff.id,
        old_values=old_values,
        new_values=payload.model_dump(exclude_unset=True, exclude={"reset_password"}),
    )
    await db.commit()
    await db.refresh(staff)
    if user_obj:
        await db.refresh(user_obj)

    return StaffOut(
        id=staff.id,
        service_number=staff.service_number,
        name=staff.name,
        designation=staff.designation.value if hasattr(staff.designation, "value") else str(staff.designation),
        category=staff.category.value if hasattr(staff.category, "value") else str(staff.category),
        sector_id=staff.sector_id,
        section=staff.section,
        contact_phone=staff.contact_phone,
        is_active=staff.is_active,
        is_demo=staff.is_demo,
        date_of_joining=staff.date_of_joining,
        notes=staff.notes,
        user_id=user_obj.id if user_obj else None,
        user_username=user_obj.username if user_obj else None,
        user_role=user_obj.role.value if (user_obj and hasattr(user_obj.role, "value")) else None,
    )


@router.get("/download-template")
async def download_template_csv():
    """Returns the official 140 staff dataset as a downloadable CSV."""
    candidates = [
        os.path.join(os.getcwd(), "data", "panjagutta_140_police_staff.csv"),
        os.path.join(os.getcwd(), "panjagutta_140_police_staff.csv"),
        "/app/data/panjagutta_140_police_staff.csv",
    ]
    csv_path = None
    for c in candidates:
        if os.path.exists(c):
            csv_path = c
            break

    if not csv_path:
        raise HTTPException(status_code=404, detail="CSV template file not found on server")

    return FileResponse(
        csv_path,
        media_type="text/csv",
        filename="panjagutta_140_police_staff.csv",
    )


@router.post("/clear-demo-data")
async def clear_demo_data(
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    """
    Clears all demo operational records, staff profiles, and other demo users,
    retaining only the active administrator who performs the action.
    """
    # 1. Clear operational tables with FK dependencies
    for tbl in [
        "alerts", "audit_log", "attachment_orders", "movements",
        "leave_requests", "tasks", "attendance", "roster_assignments",
        "rosters",
    ]:
        try:
            await db.execute(text(f'DELETE FROM "{tbl}"'))
        except Exception:
            pass

    # 2. Nullify user references in static configs
    try:
        await db.execute(text('UPDATE rotation_rules SET confirmed_by_id = NULL'))
    except Exception:
        pass
    try:
        await db.execute(text('UPDATE shift_config SET modified_by_id = NULL'))
    except Exception:
        pass

    # 3. Unlink staff references in users and self-references in staff
    try:
        await db.execute(text('UPDATE users SET staff_id = NULL'))
        await db.execute(text('UPDATE staff SET reporting_officer_id = NULL'))
    except Exception:
        pass

    # 4. Delete non-admin sessions and non-admin users
    await db.execute(delete(UserSession).where(UserSession.user_id != current_user.id))
    await db.execute(delete(User).where(User.id != current_user.id))

    # 5. Delete all staff records
    await db.execute(delete(Staff))
    await db.commit()

    await log_event(
        db,
        actor=current_user,
        action="DEMO_DATA_CLEARED",
        entity_type="System",
        entity_id=0,
        new_values={"admin": current_user.username},
    )
    await db.commit()

    return {
        "success": True,
        "detail": "All demo records and staff have been wiped. You are ready to import the 140 personnel CSV.",
        "admin_retained": current_user.username,
    }


HEADER_KEYWORDS = [
    "sno", "serial", "range", "zone", "division", "police", "station",
    "employee", "emp", "rank", "designation", "general", "name", "mobile",
    "phone", "dept", "department", "tongue", "email", "category", "sector", "section",
    "pgid", "service", "role", "cadre", "post"
]


def find_header_row_and_data_from_rows(all_rows):
    best_idx = -1
    best_score = 0
    best_headers = []

    for idx, row in enumerate(all_rows[:25]):
        if not row or not any(row):
            continue
        cleaned_cells = [
            re.sub(r'[\r\n\t\xa0]+', ' ', str(c)).strip() if c is not None else ""
            for c in row
        ]
        score = 0
        for cell in cleaned_cells:
            if not cell:
                continue
            alpha = re.sub(r'[^a-z0-9]', '', cell.lower())
            for kw in HEADER_KEYWORDS:
                if kw in alpha:
                    score += 1
                    break
        if score > best_score and score >= 2:
            best_score = score
            best_idx = idx
            best_headers = cleaned_cells

    if best_idx == -1:
        for idx, row in enumerate(all_rows):
            if any(row):
                return idx, [str(c).strip() if c is not None else "" for c in row], all_rows[idx + 1:], 0
        return 0, [], [], 0

    return best_idx, best_headers, all_rows[best_idx + 1:], best_score


def format_cell_val(val) -> str:
    if val is None:
        return ""
    if isinstance(val, float) and val.is_integer():
        return str(int(val))
    val_str = str(val).strip()
    if val_str.endswith(".0") and val_str[:-2].isdigit():
        return val_str[:-2]
    return val_str


def get_field_val(clean_dict, *candidates):
    for c in candidates:
        if c in clean_dict and clean_dict[c]:
            return clean_dict[c]
    return ""


def find_name_val(clean_dict, row_cells):
    val = get_field_val(
        clean_dict,
        "employeename", "officername", "staffname", "personnelname",
        "fullname", "empname", "name"
    )
    if val:
        return val
    # Check if any key contains 'name' and is not a geographic/department/system entity
    for k, v in clean_dict.items():
        if "name" in k and not any(x in k for x in ["station", "division", "zone", "range", "father", "mother", "user", "file", "unit"]):
            if v and re.search(r'[a-zA-Z]{2,}', v):
                return v
    # Positional fallback based on standard police proforma (Cols 8, 9, 7, 6, 5)
    if row_cells:
        for pos in (8, 9, 7, 6, 5):
            if pos < len(row_cells):
                cell_val = format_cell_val(row_cells[pos])
                if cell_val and re.search(r'[a-zA-Z]{2,}', cell_val):
                    c_up = cell_val.upper().strip()
                    if not any(r == c_up for r in [
                        "INSPECTOR", "CONSTABLE", "PANJAGUTTA", "CHARMINAR", "KHAIRATABAD",
                        "TELUGU", "URDU", "HINDI", "MALE", "FEMALE", "HEAD CONSTABLE", "SUB-INSPECTOR"
                    ]):
                        return cell_val
    return ""


def find_sno_and_pg_id_val(clean_dict, row_cells, row_idx):
    pg_id = get_field_val(clean_dict, "pgid", "uniqueid", "servicenumber", "serviceno", "badge")
    if not pg_id:
        for k, v in clean_dict.items():
            if "pg" in k and "id" in k:
                if v:
                    pg_id = v
                    break
            elif "unique" in k and "id" in k:
                if v:
                    pg_id = v
                    break

    sno_val = get_field_val(clean_dict, "sno", "slno", "serialno", "serial")
    if not sno_val and row_cells and len(row_cells) > 0:
        c0 = format_cell_val(row_cells[0])
        if c0.isdigit():
            sno_val = c0

    if pg_id:
        clean_id = pg_id.strip().lower()
        m = re.match(r'^pg[-_]?(\d+)$', clean_id)
        if m:
            svc = f"pg-{int(m.group(1)):03d}"
        else:
            svc = clean_id
    elif sno_val and sno_val.isdigit():
        svc = f"pg-{int(sno_val):03d}"
    else:
        svc = f"pg-{row_idx - 1:03d}"

    return sno_val, svc


def find_rank_val(clean_dict, row_cells):
    val = get_field_val(clean_dict, "rank", "designation", "post", "cadre", "designationrank")
    if val:
        return val
    for k, v in clean_dict.items():
        if any(x in k for x in ["rank", "desig", "post", "cadre"]):
            if v:
                return v
    if row_cells:
        for pos in (6, 7, 5):
            if pos < len(row_cells):
                cell_val = format_cell_val(row_cells[pos])
                if any(x in cell_val.upper() for x in ["INSP", "SI", "ASI", "HC", "PC", "CONST", "HG", "SPO"]):
                    return cell_val
    return "PC"


def find_emp_id_val(clean_dict, row_cells):
    val = get_field_val(clean_dict, "employeeid", "empid", "hrmsid", "treasuryid", "badgeid")
    if val:
        return val
    for k, v in clean_dict.items():
        if ("employee" in k or "emp" in k) and "id" in k:
            if v:
                return v
    if row_cells:
        for pos in (5, 6, 4):
            if pos < len(row_cells):
                cell_val = format_cell_val(row_cells[pos])
                if cell_val.isdigit() and len(cell_val) >= 4:
                    return cell_val
    return ""


def find_phone_val(clean_dict, row_cells):
    def extract_clean_phone(raw):
        if not raw:
            return ""
        s = format_cell_val(raw)
        digits = re.sub(r'[^0-9]', '', s)
        if len(digits) == 10:
            return digits
        elif len(digits) == 12 and digits.startswith("91"):
            return digits[2:]
        elif len(digits) == 11 and digits.startswith("0"):
            return digits[1:]
        elif len(digits) >= 10:
            return digits[:10]
        return ""

    personal_raw = get_field_val(clean_dict, "mobilenopersonal", "mobileno", "personalmobile", "mobile", "contactphone", "phone")
    dept_raw = get_field_val(clean_dict, "departmentno", "deptno", "officialmobile", "departmentphone")
    personal = extract_clean_phone(personal_raw)
    dept = extract_clean_phone(dept_raw)

    if not personal:
        for k, v in clean_dict.items():
            if ("mobile" in k or "phone" in k or "contact" in k) and "dept" not in k and "department" not in k:
                p = extract_clean_phone(v)
                if p:
                    personal = p
                    break
    if not personal and row_cells:
        for pos in (9, 10, 8, 7):
            if pos < len(row_cells):
                p = extract_clean_phone(row_cells[pos])
                if p:
                    personal = p
                    break
    if not dept and row_cells:
        for pos in (10, 9, 11, 8):
            if pos < len(row_cells):
                d = extract_clean_phone(row_cells[pos])
                if d and d != personal:
                    dept = d
                    break
    return personal, dept


def find_email_val(clean_dict, row_cells):
    em = get_field_val(clean_dict, "emailid", "email", "mailid", "emailaddress")
    if not em:
        for k, v in clean_dict.items():
            if "email" in k or "mail" in k:
                if v and "@" in v:
                    em = v
                    break
    if not em and row_cells:
        for pos in (12, 13, 11, 10):
            if pos < len(row_cells):
                c = format_cell_val(row_cells[pos])
                if "@" in c and "." in c:
                    em = c
                    break
    return em


@router.post("/import-csv")
async def import_staff_csv(
    request: Request,
    file: Optional[UploadFile] = File(None),
    payload: Optional[CsvImportPayload] = None,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    """
    Bulk import staff members and linked user login accounts from CSV or Excel (.xlsx/.xls).
    Supports government police HRMS proforma with unique PG ID (e.g., pg-011).
    """
    content_type = request.headers.get("content-type", "")
    content_bytes = b""
    filename = ""
    raw_csv_text = ""

    if "multipart/form-data" in content_type:
        try:
            form = await request.form()
            uploaded_file = form.get("file")
            if uploaded_file and hasattr(uploaded_file, "read"):
                content_bytes = await uploaded_file.read()
                filename = getattr(uploaded_file, "filename", "") or ""
            csv_field = form.get("csv_content")
            if csv_field and isinstance(csv_field, str):
                raw_csv_text = csv_field
        except Exception:
            pass

    if not content_bytes and not raw_csv_text:
        if file and hasattr(file, "read"):
            content_bytes = await file.read()
            filename = getattr(file, "filename", "") or ""
        elif payload and payload.csv_content:
            raw_csv_text = payload.csv_content
        elif "application/json" in content_type:
            try:
                body = await request.json()
                raw_csv_text = body.get("csv_content", "")
            except Exception:
                pass
        else:
            try:
                content_bytes = await request.body()
            except Exception:
                pass

    rows: List[dict] = []
    detected_headers: List[str] = []

    # 1. Check if uploaded file is Excel (.xlsx or .xls)
    is_excel = filename.lower().endswith((".xlsx", ".xls")) or content_bytes.startswith(b"PK\x03\x04")
    if is_excel and content_bytes:
        try:
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(content_bytes), data_only=True)

            # Scan all sheets to find the one with the highest count of police staff headers
            chosen_sheet = None
            best_h_idx = -1
            best_headers = []
            best_data_rows = []
            max_kw_count = 0

            for ws in wb.worksheets:
                all_ws_rows = list(ws.iter_rows(values_only=True))
                h_idx, hdrs, d_rows, kw_count = find_header_row_and_data_from_rows(all_ws_rows)
                if kw_count > max_kw_count:
                    max_kw_count = kw_count
                    chosen_sheet = ws
                    best_h_idx = h_idx
                    best_headers = hdrs
                    best_data_rows = d_rows

            if not chosen_sheet:
                chosen_sheet = wb.active
                all_ws_rows = list(chosen_sheet.iter_rows(values_only=True))
                best_h_idx, best_headers, best_data_rows, _ = find_header_row_and_data_from_rows(all_ws_rows)

            detected_headers = best_headers
            logger.info(
                "Parsed Excel sheet '%s' with header row %d, %d headers, %d data rows",
                chosen_sheet.title if chosen_sheet else "Unknown",
                best_h_idx,
                len(best_headers),
                len(best_data_rows),
            )

            for row_tuple in best_data_rows:
                if not any(str(c).strip() for c in row_tuple if c is not None):
                    continue
                row_dict = {}
                for h, val in zip(best_headers, row_tuple):
                    if h:
                        row_dict[h] = format_cell_val(val)
                row_dict["__raw_cells__"] = row_tuple
                if any(v for k, v in row_dict.items() if k != "__raw_cells__"):
                    rows.append(row_dict)
        except Exception as e:
            logger.exception("Failed to read Excel file: %s", e)
            raise HTTPException(
                status_code=400,
                detail=f"Failed to read Excel file: {str(e)}. Please ensure it is a valid .xlsx or .csv file."
            )
    else:
        # 2. Parse as CSV
        if not raw_csv_text and content_bytes:
            for enc in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
                try:
                    raw_csv_text = content_bytes.decode(enc)
                    break
                except UnicodeDecodeError:
                    continue

        if not raw_csv_text or not raw_csv_text.strip():
            raise HTTPException(status_code=400, detail="No CSV or Excel content received.")

        try:
            reader = csv.reader(io.StringIO(raw_csv_text, newline=None))
            all_csv_rows = list(reader)
            h_idx, best_headers, best_data_rows, _ = find_header_row_and_data_from_rows(all_csv_rows)
            detected_headers = best_headers

            for row_list in best_data_rows:
                if not any(str(c).strip() for c in row_list if c):
                    continue
                row_dict = {}
                for h, val in zip(best_headers, row_list):
                    if h:
                        row_dict[h] = format_cell_val(val)
                row_dict["__raw_cells__"] = row_list
                if any(v for k, v in row_dict.items() if k != "__raw_cells__"):
                    rows.append(row_dict)
        except Exception as e:
            logger.exception("Failed to parse CSV data: %s", e)
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse CSV data: {str(e)}"
            )

    if not rows:
        raise HTTPException(
            status_code=400,
            detail="The uploaded file contains no data rows. Please ensure your file has data rows beneath the header."
        )

    # Map sectors
    sec_res = await db.execute(select(Sector))
    sectors_list = sec_res.scalars().all()
    sector_map = {}
    for s in sectors_list:
        sector_map[str(s.id)] = s.id
        sector_map[f"sector {s.id}"] = s.id
        sector_map[f"sector{s.id}"] = s.id
        sector_map[s.code.lower()] = s.id
        sector_map[s.name.lower()] = s.id

    default_pwd_hash = hash_password("Password@PJ2024!")

    imported_new_count = 0
    updated_staff_count = 0
    created_users_count = 0
    updated_users_count = 0
    errors = []

    for row_idx, r in enumerate(rows, start=2):
        raw_cells = r.get("__raw_cells__", ())
        clean_dict = {
            re.sub(r'[^a-z0-9]', '', str(k).lower()): (str(v).strip() if v is not None else "")
            for k, v in r.items()
            if k and k != "__raw_cells__"
        }

        # 1. Name Resolution
        name = find_name_val(clean_dict, raw_cells)
        if not name:
            sample_vals = [str(x) for x in raw_cells[:5] if x is not None]
            errors.append(f"Row {row_idx}: Could not detect Officer Name (Data: {sample_vals})")
            continue

        # 2. S.No & PG ID Resolution (e.g. pg-011, pg-001)
        sno_raw, svc = find_sno_and_pg_id_val(clean_dict, raw_cells, row_idx)

        # 3. Designation / Rank Mapping
        rank_raw = find_rank_val(clean_dict, raw_cells)
        rank_str = rank_raw.upper().strip()

        if "AWSI" in rank_str or "WASI" in rank_str or "WOMEN ASSISTANT" in rank_str:
            desig = StaffDesignation.AWSI
        elif "ASI" in rank_str or "ASSISTANT" in rank_str or "ASST" in rank_str:
            desig = StaffDesignation.ASI
        elif "WSI" in rank_str or "WOMEN SUB" in rank_str or "WOMEN SI" in rank_str:
            desig = StaffDesignation.WSI
        elif (
            "SUB-INSP" in rank_str
            or "SUB INSP" in rank_str
            or "SUBINSP" in rank_str
            or "PSI" in rank_str
            or rank_str == "SI"
            or rank_str.startswith("SI ")
            or rank_str.endswith(" SI")
        ):
            desig = StaffDesignation.SI
        elif any(x in rank_str for x in ["INSP", "SHO", "CI", "CIR"]):
            desig = StaffDesignation.INSPECTOR
        elif "ARWPC" in rank_str:
            desig = StaffDesignation.ARWPC
        elif "ARPC" in rank_str or "ARMED" in rank_str:
            desig = StaffDesignation.ARPC
        elif "WHC" in rank_str or "WOMEN HEAD" in rank_str or "WOMAN HEAD" in rank_str:
            desig = StaffDesignation.WHC
        elif "HC" in rank_str or "HEAD" in rank_str:
            desig = StaffDesignation.HC
        elif "WPC" in rank_str or "WOMEN PC" in rank_str or "WOMAN PC" in rank_str or "WOMEN POLICE" in rank_str:
            desig = StaffDesignation.WPC
        elif "WHGS" in rank_str or "WOMEN HG" in rank_str or "WHG" in rank_str:
            desig = StaffDesignation.WHGS
        elif "HGS" in rank_str or "HOME" in rank_str or "HG" in rank_str:
            desig = StaffDesignation.HGS
        elif "SPO" in rank_str or "SPECIAL" in rank_str:
            desig = StaffDesignation.SPO
        else:
            desig = StaffDesignation.PC

        # 4. Sector & Section
        sector_val = get_field_val(clean_dict, "sector", "sectorid")
        sector_id = None
        if sector_val:
            sector_id = sector_map.get(sector_val.lower())
            if not sector_id and sector_val.replace(".0", "").isdigit():
                sector_id = int(float(sector_val))

        section_val = get_field_val(clean_dict, "section", "sectionname", "wing") or None

        # 5. Category Mapping
        cat_str = get_field_val(clean_dict, "category").upper().strip()
        if cat_str:
            try:
                cat = StaffCategory(cat_str)
            except ValueError:
                if "SECTOR" in cat_str:
                    cat = StaffCategory.SECTOR_STAFF
                elif "DRIVER" in cat_str:
                    cat = StaffCategory.DRIVER
                elif "ATTACH" in cat_str:
                    cat = StaffCategory.ATTACHED
                else:
                    cat = StaffCategory.SECTION_DUTY
        else:
            if sector_id is not None:
                cat = StaffCategory.SECTOR_STAFF
            elif "DRIVER" in rank_str or (section_val and "DRIVER" in section_val.upper()):
                cat = StaffCategory.DRIVER
            else:
                cat = StaffCategory.SECTION_DUTY

        # 6. Police Department Proforma Details
        emp_id = find_emp_id_val(clean_dict, raw_cells)
        gen_no = get_field_val(clean_dict, "generalno", "genno", "badgeno")
        personal_mobile, dept_no = find_phone_val(clean_dict, raw_cells)
        mother_tongue = get_field_val(clean_dict, "mothertongue", "tongue", "language")
        range_val = get_field_val(clean_dict, "range")
        zone_val = get_field_val(clean_dict, "zone")
        div_val = get_field_val(clean_dict, "division")
        ps_val = get_field_val(clean_dict, "policestation", "station", "ps")
        email_val = find_email_val(clean_dict, raw_cells)

        phone_val = personal_mobile or dept_no or None

        meta_parts = []
        if emp_id:
            meta_parts.append(f"Emp ID: {emp_id}")
        if gen_no:
            meta_parts.append(f"Gen No: {gen_no}")
        if dept_no:
            meta_parts.append(f"Dept No: {dept_no}")
        if mother_tongue:
            meta_parts.append(f"Mother Tongue: {mother_tongue}")
        if range_val:
            meta_parts.append(f"Range: {range_val}")
        if zone_val:
            meta_parts.append(f"Zone: {zone_val}")
        if div_val:
            meta_parts.append(f"Div: {div_val}")
        if ps_val:
            meta_parts.append(f"PS: {ps_val}")

        proforma_notes = " | ".join(meta_parts)
        existing_notes = get_field_val(clean_dict, "notes", "remarks")
        if existing_notes and proforma_notes:
            notes_val = f"{existing_notes} | {proforma_notes}"
        elif proforma_notes:
            notes_val = proforma_notes
        elif existing_notes:
            notes_val = existing_notes
        else:
            notes_val = None

        doj_val = None
        raw_doj = get_field_val(clean_dict, "dateofjoining", "doj")
        if raw_doj:
            try:
                doj_val = date.fromisoformat(raw_doj)
            except ValueError:
                pass

        # 7. Database Transaction with Nested Savepoint
        try:
            async with db.begin_nested():
                # Upsert Staff
                staff_res = await db.execute(select(Staff).where(Staff.service_number == svc))
                staff_obj = staff_res.scalar_one_or_none()

                if staff_obj:
                    staff_obj.name = name
                    staff_obj.designation = desig
                    staff_obj.category = cat
                    staff_obj.sector_id = sector_id
                    staff_obj.section = section_val
                    staff_obj.contact_phone = phone_val
                    if doj_val:
                        staff_obj.date_of_joining = doj_val
                    if notes_val:
                        staff_obj.notes = notes_val
                    staff_obj.is_active = True
                    staff_obj.is_demo = False
                    updated_staff_count += 1
                else:
                    staff_obj = Staff(
                        service_number=svc,
                        name=name,
                        designation=desig,
                        category=cat,
                        sector_id=sector_id,
                        section=section_val,
                        contact_phone=phone_val,
                        date_of_joining=doj_val,
                        notes=notes_val,
                        is_active=True,
                        is_demo=False,
                    )
                    db.add(staff_obj)
                    imported_new_count += 1

                await db.flush()

                # User Login Account
                uname = get_field_val(clean_dict, "username", "user")
                if not uname:
                    uname = svc.replace("-", "_").lower()

                role_val = get_field_val(clean_dict, "role", "userrole")
                if role_val:
                    role_str = role_val.upper()
                    try:
                        role_enum = UserRoleEnum(role_str)
                    except ValueError:
                        if "SHO" in role_str:
                            role_enum = UserRoleEnum.SHO
                        elif "ADMIN" in role_str:
                            role_enum = UserRoleEnum.ADMIN_SI
                        elif "SECTOR" in role_str:
                            role_enum = UserRoleEnum.SECTOR_SI
                        elif "DI" == role_str:
                            role_enum = UserRoleEnum.DI
                        elif "DSI" in role_str:
                            role_enum = UserRoleEnum.DSI
                        else:
                            role_enum = UserRoleEnum.STAFF
                else:
                    if desig == StaffDesignation.INSPECTOR:
                        if row_idx == 2 or "SHO" in name.upper() or "STATION HOUSE" in (notes_val or "").upper():
                            role_enum = UserRoleEnum.SHO
                        else:
                            role_enum = UserRoleEnum.DI
                    elif desig in (StaffDesignation.SI, StaffDesignation.WSI):
                        if sector_id:
                            role_enum = UserRoleEnum.SECTOR_SI
                        elif "ADMIN" in (section_val or "").upper() or "ADMIN" in (notes_val or "").upper():
                            role_enum = UserRoleEnum.ADMIN_SI
                        elif "DUTY" in (section_val or "").upper():
                            role_enum = UserRoleEnum.DSI
                        else:
                            role_enum = UserRoleEnum.STAFF
                    else:
                        role_enum = UserRoleEnum.STAFF

                pwd = get_field_val(clean_dict, "password", "pwd", "loginpassword", "defaultpassword", "pin")
                if pwd and pwd != "Password@PJ2024!":
                    pwd_hashed = hash_password(pwd)
                else:
                    pwd_hashed = default_pwd_hash

                email_clean = (email_val or "").strip().lower() or None
                if email_clean:
                    existing_email_res = await db.execute(
                        select(User).where(User.email == email_clean)
                    )
                    existing_email_user = existing_email_res.scalar_one_or_none()
                    if existing_email_user and (existing_email_user.username != uname):
                        email_clean = None

                user_res = await db.execute(select(User).where(User.username == uname))
                user_obj = user_res.scalar_one_or_none()
                if not user_obj and staff_obj.id:
                    user_res2 = await db.execute(select(User).where(User.staff_id == staff_obj.id))
                    user_obj = user_res2.scalar_one_or_none()

                if user_obj:
                    user_obj.role = role_enum
                    user_obj.sector_id = sector_id
                    user_obj.staff_id = staff_obj.id
                    user_obj.is_active = True
                    user_obj.is_demo = False
                    if email_clean:
                        user_obj.email = email_clean
                    if pwd:
                        user_obj.hashed_password = pwd_hashed
                    updated_users_count += 1
                else:
                    user_obj = User(
                        username=uname,
                        email=email_clean,
                        hashed_password=pwd_hashed,
                        role=role_enum,
                        sector_id=sector_id,
                        staff_id=staff_obj.id,
                        is_active=True,
                        is_demo=False,
                        must_change_password=False,
                    )
                    db.add(user_obj)
                    created_users_count += 1

        except Exception as e:
            errors.append(f"Row {row_idx} ({name} / {svc}): {str(e)}")

    total_processed_staff = imported_new_count + updated_staff_count

    await log_event(
        db,
        actor=current_user,
        action="STAFF_CSV_IMPORTED",
        entity_type="Staff",
        entity_id=0,
        new_values={
            "total_rows": len(rows),
            "imported_new": imported_new_count,
            "updated_staff": updated_staff_count,
            "total_processed": total_processed_staff,
            "created_users": created_users_count,
            "updated_users": updated_users_count,
            "errors_count": len(errors),
        },
    )
    await db.commit()

    # Get total staff count in station
    tot_res = await db.execute(select(Staff.id))
    current_total_staff = len(tot_res.all())

    success_flag = total_processed_staff > 0 or len(rows) == 0
    if total_processed_staff > 0:
        result_msg = f"Successfully processed {total_processed_staff} staff personnel ({imported_new_count} new, {updated_staff_count} updated) and provisioned {created_users_count + updated_users_count} user accounts."
    else:
        result_msg = f"Import failed: 0 of {len(rows)} staff records could be processed. Headers detected: {detected_headers[:6]}. Please verify your column headers."

    return {
        "success": success_flag,
        "message": result_msg,
        "imported_count": total_processed_staff,
        "imported_new": imported_new_count,
        "updated_staff": updated_staff_count,
        "total_staff_count": current_total_staff,
        "total_rows": len(rows),
        "created_users": created_users_count,
        "updated_users": updated_users_count,
        "detected_headers": detected_headers,
        "details": errors,
        "errors": errors,
    }


@router.get("/{staff_id}", response_model=StaffOut)
async def get_staff(
    staff_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Staff).options(selectinload(Staff.user)).where(Staff.id == staff_id)
    )
    staff = result.scalar_one_or_none()
    if not staff:
        raise HTTPException(status_code=404, detail="Staff not found")

    # Sector SI scope check
    if current_user.role == UserRoleEnum.SECTOR_SI and staff.sector_id != current_user.sector_id:
        raise HTTPException(status_code=403, detail="Access denied: different sector")

    u = staff.user
    return StaffOut(
        id=staff.id,
        service_number=staff.service_number,
        name=staff.name,
        designation=staff.designation.value if hasattr(staff.designation, "value") else str(staff.designation),
        category=staff.category.value if hasattr(staff.category, "value") else str(staff.category),
        sector_id=staff.sector_id,
        section=staff.section,
        contact_phone=staff.contact_phone,
        is_active=staff.is_active,
        is_demo=staff.is_demo,
        date_of_joining=staff.date_of_joining,
        notes=staff.notes,
        user_id=u.id if u else None,
        user_username=u.username if u else None,
        user_role=u.role.value if (u and hasattr(u.role, "value")) else None,
    )


@router.patch("/{staff_id}", response_model=StaffOut)
async def update_staff(
    staff_id: int,
    payload: StaffUpdate,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Staff).options(selectinload(Staff.user)).where(Staff.id == staff_id)
    )
    staff = result.scalar_one_or_none()
    if not staff:
        raise HTTPException(status_code=404, detail="Staff not found")

    dump = payload.model_dump(exclude_none=True)
    user_role = dump.pop("user_role", None)
    user_username = dump.pop("user_username", None)
    reset_password = dump.pop("reset_password", None)

    old_values = {k: getattr(staff, k) for k in dump}
    for key, val in dump.items():
        setattr(staff, key, val)

    # Handle linked user update
    linked_user = staff.user
    if user_role or user_username or reset_password:
        if linked_user:
            if user_role:
                linked_user.role = user_role
            if user_username:
                linked_user.username = user_username
            if reset_password:
                linked_user.hashed_password = hash_password(reset_password)
                linked_user.must_change_password = False
            if "is_active" in dump:
                linked_user.is_active = dump["is_active"]
            if "sector_id" in dump:
                linked_user.sector_id = dump["sector_id"]
        elif user_username:
            new_u = User(
                username=user_username,
                hashed_password=hash_password(reset_password or "Password@PJ2024!"),
                role=user_role or UserRoleEnum.STAFF,
                staff_id=staff.id,
                sector_id=staff.sector_id,
                is_active=staff.is_active,
                is_demo=False,
                must_change_password=False,
            )
            db.add(new_u)

    await log_event(
        db,
        actor=current_user,
        action=AuditAction.STAFF_UPDATED,
        entity_type="Staff",
        entity_id=staff_id,
        old_values=old_values,
        new_values=payload.model_dump(exclude_none=True),
    )
    await db.commit()

    # Re-fetch for clean output
    res2 = await db.execute(
        select(Staff).options(selectinload(Staff.user)).where(Staff.id == staff_id)
    )
    s2 = res2.scalar_one()
    u2 = s2.user

    return StaffOut(
        id=s2.id,
        service_number=s2.service_number,
        name=s2.name,
        designation=s2.designation.value if hasattr(s2.designation, "value") else str(s2.designation),
        category=s2.category.value if hasattr(s2.category, "value") else str(s2.category),
        sector_id=s2.sector_id,
        section=s2.section,
        contact_phone=s2.contact_phone,
        is_active=s2.is_active,
        is_demo=s2.is_demo,
        date_of_joining=s2.date_of_joining,
        notes=s2.notes,
        user_id=u2.id if u2 else None,
        user_username=u2.username if u2 else None,
        user_role=u2.role.value if (u2 and hasattr(u2.role, "value")) else None,
    )


@router.delete("/{staff_id}")
async def deactivate_staff(
    staff_id: int,
    current_user: User = Depends(require_roles(UserRoleEnum.SHO, UserRoleEnum.ADMIN_SI)),
    db: AsyncSession = Depends(get_db),
):
    """Soft deactivation — preserves audit history."""
    result = await db.execute(
        select(Staff).options(selectinload(Staff.user)).where(Staff.id == staff_id)
    )
    staff = result.scalar_one_or_none()
    if not staff:
        raise HTTPException(status_code=404, detail="Staff not found")

    staff.is_active = False
    if staff.user:
        staff.user.is_active = False

    await log_event(
        db,
        actor=current_user,
        action=AuditAction.STAFF_DEACTIVATED,
        entity_type="Staff",
        entity_id=staff_id,
    )
    await db.commit()
    return {"detail": f"Staff {staff.service_number} deactivated"}
