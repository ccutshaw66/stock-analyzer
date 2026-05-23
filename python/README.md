# Python strategies

Sibling Python services that run **outside** the Node build and are called over
HTTP from the web app — same pattern as HERMES on Railway.

These files are **not bundled** with the Node deploy. Adding Python to this
directory is purely an archival/versioning convenience so the source travels
with the repo; running them in production requires hosting them as their own
service (Railway / Render / Fly / a VM) and pointing the relevant page at the
deployed URL.

## Why this lives here

Per `docs/MASTER_PATHWAY.md`:
- The app is a TypeScript monorepo (Express 5 + React).
- No vendor- or runtime-specific code lives inside `server/*` modules.

Mixing a Python runtime into the Node build would violate both. Hosting Python
strategies as standalone HTTP services keeps the architectural rule intact and
mirrors how HERMES is integrated.

## Current contents

| File | Strategy | Page that consumes it |
|---|---|---|
| `markov_trading_v2.py` | Gaussian-HMM regime detection with vol-targeted sizing, transaction costs, and a min-hold filter. Outputs an OOS backtest vs buy & hold. | `/markov` (Experimental) |

## Deploying

Each script needs to be wrapped in a small HTTP layer (FastAPI/Flask) before it
can serve the web app. The minimum surface the `/markov` page expects is:

```
POST /api/backtest
body: { ticker, start, end, states, train_frac, target_vol, cost_bps, min_hold_days, allow_short }
→ { regime_stats, performance: { net, gross, bh }, equity_curve, positions }
```

Once deployed, set the endpoint URL inside `client/src/pages/markov.tsx`
(constant near the top, same pattern as `HERMES_API` in `hermes.tsx`).
