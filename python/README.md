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

| Path | Strategy | Page that consumes it |
|---|---|---|
| `markov/` | Gaussian-HMM regime detection with vol-targeted sizing, transaction costs, and a min-hold filter. FastAPI service (`app.py`) wrapping the original strategy module (`markov_trading_v2.py`). Deployable to Railway via the included `Dockerfile`. | `/markov` (Experimental) |
| `hermes/` | Self-improving multi-asset trading agent. FastAPI dashboard (`dashboard_web.py`) + trading loop (`hermes_trading/loop.py`) with reflection (`reflect.py`), volatility-targeted sizing, and pluggable adapters (price / news / macro / on-chain). Deployed to Railway as a standalone service. | `/hermes` (Experimental) |

## Deploying

The Markov directory already includes its FastAPI wrapper, requirements, and
Dockerfile — see `markov/README.md` for the deploy steps. Once Railway (or
your host of choice) gives you a URL, set it in
`client/src/compartments/markov/useMarkov.ts` (constant near the top, same
pattern as `HERMES_API` in `hermes/useHermes.ts`):

```ts
export const MARKOV_API: string | null = "https://...up.railway.app";
```

The page checks `MARKOV_API !== null` and flips from "Pending Deploy" to
"Live" automatically.
