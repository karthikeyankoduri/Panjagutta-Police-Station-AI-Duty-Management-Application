#!/usr/bin/env bash
# Encrypted PostgreSQL backup (guide §12, blueprint step 28).
#
#   scripts/backup.sh                 # writes backups/panjagutta_<timestamp>.sql.gz.gpg
#
# Schedule nightly on the host, e.g. crontab:
#   30 1 * * *  cd /opt/panjagutta && scripts/backup.sh >> backups/backup.log 2>&1
#
# Requires: docker compose stack running, gpg on the host, BACKUP_PASSPHRASE in .env.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a

: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE in .env}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
DB_USER="${POSTGRES_USER:-panjagutta}"
DB_NAME="${POSTGRES_DB:-panjagutta_duty_db}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/panjagutta_${STAMP}.sql.gz.gpg"

docker compose exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner \
  | gzip -9 \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-fd 3 -o "$OUT" 3<<<"$BACKUP_PASSPHRASE"

sha256sum "$OUT" > "$OUT.sha256"
chmod 600 "$OUT" "$OUT.sha256"
echo "$(date -Is) backup written: $OUT ($(du -h "$OUT" | cut -f1))"

# Retention
find "$BACKUP_DIR" -name 'panjagutta_*.sql.gz.gpg*' -mtime +"$KEEP_DAYS" -delete
