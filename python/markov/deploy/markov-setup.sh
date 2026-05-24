#!/usr/bin/env bash
# One-time setup of the Markov service on the LTS server.
#
# Run this ONCE after the first git pull that brings python/markov/ in.
# Subsequent code updates flow through markov-deploy.sh (idempotent
# pip install + service restart), so this script does not need to
# re-run.
#
# Assumes:
#   - Stockotter repo lives at /opt/stock-analyzer
#   - Running as root (or with sudo)
#   - Ubuntu / Debian with apt + systemd + nginx already installed

set -euo pipefail

REPO=/opt/stock-analyzer
MARKOV=$REPO/python/markov
VENV=/opt/markov/venv
SERVICE=/etc/systemd/system/markov.service
ENV_FILE=/etc/markov.env

echo "==> 1/5  System Python + venv tooling"
apt-get update -qq
apt-get install -y python3 python3-venv python3-pip build-essential >/dev/null

echo "==> 2/5  Virtualenv at $VENV"
mkdir -p /opt/markov
python3 -m venv "$VENV"
"$VENV/bin/pip" install --upgrade pip setuptools wheel >/dev/null
"$VENV/bin/pip" install -r "$MARKOV/requirements.txt"

echo "==> 3/5  Env file at $ENV_FILE"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
# Markov service environment.
# Lock CORS to the Stockotter origin. If you also run dev locally,
# add it comma-separated (no spaces).
MARKOV_ALLOWED_ORIGINS=https://stockotter.ai
EOF
  chmod 600 "$ENV_FILE"
  echo "    created $ENV_FILE (edit if you want extra origins)."
else
  echo "    $ENV_FILE already exists — leaving untouched."
fi

echo "==> 4/5  systemd unit"
cp "$MARKOV/deploy/markov.service" "$SERVICE"
systemctl daemon-reload
systemctl enable --now markov

echo "==> 5/5  Health check"
sleep 2
if curl -fsS http://127.0.0.1:8001/health >/dev/null; then
  echo "    Markov service is up at 127.0.0.1:8001"
else
  echo "    Health check FAILED. Check 'journalctl -u markov -n 50'."
  exit 1
fi

echo
echo "Setup complete."
echo "Next steps:"
echo "  - Add the contents of $MARKOV/deploy/nginx-markov.conf"
echo "    inside the server { } block for stockotter.ai, then"
echo "    'sudo nginx -t && sudo systemctl reload nginx'."
echo "  - Hook 'sudo bash $MARKOV/deploy/markov-deploy.sh' into your"
echo "    Stockotter deploy webhook so future pushes redeploy automatically."
echo "  - In Stockotter: set MARKOV_API to"
echo "    'https://stockotter.ai/markov-api' in"
echo "    client/src/compartments/markov/useMarkov.ts."
