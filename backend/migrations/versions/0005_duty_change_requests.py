"""0005 — Add duty_change_requests table.

Revision ID: 0005_duty_change_requests
Revises: 0004_confirm_login_attendance
Create Date: 2026-11-06
"""
from alembic import op
import sqlalchemy as sa


revision = "0005_duty_change_requests"
down_revision = "0004_confirm_login_attendance"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "duty_change_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("roster_id", sa.Integer(), sa.ForeignKey("rosters.id", ondelete="CASCADE"), nullable=False),
        sa.Column("roster_assignment_id", sa.Integer(), sa.ForeignKey("roster_assignments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("staff_id", sa.Integer(), sa.ForeignKey("staff.id", ondelete="CASCADE"), nullable=False),
        sa.Column("requested_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=False),
        sa.Column("current_shift_code", sa.String(1), nullable=False),
        sa.Column("current_duty_category", sa.String(100), nullable=True),
        sa.Column("current_roster_date", sa.Date(), nullable=False),
        sa.Column("requested_shift_code", sa.String(1), nullable=True),
        sa.Column("requested_duty_category", sa.String(100), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("reviewed_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewer_remarks", sa.Text(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_dcr_staff_id", "duty_change_requests", ["staff_id"])
    op.create_index("ix_dcr_roster_id", "duty_change_requests", ["roster_id"])
    op.create_index("ix_dcr_status", "duty_change_requests", ["status"])


def downgrade():
    op.drop_index("ix_dcr_status", table_name="duty_change_requests")
    op.drop_index("ix_dcr_roster_id", table_name="duty_change_requests")
    op.drop_index("ix_dcr_staff_id", table_name="duty_change_requests")
    op.drop_table("duty_change_requests")
