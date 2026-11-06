"""Task categories: category and custom header ('Others') on tasks.

Revision ID: 0003_task_categories
Revises: 0002_attendance_signin
Create Date: 2026-11-06

Existing tasks become category OTHERS with no header. Idempotent like 0002.
"""
import sqlalchemy as sa
from alembic import op

revision = "0003_task_categories"
down_revision = "0002_attendance_signin"
branch_labels = None
depends_on = None


def _cols() -> set:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns("tasks")}


def upgrade() -> None:
    have = _cols()
    if "category" not in have:
        op.add_column("tasks", sa.Column("category", sa.String(30), nullable=False, server_default="OTHERS"))
    if "custom_title" not in have:
        op.add_column("tasks", sa.Column("custom_title", sa.String(120), nullable=True))


def downgrade() -> None:
    have = _cols()
    for name in ("custom_title", "category"):
        if name in have:
            op.drop_column("tasks", name)
