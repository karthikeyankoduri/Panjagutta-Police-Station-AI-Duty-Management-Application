"""Sign-in attendance always counts as Present: confirm earlier unscheduled sign-in rows.

Revision ID: 0004_confirm_login_attendance
Revises: 0003_task_categories
Create Date: 2026-11-06
"""
import sqlalchemy as sa
from alembic import op

revision = "0004_confirm_login_attendance"
down_revision = "0003_task_categories"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("UPDATE attendance SET is_confirmed = :t WHERE source = 'LOGIN' AND is_confirmed = :f")
               .bindparams(t=True, f=False))


def downgrade() -> None:
    pass  # not reversible: unscheduled and scheduled sign-ins are indistinguishable once confirmed... except is_scheduled
