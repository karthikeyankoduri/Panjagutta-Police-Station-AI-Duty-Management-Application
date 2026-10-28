"""
SQLAlchemy ORM models for Panjagutta Police Station Duty Management System.
All tables map directly to requirements from the PDF build guide (pages 8-9).
"""
from __future__ import annotations

import enum
from datetime import datetime, date, time
from typing import Optional, List

from sqlalchemy import (
    String, Integer, Boolean, DateTime, Date, Time, Text, Enum as SAEnum,
    ForeignKey, UniqueConstraint, Index, func, JSON
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


# ─────────────────────────────────────────────────────────────────────────────
# Enumerations — match source exactly (PDF pages 4-5)
# ─────────────────────────────────────────────────────────────────────────────

class UserRoleEnum(str, enum.Enum):
    SHO = "SHO"
    DI = "DI"
    ADMIN_SI = "ADMIN_SI"
    SECTOR_SI = "SECTOR_SI"
    DSI = "DSI"
    STAFF = "STAFF"


class StaffDesignation(str, enum.Enum):
    INSPECTOR = "INSPECTOR"
    SI = "SI"
    WSI = "WSI"
    ASI = "ASI"
    AWSI = "AWSI"
    HC = "HC"
    WHC = "WHC"
    PC = "PC"
    WPC = "WPC"
    ARPC = "ARPC"
    ARWPC = "ARWPC"
    HGS = "HGS"
    WHGS = "WHGS"
    SPO = "SPO"


class StaffCategory(str, enum.Enum):
    SECTOR_STAFF = "SECTOR_STAFF"
    SECTION_DUTY = "SECTION_DUTY"
    DRIVER = "DRIVER"
    ATTACHED = "ATTACHED"


class ShiftCode(str, enum.Enum):
    A = "A"
    B = "B"
    C = "C"


class StaffStatus(str, enum.Enum):
    PRESENT_AVAILABLE = "Present - Available"
    ON_DUTY = "On Duty"
    FIELD_DUTY = "Field Duty"
    COURT_DUTY = "Court Duty"
    PATROL_BEAT = "Patrol / Beat Duty"
    OFFICIAL_MOVEMENT = "Official Movement"
    ATTACHED_OTHER_WING = "Attached to Other Wing"
    ON_LEAVE = "On Leave"
    DUTY_OFF = "Duty Off / Rest"
    ABSENT = "Absent"
    EMERGENCY_DEPLOYMENT = "Emergency Deployment"
    SHIFT_CHANGE_PENDING = "Shift Change Pending"


class LeaveStatus(str, enum.Enum):
    PENDING = "Pending"
    APPROVED = "Approved"
    REJECTED = "Rejected"
    CANCELLED = "Cancelled"


class TaskStatus(str, enum.Enum):
    NOT_STARTED = "Not Started"
    IN_PROGRESS = "In Progress"
    COMPLETED = "Completed"
    ON_HOLD = "On Hold"
    CANCELLED = "Cancelled"


class RosterStatus(str, enum.Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    PUBLISHED = "published"


class MovementStatus(str, enum.Enum):
    PENDING_AUTHORIZATION = "pending_authorization"
    AUTHORIZED = "authorized"
    OPEN = "open"
    RETURNED = "returned"
    OVERDUE = "overdue"
    CANCELLED = "cancelled"


class PolicyStatus(str, enum.Enum):
    UNCONFIRMED = "unconfirmed"
    DEMO_SIMULATED = "demo_simulated"
    CONFIRMED = "confirmed"


# ─────────────────────────────────────────────────────────────────────────────
# Users & Roles
# ─────────────────────────────────────────────────────────────────────────────

class User(Base):
    """Login identity — separate from staff profile for role/permission clarity."""
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), unique=True, nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRoleEnum] = mapped_column(SAEnum(UserRoleEnum), nullable=False)
    sector_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("sectors.id"), nullable=True)
    staff_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("staff.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_activity: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    sector: Mapped[Optional["Sector"]] = relationship("Sector", back_populates="users")
    staff_profile: Mapped[Optional["Staff"]] = relationship("Staff", back_populates="user", foreign_keys=[staff_id])
    sessions: Mapped[List["UserSession"]] = relationship("UserSession", back_populates="user")


class UserSession(Base):
    """Server-side session tracking for invalidation on logout."""
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    token_jti: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    is_valid: Mapped[bool] = mapped_column(Boolean, default=True)
    draft_payload: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)  # preserve drafts on logout
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    invalidated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="sessions")


# ─────────────────────────────────────────────────────────────────────────────
# Configuration: Sectors, Shifts, Duty Master, Rotation Rules
# ─────────────────────────────────────────────────────────────────────────────

class Sector(Base):
    """Five sectors at Panjagutta PS — configurable."""
    __tablename__ = "sectors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    staff: Mapped[List["Staff"]] = relationship("Staff", back_populates="sector")
    users: Mapped[List["User"]] = relationship("User", back_populates="sector")
    sector_si: Mapped[Optional["Staff"]] = relationship(
        "Staff", primaryjoin="and_(Staff.sector_id==Sector.id, Staff.designation=='INSPECTOR')",
        viewonly=True, overlaps="staff"
    )


class ShiftConfig(Base):
    """Shift A/B/C configuration — editable only by authorized admins. PDF page 4."""
    __tablename__ = "shift_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shift_code: Mapped[ShiftCode] = mapped_column(SAEnum(ShiftCode), nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    duration_hours: Mapped[float] = mapped_column(nullable=False)
    crosses_midnight: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    modified_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    modified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("shift_code", "version", name="uq_shift_version"),
    )


class DutyMaster(Base):
    """Duty requirements per shift — configurable, designation-constrained. PDF pages 4-5."""
    __tablename__ = "duty_master"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    section: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    shift_code: Mapped[Optional[ShiftCode]] = mapped_column(SAEnum(ShiftCode), nullable=True)  # None = all shifts
    required_strength: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # None = not configured
    eligible_designations: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)  # list of StaffDesignation values
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_configured: Mapped[bool] = mapped_column(Boolean, default=False)  # False until authorized user supplies strength
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class RotationRule(Base):
    """
    SHO-confirmed rotation/rest rules — PROVISIONAL until signed off.
    PDF page 16, Section 1 policy gate.
    """
    __tablename__ = "rotation_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    rotation_sequence: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # e.g. "A->B->C"
    min_rest_hours_after_shift: Mapped[Optional[float]] = mapped_column(nullable=True)
    duty_off_after_shift_b_hours: Mapped[Optional[float]] = mapped_column(nullable=True)
    permitted_exceptions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    exception_authorizer_role: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    policy_status: Mapped[PolicyStatus] = mapped_column(SAEnum(PolicyStatus), default=PolicyStatus.UNCONFIRMED)
    confirmed_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    is_demo_acknowledgement: Mapped[bool] = mapped_column(Boolean, default=False)
    demo_acknowledgement_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    effective_from: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─────────────────────────────────────────────────────────────────────────────
# Staff Register
# ─────────────────────────────────────────────────────────────────────────────

class Staff(Base):
    """Staff profile — service number is the unique identifier. PDF page 8."""
    __tablename__ = "staff"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    service_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    designation: Mapped[StaffDesignation] = mapped_column(SAEnum(StaffDesignation), nullable=False)
    category: Mapped[StaffCategory] = mapped_column(SAEnum(StaffCategory), nullable=False)
    sector_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("sectors.id"), nullable=True)
    section: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    reporting_officer_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("staff.id"), nullable=True)
    # Contact — visible only to authorized roles
    contact_phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    contact_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    date_of_joining: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    sector: Mapped[Optional["Sector"]] = relationship("Sector", back_populates="staff")
    reporting_officer: Mapped[Optional["Staff"]] = relationship("Staff", remote_side="Staff.id")
    user: Mapped[Optional["User"]] = relationship("User", back_populates="staff_profile", foreign_keys="User.staff_id")
    attendance_records: Mapped[List["Attendance"]] = relationship("Attendance", back_populates="staff")
    roster_assignments: Mapped[List["RosterAssignment"]] = relationship("RosterAssignment", back_populates="staff")
    tasks: Mapped[List["Task"]] = relationship("Task", back_populates="assignee", foreign_keys="Task.assignee_id")
    leave_requests: Mapped[List["LeaveRequest"]] = relationship("LeaveRequest", back_populates="staff")
    movements: Mapped[List["Movement"]] = relationship("Movement", back_populates="staff")
    attachment_orders: Mapped[List["AttachmentOrder"]] = relationship("AttachmentOrder", back_populates="staff", foreign_keys="AttachmentOrder.staff_id")


# ─────────────────────────────────────────────────────────────────────────────
# Roster & Assignments
# ─────────────────────────────────────────────────────────────────────────────

class Roster(Base):
    """Roster header — each change creates a new version. PDF pages 10-12."""
    __tablename__ = "rosters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    roster_date: Mapped[date] = mapped_column(Date, nullable=False)
    shift_code: Mapped[ShiftCode] = mapped_column(SAEnum(ShiftCode), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    status: Mapped[RosterStatus] = mapped_column(SAEnum(RosterStatus), default=RosterStatus.DRAFT)
    change_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    prepared_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    modified_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    submitted_to_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    approved_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    approval_comments: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    is_demo_policy: Mapped[bool] = mapped_column(Boolean, default=False)  # True = published under demo policy
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    assignments: Mapped[List["RosterAssignment"]] = relationship("RosterAssignment", back_populates="roster")

    __table_args__ = (
        UniqueConstraint("roster_date", "shift_code", "version", name="uq_roster_version"),
        Index("ix_roster_date_shift", "roster_date", "shift_code"),
    )


class RosterAssignment(Base):
    """Individual duty assignment within a roster."""
    __tablename__ = "roster_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    roster_id: Mapped[int] = mapped_column(Integer, ForeignKey("rosters.id"), nullable=False)
    duty_master_id: Mapped[int] = mapped_column(Integer, ForeignKey("duty_master.id"), nullable=False)
    staff_id: Mapped[int] = mapped_column(Integer, ForeignKey("staff.id"), nullable=False)
    sector_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("sectors.id"), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_exception: Mapped[bool] = mapped_column(Boolean, default=False)
    exception_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    exception_authorized_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    roster: Mapped["Roster"] = relationship("Roster", back_populates="assignments")
    staff: Mapped["Staff"] = relationship("Staff", back_populates="roster_assignments")
    duty: Mapped["DutyMaster"] = relationship("DutyMaster")

    __table_args__ = (
        UniqueConstraint("roster_id", "staff_id", "duty_master_id", name="uq_roster_staff_duty"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Attendance
# ─────────────────────────────────────────────────────────────────────────────

class Attendance(Base):
    """Attendance record — scheduled vs confirmed kept separate. PDF pages 10-11."""
    __tablename__ = "attendance"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    staff_id: Mapped[int] = mapped_column(Integer, ForeignKey("staff.id"), nullable=False)
    attendance_date: Mapped[date] = mapped_column(Date, nullable=False)
    shift_code: Mapped[ShiftCode] = mapped_column(SAEnum(ShiftCode), nullable=False)
    is_scheduled: Mapped[bool] = mapped_column(Boolean, default=False)  # from roster
    is_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)  # verified by officer
    submitted_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    verified_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    staff: Mapped["Staff"] = relationship("Staff", back_populates="attendance_records")

    __table_args__ = (
        UniqueConstraint("staff_id", "attendance_date", "shift_code", name="uq_attendance_staff_shift"),
        Index("ix_attendance_date_shift", "attendance_date", "shift_code"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Tasks
# ─────────────────────────────────────────────────────────────────────────────

class Task(Base):
    """Task with exactly 5 source statuses. PDF page 5."""
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    assignee_id: Mapped[int] = mapped_column(Integer, ForeignKey("staff.id"), nullable=False)
    reporting_officer_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("staff.id"), nullable=True)
    start_time: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    expected_completion: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    actual_completion: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[TaskStatus] = mapped_column(SAEnum(TaskStatus), default=TaskStatus.NOT_STARTED)
    is_overdue: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    assignee: Mapped["Staff"] = relationship("Staff", back_populates="tasks", foreign_keys=[assignee_id])
    reporting_officer: Mapped[Optional["Staff"]] = relationship("Staff", foreign_keys=[reporting_officer_id])


# ─────────────────────────────────────────────────────────────────────────────
# Leave Requests
# ─────────────────────────────────────────────────────────────────────────────

class LeaveRequest(Base):
    """Leave lifecycle — exactly 4 states. PDF pages 12-13."""
    __tablename__ = "leave_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    staff_id: Mapped[int] = mapped_column(Integer, ForeignKey("staff.id"), nullable=False)
    leave_type: Mapped[str] = mapped_column(String(100), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    reference_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[LeaveStatus] = mapped_column(SAEnum(LeaveStatus), default=LeaveStatus.PENDING)
    submitted_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    approver_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    decision_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    approver_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    staff: Mapped["Staff"] = relationship("Staff", back_populates="leave_requests")


# ─────────────────────────────────────────────────────────────────────────────
# Outside Movements
# ─────────────────────────────────────────────────────────────────────────────

class Movement(Base):
    """Outside movement with full lifecycle. PDF page 12."""
    __tablename__ = "movements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    staff_id: Mapped[int] = mapped_column(Integer, ForeignKey("staff.id"), nullable=False)
    purpose: Mapped[str] = mapped_column(Text, nullable=False)
    destination: Mapped[str] = mapped_column(String(255), nullable=False)
    reference_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    expected_return: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    actual_departure: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    actual_return: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[MovementStatus] = mapped_column(SAEnum(MovementStatus), default=MovementStatus.PENDING_AUTHORIZATION)
    authorizing_officer_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    authorized_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    is_overdue: Mapped[bool] = mapped_column(Boolean, default=False)
    overdue_alerted: Mapped[bool] = mapped_column(Boolean, default=False)
    closed_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    close_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    staff: Mapped["Staff"] = relationship("Staff", back_populates="movements")


# ─────────────────────────────────────────────────────────────────────────────
# Attachment Orders
# ─────────────────────────────────────────────────────────────────────────────

class AttachmentOrder(Base):
    """Staff attached to another wing — count in strength, exclude from routine. PDF page 13."""
    __tablename__ = "attachment_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    staff_id: Mapped[int] = mapped_column(Integer, ForeignKey("staff.id"), nullable=False)
    parent_unit: Mapped[str] = mapped_column(String(200), nullable=False)
    attached_wing: Mapped[str] = mapped_column(String(200), nullable=False)
    order_reference: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    expected_end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    actual_end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    reporting_officer_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("staff.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    ended_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    end_authority: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    staff: Mapped["Staff"] = relationship("Staff", back_populates="attachment_orders", foreign_keys=[staff_id])
    reporting_officer: Mapped[Optional["Staff"]] = relationship("Staff", foreign_keys=[reporting_officer_id])


# ─────────────────────────────────────────────────────────────────────────────
# Audit Log — append-only
# ─────────────────────────────────────────────────────────────────────────────

class AuditLog(Base):
    """Immutable audit trail — no ordinary user can edit/delete. PDF page 9."""
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    actor_username: Mapped[str] = mapped_column(String(100), nullable=False)  # snapshot in case user deleted
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    old_values: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    new_values: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    authorizer_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    authorizer_username: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    exception_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    request_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (
        Index("ix_audit_entity", "entity_type", "entity_id"),
        Index("ix_audit_actor", "actor_id"),
        Index("ix_audit_action", "action"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Notification / Alert State
# ─────────────────────────────────────────────────────────────────────────────

class Alert(Base):
    """In-app alerts for overdue, vacancies, stalled approvals. Deduplication tracked."""
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    alert_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(20), default="warning")  # info | warning | critical
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    resolved_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("alert_type", "entity_type", "entity_id", "is_resolved", name="uq_alert_dedup"),
    )
