# Stock Otter

Tier-gated SaaS for stockotter.ai. Validates stock-market claims with backtested confluence signals, runs an end-to-end trade tracker, and surfaces opportunities through a confluence engine that drives the same verdict everywhere it shows up.

> **Mission:** stop trusting gurus — verify every call with backtested confluence.

## What's in the app

Organized into four nav groups (see `client/src/components/AppLayout.tsx`):

**Trade Tracker** — Current Positions, Dividend Positions, Add/Close Trade modals, Performance Analytics (win rate, P/L, MFE/MAE, position-duration breakdown).

**Company Research** — Profile, Trade Analysis, **MM Exposure** (paid tier), Institutions (Form-4 insider + 13F holdings), Long-Term Outlook (the 8-category Verdict).

**Investment Opportunities** — Scanner (with MACD/RSI oscillator), Sector Heatmap (drill-in to top-10 leaders per sector), Earnings Calendar, Dividend Finder, Track Record (signal-based backtester), Alerts (4 rule types + in-app bell).

**Calculators** — Options pricing, Payoff Diagram, Greeks, Kelly Criterion, Wheel Strategy.

Plus auth (passport-local + JWT), Stripe billing, account/admin pages, onboarding tour, dark finance theme.

## Architecture

```
server/
  data/          Vendor-agnostic data layer (Polygon, FMP, Yahoo, EDGAR, in-house)
  indicators/    Pure math — RSI, BB, MACD, volume, beta, pullback
  signals/       Gates 1-3 + confluence engine + strategies (BBTC, VER, AMC)
  features/      Page-level orchestration
  platform/      Cross-cutting — tiers, alerts, billing, jobs, config, telemetry
  api/           Thin HTTP routes
```

**Dependency rule:** each layer imports only from layers below. `platform/*` is callable from any layer but never imports upward. See `docs/ARCHITECTURE.md` and `docs/MASTER_PATHWAY.md` for the full plan.

**Tech stack:**
- Frontend — React 18, Vite, Tailwind, shadcn/ui (Radix), wouter, TanStack Query, Recharts, Framer Motion
- Backend — Express 5, TypeScript, Drizzle ORM (Postgres), passport-local + JWT sessions, Stripe, node-cron, pino, nodemailer
- Build — esbuild + Vite bundle to `dist/index.cjs`

## Data providers

| Provider | Role | Required? |
|---|---|---|
| **Polygon** (Stocks Starter + Options Starter) | Quotes, aggregates, financials, options, dividends, splits, search | Yes |
| **FMP Premium** | Analyst ratings, earnings estimates/surprises, insider, 13F, fundamental screener, >5y bars | Strongly recommended |
| **SEC EDGAR** | 13F institutional fallback (free) | No |
| **Yahoo Finance** | Background **buffer / cache-refresh agent** for fund holdings, institutional ownership, insider rosters | Architectural — not on user request path |

**Yahoo's role:** Yahoo is a cache-warming agent only — never on the live request path. Crons (`server/yahoo-ownership-warmup.ts`, etc.) refresh a 23-hour cache that paid pages read from. The eventual replacement for fund-holdings data is **SEC N-PORT** (not 13F, which only covers institutions). Until N-PORT is integrated, Yahoo stays.

## Setup

```bash
cp .env.example .env   # fill in POLYGON_API_KEY, DATABASE_URL, JWT_SECRET at minimum
npm install
npm run db:push        # push Drizzle schema to Postgres
npm run dev            # http://localhost:5000
```

Required env vars: `POLYGON_API_KEY`, `DATABASE_URL`, `JWT_SECRET`. Recommended: `FMP_API_KEY`, Stripe keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `STRIPE_ELITE_PRICE_ID`), SMTP (`SMTP_HOST`/`PORT`/`USER`/`PASS`/`FROM` — required for alerts), `SENTRY_DSN`. Full list in `.env.example`.

## Scripts

```bash
npm run dev              # tsx server/index.ts (dev)
npm run build            # bundle to dist/
npm start                # NODE_ENV=production node dist/index.cjs
npm run check            # tsc --noEmit
npm run db:push          # drizzle-kit push
npm run seed:demo        # seed demo data

# Smoke tests (run in CI)
npm run rsi:diff         # cross-path RSI parity
npm run bbtc:parity      # BBTC strategy parity
npm run ver:parity       # VER strategy parity
npm run amc:parity       # AMC strategy parity
npm run tier:smoke       # tier middleware
npm run health:smoke     # /health endpoint
npm run logging:smoke    # request-id + pino
npm run jobs:smoke       # job scheduler
npm run fmp:smoke        # FMP adapter
npm run ratings:smoke    # analyst ratings
npm run earnings:smoke   # earnings calendar
```

## Production build

```bash
npm run build
NODE_ENV=production node dist/index.cjs
```

Requires Postgres reachable via `DATABASE_URL`. Better-sqlite3 is included for local caching but Postgres is the source of truth.

## Deploy

### Production (stockotter.ai)

Self-hosted on `imt-uv-helpdesk` (`68.171.198.222`).

- **App path:** `/opt/stock-analyzer/`
- **Process manager:** `pm2`, process name `stock-analyzer`
- **Deploy trigger:** GitHub webhook on push to `main` → server pulls → `pm2` restarts the process
- **Owner workflow:** edit locally → upload via GitHub web UI → merge to `main` → webhook handles the rest

Operational checks (run on the server):

```bash
pm2 list                          # confirm stock-analyzer is "online"
pm2 logs stock-analyzer --lines 50
curl -fsS http://localhost:5000/health    # 200 = DB reachable, 503 = degraded
```

### Other targets (forks / experiments)

**Railway** (uses `nixpacks.toml`): New Project → Deploy from GitHub Repo → set env vars → deploy. Build/start are auto-detected from `package.json`.

**Render**: New Web Service → Build: `npm install && npm run build`, Start: `NODE_ENV=production node dist/index.cjs`, Env: Node 20+, set env vars.

**Fly.io**: `fly launch` (auto-generates Dockerfile) → `fly deploy`. Set secrets via `fly secrets set`.

All targets need `PORT`, `DATABASE_URL`, `POLYGON_API_KEY`, `JWT_SECRET` at minimum.

## Verdict scoring model

The Long-Term Outlook page (`/verdict`) runs an 8-category weighted score:

| Category | Weight | What it measures |
|---|---|---|
| Income Strength | 15% | Dividend yield level |
| Income Quality | 15% | Payout ratio sustainability |
| Business Quality | 15% | Revenue growth + gross margins |
| Balance Sheet Quality | 15% | Debt-to-equity + current ratio |
| Performance Quality | 15% | 1Y and 3Y total returns |
| Valuation Sanity | 10% | P/E + forward P/E |
| Liquidity & Scale | 5% | Market cap + average volume |
| Thesis Durability | 10% | Beta + growth + leverage |

**Verdict bands:** 8.5–10.0 YES (strong) · 7.0–8.49 YES (with caveats) · 5.5–6.99 WATCH · below 5.5 NO.

The Scanner / Watchlist / Trade Analysis pages run a separate gate-based confluence signal (`server/signals/confluence.ts`) — three gates (reversal, momentum, trend) producing READY → SET → GO state.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every PR: `npm ci` → `npm run build` → signal parity smokes (BBTC/VER/AMC) → jobs scheduler smoke → tier middleware smoke.

## License

MIT
