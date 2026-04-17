#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/backup.sh
# Nightly backup of the stock-analyzer app:
#   1. Tarball of /opt/stock-analyzer (excluding regeneratable dirs)
#   2. pg_dumpall of the local Postgres instance
#   3. 7-day rolling retention — files older than N days are pruned
#
# Intended to run nightly via cron (see scripts/install-backup-cron.sh).
# Can also be run manually: sudo /opt/stock-analyzer/scripts/backup.sh
#
# Environment overrides:
#   BACKUP_DIR       (default: /opt/backups/stock-analyzer)
#   APP_DIR          (default: /opt/stock-analyzer)
#   RETENTION_DAYS   (default: 7)
#   PG_USER          (default: postgres)
#   LOG_FILE         (default: /var/log/stock-analyzer/backup.log)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups/stock-analyzer}"
APP_DIR="${APP_DIR:-/opt/stock-analyzer}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
PG_USER="${PG_USER:-postgres}"
LOG_FILE="${LOG_FILE:-/var/log/stock-analyzer/backup.log}"

STAMP="$(date +%Y-%m-%d_%H%M%S)"
CODE_FILE="$BACKUP_DIR/code_$STAMP.tar.gz"
DB_FILE="$BACKUP_DIR/db_$STAMP.sql.gz"

mkdir -p "$BACKUP_DIR"
mkdir -p "$(dirname "$LOG_FILE")"

# Log everything (stdout + stderr) to both the console and the log file.
exec > >(tee -a "$LOG_FILE") 2>&1

log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fail() { log "ERROR: $*"; exit 1; }

log "===== Backup started (stamp=$STAMP) ====="
log "APP_DIR=$APP_DIR BACKUP_DIR=$BACKUP_DIR RETENTION_DAYS=$RETENTION_DAYS"

# ── 1. Code ────────────────────────────────────────────────────────────────
if [[ ! -d "$APP_DIR" ]]; then
  fail "App directory $APP_DIR not found"
fi

log "Tarring code → $CODE_FILE"
tar \
  --exclude="$APP_DIR/node_modules" \
  --exclude="$APP_DIR/dist" \
  --exclude="$APP_DIR/.git" \
  --exclude="$APP_DIR/.next" \
  --exclude="$APP_DIR/coverage" \
  --exclude="$APP_DIR/logs" \
  -czf "$CODE_FILE" \
  -C "$(dirname "$APP_DIR")" "$(basename "$APP_DIR")"

CODE_SIZE="$(du -h "$CODE_FILE" | cut -f1)"
log "Code backup OK ($CODE_SIZE)"

# ── 2. Database ────────────────────────────────────────────────────────────
log "Dumping Postgres (pg_dumpall as user '$PG_USER') → $DB_FILE"
if ! sudo -u "$PG_USER" pg_dumpall | gzip > "$DB_FILE"; then
  # If pg_dumpall failed, remove the partial file so retention logic doesn't
  # count it as a valid backup.
  rm -f "$DB_FILE"
  fail "pg_dumpall failed"
fi

# Sanity check: the gzipped dump should be at least a few hundred bytes
# (an empty/failed dump is typically < 100 bytes).
DB_BYTES="$(stat -c %s "$DB_FILE")"
if (( DB_BYTES < 500 )); then
  rm -f "$DB_FILE"
  fail "pg_dumpall produced a suspiciously small file ($DB_BYTES bytes) — aborting"
fi

DB_SIZE="$(du -h "$DB_FILE" | cut -f1)"
log "DB backup OK ($DB_SIZE)"

# ── 3. Retention ───────────────────────────────────────────────────────────
log "Pruning backups older than $RETENTION_DAYS days"
PRUNED_CODE="$(find "$BACKUP_DIR" -maxdepth 1 -name 'code_*.tar.gz' -type f -mtime +"$RETENTION_DAYS" -print -delete | wc -l)"
PRUNED_DB="$(find "$BACKUP_DIR" -maxdepth 1 -name 'db_*.sql.gz'   -type f -mtime +"$RETENTION_DAYS" -print -delete | wc -l)"
log "Pruned $PRUNED_CODE old code file(s), $PRUNED_DB old db file(s)"

# ── 4. Summary ─────────────────────────────────────────────────────────────
TOTAL_SIZE="$(du -sh "$BACKUP_DIR" | cut -f1)"
BACKUP_COUNT="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.gz' | wc -l)"
log "Backup directory holds $BACKUP_COUNT files, $TOTAL_SIZE total"
log "===== Backup finished successfully ====="
