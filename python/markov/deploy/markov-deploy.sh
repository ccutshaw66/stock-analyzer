#!/usr/bin/env bash
# Markov re-deploy after a git pull.
#
# Idempotent: safe to run on every push. Only reinstalls deps when
# requirements.txt actually changed, then restarts the service.
#
# Wire this into your existing Stockotter deploy hook AFTER the
# 'git pull' step. Example minimum addition to /opt/stock-analyzer/deploy.sh:
#
#     # ...existing Stockotter build steps...
#     bash /opt/stock-analyzer/python/markov/deploy/markov-deploy.sh

set -euo pipefail

REPO=/opt/stock-analyzer
MARKOV=$REPO/python/markov
VENV=/opt/markov/venv
REQS=$MARKOV/requirements.txt
HASH_FILE=/opt/markov/.requirements.sha256
UNIT_SRC=$MARKOV/deploy/markov.service
UNIT_DST=/etc/systemd/system/markov.service

# Cheap change detection — only run pip install if reqs changed.
NEW_HASH=$(sha256sum "$REQS" | awk '{print $1}')
OLD_HASH=$(cat "$HASH_FILE" 2>/dev/null || echo "")

if [ "$NEW_HASH" != "$OLD_HASH" ]; then
  echo "[markov-deploy] requirements changed — installing"
  "$VENV/bin/pip" install -r "$REQS"
  echo "$NEW_HASH" > "$HASH_FILE"
else
  echo "[markov-deploy] requirements unchanged — skipping pip install"
fi

# Re-copy the systemd unit if the repo version differs. Daemon-reload
# only if we actually changed it.
if ! cmp -s "$UNIT_SRC" "$UNIT_DST"; then
  echo "[markov-deploy] systemd unit changed — reinstalling"
  cp "$UNIT_SRC" "$UNIT_DST"
  systemctl daemon-reload
fi

echo "[markov-deploy] restarting service"
systemctl restart markov

sleep 2
if curl -fsS http://127.0.0.1:8001/health >/dev/null; then
  echo "[markov-deploy] OK — service is healthy"
else
  echo "[markov-deploy] FAIL — health check did not respond"
  journalctl -u markov -n 30 --no-pager
  exit 1
fi
