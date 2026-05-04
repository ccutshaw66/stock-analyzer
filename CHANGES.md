# Stock Otter — Changes Log

This file is the running history of meaningful changes to the project.
Newest entries on top. Each entry should describe **what** changed,
**why**, and which files were touched, so that any human or AI picking
up the project later has the context to keep moving.

For pre-2026-04-25 history, see `FEATURE_CHANGES.md` (focused log of the
Dividend Finder + Position Duration Analysis features that were added
during the prior Perplexity/Claude session).
---
## 2026-05-04 (dev branch) — Display fix: per-share entry prices show as positive

**Why:** Owner reported position numbers looked off on SoFi and ORCL.
Verified the *math* is correct (each lot's Open P/L computes correctly,
the aggregated sum matches), but the *display* was misleading: avg open
price showed as `-180.82` for an ORCL long position, individual lot
prices showed `-182.38` and `-173.03` in red. That's because `openPrice`
is stored signed (negative = debit / cash-out) for the internal profit
math, and the display was passing it through raw.

**Fix:**
- `client/src/pages/trade-tracker.tsx` — three render sites:
  - Aggregate row's "Avg Open Price" cell now shows `$X.XX` (positive,
    neutral color). The internal `avgOpenPrice` calc also uses
    `Math.abs(openPrice)` in the weighted sum so the average never goes
    negative even with mixed signed conventions across lots.
  - Individual lot row's open-price cell shows `$X.XX` instead of
    signed `-XX.XX` in red.
  - Closed-trade rows' open + close price cells both use `Math.abs` so
    long positions display positive entry prices.

The signed `openPrice` convention stays in the data layer — the profit
math (`computeStockPL`, `computeOptionPL`, `computeTradeProfit`) all
relies on it. Only the display changed.

---
## 2026-05-04 (dev branch) — Cost basis from openPrice × shares + allocation rule setting

**Why:** v2 used `trade.allocation` to compute cash debits, but allocation
is sparsely populated (often null/0 on existing trades). Owner clarified:
allocation is a USER REFERENCE for risk-reminder, not the actual cost
basis. Real cost basis is `openPrice × shares` (× 100 for options).

**Fix:**
- `server/routes.ts` — cash math now derives `openPositionCostBasis`
  from `openPrice × shares` (× 100 for options). Reliable regardless of
  whether the user filled in the allocation field. The `allocated` /
  `allocatedPct` fields stay as user-reference numbers (still used for
  the existing Allocated card and color thresholds), but no longer
  affect cash or account value math.
- `shared/schema.ts` — added `allocationRuleMode` ("dollar" | "percent")
  and `allocationRuleValue` (number) to `account_settings`. The user
  picks ONE rule: "no more than $X per position" OR "no more than X%
  of total portfolio per position." Future commit will surface a
  red/green dot on each trade based on whether its cost basis exceeds
  the rule.
- `client/src/pages/trade-tracker.tsx` — Settings drawer gets a new
  "Allocation Rule per Position" section with a Mode dropdown
  (Dollar / Percent) and a single value field that relabels based on mode.

Future: per-trade red/green indicator if the trade's cost basis
exceeds the allocation rule. Schema and settings UI are ready; just
need the per-trade UI wiring.

---
## 2026-05-03 (dev branch, v2) — Trade Tracker portfolio model: derived cash + correct Account Value

**Why the redesign:** First version (v1, see entry below) asked the user
to manually enter a "Brokerage Cash Balance" and showed both an "Account
Value" AND a "Total Portfolio" card. Owner correctly pointed out:
1. User shouldn't enter cash directly — Starting Account Value already
   IS your starting cash; opening positions should debit it automatically.
2. Two separate "Total Portfolio" and "Account Value" cards is confusing
   duplication — they should be the same number.
3. The math wasn't adding up because the existing Account Value formula
   didn't include unrealized P/L from open positions.

**New model (matches how a brokerage account actually works):**
- Starting Account Value = your initial cash deposit.
- Open positions DEBIT cash by their cost basis (allocation).
- Closed trades CREDIT cash with realized P/L.
- Deposits/withdrawals adjust cash directly.
- Cash Available = starting + realized P/L + transactions − allocated.
- Account Value = cash available + open position market value.
  (Equivalent to: starting + realized P/L + transactions + unrealized P/L.
  This is what should match Schwab.)

**Fix:**
- `shared/schema.ts` — removed the `cashBalance` column added in v1.
  No longer manually entered.
- `server/routes.ts` — account-summary route rewritten to compute
  `cashAvailable` and `accountValue` correctly (now includes unrealized
  P/L). Returns `cashAvailable`, `openPositionMarketValue`, `accountValue`.
  Removes `cashBalance` and `totalPortfolioValue` fields.
- `client/src/pages/trade-tracker.tsx` — Settings drawer no longer has
  the Brokerage Cash input (Starting Account Value relabeled to clarify
  it's the starting cash). Top row of cards is now: Account Value (one,
  prominent) | Cash Available | Open Positions. Bottom row drops the
  duplicate Account Value card; remaining: Total P/L | Open P/L | Win
  Rate | Open Trades | Allocated.

**Migration:** local Postgres has the old `cash_balance` column from
v1's db:push. After pulling, `npm run db:push` may prompt about
dropping the column. Drop it (or leave it; harmless). Production
isn't affected — v1 was rolled back from main before merging.

---
## 2026-05-03 (dev branch) — Brokerage cash balance + Total Portfolio card (v1, superseded)

**Why:** Owner wants the Trade Tracker portfolio figures to match what
he sees in Schwab. The existing "Account Value" is a derived equity-
curve number (`startingAccountValue + closed P/L + manual transactions`)
which doesn't include actual brokerage cash or live open-position market
value, so it always drifts from the broker's number.

**Status:** shipped to `dev` branch only. Not yet on production. Owner
tests locally, then merges dev → main when ready (which also requires
running `npm run db:push` on the prod server before the merge — schema
adds a column).

**Fix:**
- `shared/schema.ts` — added `cashBalance` field to `account_settings`
  (default 0, manually set by user).
- `server/routes.ts` (account summary route) — computes
  `openPositionMarketValue` from open trades (stocks: currentPrice ×
  shares; options: allocation as a proxy since we don't have live
  premiums) and returns three new fields: `cashBalance`,
  `openPositionMarketValue`, `totalPortfolioValue` (= cash + positions).
- `client/src/pages/trade-tracker.tsx` — Settings drawer gets a
  "Brokerage Cash Balance" input. Top of the page gets a new 3-card row
  showing Total Portfolio / Brokerage Cash / Open Positions side-by-side.
  Existing 6-card row stays intact underneath. Defensive `?? 0` on the
  three new fields so the page renders even if the response shape is
  partial (e.g. during a deploy where the server is updated but the DB
  migration hasn't run yet).

Note: this is the second attempt. First attempt pushed straight to main
without the dev-branch workflow and broke prod for ~10 min because the
schema change wasn't applied to the production database. Now lives on
dev only, with a manual ship gate.

---
## 2026-05-03 (late evening) — Cross-platform `httpServer.listen` (Windows fix)

**Issue:** After fixing the `dev` script earlier (cross-env), `npm run dev`
got further but then died with `Error: listen ENOTSUP: operation not
supported on socket 0.0.0.0:5000` on Node 24 / Windows.

**Root cause:** `server/index.ts` passed `reusePort: true` to
`httpServer.listen()`. `SO_REUSEPORT` is a Linux-only socket option
(kernel ≥ 3.9). Node 24 on Windows throws `ENOTSUP` when it sees the
option, instead of silently ignoring it the way older Node versions
sometimes did.

**Fix:** `server/index.ts` — gate `reusePort` on `process.platform === "linux"`.
Production (Ubuntu) keeps the option for clean pm2 reloads; Windows and
Mac dev environments just work. Also extracted `host` to a `HOST` env var
override (defaults to `0.0.0.0`), so a developer can lock the dev server
to `127.0.0.1` if they want LAN to not see it.

Commit: `<this commit>`. Rollback tag: `safe/2026-05-03-listen`.

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

## 2026-05-02 — Conviction Compass: new fused multi-stream indicator + forward-tracker

Brand-new indicator and page that fuses four orthogonal signal categories
into one readable conviction score: smart money flow (institutional QoQ +
insider Form 4), dealer positioning (gamma exposure + walls + put/call),
technical momentum (RSI, MACD, EMA stack, Bollinger %B), and fundamental
quality (existing 8-factor verdict score). Math penalizes divergence so
"all four agree" registers as much stronger than "three of four agree."
Visualized as a four-axis radar with a center confluence gauge and a
plain-language verdict pill (ALL_ALIGNED_BULLISH / DIVERGENT / etc.).

**Why this is novel:** popular 2026 indicator stacks (MACD+RSI+Bollinger)
combine *correlated* TA components — one signal category pretending to
be many. The Compass mixes independent streams; institutions can't
manipulate gamma exposure AND analyst consensus AND your moving averages
simultaneously, so agreement across them is a structurally stronger
signal. No retail tool currently offers all four streams in one place.

**Backtesting:** owner asked how to validate it. Built a forward
paper-trader rather than a backward backtest (3 of 4 axes are cheaply
reconstructable historically, but dealer positioning needs paid
historical options data). Snapshots the live compass for ~100 megacaps
every weekday at close, then fills in 1d/5d/30d/90d forward returns as
each window closes. After ~30 days there's real per-verdict performance
data; after 90 days the dataset is complete. Surfaced on the conviction
page as a per-verdict-class results table compared against a SPY baseline
over the same dates.

**Files added/touched:**
- `server/conviction/compass.ts` — pure compute function
- `server/conviction/pipeline.ts` — data orchestrator
- `server/conviction/tracker.ts` — daily snapshot + forward-returns updater
- `server/conviction/backtest.ts` — SQL aggregator
- `server/snapshot/index.ts` — added `getInstitutionalScanSnapshot` (slim)
- `server/cron.ts` — two new daily jobs (snapshot + forward-returns)
- `server/routes.ts` — `/api/conviction/:ticker` + `/api/diag/conviction/backtest`
- `shared/schema.ts` — `compass_snapshots` + `spy_baseline_returns` tables
- `client/src/pages/conviction.tsx` — radar + breakdown + backtest panel
- `client/src/App.tsx` + `client/src/components/AppLayout.tsx` — nav + route

Polish iterations addressed: 2-decimal rounding at the backend source,
axis-card layout overflow (GEX in billions was pushing rows off the
card; added compact K/M/B/T format + fixed-width cells), and dropping
QoQ from axis math when EDGAR is on Yahoo fallback (was diluting the
Smart Money Flow score with a suppressed-zero).

---

## 2026-05-01 — Architectural rebuild: unified snapshot pipeline + EDGAR resilience

All-day rebuild. Owner asked for "no patches." Replaced fragmented data
fetching with a unified pipeline that has provider fallbacks and full
provenance, then made the EDGAR layer resilient to Akamai rate limiting.

**Snapshot pipeline (additive, no existing route changed first):**
New `server/snapshot/` directory. `getCompanySnapshot(ticker)` returns
every data point the app needs in one normalized shape. Each field
wrapped in `FieldHealth<T>` recording which provider answered, what
fallbacks were attempted, latencies, errors. Provider chains:
quote/chart Polygon→FMP→Yahoo, institutional EDGAR→Yahoo, insider FMP,
analyst FMP, earnings FMP→Polygon, fundamentals Polygon→FMP, profile
FMP→Polygon→EDGAR. New diagnostic endpoints under `/api/diag/*` (auth-
exempt for monitoring).

**Phase 2 cutovers:** `/api/institutional/:ticker` and
`/api/institutional-scan` migrated through a `projectInstitutional`
legacy-shape projector — frontend unchanged. Page populates from Yahoo
when EDGAR is empty instead of rendering blank. Scanner reduced from
8-adapter snapshot to a slim 3-adapter version + 50 tickers + stale-
while-revalidate so it fits in nginx's 60s timeout.

**EDGAR data quality fixes (the deep ones):**
- `isSummaryCorrupt()` extended to three corruption patterns including
  megacap-with-zero-holders. Fixes AAPL/MSFT/PLTR persistent zero-cache.
- Stop caching empty results when CUSIP fetch transiently fails — single
  FMP outage was poisoning the cache for 3 days.
- Replaced silent `.catch(() => {})` swallows on background warms with
  proper error logging — failures are now visible in `pm2 logs`.
- `forceCloseEdgarCircuit()` + `/api/diag/edgar/health` and `/reset`
  endpoints. Manual circuit recovery without a process restart.
- EFTS pagination: per-page retry + skip-on-failure + bail-on-5-consecutive-
  failures. Old code broke out on first page error, leaving us with ~136
  of ~5000 filers and no megacap holders.
- `KNOWN_MAJOR_FILER_CIKS` — hard-anchored list of 19 verified megacap
  filers (Vanguard, BlackRock, State Street, FMR, etc.) fetched directly
  from SEC submissions API regardless of EFTS health. Guarantees
  megacap coverage even when EFTS misbehaves.
- Refuse to cache suspiciously-empty summaries (<200 filers processed
  AND zero holders = partial-pagination failure, don't persist as truth).
- Disk cache for `company_tickers.json` (7-day TTL) — the entry-point
  lookup was getting 429-blocked on every restart. Now persists across
  deploys.
- FMP CIK fallback in `tickerToCik()` — pipeline keeps working through
  Akamai outages by sourcing CIK from FMP `/profile`.

**The 429-burst root cause and fix:** EDGAR's throttle had a concurrency
race. N concurrent callers all read the same `lastRequestAt`, all slept
the same duration, all woke up together and fired N requests in one
burst. The throttle delayed bursts; it didn't prevent them. Replaced with
a Promise chain that serializes — only one slot updates `lastRequestAt`
at a time. True 4 req/sec regardless of concurrency. Killed the 429 storm.

**Yahoo QoQ artifact handling:** Verified via direct EDGAR query that
JPMorgan files 13Fs under multiple subsidiary CIKs (`19617` JPM Chase,
`919185` JPM Investment Mgmt). When one subsidiary skips a quarter,
Yahoo's name-matching shows fake -52% drops — observed identical -52%
across AAPL/PLTR/MSFT, impossible as a real investment decision. We
suppress flow score when EDGAR isn't authoritative (Yahoo fallback) so
we don't publish fake STRONG OUTFLOW signals. An initial attempt also
silently filtered -50%+ drops on $1B+ positions; owner correctly
flagged that as data manipulation and we reverted it. Honest disclosure
of uncertainty stays; silent filtering doesn't.

**On-demand refresh UX:** `?refresh=1` on `/api/institutional/:ticker`
clears EDGAR disk + in-process caches and bypasses the snapshot
orchestrator cache. Refresh button added to the institutional detail
modal. (Initial version had a 60s countdown which was wrong UX since the
endpoint returns in 1-2s — removed.)

**Files touched (cumulative across the day):**
- `server/snapshot/` — 13 new files (orchestrator + 8 adapter modules +
  fallback helper + types + projector + insider-codes)
- `server/data/providers/edgar.client.ts`
- `server/data/providers/edgar.adapter.ts`
- `server/institutional-cache.ts`
- `server/routes.ts`
- `client/src/pages/institutional.tsx`

Many rollback tags created across the day — most recent `safe/2026-05-01-1745`.

---

## 2026-04-30 — Unified analysis pipeline + metals fix + institutional UI guards

Extracted `computeAnalysisCore()` so `/api/analyze` and `/api/verdict`
share one scoring path (verdict had been hardcoding `threeYear`/`fiveYear`
to null, producing a ~0.15 score gap that flipped borderline tickers).
Replaced inline Wilder's RSI in scanner oscillator endpoint with the
canonical `computeRSISeries`. Fixed metals fmpGet calls (gold/silver
quotes had malformed URLs with double `?` separators). Added defensive
`?? []` guards in the institutional page to stop the TypeError crash on
partial payloads. Reframed Yahoo as buffer/cache-refresh agent in docs
(not deprecated; replacement is SEC N-PORT in Phase 7).

Commit: `cc0c8ac`.

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
