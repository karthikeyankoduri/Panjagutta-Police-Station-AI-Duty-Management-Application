"""Baseline schema: every table in app.models plus the append-only audit trigger.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-11-03

Databases that were already created by the application's bootstrap can adopt
Alembic with:  alembic stamp 0001_baseline
"""
from alembic import op

from app.db.database import Base
from app.models import models  # noqa: F401  (registers every table on Base.metadata)

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None

AUDIT_GUARD_FUNCTION = """
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;
"""
AUDIT_GUARD_TRIGGER = """
CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
"""


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=True)
    if bind.dialect.name == "postgresql":
        op.execute(AUDIT_GUARD_FUNCTION)
        op.execute("DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log")
        op.execute(AUDIT_GUARD_TRIGGER)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log")
        op.execute("DROP FUNCTION IF EXISTS audit_log_append_only()")
    Base.metadata.drop_all(bind=bind, checkfirst=True)
