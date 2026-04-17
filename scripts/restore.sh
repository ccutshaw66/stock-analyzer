#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/restore.sh
# Companion to backup.sh. Lists available backups and restores code and/or DB.
#
# Usage:
#   sudo /opt/stock-analyzer/scripts/restore.sh --list
#   sudo /opt/stock-analyzer/scripts/restore.sh --code <timestamp>
#   sudo /opt/stock-analyzer/scripts/restore.sh --db   <timestamp>
#   sudo /opt/stock-analyzer/scripts/restore.sh --full <timestamp>
#
# <timestamp> is the YYYY-MM-DD_HHMMSS portion of a backup filename, e.g.
# 2026-04-17_030000. Use --list to see what's available.
#
# The code restore renames the existing /opt/stock-analyzer to .broken-<ts>
# rather than deleting it outright, so you always have a safety net.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups/stock-analyzer}"
APP_DIR="${APP_DIR:-/opt/stock-analyzer}"
PG_USER="${PG_USER:-postgres}"
PM2_APP="${PM2_APP:-stock-analyzer}"

usage() {
  sed -n '3,15p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

list_backups() {
  echo "Available backups in $BACKUP_DIR:"
  echo ""
  printf "%-22s %10s %10s\n" "TIMESTAMP" "CODE" "DB"
  printf "%-22s %10s %10s\n" "---------" "----" "--"
  # Union of timestamps across code_*.tar.gz and db_*.sql.gz
  (cd "$BACKUP_DIR" 2>/dev/null && \
    ls code_*.tar.gz db_*.sql.gz 2>/dev/null | \
    sed -E 's/^(code_|db_)//; s/\.(tar\.gz|sql\.gz)$//' | sort -u) | \
  while read -r ts; do
    code="$BACKUP_DIR/code_$ts.tar.gz"
    db="$BACKUP_DIR/db_$ts.sql.gz"
    code_size="—"; db_size="—"
    [[ -f "$code" ]] && code_size="$(du -h "$code" | cut -f1)"
    [[ -f "$db"   ]] && db_size="$(du -h "$db" | cut -f1)"
    printf "%-22s %10s %10s\n" "$ts" "$code_size" "$db_size"
  done
}

restore_code() {
  local ts="$1"
  local file="$BACKUP_DIR/code_$ts.tar.gz"
  [[ -f "$file" ]] || { echo "Not found: $file" >&2; exit 2; }

  echo "==> Restoring code from $file"
  if [[ -d "$APP_DIR" ]]; then
    local stash="${APP_DIR}.broken-$(date +%Y%m%d_%H%M%S)"
    echo "    Stashing current $APP_DIR → $stash"
    mv "$APP_DIR" "$stash"
  fi
  tar -xzf "$file" -C "$(dirname "$APP_DIR")"
  echo "==> Installing deps and rebuilding"
  ( cd "$APP_DIR" && npm ci && npm run build )
  echo "==> Restarting pm2 process '$PM2_APP'"
  pm2 restart "$PM2_APP" || pm2 start "$APP_DIR/ecosystem.config.js" --only "$PM2_APP" || true
  echo "==> Code restore complete"
}

restore_db() {
  local ts="$1"
  local file="$BACKUP_DIR/db_$ts.sql.gz"
  [[ -f "$file" ]] || { echo "Not found: $file" >&2; exit 2; }

  echo "==> Restoring database from $file"
  echo "    WARNING: this runs pg_dumpall's output through psql, which will"
  echo "    DROP and RECREATE databases/roles included in the dump."
  read -r -p "Type 'yes' to continue: " confirm
  [[ "$confirm" == "yes" ]] || { echo "Aborted."; exit 1; }
  gunzip -c "$file" | sudo -u "$PG_USER" psql
  echo "==> DB restore complete. Consider: pm2 restart $PM2_APP"
}

[[ $# -ge 1 ]] || usage

case "$1" in
  --list|-l)
    list_backups
    ;;
  --code)
    [[ $# -eq 2 ]] || usage
    restore_code "$2"
    ;;
  --db)
    [[ $# -eq 2 ]] || usage
    restore_db "$2"
    ;;
  --full)
    [[ $# -eq 2 ]] || usage
    restore_code "$2"
    restore_db "$2"
    ;;
  -h|--help)
    usage
    ;;
  *)
    echo "Unknown option: $1" >&2
    usage
    ;;
esac
