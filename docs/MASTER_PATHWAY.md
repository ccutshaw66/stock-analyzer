# Stock Otter — Master Pathway (MP)

**Owner:** Chris Cutshaw
**Last updated:** 2026-05-23
**Status:** Living document. Single reference point for next steps.

> **Mission:** Ship a foundationally reliable, commercially licensed, tier-gated
> SaaS that validates stock market claims with backtested confluence. The MP is
> the only document that answers "what do I work on next?"

> **Project rules** — workflow, build/structure, auto-deploy, backups — live in
> `docs/RULES.md` (the single source of truth, per the one-file-one-location
> rule). The compartment contract referenced below is also catalogued there.

**Status legend:** ✅ done · 🟨 partial / in progress · ⬜ not started · 🚫 dropped/deprecated

---

## Where we are (April 2026)

Phases 0–1 are substantially complete. Phase 2 reliability is mostly in place — the gap is **Sentry, Zod request validation, and global rate limiting**. Phase 3 data migration shipped, including FMP analyst ratings/earnings/insider/institutional, in-house beta, and the Polygon-backed long-range Verdict (25y history was solved by swapping Yahoo futures for FMP commodity quotes — see PRs #70-75). Phase 4 (Alerts MVP + signal-based Track Record + Scanner oscillator) shipped. Phase 5 admin/billing surface exists; webhook-idempotency review still pending. Phase 6 hardening is the active workstream — **the dominant blocker for GA is FMP commercial-tier upgrade**. Yahoo retirement is a Phase 7 project (SEC N-PORT replacement), not a Phase 6 line item.

**Architectural note on Yahoo:** Yahoo data is intentionally retained as a background buffer/cache-refresh agent (`server/yahoo-ownership-warmup.ts` and the institutional/long-range warmup crons). It is not on the user request path. A previous AI session attempted a "remove Yahoo" sweep that gutted Institutional/Insider/Fund Holders pages; restoring those required reintroducing the Yahoo cache helper. **Do not propose removing Yahoo as a quick win.** The clean retirement path is SEC N-PORT integration in Phase 7.

Several features shipped that weren't on this plan and should be folded in: Sector Heatmap with sector drill-in (PRs #66-68), Dividend Finder + Dividend Portfolio (`/dividends`, `/dividend-portfolio`), Earnings Calendar (`/earnings`), Trade Tracker analytics with MFE/MAE + position-duration breakdown, and Scanner v2 with ~12 confluence signals (`server/scanner-v2-signals/*`).

---

## Guiding principles

1. **Foundation before features.** Every new feature lands on top of the compartmentalized architecture below.
2. **Swap-ability everywhere it matters.** Data providers, alert channels, billing, and indicators are isolated behind interfaces. No vendor-specific code in feature modules.
3. **One voice for signals.** Scanner, watchlist, verdict, gate cards, and trade analysis all call the same `signals/confluence.ts`. No more VER ↔ Gate 1 ↔ SOFI/TAL contradictions.
4. **Strangler migration, not big-bang.** Old code stays alive until the new code replaces its caller. No cutover weekends.
5. **Reliability before growth.** Backups, monitoring, error capture, and graceful degradation ship before marketing does.
6. **Every feature is a compartment, end-to-end.** *(Added 2026-05-14, locked R2.5 of dashboard plan.)* Server module → one canonical data hook → at minimum a Full view and a Widget view → one registry entry. New widgets and new surfaces (mobile, embed, alert preview) come from composing existing compartments, not from new bespoke code. Adding a new compartment is **one new file plus one registry line**. This is "one RSI reference" applied to every feature.

---

## Architecture target (see README + scaffold)

```
server/
  data/          ← Layer 1: vendor-agnostic data access
  indicators/    ← Layer 2: pure calculations
  signals/       ← Layer 3: gates + confluence
  features/      ← Layer 4: page orchestration
  platform/      ← Layer 5: cross-cutting (tiers, alerts, jobs, billing, ...)
  api/           ← Layer 6: HTTP routes
```

**Dependency rule:** each layer imports only from layers below. `platform/*` callable from any layer; never imports upward.

**State:** scaffold dropped, `data/`/`indicators/`/`signals/`/`platform/` populated and used. `features/*` is mostly stubs (`.keep` files); page orchestration still lives in `server/routes.ts` and per-page server modules. The strangler migration of `routes.ts` into `features/*` is unfinished and is the next architectural cleanup.

---

## Validated positioning (from ideas thread)

- **Guru/hype detector** is the wedge. "Stop trusting gurus. Verify every call with backtested confluence."
- **Confluence over single indicators** is the moat.
- **Track record + 2y backtest** is the primary sales asset. (Track Record backtester shipped PR #59.)
- **Alerts > Wheel.** Wheel is deferred until alerts ship. (Alerts shipped PR #57; Wheel still parked.)

---

## Data stack decisions

| Provider | Role | Cost | Status |
|---|---|---|---|
| **Polygon Stocks Starter** | Quotes, aggregates, financials, search, dividends | $29/mo | ✅ Active |
| **Polygon Options Starter** | Options snapshots for MM Exposure + Wheel | $29/mo | ✅ Active |
| **FMP Premium** | Analyst ratings, earnings estimates, insider, institutional, commodity quotes (metals 25y) | $59/mo | ✅ Active |
| **Yahoo** | **Buffer / cache-refresh agent** for fund holdings, institutional ownership, insider rosters | $0 | ✅ Active — architectural role, not on user request path |
| **In-house beta calc** | Beta from Polygon vs SPY | $0 | ✅ Active (`server/indicators/beta.ts`) |
| **SEC EDGAR** | 13F institutional fallback | $0 | ✅ Active (`data/providers/edgar.adapter.ts` + `edgar.client.ts` with rate limiter + circuit breaker; FMP primary, EDGAR fallback) |
| **SEC N-PORT** | **Future** — replaces Yahoo for fund-holdings refresh | $0 | ⬜ Not started — this is the work item that retires Yahoo |

**Total data cost:** $117/mo. **Open:** Upgrade FMP to commercial tier (Build/Enterprise) before GA.

**Yahoo's architectural role:** Yahoo is a **cache-warming agent only**. Crons (`server/yahoo-ownership-warmup.ts`, `server/institutional-warmup.ts`, `server/long-range-warmup.ts`) refresh a 23-hour cache; paid pages read from the cache, never directly from Yahoo. This sidesteps the redistribution-licensing concern because Yahoo data is not served on the user request path. **Yahoo will not be removed until SEC N-PORT replaces fund-holdings refresh** (13F-only EDGAR is not a complete substitute — it covers institutions, not fund holdings).

---

## Master execution pathway

### Phase 0 — Unblock ✅ complete

| # | Task | Status |
|---|---|---|
| 0.1 | Rotate Polygon API key; confirm dashboard matches `.env` | ✅ |
| 0.2 | Move all secrets to `.env` (gitignored) | ✅ |
| 0.3 | Subscribe to FMP Premium; obtain API key | ✅ |
| 0.4 | Install database backup cron (pg_dump → S3/B2 nightly) | ✅ (`scripts/backup.sh`, `scripts/install-backup-cron.sh`, `docs/BACKUP.md`) |
| 0.5 | Polygon coverage decisions (institutional, verdict 25y) | ✅ — FMP for institutional, FMP commodity quotes for metals 25y |

### Phase 1 — Compartmentalize ✅ mostly done

| # | Task | Status |
|---|---|---|
| 1.1 | Drop scaffold into repo; wire TypeScript paths; baseline `tsc --noEmit` | ✅ |
| 1.2 | Implement `platform/config/` loader; remove all direct `process.env` reads | 🟨 — loader exists at `server/platform/config/index.ts`; **13 server files still read `process.env` directly** (auth, storage, stripe, polygon, email, edgar.client, fmp.client, routes, index, logger, seed-demo, health, providers). Audit + replace. |
| 1.3 | `data/providers/polygon.adapter.ts` for quotes + aggregates + options + financials + search | ✅ |
| 1.4 | `data/providers/yahoo.adapter.ts` thin wrapper | ✅ |
| 1.5 | `data/providers/in-house.adapter.ts` for beta | ✅ |
| 1.6 | Route **Profile** page through `data/` facade as proof-of-design | 🟨 — `data/` facade in use across the codebase, but Profile page (`/profile` → `home.tsx`) still hits the legacy `/api/analyze` path through `routes.ts`. `features/profile/.keep` is a stub. |
| 1.7 | Unify `indicators/rsi.ts` usage across scanner, verdict, watchlist | ✅ (PR #56 unified the signal engine) |
| 1.8 | Diff script: compare RSI values from every code path | ✅ (`scripts/rsi-diff.ts`, runs in CI as `npm run rsi:diff`) |
| 1.9 | Route `signals/confluence.ts` into Scanner page | ✅ |
| 1.10 | Route `signals/confluence.ts` into Watchlist page | ✅ |
| 1.11 | Route `signals/confluence.ts` into Trade Analysis / Verdict signals | ✅ |
| 1.12 | `platform/tiers/` middleware on protected routes | ✅ (`server/platform/tiers/middleware.ts` + `server/middleware/tier.ts`; smoke test in CI) |

### Phase 1B — Universal Compartment Contract ⬜ (added 2026-05-14, locked R2.5)

**Origin:** dashboard-planning session 2026-05-14 — Chris's realization that the dashboard requirement implies every feature should be a self-contained compartment with a widget-compatible interface. Otherwise every widget is bespoke code.

**Goal:** Every existing user-facing feature becomes a compartment with a defined contract, so any new surface (Dashboard widgets, mobile, embed, alert previews) is composition, not net-new feature code.

**Compartment contract (the four guarantees):**
1. **One canonical data hook per compartment.** Pages, widgets, alerts, and API endpoints all call the same source. No parallel fetches or duplicated calc paths.
2. **Pure logic layer.** Calculations are pure functions. No vendor calls inside calc. Preserves swap-ability (Principle #2).
3. **At minimum two presentation modes:** Full view (existing page) + Widget view (compact, dashboard-ready). Additional modes (mobile, embed, alert preview) can be added later without touching data or logic.
4. **Registry entry.** A manifest exporting `{ id, name, tier, defaultSize, WidgetComponent, fullPageRoute }`. Adding a new compartment is **one new file + one registry line**.

**Execution model:** Strangler (Principle #4). One feature at a time, ordered by the next widget that needs it. Never break a working feature in a refactor sweep.

| # | Task | Status |
|---|---|---|
| 1B.1 | Audit existing features against the compartment contract; produce a checklist of which features are already compartment-shaped vs need refactor | ✅ — see `~/.claude/plans/compartment-works-lock-it-velvet-pillow.md` for full audit (12 features scored on the 4-point contract, effort sized S/M/L) |
| 1B.2 | Finalize the compartment contract (the 4 points below are locked R2.5) | ✅ |
| 1B.3 | Define the registry shape — TypeScript types + the single registry file | ⬜ |
| 1B.4 | First strangler refactor: Scanner v2 → compartment (driven by Dashboard's "Best Opps" widget need) | ⬜ |
| 1B.5 | Second strangler refactor: Favorites/Watchlist → compartment (driven by Dashboard's "Watchlist" widget need) | ⬜ |
| 1B.6 | Third strangler refactor: Trade Tracker → compartment (driven by Dashboard's "My Trades" widget need) | ⬜ |
| 1B.7 | Subsequent compartments refactored on demand as their widgets get scheduled (dividend finder, earnings, verdict, MM exposure, sector heatmap, etc.) | ⬜ |

**Dependency on the existing `features/*` layer:** The architecture target already defines a `server/features/*` layer that is mostly stubs. The compartment work is **finishing the `features/` migration + adding a client-side mirror** (the data hook + widget view + registry live on the client, calling into `features/*` on the server). It is **not** a parallel architecture.

**Refactor order (locked R2.5, driven by dashboard widget dependencies):**
1. Favorites / Watchlist (effort S) — also serves as the *template compartment* (worked example of the contract).
2. Scanner v2 (effort M) — unblocks "Best Opps" widget.
3. Trade Tracker (effort L) — unblocks "My Trades" widget; requires pre-decision on client vs server P/L ownership.
4. Subsequent compartments (Earnings, Track Record, MM Exposure, Verdict, Dividend, Sector, Strategy Chart, Profile, Signal Pulse, Alerts, Admin) refactored on-demand when a widget round needs them.

**Audit-flagged cross-feature tangles to design around:**
- **Verdict score divergence** — `/api/verdict` calls both `scoreSnapshot()` and legacy `computeScoring()` with fallback (`server/routes.ts:4454-4525`). Touches Principle #3 ("one voice for signals"). Fix before any compartment depends on Verdict, or as part of Verdict's own refactor.
- **Alerts have no pure eval function** — every alert type is a separate cron branch (`routes.ts:6373+`, `cron.ts`). Compartment refactor must extract `evaluateAlertRule(rule, tick) → bool`.
- **Trade Tracker P/L ownership** — client (`trade-tracker.tsx:180-297`) and server (`routes.ts:5868-5930`) both implement P/L; needs design decision before refactor #3.

**Standing risks:**
- "Just wrap it" anti-pattern: wrapping tangled code in a function does not make it a compartment. The contract must be real.
- Tests: compartments need unit-testable boundaries. **Zero of the 12 audited features have unit tests.** Compartment refactors add tests at the boundary (data hook + pure logic).

### Phase 2 — Foundation reliability 🟨 in progress

| # | Task | Status |
|---|---|---|
| 2.1 | Sentry integration via `platform/telemetry/captureException` | ⬜ — `telemetry/index.ts` is a stub with `TODO: Sentry.init()` and console fallbacks. `SENTRY_DSN` is wired in config but never consumed. |
| 2.2 | Structured logging via pino; request-id middleware | ✅ (`server/lib/logger.ts`, `server/middleware/request-context.ts`, smoke `npm run logging:smoke`) |
| 2.3 | `/health` endpoint checking DB + Polygon + Stripe + FMP | 🟨 — `/health` and `/health/live` shipped (`server/api/routes/health.ts`); only checks DB. Add Polygon + Stripe + FMP probes. |
| 2.4 | UptimeRobot / BetterUptime pinging `/health` every 5m | ✅ — playbook in `docs/uptime-monitoring.md` |
| 2.5 | `platform/jobs/scheduler.ts` wired; migrate existing crons | ✅ (`server/platform/jobs/scheduler.ts` + 4 jobs: backup-database, check-outcomes, evaluate-alerts, log-daily-signals; smoke `npm run jobs:smoke`) |
| 2.6 | `backup-database` cron live with restore-test script | ✅ (`scripts/backup.sh`, `scripts/restore.sh`, `scripts/install-backup-cron.sh`); end-to-end restore drill is Phase 6.6 |
| 2.7 | Zod request validation on all `/api/*` endpoints | ⬜ — **zero `z.` usage in `server/`**. Drizzle-zod is wired at the schema layer; request-body validation is not. |
| 2.8 | Rate limiting via express-rate-limit per user + tier | 🟨 — per-user scan-count rate limiting in `server/middleware/tier.ts`; no global IP-based limiter. |
| 2.9 | Graceful-degradation policy: cached data + banner when Polygon down | 🟨 — caches exist (`server/cache.ts`, `server/long-range-cache.ts`, `server/institutional-cache.ts`); no formal "stale-cache served" UI banner. |
| 2.10 | GitHub Actions CI: `tsc --noEmit` + tests on every PR | 🟨 — `.github/workflows/ci.yml` runs build + parity smokes + jobs/tier smokes. Add explicit `npm run check` (`tsc --noEmit`) step. |

### Phase 3 — Data migration ✅ complete

| # | Task | Status |
|---|---|---|
| 3.1 | `fmp.adapter.ts` (analyst ratings, earnings, insider, institutional) | ✅ (`server/data/providers/fmp.adapter.ts` + `fmp.client.ts`; smoke `npm run fmp:smoke`) |
| 3.2 | Migrate Analyst Ratings page (Yahoo → FMP) | ✅ (smoke `npm run ratings:smoke`) |
| 3.3 | Migrate Earnings page (Polygon + FMP) | ✅ (`server/fmp-earnings.ts`, `client/src/pages/earnings-calendar.tsx`, smoke `npm run earnings:smoke`) |
| 3.4 | Migrate Institutional / Insider page (FMP, EDGAR fallback) | ✅ (PRs #64, #65, #69 — Form-4 code translation, mcap fallback, cache invalidation) |
| 3.5 | Build Fundamental Screener on top of `/vX/reference/financials` | ✅ — landed as **Scanner v2** with 12 signals (`server/scanner-v2-signals/*`, `server/scanner-v2.ts`, smoke `npm run scanner-v2:smoke`) |
| 3.6 | Wire MM Exposure to `/v3/snapshot/options/*` | ✅ (`server/mm-exposure.ts`) |
| 3.7 | Compute Beta via in-house adapter; remove Yahoo dependency for beta | ✅ (`server/indicators/beta.ts`) |
| 3.8 | Verdict 25y history strategy | ✅ — Polygon for equities, FMP commodity quotes for metals (PRs #70-75) |

### Phase 4 — Retention loop: Alerts ✅ complete

| # | Task | Status |
|---|---|---|
| 4.1 | `platform/alerts/` email + webhook adapters | ✅ (`server/platform/alerts/providers/{email,webhook}.adapter.ts`) |
| 4.2 | Alert trigger definitions (4 rule types) | ✅ (PR #57 "Alerts MVP — 4 rule types + in-app bell/page") |
| 4.3 | `evaluate-alerts` cron | ✅ (`server/platform/jobs/jobs/evaluate-alerts.ts`) |
| 4.4 | User alert preferences UI | ✅ (`client/src/pages/alerts.tsx` + `AlertsBell.tsx`) |
| 4.5 | Dedupe + idempotency so repeated evaluations don't spam | 🟨 — verify under load before promoting to ✅ |

**Bonus shipped this phase (not originally planned):**
- Scanner indicator oscillator — MACD histogram + RSI (PR #58)
- Track Record signal-based backtester (PR #59)
- Signal Pulse oscillator + How-it-works panels (PR #60, #61)
- Live Signals universe expanded to ~200 tickers (PR #62)

### Phase 5 — Conversion + Admin 🟨 in progress

| # | Task | Status |
|---|---|---|
| 5.1 | Limit-reached page redesigned as conversion surface | ✅ (`client/src/components/{LimitReached,UpgradePrompt}.tsx`) |
| 5.2 | Free-tier pages show proper messaging instead of 403 / blank state | ✅ (`UpgradePrompt` is wired across paid pages) |
| 5.3 | Admin panel: user table + tier dropdown + scan-count view | ✅ (`client/src/pages/admin.tsx`, gated to `awisper@me.com`) |
| 5.4 | `platform/billing/stripe.adapter.ts` wrapper; idempotent webhooks | 🟨 — `server/stripe.ts` + `server/platform/billing/index.ts` exist; audit webhook handler for replay safety (Stripe event-id dedupe table) |
| 5.5 | Gate box visual consistency + VER/AMC/BBTC card alignment | ✅ |

### Phase 6 — Pre-GA hardening 🟨 active workstream

| # | Task | Status |
|---|---|---|
| 6.1 | Confirm no Yahoo data is served on the user request path (cache-warmup-only architecture) | 🟨 — metals swap landed (PR #75); Yahoo lives in cache-warmup crons (`yahoo-ownership-warmup.ts`, `institutional-warmup.ts`). Audit user-facing routes to confirm none read directly from Yahoo. **Replacement of Yahoo as the warmup source is a separate project — see Phase 7 (SEC N-PORT).** |
| 6.2 | FMP upgrade to commercial tier (Build/Enterprise) | ⬜ — **GA blocker** |
| 6.3 | Terms of service + "not investment advice" disclaimer | ✅ (`client/src/components/Disclaimer.tsx`, `client/src/pages/legal.tsx` with `/terms` and `/privacy` routes) |
| 6.4 | Staging environment separate from prod (separate DB + keys) | ⬜ |
| 6.5 | Load test scanner + MM Exposure at 100 concurrent users | ⬜ |
| 6.6 | Restore-test database backups end-to-end | 🟨 — `scripts/restore.sh` exists; needs an actual end-to-end drill |

### Phase 7 — Parking lot

- **SEC N-PORT integration as Yahoo replacement** — replaces `yahoo-ownership-warmup.ts` as the source for fund holdings. N-PORT covers funds (mutual funds, ETFs); 13F covers institutions. Both are needed to fully retire Yahoo.
- Wheel Strategy re-activation (post-alerts) — **eligible to promote now that alerts shipped**
- SEC EDGAR as primary insider/institutional source (currently fallback only)
- Mobile app
- API for third-party integrations
- Accessibility audit
- Design system / shared component library
- Multi-region deployment
- Multi-tenancy for enterprise customers
- Finish strangler migration of `server/routes.ts` into `features/*` modules *(folded into Phase 1B — see "Universal Compartment Contract")*
- Customizable per-member Dashboard at `/dashboard` *(planning in flight 2026-05-14, see `docs/DASHBOARD_PLAN.md`; ship depends on Phase 1B compartment work)*

---

## Decisions still open

1. ~~Institutional/insider source: FMP vs SEC EDGAR.~~ **Resolved:** FMP primary, EDGAR fallback adapter built.
2. ~~Verdict 25y history: Polygon upgrade vs 5y compromise.~~ **Resolved:** FMP commodity quotes for metals, Polygon for equities, no plan upgrade needed (PRs #70-75).
3. **Production backup destination:** AWS S3, Backblaze B2, or Wasabi. Still open — pick on cost. Backup mechanics are otherwise complete.
4. **NEW — `process.env` cleanup deadline.** 13 files still bypass `platform/config`. Pick a date or accept the drift.
5. **NEW — Stripe webhook idempotency.** Audit before charging real cards at volume.

---

## Immediate next 5 (do these first)

In priority order, these are the lowest-numbered unchecked tasks whose dependencies are met:

1. **2.1 Sentry** — replace `telemetry/index.ts` stub with real `@sentry/node` init. Wire `captureException` calls into the request-context middleware error path. (~2h)
2. **6.2 FMP commercial tier** — upgrade subscription. (~1h, mostly billing.)
3. **6.1 Yahoo request-path audit** — grep all live `/api/*` routes for direct Yahoo reads; confirm Yahoo is touched only by cache-warmup crons. (~1-2h. Yahoo replacement itself is Phase 7 / SEC N-PORT, not a Phase 6 task.)
4. **2.7 Zod request validation** — add a request-body schema layer to `/api/*`. Start with the highest-traffic 5 endpoints. (~3-4h)
5. **5.4 Stripe webhook idempotency** — add event-id dedupe table; replay test. (~2h)

---

## KPIs for "kickass SaaS" readiness

You're ready for real paying users when every one of these is green:

- [ ] Zero `process.env` reads outside `platform/config` *(13 files still bypass — Phase 1.2)*
- [x] Single RSI function verified via diff script across all pages
- [x] `signals/confluence.ts` is the only code that renders gate state
- [x] All paid pages pass tier middleware
- [ ] `/health` green on UptimeRobot for 7 straight days *(endpoint shipped; need extended uptime + Polygon/Stripe/FMP sub-checks)*
- [ ] Nightly backup proven with an end-to-end restore test *(scripts in place; drill not run)*
- [ ] Sentry receiving errors; alert wired to email *(Phase 2.1)*
- [ ] Stripe webhooks idempotent (can replay any event safely) *(Phase 5.4)*
- [ ] No Yahoo calls in the user request path — confirmed by route-level grep *(Phase 6.1; cache-warmup Yahoo crons are intentional and stay until SEC N-PORT replaces them — Phase 7)*
- [ ] FMP on a commercial-licensed tier *(Phase 6.2)*
- [ ] CI blocks PRs that fail `tsc --noEmit` *(CI exists, missing `npm run check` step)*
- [x] ToS + disclaimer published
- [ ] One full week using the app as a paying user would (dogfood)

**Score: 4 / 13 green.** The remaining 9 are mostly contained to Phase 2 (Sentry, Zod, health sub-checks) and Phase 6 (Yahoo, FMP, restore drill, dogfood, staging).

---

## How to use this document

1. **Every working session:** open MP, pick the lowest-numbered unchecked task whose dependencies are all checked. Work only on that.
2. **When tempted by a new idea:** add it to Phase 7 (parking lot), not earlier phases.
3. **When blocked:** note the blocker next to the task. Don't silently stall.
4. **At the end of each phase:** re-read Phase 7 and promote/demote items based on what you learned.
5. **When you ship something not on this list:** add it under the relevant phase as a "Bonus shipped" line so the doc stays honest.

The MP is the product roadmap, the engineering plan, and the focus tool. If work doesn't map to a line item here, it shouldn't be happening yet.
