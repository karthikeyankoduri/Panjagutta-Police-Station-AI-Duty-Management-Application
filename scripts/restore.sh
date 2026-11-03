#!/usr/bin/env bash
# Restore an encrypted backup and verify the result (restore drill, blueprint step 28).
#
#   scripts/restore.sh backups/panjagutta_20261103_013000.sql.gz.gpg            # restore into the live DB
#   scripts/restore.sh backups/panjagutta_20261103_013000.sql.gz.gpg --drill    # restore into a scratch DB and verify
#
# The drill never touches the live database: it restores into "<db>_restore_drill",
# prints row counts for key tables, then drops the scratch database.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a

FILE="${1:?Usage: scripts/restore.sh <backup.sql.gz.gpg> [--drill]}"
MODE="${2:-}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE in .env}"
DB_USER="${POSTGRES_USER:-panjagutta}"
DB_NAME="${POSTGRES_DB:-panjagutta_duty_db}"

if [ -f "$FILE.sha256" ]; then
  sha256sum -c "$FILE.sha256"
fi

TARGET="$DB_NAME"
if [ "$MODE" = "--drill" ]; then
  TARGET="${DB_NAME}_restore_drill"
  docker compose exec -T db psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$TARGET\";" -c "CREATE DATABASE \"$TARGET\";"
else
  read -r -p "This replaces the LIVE database '$DB_NAME'. Type RESTORE to continue: " ok
  [ "$ok" = "RESTORE" ] || { echo "Cancelled"; exit 1; }
fi

gpg --batch --decrypt --passphrase-fd 3 "$FILE" 3<<<"$BACKUP_PASSPHRASE" \
  | gunzip \
  | docker compose exec -T db psql -v ON_ERROR_STOP=1 -q -U "$DB_USER" -d "$TARGET"

echo "Restored into $TARGET. Row counts:"
docker compose exec -T db psql -U "$DB_USER" -d "$TARGET" -At -c "
  SELECT 'staff', count(*) FROM staff UNION ALL
  SELECT 'users', count(*) FROM users UNION ALL
  SELECT 'rosters', count(*) FROM rosters UNION ALL
  SELECT 'attendance', count(*) FROM attendance UNION ALL
  SELECT 'audit_log', count(*) FROM audit_log;"

if [ "$MODE" = "--drill" ]; then
  docker compose exec -T db psql -U "$DB_USER" -d postgres -c "DROP DATABASE \"$TARGET\";"
  echo "Restore drill PASSED $(date -Is) for $FILE" | tee -a "${BACKUP_DIR:-./backups}/restore-drills.log"
fi
