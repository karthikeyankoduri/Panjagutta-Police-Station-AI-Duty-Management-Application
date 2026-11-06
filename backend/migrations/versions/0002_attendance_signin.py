"""Attendance recorded from sign-in/sign-out: check-in/out times, source and late flag.

Revision ID: 0002_attendance_signin
Revises: 0001_baseline
Create Date: 2026-11-06

Idempotent: a database created from the current models (including a fresh Alembic run, whose
baseline calls create_all) already has the columns, so each one is added only if missing.
Existing hand-marked rows are untouched (source stays NULL).
"""
import sqlalchemy as sa
from alembic import op

revision = "0002_attendance_signin"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None

TABLE = "attendance"


def _existing_columns() -> set:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(TABLE)}


def upgrade() -> None:
    have = _existing_columns()
    if "check_in_at" not in have:
        op.add_column(TABLE, sa.Column("check_in_at", sa.DateTime(timezone=True), nullable=True))
    if "check_out_at" not in have:
        op.add_column(TABLE, sa.Column("check_out_at", sa.DateTime(timezone=True), nullable=True))
    if "source" not in have:
        op.add_column(TABLE, sa.Column("source", sa.String(20), nullable=True))
    if "is_late" not in have:
        op.add_column(TABLE, sa.Column("is_late", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    have = _existing_columns()
    for name in ("is_late", "source", "check_out_at", "check_in_at"):
        if name in have:
            op.drop_column(TABLE, name)
