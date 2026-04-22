# Uptime Monitoring — Setup Guide

Phase 2.4. This doc covers how to wire external uptime monitoring against the
health endpoints that Phase 2.1 introduced.

---

## Endpoints to monitor

| Path | What it checks | Use for |
|---|---|---|
| `GET /api/health/live` | Process is up and Express is responding. No DB touch. | Fast liveness probe. Alert if 3 consecutive fails. |
| `GET /api/health` | Liveness + DB connectivity (SELECT 1). Returns 503 when DB is down. | Full health check. Alert on any 5xx. |
| `GET /api/deploy/health` | Auto-deploy webhook status + last deploy result. | Not for alerting — dashboard only. |

Both health endpoints are **unauthenticated** by design so external monitors
can hit them without credentials. They do not leak secrets.

### Example responses

`GET /api/health/live`:
```json
{ "ok": true, "status": "live", "uptime_s": 72, "ts": "2026-04-22T18:35:23.772Z" }
```

`GET /api/health`:
```json
{
  "ok": true,
  "status": "healthy",
  "version": "1.0.0",
  "git_sha": "0f58f3d37ced",
  "uptime_s": 72,
  "checks": { "db": { "ok": true, "latency_ms": 3 } },
  "last_deploy": { "time": "2026-04-22T15:03:26Z", "success": true },
  "ts": "2026-04-22T18:35:23.772Z"
}
```

---

## Recommended setup: BetterStack (formerly Better Uptime)

**Why BetterStack over UptimeRobot:**
- 30-second check interval on the free tier (vs 5 min on UptimeRobot)
- Built-in incident management + status page
- Integrates with pino JSON logs via Better Stack Logs (future Phase 2.3+ hook)
- Clean email + SMS + Slack alerts

**Free tier:** 10 monitors, 30s checks, 3 status pages. Enough for us.

### Step-by-step

1. Sign up at https://betterstack.com/uptime (free).
2. **Create monitor #1 — API liveness**
   - URL: `https://stockotter.ai/api/health/live`
   - Check frequency: 30 seconds
   - Expected status code: 200
   - Request timeout: 10s
   - Keyword to expect in body: `"ok":true`
   - Alert on: 2 consecutive failures
3. **Create monitor #2 — API full health (DB)**
   - URL: `https://stockotter.ai/api/health`
   - Check frequency: 1 minute
   - Expected status code: 200
   - Keyword to expect in body: `"status":"healthy"`
   - Alert on: 2 consecutive failures
   - This will fire if Postgres goes down even while Express is up.
4. **Create monitor #3 — Homepage**
   - URL: `https://stockotter.ai/`
   - Check frequency: 1 minute
   - Expected status code: 200
   - Keyword to expect: `<html` (anything that proves static serving works)
5. **Alert routing**
   - Email: your primary
   - Optional: SMS, Slack webhook, PagerDuty
   - Set up an on-call schedule once you have a second person.
6. **Status page (optional)**
   - BetterStack can auto-publish `status.stockotter.ai` showing these three
     monitors. Good for customer-facing trust signal before GA.

---

## Alternative: UptimeRobot

If you prefer UptimeRobot (50 monitors free, but 5-minute intervals):

1. Sign up at https://uptimerobot.com.
2. Create HTTP(s) monitor:
   - URL: `https://stockotter.ai/api/health`
   - Monitoring interval: 5 min (free tier)
   - Alert contacts: your email
3. Repeat for `/api/health/live` if desired.

---

## Internal fallback (already enabled)

The server automatically writes a heartbeat file at
`/tmp/stock-analyzer-heartbeat` every 60 seconds (see
`server/api/routes/health.ts`). If this file is older than 5 minutes,
something is wrong — the node process is stuck or dead.

To check from a shell on the server:

```bash
# Age of heartbeat in seconds
echo $(( $(date +%s) - $(date -r /tmp/stock-analyzer-heartbeat +%s) ))
```

This is purely a belt-and-suspenders measure — external monitoring is still
the source of truth for alerting.

---

## What to do when an alert fires

1. Check `/api/health` in a browser — what does it say?
2. If 503 with `checks.db.ok = false` → DB problem. SSH to server, run
   `sudo systemctl status postgresql` and `pm2 logs stock-analyzer`.
3. If timeout / 502 → Express process down or nginx misrouting. Run
   `pm2 status` and check `pm2 logs stock-analyzer --lines 100`.
4. If 500 but body has detail → app-level bug. Grab the `req_id` from the
   failing request header and grep logs for it.
5. If everything on the box looks fine but the monitor still fails → DNS
   or TLS cert issue. Check `curl -v https://stockotter.ai/api/health`.

---

## Follow-ups (not in 2.4)

- Phase 2.3 Sentry: route app errors to Sentry so we see stack traces, not
  just "it was down."
- Phase 2.5 Jobs scheduler: right now scheduled jobs run inline. If one
  hangs, it may affect the health endpoint's DB check. A proper scheduler
  isolates them.
- Long-horizon: an external status page fed from BetterStack, wired into
  the app's login screen so users know when we're degraded.
