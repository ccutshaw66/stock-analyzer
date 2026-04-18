#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/install-backup-cron.sh
# One-shot installer that wires up the nightly backup cron.
#
# Idempotent — safe to re-run. Overwrites the cron file and logrotate config
# each time so changes in the repo propagate to the server.
#
# Run once after merging the feat/nightly-backup-cron PR:
#   sudo /opt/stock-analyzer/scripts/install-backup-cron.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/stock-analyzer}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/stock-analyzer}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
LOG_FILE="${LOG_FILE:-/var/log/stock-analyzer/backup.log}"
CRON_FILE="/etc/cron.d/stock-analyzer-backup"
LOGROTATE_FILE="/etc/logrotate.d/stock-analyzer-backup"

if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root (use sudo)." >&2
  exit 1
fi

if [[ ! -x "$APP_DIR/scripts/backup.sh" ]]; then
  echo "Making $APP_DIR/scripts/backup.sh executable"
  chmod +x "$APP_DIR/scripts/backup.sh"
fi
if [[ -f "$APP_DIR/scripts/restore.sh" && ! -x "$APP_DIR/scripts/restore.sh" ]]; then
  chmod +x "$APP_DIR/scripts/restore.sh"
fi

mkdir -p "$BACKUP_DIR" "$(dirname "$LOG_FILE")"

# ── /etc/cron.d entry ─────────────────────────────────────────────────────
# Runs every night at 03:00 server time. Crontab format requires 6 fields
# for /etc/cron.d (the user field is the 6th).
cat > "$CRON_FILE" <<EOF
# stock-analyzer nightly backup — managed by $APP_DIR/scripts/install-backup-cron.sh
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
BACKUP_DIR=$BACKUP_DIR
APP_DIR=$APP_DIR
RETENTION_DAYS=$RETENTION_DAYS
LOG_FILE=$LOG_FILE

0 3 * * * root $APP_DIR/scripts/backup.sh
EOF
chmod 644 "$CRON_FILE"
echo "Installed cron: $CRON_FILE"

# ── logrotate ─────────────────────────────────────────────────────────────
cat > "$LOGROTATE_FILE" <<EOF
$LOG_FILE {
    weekly
    rotate 8
    compress
    delaycompress
    missingok
    notifempty
    create 0644 root root
}
EOF
chmod 644 "$LOGROTATE_FILE"
echo "Installed logrotate: $LOGROTATE_FILE"

# ── First-run smoke test ──────────────────────────────────────────────────
echo ""
echo "Running an initial backup now to verify everything works…"
"$APP_DIR/scripts/backup.sh"

echo ""
echo "✔ Install complete."
echo "  • Backups run nightly at 03:00 server time"
echo "  • Files: $BACKUP_DIR"
echo "  • Log:   $LOG_FILE"
echo "  • Retention: $RETENTION_DAYS days"
echo ""
echo "To list backups later:   sudo $APP_DIR/scripts/restore.sh --list"
echo "To restore a backup:     sudo $APP_DIR/scripts/restore.sh --full <timestamp>"
