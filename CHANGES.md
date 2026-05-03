# Stock Otter — Changes Log

This file is the running history of meaningful changes to the project.
Newest entries on top. Each entry should describe **what** changed,
**why**, and which files were touched, so that any human or AI picking
up the project later has the context to keep moving.

For pre-2026-04-25 history, see `FEATURE_CHANGES.md` (focused log of the
Dividend Finder + Position Duration Analysis features that were added
during the prior Perplexity/Claude session).
---
## 2026-05-03 (evening) — Cross-platform `npm run dev` (Windows fix)

**Issue:** Setting up the project on a Windows laptop, `npm run dev`
failed with `'NODE_ENV' is not recognized as an internal or external
command`.

**Root cause:** The `dev` and `start` scripts in package.json used
Mac/Linux inline env-var syntax (`NODE_ENV=development tsx server/index.ts`).
PowerShell doesn't parse that — it treats `NODE_ENV=development` as a
command, which doesn't exist.

**Fix:**
- `package.json` — wrapped the `dev` and `start` scripts with `cross-env`,
  the standard cross-platform env-var wrapper. No-op on Linux/Mac (passes
  the var through to the wrapped command), so the prod deploy on
  imt-uv-helpdesk behaves identically. Now `npm run dev` works on
  Windows / Mac / Linux without any per-session `$env:` setup.
- Added `cross-env@^7.0.3` to `devDependencies`. Run `npm install` once
  after pulling to pick it up.

Commit: `40e239e`. Rollback tag: `safe/2026-05-03-pkgxenv`.

---
## 2026-05-03 (later) — EDGAR burst-detection fix + Akamai re-block

Issue: Today's 5am ET institutional warmup completed in 14 seconds with 163 errors and 0 successful writes. Curl confirmed SEC IP block re-tripped. ~219 corrupt cache files showing 0 holders for valid tickers.

Root cause: `aggregateFilers()` in edgar.adapter.ts was using Promise.all() with CONCURRENCY=8. The client-level rate limiter throttles individual requests, but parallel queueing produced visible bursts to Akamai. Cumulatively this re-tripped the auto-block we resolved on April 29.

Secondary: empty (0-holder) aggregation results were being written to cache as if valid, masking the failure for the full TTL.

Fix:
- server/data/providers/edgar.adapter.ts — CONCURRENCY lowered from 8 to 1
- Added empty-result guard before cache write

Operational: deleted all 219 corrupt cache files; sent follow-up to webmaster@sec.gov; waiting on unblock before re-warming.
---

## 2026-05-03 — Verdict snapshot card: Avg Volume + Beta restored

**Symptoms users were seeing:**
- Verdict page Snapshot card displayed `Avg Volume: 0` with a Caution flag
- `Beta: N/A` with a Neutral flag, on every ticker

**Root causes (both pre-existing bugs, not caused by this session):**

1. `server/polygon.ts` had a `null // filled below if possible` placeholder
   on `averageDailyVolume3Month` from the prior AI's Phase 3.7 Polygon
   migration. The implementation was never finished; the field was
   permanently null. Downstream `safeNum()` then converted null to 0.

2. `server/polygon.ts` also hardcoded `beta: null` because Polygon does not
   sell beta data on any tier (verified 2026-04). The original Yahoo
   `defaultKeyStatistics.beta` source path was retired during the same
   migration and never replaced.

**Fixes:**

- **`server/polygon.ts`** — promoted the avg-volume calculation into the
  same try-block as the existing 52-week range computation. Both averages
  (3-month / 10-day) now derive from the daily bars already being fetched.
  Zero additional HTTP calls; just mining the existing payload.
  - 3-month avg = mean of last 63 trading days' volume (US trading sessions ≈ 1 quarter)
  - 10-day avg = mean of last 10 days' volume

- **`server/data/providers/fmp.adapter.ts`** — added a new exported
  function `getFmpProfileBeta(symbol)`. Calls FMP `/profile/{symbol}`,
  reads the `beta` field, returns null gracefully on missing data /
  micro-caps / API errors.

- **`server/routes.ts`** — added `getFmpProfileBeta` to the FMP imports.
  In both `/api/analyze/:ticker` (analyze route) and
  `/api/verdict/:ticker` (verdict route), inserted a beta-fallback block
  immediately after `extractQuoteData()`: if `quote.beta == null`, try
  FMP and overlay the value. Wrapped in try/catch so a transient FMP
  failure does not crash the page; UI tolerates null and renders N/A.

**Cost impact:** zero recurring. Avg Volume reuses bars already fetched.
Beta adds at most one FMP `/profile` call per first-time ticker view
(cached upstream by `fmpGet`). FMP Premium plan budget is unaffected.

**Architectural note:** beta now permanently lives on FMP. If the FMP
plan is ever downgraded or swapped, beta will go back to N/A. Eventually
this should be replaced with a Yahoo-backed cache-refresh agent (same
pattern as `yahoo-ownership-warmup.ts`) for resilience.

**Files touched:**
- `server/polygon.ts`
- `server/routes.ts`
- `server/data/providers/fmp.adapter.ts`

---

## 2026-05-02 (evening) — Conviction Compass forward-tracker

**Why:** Added the new Conviction Compass indicator earlier the same day
(see entry below). Owner asked: "How can we backtest this?" Answer: only
3 of 4 axes are historically reconstructable cheaply (smart money,
technicals, fundamentals); the dealer-positioning axis needs historical
options data we don't currently buy. So instead of a backward backtest,
we ship a **forward paper-trader** that snapshots the live compass for a
curated universe daily, then fills in 1d/5d/30d/90d returns as each
window closes. Real performance data accumulates without paying for
historical options data.

**Implementation:**

- **`shared/schema.ts`** — added two tables:
  - `compass_snapshots` — denormalized daily reading per ticker
    (verdict, axis scores, confluence, alignment, confidence) plus
    `return_1d`/`5d`/`30d`/`90d` columns that start null and get filled
    in. Full compass JSON also stored for audit. Indexes on
    `(ticker, taken_date)`, `taken_at`, and `verdict`.
  - `spy_baseline_returns` — same forward-return columns anchored on
    each tracked date so the aggregator can show "ALL_ALIGNED_BULLISH
    30d return: +X% vs SPY +Y% on the same dates."

- **`server/conviction/tracker.ts`** (new) — exports
  `snapshotConvictionForUniverse()` and `updateForwardReturns()`.
  `TRACKED_UNIVERSE` is a hardcoded ~100-ticker S&P-100-ish list spanning
  sectors with options coverage so all four axes can score. Snapshot
  function is idempotent (skips tickers already snapshotted today).

- **`server/conviction/backtest.ts`** (new) — pure SQL aggregations
  grouped by verdict — count, avg per forward window, win rate at 30d.
  Plus SPY baseline averaged over the same date set.

- **`server/cron.ts`** — registered two jobs:
  - `conviction-snapshot` at 21:30 UTC weekdays (5:30pm ET, 30 min after
    close)
  - `conviction-forward-returns` at 21:45 UTC weekdays (15 min later)
  - `initCron()` signature extended to accept `yahooFetch` +
    `getYahooOwnership` for the snapshot pipeline.

- **`server/routes.ts`** — `GET /api/diag/conviction/backtest` returns
  the per-verdict aggregates. Public via the existing `/api/diag/*`
  auth bypass (read-only aggregates).

- **`client/src/pages/conviction.tsx`** — added a `BacktestPanel`
  below the radar. Per-verdict performance table + SPY baseline row.
  Suppresses cells with N < 5 datapoints so we never show misleading
  early numbers. Friendly "still collecting" empty state on day 1.

**Timeline expectations:**
- Day 0: empty-state panel
- +1 day: 1d returns populate
- +5 days: 5d returns populate; panel becomes meaningfully useful
- +30 days: real backtest data per verdict including 30d win rate
- +90 days: complete dataset, marketing-ready

**Files touched:**
- `shared/schema.ts`
- `server/conviction/tracker.ts` (new)
- `server/conviction/backtest.ts` (new)
- `server/cron.ts`
- `server/routes.ts`
- `client/src/pages/conviction.tsx`

Commit: `7d09039`. Rollback tag: `safe/2026-05-01-1745`.

---

## 2026-05-02 — Conviction Compass — new fused multi-stream indicator + page

**Why:** Owner asked for a brand-new indicator with its own page. Audit
of existing indicators showed StockOtter has access to four orthogonal
signal categories that no popular retail tool combines today: smart
money flow, dealer positioning, technical momentum, fundamental quality.
Most "composite" indicators just stack TA components (MACD + RSI + BB)
which is one category of signal pretending to be many. The novelty is
fusing *independent* data streams — institutions can't manipulate
gamma exposure AND analyst consensus AND your moving averages
simultaneously, so when all four agree the signal is structurally much
stronger than four correlated TA signals agreeing.

**Backed by 2026 research:** retail traders using >5 indicators get
*worse* returns than those using 2-3 (analysis paralysis). So the
indicator must COMPRESS into one readable signal, not pile on another
chart. The radar visualization makes "everything aligned" vs "internal
contradiction" readable in one glance.

**Backend:**

- **`server/conviction/compass.ts`** (new) — pure compute function.
  `computeConvictionCompass(inputs)` produces four axis scores
  (-100..+100), a confluence score that penalizes divergence, an
  alignment 0..1, a plain-language verdict
  (`ALL_ALIGNED_BULLISH` / `MOSTLY_BULLISH` / `DIVERGENT` / etc.),
  and confidence (HIGH/MODERATE/LOW based on data completeness).
  Each axis fail-soft — missing data shrinks that axis's weight without
  failing the rest.

- **`server/conviction/pipeline.ts`** (new) — data orchestrator. Fetches
  CompanySnapshot + `computeMMExposure()` (gamma/dex/walls from Polygon
  Options) + 1y daily chart in parallel. Derives technicals (RSI(14),
  MACD histogram, EMA(9/21/50), Bollinger %B) via the existing indicators
  package. Mirrors the 8-factor verdict score from the snapshot.
  Cached 5 min in-process.

- **`server/routes.ts`** — `GET /api/conviction/:ticker` reads through
  this. `?refresh=1` supported.

**Frontend:**

- **`client/src/pages/conviction.tsx`** (new) — Recharts radar with
  two-polygon visualization (green for bullish magnitude per axis, red
  for bearish magnitude). Plain-language verdict pill at top.
  Bidirectional confluence gauge in side panel showing axis-alignment
  percentage. Per-axis cards below with every input that contributed to
  the score, signed contribution, direction icon. Educational HelpBlock
  explains methodology.

- **`client/src/App.tsx`** — added `/conviction` route.

- **`client/src/components/AppLayout.tsx`** — added "Conviction Compass"
  entry in the Company Research nav section between Institutions and
  Long-Term Outlook (logical grouping — they all read the snapshot).

**Follow-up fixes:**
- `51d097e` — round displayed values to 2 decimals at the backend source
  (defense in depth on top of frontend fmtNum).
- `54dc13b` — axis-card row overflow fix: GEX dollar values were running
  off the card. Compact K/M/B/T format in fmtNum + fixed widths on the
  value/contribution cells + truncation on long labels.
- `2f2ffbd` — drop QoQ from axis math when EDGAR is unavailable. The
  60%-weighted Institutional QoQ flow component was contributing 0
  during Yahoo fallback, diluting the Smart Money Flow score. Now drops
  out of the weighted average entirely so insider data drives the axis
  alone when QoQ isn't trustworthy.

Commits: `db0b8c2`, `51d097e`, `54dc13b`, `2f2ffbd`.

---

## 2026-05-01 — Architectural rebuild: unified snapshot pipeline + EDGAR resilience

Multi-day push to fix the long-running "follow the money" data quality
problems. Owner explicitly asked for "no patches" — replace patterns,
not symptoms. Roughly 20 commits across the day.

### Phase 1 — Snapshot pipeline foundation (`0de1864`)

**Why:** Three providers (Polygon, FMP, Yahoo, EDGAR), each silently
failing in different ways, each plumbed into different code paths.
Verdict route claimed it weights Institutional Flow at 25% but the
underlying `computeScoring()` ignored institutional data entirely.
Pages rendered blank when one provider failed because there was no
fallback. No way to see *which* provider answered.

**What:** New `server/snapshot/` directory — 12 files. `getCompanySnapshot()`
orchestrator + per-field `FieldHealth<T>` provenance (source / attempts /
latency / errors). Provider-fallback chains: quote (Polygon→FMP→Yahoo),
chart (Polygon→FMP→Yahoo), institutional (EDGAR→Yahoo), insider (FMP,
EDGAR slot reserved), analyst (FMP), earnings (FMP→Polygon),
fundamentals (Polygon→FMP), profile (FMP→Polygon→EDGAR). Diagnostic
route `/api/diag/snapshot/:ticker[?view=health|?refresh=1]`.

**Critical:** additive only. No existing route touched in Phase 1.

### Auth bypass for diagnostic endpoints (`9634ac7`)

`/api/diag/*` exempted from `requireAuth` so scheduled verification
agents and external monitoring can hit it without a session cookie.
Diag endpoints expose nothing a logged-in user can't see; the
ergonomics win.

### Phase 2 cutover — institutional page (`8527739`, `ff19938`)

`/api/institutional/:ticker` migrated to `getCompanySnapshot` +
`projectInstitutional` (legacy-shape projector). Frontend unchanged.
Picks up EDGAR→Yahoo fallback automatically. Also fixed:
- EDGAR `isSummaryCorrupt()` extended from one corruption pattern to
  three (the megacap empty-cache poison case where holders=0 but
  sharesOutstanding>0).
- `% Held` displayed as 972% instead of 9.72% (double *100 bug between
  snapshot and frontend).
- INSTITUTIONAL OWNERSHIP card showed 0.0% while the table showed
  ~70% of float — now derives institutionPct from Yahoo
  `majorHoldersBreakdown.institutionsPercentHeld` when EDGAR is empty.

### Yahoo QoQ artifact handling (`01fee32`, `1ee452e`)

Verified via direct EDGAR query: JPMorgan files 13Fs under multiple
subsidiary CIKs (`0000019617` JPM Chase + `0000919185` JPM Investment
Mgmt). When one subsidiary skips a quarter, Yahoo's name-matching
shows fake -52% drops on every megacap (we observed identical -52%
across AAPL/PLTR/MSFT — impossible as a real investment decision).

Initial fix `01fee32` did two things: (1) Yahoo-fallback gate to
suppress flow score when EDGAR was empty, (2) per-holder filter
ignoring -50%+ drops on $1B+ positions. Owner correctly flagged the
filter as data manipulation. `1ee452e` reverted the silent filter
but kept the Yahoo-fallback gate (honest disclosure of uncertainty,
not a hidden filter).

### On-demand refresh (`057f6e4`, `e6d2023`, `8ac2da6`)

`?refresh=1` on `/api/institutional/:ticker` clears EDGAR disk + in-process
caches, bypasses the snapshot orchestrator cache, returns whatever is
available immediately while EDGAR re-warms in background. Refresh
button added to the institutional detail modal. Initial 60s countdown
removed after testing — endpoint actually returns in 1-2s, owner
correctly pointed out the countdown was bad UX.

### Scanner cutover + slim version (`38c66d6`, `26dc23e`, `10d5ed4`)

`/api/institutional-scan` migrated to snapshot pipeline. Pre-existing
bug surfaced: cached scan response was returning bare array instead of
the wrapper object frontend expected — fixed.

Then realized 8-adapter snapshot per ticker × 150 tickers was timing
out at nginx's 60s proxy limit (took 133s). Slimmed to:
- `getInstitutionalScanSnapshot()` — only quote + ownership + insider
  (3 adapters not 8, ~62% reduction in network work).
- Default scan reduced 150 → 50 tickers.
- Stale-while-revalidate cache so repeat scans are instant.

### EDGAR fetch path resilience (`f630836`, `2f69577`, `64dc433`, `93a47dc`)

Diagnostic endpoint `/api/diag/edgar/:ticker` for true cache-bypassing
fetches.

`2f69577` — three changes: stop caching empty results when CUSIP is
missing (single FMP outage was poisoning cache for 12h in-process /
3 days on disk); replace silent `.catch(() => {})` swallows in
`getInstitutionalSummaryStaleOk` with logged errors; added
`forceCloseEdgarCircuit()` + `/api/diag/edgar/health` + reset
endpoints so circuit state is observable.

`64dc433` — three more: EFTS pagination retry + skip-on-page-failure
(was breaking out on first page error, leaving us with ~136 of ~5000
filers); `KNOWN_MAJOR_FILER_CIKS` list of 19 verified megacap filers
(Vanguard, BlackRock, State Street, etc.) fetched directly from SEC
submissions API regardless of EFTS health; refuse to cache
suspiciously-empty summaries (filerRefs.length < 200 + zero holders =
likely partial-pagination failure, don't cache).

`93a47dc` — root-cause fix for 429 storm. Three pieces:
1. **Throttle race condition** in `edgar.client.ts` — old throttle let
   N concurrent callers all read the same `lastRequestAt`, sleep the
   same duration, wake up together, and burst together. Replaced with
   a Promise chain that serializes — only one slot updates
   `lastRequestAt` at a time. True 4 req/sec regardless of concurrency.
2. **Disk cache for `company_tickers.json`** (7-day TTL) — the entry-
   point lookup was getting 429-blocked on every restart. Now persists
   across deploys.
3. **FMP CIK fallback** in `tickerToCik()` — verified live for AAPL
   (cik: '0000320193'). EDGAR pipeline keeps working through Akamai
   outages.

### Files touched across Phase 2 / EDGAR resilience

- `server/snapshot/` — 12 new files: types, fallback, quote, chart,
  institutional, insiders, insider-codes, analyst, earnings,
  fundamentals, profile, index
- `server/snapshot/projection-institutional.ts` — legacy-shape projector
- `server/data/providers/edgar.client.ts` — throttle + circuit reset
- `server/data/providers/edgar.adapter.ts` — corruption check, known
  filers, suspicious-empty refusal, FMP CIK fallback, ticker-map disk
  cache integration
- `server/institutional-cache.ts` — `clearInstitutional()` + ticker-map
  disk persistence functions
- `server/routes.ts` — diagnostic endpoints + cutover of
  `/api/institutional/:ticker` and `/api/institutional-scan`
- `client/src/pages/institutional.tsx` — refresh button, layout fixes

Many rollback tags were created across these commits. Most recent:
`safe/2026-05-01-1709`.

---

## 2026-04-30 — Unified analysis pipeline + metals fix + institutional UI guards (`cc0c8ac`)

Prior session work, included for completeness:
- Extracted `computeAnalysisCore()` so `/api/analyze` and `/api/verdict`
  both route through the same scoring path. Verdict had been hardcoding
  `threeYear`/`fiveYear` to null, producing a ~0.15 score gap that
  flipped borderline tickers. Bumped verdict cache key v3 → v4.
- Replaced inline Wilder's RSI in scanner oscillator endpoint with
  canonical `computeRSISeries` (was 1-bar lagged + capped at 99.01
  vs 100).
- Fixed metals fmpGet calls (gold/silver spot + 25y history): query
  params were embedded in path, producing malformed URLs with two `?`
  separators.
- `?? []` defensive guards in `client/src/pages/institutional.tsx` to
  stop the TypeError crash when API payload is partial.
- README.md and docs/MASTER_PATHWAY.md — reframed Yahoo as
  buffer/cache-refresh agent (not deprecated, replacement is SEC N-PORT
  in Phase 7).

---

## 2026-04-29 — SEC EDGAR Akamai block resolved

**Symptoms:**
- `[inst-warmup] EDGAR 403 Forbidden` spamming the logs (60+ tickers in a row)
- Top Institutions table showing only tiny RIAs (4–21 holders) instead of the
  expected hundreds for popular tickers like AAPL/NVDA/GE
- Institutional Ownership % computing to ~0.0% (effectively zero) because
  the cache had only fragments of the 13F data

**Root cause:**
SEC's CDN (Akamai) auto-blocks IPs that sustain too-aggressive request
patterns. The previous AI's panic-loop debugging session hammered EDGAR
hard enough to trip the block; the existing 8 req/sec rate limit had no
jitter and was shared across multiple concurrent crons, occasionally
producing visible bursts.

**Resolution path:**
1. Filed an unblock request to `webmaster@sec.gov` with our IP
   (68.171.198.222), explaining the new mitigations we'd just deployed.
2. SEC acknowledged the same day; full unblock confirmed within 24 hours.
3. Verified: `curl -m 10 -s -o /dev/null -w "%{http_code}\n" -H 'User-Agent: StockOtter SaaS superotter@stockotter.ai' https://www.sec.gov/files/company_tickers.json` returns 200.

**Code hardening (deployed before sending the email):**

- **`server/data/providers/edgar.client.ts`** — rate dropped from 8 req/sec
  flat → 4 req/sec with random 0–50ms jitter (intentionally well below
  SEC's 10/sec cap). Added a circuit breaker: 3 consecutive 403s opens
  the circuit for 1 hour, during which all EDGAR calls short-circuit
  with a new `EdgarBlockedError` instead of hitting the wire. Counter
  resets on any success. Default User-Agent updated from broken
  `contact@stockotter.ai` mailbox to `superotter@stockotter.ai`.

- **`server/institutional-warmup.ts`** — pre-flight circuit check skips
  the warmup entirely when the breaker is open. Mid-loop check aborts
  the iteration immediately when the breaker trips during a run, so a
  partially-lifted-then-retripped block can't burn through 250 tickers
  generating more pressure.

**Files touched:**
- `server/data/providers/edgar.client.ts`
- `server/institutional-warmup.ts`

---

## 2026-04-25 — Institutional page restored (Yahoo as cache-refresh agent)

**Symptoms:**
- Fund Holders tab showed "Fund holder breakdown not available"
- Insiders tab showed "Insider roster not available"
- Insider Ownership % showed 0.0%
- INCREASING / DECREASING / NEW / SOLD-OUT counts all showed 0
- Money Flow Score scored only insider activity (institutional flow had
  been silently zeroed out)

**Root cause:**
The previous AI's "Phase 3.7 — fully migrated off Yahoo" sweep ripped
out Yahoo data sources from `server/routes.ts` and replaced them with
hardcoded empty stubs:
```ts
const instOwnership: any[] = [];
const fundOwnership: any[] = [];
const majorBreakdown: any = {};
insiderHolders: { holders: [] }
```
The `// Phase 3.4b will populate` comments were placeholder IOUs that
never came back.

**Decision:**
Restore Yahoo as the source for these fields, but architecturally as a
**background cache-refresh agent** rather than a request-path dependency.
This matches the original "Yahoo as buffer, never on the request path"
rule. A nightly cron warms the cache before market open; live requests
read from the cache 23 hours / day.

**Implementation:**

- **`server/routes.ts`** — added `getYahooOwnership(ticker)` helper that
  fetches `fundOwnership`, `institutionOwnership`, `majorHoldersBreakdown`,
  and `insiderHolders` from Yahoo's quoteSummary endpoint in a single
  call. 23-hour cache TTL (slightly under the warmup cadence so the cron
  always refreshes before expiry). Wired into the institutional data
  pipeline alongside the EDGAR-sourced topInstitutions. Also added a
  name normalizer that joins EDGAR's legal-entity names ("BRITISH
  COLUMBIA INVESTMENT MANAGEMENT Corp") with Yahoo's trimmed names
  ("British Columbia Investment Management") so QoQ change deltas can
  be merged onto the EDGAR rows where Yahoo has them.

- **`server/yahoo-ownership-warmup.ts`** (new file) — mirrors the
  existing `institutional-warmup.ts` pattern. Walks ~250 always-warm
  symbols (mega-caps, sector ETFs, popular dividend names) plus every
  symbol that appears in any user's open trades. Serial execution with
  400ms delay between calls to stay well under Yahoo's per-IP rate limit.

- **`server/cron.ts`** — registered the new warmup at `30 8 * * *`
  (4:30am ET / 08:30 UTC). Sits between the existing long-range chart
  warmup at 3:30am ET and the EDGAR institutional warmup at 5am ET.
  30-min timeout, no overlap protection.

**Architectural rule preserved:**
Yahoo is still off the request path 99% of the time. The
`getYahooOwnership()` helper is a fallback for cache-miss tickers; the
warmup agent ensures cache hits for the symbols users actually look at.

**TODO (Phase 3.4b / N-PORT):** replace Yahoo dependency entirely with
SEC N-PORT filings (mutual fund / ETF holdings) plus 13F QoQ deltas
computed from EDGAR history. Multi-week project; deferred.

**Files touched:**
- `server/routes.ts`
- `server/cron.ts`
- `server/yahoo-ownership-warmup.ts` (new)

---

## Backlog — items identified but not yet addressed

Priority order based on user-impact, not difficulty:

1. **Frontend crash on Institutional page** — `TypeError: Cannot read
   properties of undefined (reading 'length')`. Hits when partial data
   is returned. Fix is defensive `?? []` guards in
   `client/src/pages/institutional.tsx` around lines 195, 212, 247, 282.
   ~4 lines of code.

2. **RSI / score consistency** — owner's "header grade doesn't match
   outlook grade" complaint. Scanner, verdict page, and gate logic each
   compute RSI on potentially different lookback windows / candle sources.
   Need to diff values across 20 tickers and reconcile. Files:
   `server/signal-engine.ts`, `server/scanner-v2.ts`,
   `server/signals/gates/`. This is the most strategically important
   item — the "verify the gurus" pitch dies if the same ticker shows
   different RSI on different pages.

3. **Stress comparison missing** — Long-term Outlook page no longer
   renders the historical stress event comparison.

4. **Gold/silver display** — PR #75 from the prior AI session
   ("Permanent metals fix: swap Yahoo GC=F/SI=F to FMP GCUSD/SIUSD")
   may not be fully working. Verify quotes and 25-year history actually
   render on the page.

5. **Explosion detector / Scanner v2 broken** — unspecified breakage in
   the scanner UI per owner. Investigate `server/scanner-v2.ts` and
   the `ExplosionCard` component.

6. **Admin cache visibility** — Admin panel shows "no cached
   information" even when caches exist. Likely a diagnostics endpoint
   wiring issue.

7. **SMTP credentials broken** — `[EMAIL] SMTP connection failed:
   Invalid login: 535 5.7.139` in logs. Probably needs a Microsoft 365
   App Password instead of the regular account password. Until fixed:
   no alert emails, no password resets, no Phase 4 notifications.

8. **`.env.bak*` cleanup** — multiple backup `.env` files lying around
   in `/opt/stock-analyzer/` from prior AI's edit-and-backup pattern.
   Delete the older ones; add `.env.bak*` to `.gitignore` so future
   backups don't accidentally get committed.

9. **Bot probes** — `URIError: Failed to decode param '%c0'` errors in
   logs from external scanners probing the site for vulnerabilities.
   Add Express error middleware to catch malformed URIs and return 400
   instead of letting them throw.

10. **Dead code** — `server/signals/gates/gate3-trend.ts` is an unused
    placeholder; the live gate logic is in `signal-engine.ts`. Remove
    or wire up.

11. **`package.json` local drift** — server has uncommitted local edits
    moving `tsx` from deps → devDeps. Currently in `git stash`. Either
    commit the change or discard the stash cleanly.

12. **FMP Personal → Commercial license** — owner is on FMP's Personal
    Use plan. Required to switch to Commercial Use before going wider
    with users (current setup is fine for pre-launch / small user base).

---

## Notes on the deploy workflow

- Repo: `ccutshaw66/stock-analyzer` on GitHub
- Server: self-hosted at `/opt/stock-analyzer/` on `imt-uv-helpdesk`
  (IP `68.171.198.222`)
- Process manager: pm2, app name `stock-analyzer`
- Auto-deploy: GitHub webhook fires on push to `main`, server pulls,
  pm2 auto-restarts
- Owner deploys via GitHub web UI (not git CLI). Two folders ⇒ two
  commits when changes span paths.

## Notes on data sources

- **Polygon Stocks Starter** ($29/mo) + **Polygon Options Starter** ($29/mo)
  — end-of-day data, sufficient for current pre-launch needs
- **FMP Premium** ($69/mo, Personal Use) — analyst data, insider Form 4,
  earnings, ratios, beta, gold/silver quotes
- **SEC EDGAR** — free, primary for 13F holdings; rate-limited per their
  fair-access policy (must include working contact email in User-Agent)
- **Yahoo Finance** — free unofficial API, used ONLY as background
  cache-refresh agent for fund holders, insider rosters, long-range
  charts (per architectural rule)

Total recurring data cost: ~$130/month. Stripe is wired in but not
actively monetizing yet.
