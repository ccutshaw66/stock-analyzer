# Markov deploy — LTS server

End state: Markov runs as a systemd-managed FastAPI service on the same
LTS server as Stockotter (`imt-uv-helpdesk`), reachable at
`https://stockotter.ai/markov-api/`. Every push that touches
`python/markov/**` auto-redeploys via the existing GitHub webhook.

## Files in this folder

| File | Purpose |
|---|---|
| `markov.service` | systemd unit. Runs uvicorn under a venv. |
| `nginx-markov.conf` | Reverse-proxy snippet to drop into the stockotter.ai server block — avoids CORS entirely. |
| `markov-setup.sh` | One-time setup script. Creates the venv, installs deps, installs the systemd unit, brings the service up. |
| `markov-deploy.sh` | Re-deploy script. Idempotent — only runs `pip install` when requirements.txt changed, then restarts the service. Hook into your existing deploy webhook. |

## First-time setup (run once on the LTS server)

```bash
ssh root@imt-uv-helpdesk
cd /opt/stock-analyzer
git pull        # bring python/markov/ in
sudo bash /opt/stock-analyzer/python/markov/deploy/markov-setup.sh
```

Then add the nginx route. Open the Stockotter nginx config:

```bash
sudo nano /etc/nginx/sites-available/stockotter.ai
```

Paste the contents of `nginx-markov.conf` somewhere inside the
`server { ... }` block. Save, then:

```bash
sudo nginx -t            # confirm config is valid
sudo systemctl reload nginx
```

Smoke-test from the outside:

```bash
curl https://stockotter.ai/markov-api/health
# expected: {"status":"ok"}
```

## Wire it into the auto-deploy webhook

Edit your existing Stockotter deploy script (usually at
`/opt/stock-analyzer/deploy.sh` or whatever the webhook runs) and add
ONE line after the `git pull`:

```bash
bash /opt/stock-analyzer/python/markov/deploy/markov-deploy.sh
```

From this point on, any push to `main` that touches `python/markov/`
will pull, reinstall deps if needed, and restart the service in one go.

## Flip the page from "Pending" to "Live"

Once `curl https://stockotter.ai/markov-api/health` returns OK, change
ONE line in the Stockotter codebase:

```ts
// client/src/compartments/markov/useMarkov.ts
export const MARKOV_API: string | null = "https://stockotter.ai/markov-api";
```

Commit. The webhook will rebuild Stockotter, and the `/markov` page
will detect `MARKOV_API !== null` and flip from "Pending Deploy" to
"Live". The Run Backtest button becomes functional.

## Troubleshooting

| Symptom | Check |
|---|---|
| `markov-setup.sh` fails on `pip install` | Server Python version: `python3 --version`. scikit-learn 1.5.x needs Python 3.9–3.12. If your server is on 3.13+, downgrade scikit-learn in requirements.txt to a version compatible with your Python. |
| nginx 502 at `/markov-api/health` | Service not running. `sudo systemctl status markov` → `journalctl -u markov -n 50`. |
| nginx 404 at `/markov-api/health` | nginx config didn't reload, or the location block is in the wrong server. `sudo nginx -t && sudo systemctl reload nginx`. |
| Backtest button fires but page shows error | Browser console + service logs. The contract between frontend and backend is in `python/markov/README.md`. |
| Yahoo (yfinance) gives 429s | This is the known-issue we logged. Eventually swap yfinance for FMP per `docs/TODO.md`. |
