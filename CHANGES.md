# Stock Otter — Changes Log

This file is the running history of meaningful changes to the project.
Newest entries on top. Each entry should describe **what** changed,
**why**, and which files were touched, so that any human or AI picking
up the project later has the context to keep moving.

For pre-2026-04-25 history, see `FEATURE_CHANGES.md` (focused log of the
Dividend Finder + Position Duration Analysis features that were added
during the prior Perplexity/Claude session).
---
## 2026-05-07 — Trade Tracker: brokerage cash balance + Total Portfolio card

**Why:** The original cash-balance feature was reverted from main on 2026-05-03 after it broke prod (schema migration not run before deploy). Working code lived on dev but never made it back to main. Chris approved a rewrite + improvement.

**What:**
- **`shared/schema.ts`** — added `cashBalance` column to `account_settings` (`double_precision` default 0).
- **`server/storage.ts`** — `getAccountSettings` now has a try/catch fallback. If Drizzle's typed `select()` errors with "column does not exist" (i.e., `db:push` hasn't run on this env yet for a new column), the function retries with raw `SELECT * FROM account_settings WHERE user_id = ...` and injects defaults for any missing properties. **This means deploys never 500 on a migration-lag race** — the page degrades gracefully (cashBalance shows 0) until the migration runs. Improvement over the original implementation.
- **`server/routes.ts` `/api/trades/summary`** — computes `openPositionMarketValue` from open trades (stocks: currentPrice × shares; options: allocation as proxy until we have live option premiums) and returns `cashBalance`, `openPositionMarketValue`, `totalPortfolioValue` alongside the existing fields.
- **`client/src/pages/trade-tracker.tsx`** — Settings drawer gets a "Brokerage Cash Balance ($) — set this to match your broker" input. Top of page gets a 3-card row above the existing 6-card row: Total Portfolio | Brokerage Cash | Open Positions. Defensive `?? 0` on the new fields.

**Files:** `shared/schema.ts`, `server/storage.ts`, `server/routes.ts`, `client/src/pages/trade-tracker.tsx`.

**Operator action:** run `npm run db:push` on the production server to add the new column. Thanks to the storage.ts resilience layer, the order doesn't matter — code can deploy first, migration can run second, no 500s either way. Until the migration runs, the cash balance input persists no value (writes silently no-op on the missing column) and the cards show $0.

Rollback tag: `safe/2026-05-07-cash-balance`.

---
## 2026-05-07 — Market Pulse page (rebuilt from scratch, FMP-only)

**Why:** The original Market Pulse work shipped to the `dev` branch but never merged to `main`, so the page disappeared from production after the branches diverged. Chris green-lit a clean rewrite + repositioning under Trade Tracker (above Current Positions) + moving the Gold/Silver and major-market cards off the Verdict page onto Market Pulse.

**What:**

- **`server/data/providers/market-pulse.adapter.ts`** (new) — FMP-only fetchers for Volatility (VIX, VIX9D, VIX3M, 20-day percentile, term ratio), Breadth (S&P 500 % above 50/200d MA + new H/L counts via `/stable/sp500-constituent` + `/stable/historical-price-eod/full`), Risk Appetite (HYG/LQD + SPY/TLT ratios with 5-day direction), Index Cards (SPY/QQQ/IWM/DIA), Safe Haven (Gold/Silver/Ratio with regime tag). `computeRegime()` produces a 0-100 score and 5-tier label (RISK-OFF / DEFENSIVE / NEUTRAL / RISK-ON / EUPHORIC) with a dynamic explainer.
- **`server/market-pulse-cache.ts`** (new) — disk cache (`data/market-pulse-cache/intraday.json` + `breadth.json`).
- **`server/market-pulse-warmup.ts`** (new) — two warmup handlers.
- **`server/cron.ts`** — registered two crons: intraday `*/5 * * * *` (live during market hours, hourly off-hours; runOnStart) and breadth `35 13 * * 1-5` (weekday 9:35am ET; runOnStart).
- **`server/routes.ts`** — `GET /api/market-pulse` serves cron-warmed cache (no live FMP calls on request path; <50ms response).
- **`client/src/pages/market-pulse.tsx`** (new) — single-screen page: headline tier card, three-up Volatility/Breadth/Risk-Appetite grid, four-up Major Indices grid, three-up Safe Haven (Gold/Silver/Ratio).
- **`client/src/App.tsx`** — `/market-pulse` route + root `/` now points to MarketPulse (was TradeTracker).
- **`client/src/components/AppLayout.tsx`** — nav entry inserted at top of Trade Tracker group, ABOVE Current Positions.
- **`client/src/pages/verdict.tsx`** — removed Section 4 "Safe Haven & Benchmark Comparison" (Gold/Silver/Ratio + SPY/QQQ cards) since those now live on Market Pulse. Stress Test table (per-ticker comparison vs S&P 500/Nasdaq 100/Gold/Silver during crises) stays — different feature.
- **`server/routes.ts` `/api/verdict`** — dropped the `fmpSpotQuote` calls and `metals` payload assembly (now provided by `/api/market-pulse`). Verdict cache key bumped v10→v11.

**Files (8):** `server/data/providers/market-pulse.adapter.ts`, `server/market-pulse-cache.ts`, `server/market-pulse-warmup.ts`, `server/cron.ts`, `server/routes.ts`, `client/src/pages/market-pulse.tsx`, `client/src/App.tsx`, `client/src/components/AppLayout.tsx`, `client/src/pages/verdict.tsx`.

Rollback tag: `safe/2026-05-07-market-pulse`.

---
## 2026-05-06 — Snapshot pipeline flow score: derive prior quarter from FMP's usedQuarter

**Why:** After fixing `latestAvailableQuarters`, MSFT's institutional flow factor showed -100 STRONG OUTFLOW in the score diag — wrong (drags MSFT to SPECULATIVE 5.6 instead of INVESTMENT GRADE 6.3). Root cause: snapshot pipeline's `priorQuarter()` returned Q4 2025 by walking the calendar back two quarters from Q2 2026 (the in-progress quarter). My quarter-fix made `getFmpInstitutional` ALSO return Q4 2025 (the most recent fully-aggregated). Result: comparing Q4 2025 to Q4 2025 — same data, just normalization-mismatch noise that nets negative.

**What:**
- `fmp-institutional.ts`: `FmpInstitutionalSummary` now exposes `usedQuarter` so consumers can derive the actual prior. Cache key v10→v11.
- `snapshot/institutional.ts`: replaced `priorQuarter()` with `quarterBefore(fmp.usedQuarter)`. Now a real QoQ: Q3 2025 baseline vs Q4 2025 current (or whichever pair `getFmpInstitutional` actually used).

**Files:** `server/data/providers/fmp-institutional.ts`, `server/snapshot/institutional.ts`.

Rollback tag: `safe/2026-05-06-snapshot-priorq`.

---
## 2026-05-06 — Root cause: latestAvailableQuarters picks in-progress quarter

**Why:** Three failed deploys at fixing Inst%/Insider% on the institutional page. Root cause finally found: `latestAvailableQuarters()` in `fmp-institutional.ts` was picking the quarter that *contains* a date 60 days ago, not the most recent quarter whose END was 60 days ago. For 2026-05-06, "60 days ago" = 2026-03-07, which is in Q1 2026 — a quarter that ENDED 36 days ago (filings due May 15, NOT yet aggregated). FMP's response for an in-progress quarter has `numberOf13Fshares: 0` even when `ownershipPercent` returns a value, so my computation kept falling through to the broken `ownershipPercent` field.

**What:**
- `fmp-institutional.ts` `latestAvailableQuarters`: rewritten to walk backward from current calendar quarter, only including quarters whose END date is >= 60 days ago. Cap at 12 iterations to prevent infinite loop in any date-math edge case.
- Same walk-backward logic added to the `/api/diag/fmp-inst/:ticker` route so it always queries a sane quarter.
- Diag endpoint also now returns `insiderSample` (3 rows) so we can see the insider-trading response shape in one URL.
- Cache keys: `fmp-inst:v9 → v10`, `inst:v3 → v4`.
- New `docs/FMP_REFERENCE.md` — living reference of every FMP endpoint + field name we use, with verified field schemas, plus a "common pitfalls" section listing the ones we've hit (TTM rename, ownershipPercent unreliability, the `acquistionOrDisposition` typo, multi-CIK matching, this quarter-selection bug).

**Files:** `server/data/providers/fmp-institutional.ts`, `server/routes.ts`, `docs/FMP_REFERENCE.md`.

Rollback tag: `safe/2026-05-06-quarter-bug`.

---
## 2026-05-06 — FMP-side insiderPct + Inst% field-name variants

**Why:** Yahoo kill switch (FMP_TIER=ultimate) makes `getYahooOwnership` short-circuit to all-nulls, so re-enabling that path was a no-op. Per the kill-Yahoo directive, computing insiderPct from FMP transaction data instead. Inst% still landing on the broken `ownershipPercent` because `numberOf13Fshares` may not be the field name FMP returns — adding variants and a debug log so we can see what's actually in the response.

**What:**
- `getInstitutionalData`: insider transaction fetch limit 50→500. For each unique insider (CIK or name), pick the row with the latest filing/transaction date and read `securitiesOwned`. Sum across insiders → `fmpInsiderTotalShares`. Also derive `fmpSharesOutstanding = marketCap / price` from the quote and stash both on the result. Inst cache key v2→v3.
- `parseInstitutionalData`: `insiderPct` now computed as `fmpInsiderTotalShares / fmpSharesOutstanding * 100`. Yahoo kept as last-ditch (always 0 under Ultimate but harmless).
- `fmp-institutional.ts`: try multiple field-name variants for the institutional share count (`numberOf13Fshares`, `numberOf13fShares`, `totalShares`, `total13fShares`, `shares`). Log a warn with the actual key list when none match so we can see what FMP returns. Cache v8→v9.

**Files:** `server/routes.ts`, `server/data/providers/fmp-institutional.ts`.

Rollback tag: `safe/2026-05-06-fmp-insider-pct`.

---
## 2026-05-06 — Institutional Inst% fix v3: derive sharesOutstanding from marketCap/price

**Why:** Diag of FMP `/profile` for MSFT shows no `sharesOutstanding` field — only `marketCap` and `price`. My v7 fix that read `profileRow.sharesOutstanding` was returning null, falling back to the broken `ownershipPercent`.

**What:** `fmp-institutional.ts` derives `sharesOutstanding = marketCap / price` from the `/profile` response. For MSFT: `3075072882800 / 413.96 ≈ 7.43B` shares — correct. Cache v7→v8.

**Files:** `server/data/providers/fmp-institutional.ts`.

Rollback tag: `safe/2026-05-06-inst-pct-fix3`.

---
## 2026-05-06 — Institutional page Inst%/Insider% follow-up: bump caches + use /profile sharesOutstanding

**Why:** Prior pass updated the in/out flow stats (worked) but Inst% and Insider% still showed old values. Two issues: (1) the route-level `inst:${ticker}` cache was unbumped so the page got the pre-fix Yahoo-stub response shape; (2) my Inst% formula used `numberOf13FsharesOutstanding` which doesn't exist on FMP's summary endpoint, so the calc fell back to the broken `ownershipPercent` field.

**What:**
- `server/routes.ts` `getInstitutionalData`: cache key `inst:` → `inst:v2:` so the response shape with real Yahoo `majorHoldersBreakdown` flushes through. Insider% should now populate.
- `server/data/providers/fmp-institutional.ts`: institutional ownership % now computed as `numberOf13Fshares / sharesOutstanding * 100`, where `sharesOutstanding` comes from a parallel FMP `/profile` call. Cache key v6→v7.

**Files:** `server/routes.ts`, `server/data/providers/fmp-institutional.ts`.

Rollback tag: `safe/2026-05-06-inst-pct-fix2`.

---
## 2026-05-06 — Institutional page: real Inst%, real Insider%, real flow score

**Why:** Page (and scan) showed Insider% = 0% across all tickers, Inst% suspiciously low and identical across megacaps (MSFT 4.8% / AMZN 4.8%), 0-in/0-out counts everywhere, and STRONG OUTFLOW -100 score driven entirely by net insider selling because the institutional flow signal was zero.

**What:**
- `fmp-institutional.ts`: institutionPct now computed from `numberOf13Fshares / numberOf13FsharesOutstanding * 100` instead of trusting FMP's `ownershipPercent` field (which appears unreliable). FMP's field kept as last-ditch fallback. Cache key v5→v6.
- `routes.ts` `getInstitutionalData`: dropped the Yahoo-stub block; now calls `getYahooOwnership()` so `majorHoldersBreakdown.insidersPercentHeld` populates `insiderPct`. Yahoo cron pre-warms this nightly so request-path almost always hits cache.
- `routes.ts` `parseInstitutionalData`: institutional flow stats (inflow/outflow/increased/decreased/new/soldOut) now built from FMP `topHolders[].changeQoQ` when the FMP source is active; legacy Yahoo `instOwnership` loop kept as fallback. Unblocks the flow score so `combinedScore` isn't always insider-only.
- New `/api/diag/fmp-inst/:ticker` route — dumps raw FMP `symbol-positions-summary` + a 5-row holder sample for diagnosing field-name drift.

**Files:** `server/data/providers/fmp-institutional.ts`, `server/routes.ts`.

Rollback tag: `safe/2026-05-06-inst-pct-flow-fix`.

---
## 2026-05-06 — Institutional page: tiered size threshold + movers-first sort

**Why:** The OR filter (size or QoQ change) worked well on mid- and small-caps but barely shortened MSFT's list because megacaps have hundreds of $100M+ institutional positions just by virtue of being multi-trillion-dollar stocks. Chris also wanted movers surfaced first instead of buried below the size-sorted list.

**What:**
- `MIN_DISPLAY_VALUE` is now tiered by market cap so the cutoff scales with what "significant" means for a given stock:
  - Market cap >= $500B (megacap, e.g. MSFT/AAPL/NVDA/GOOG) → $500M cutoff
  - Market cap >= $100B (large cap) → $250M cutoff
  - Otherwise (mid/small) → $100M cutoff
- Sort flipped from share-count desc to `|changeQoQ|` desc, with `value` desc as the tiebreaker. Movers (positive or negative) bubble to the top; static-but-large holders sit below.

**Files:** `server/routes.ts` (parseInstitutionalData).

Rollback tag: `safe/2026-05-06-inst-sort-tier`.

---
## 2026-05-06 — Institutional page filter: OR-style ($100M size OR meaningful QoQ)

**Why:** Chris's first $100M cutoff hid bottom feeders successfully but also hid smaller filers who were *actively* trading the stock — those are signal, not noise. He wanted the list to surface holders that matter on either dimension: significant by size, or significant by activity. "Just trying to make the list shorter and more significant than 100 institutions where 70 of the 100 have 0 changes."

**What:** Filter in `parseInstitutionalData` flipped from AND-implicit (size only) to explicit OR:
```
value >= $100M  OR  |changeQoQ| >= 0.05%
```
The 0.05% threshold matches the page's one-decimal display: anything that would render as "0.0%" gets dropped unless it qualifies on size. Anything that would render as "+0.1%" or louder makes the cut.

**Files:** `server/routes.ts` (parseInstitutionalData).

**Notes:**
- A genuinely brand-new holder (no prior quarter baseline) currently has `changeQoQ = 0` per `qoqPct` in `fmp-institutional.ts` (we report 0 for unknown baselines rather than +∞). Such a new position with `value < $100M` would be filtered out — flagged as a possible follow-up if Chris wants new entrants surfaced as a class.
- The snapshot/scoring pipeline (`server/snapshot/institutional.ts`) is untouched: flow score, accumulation/distribution counts, etc. operate on the full unfiltered list as before.

Rollback tag: `safe/2026-05-06-inst-or-filter`.

---
## 2026-05-06 — Institutional page: $100M cutoff + CIK-keyed QoQ + deeper prior-quarter baseline

**Why:** First QoQ pass shipped real numbers for the top ~16 holders but exposed two artifacts on MSFT: (1) most rows below #16 showed `0.0%` because the prior-quarter fetch was capped at 100 rows — a current top-100 holder who ranked #101+ last quarter had no baseline; (2) duplicate-name filers (UBS GROUP AG ×3, HSBC HOLDINGS PLC ×2) showed wildly negative changeQoQ (-93%, -94%) because `priorByName` summed all UBS/HSBC subsidiaries into one bucket, then each individual current row was diff'd against that aggregate. Chris also called for a display cutoff: hide bottom-feeder filers entirely.

**What:**
- `server/data/providers/fmp-institutional.ts`:
  - Prior-quarter QoQ now keys primarily on `cik` (`priorByCik`), falling back to normalized name (`priorByName`) only when CIK is missing on either side. CIK is unique per legal-entity filer, so the UBS-subsidiaries-collapsing bug is fixed.
  - Prior-quarter `limit` bumped from 100 → 1000 so a current top-100 holder who ranked #101+ last quarter still has a baseline. Cost: one larger FMP response, still 24h-cached.
  - Cache key bumped `fmp-inst:v4` → `v5`.
- `server/routes.ts` `parseInstitutionalData`: applies a `MIN_DISPLAY_VALUE = $100M` filter to both `topInstitutions` and `topFunds` before returning. The snapshot/scoring pipeline (`server/snapshot/institutional.ts`) is intentionally untouched — flow scoring still operates on the full holder list. This is a display cut, not a scoring cut.

**Files:** `server/data/providers/fmp-institutional.ts`, `server/routes.ts`.

**Notes:** For megacaps (MSFT, AAPL) the page now shows ~25-40 holders instead of 100. For smaller stocks, fewer or even zero holders may surface — that's accurate (those companies genuinely don't have many $100M+ institutional positions). If a stock surfaces zero holders post-filter and Chris wants the threshold tunable per ticker class, that's a follow-up.

Rollback tag: `safe/2026-05-06-inst-100m-cut`.

---
## 2026-05-06 — Institutional page QoQ %: real numbers instead of all-zeros

**Why:** Top Institutions and Top Funds tables on the Institutional page both showed `0.0%` in the "QoQ Change" column for every row. Root cause: `parseInstitutionalData` (`server/routes.ts`) merged QoQ deltas from Yahoo's `institutionOwnership.pctChange`, but under `FMP_TIER=ultimate` Yahoo is killed in `getInstitutionalData`, so the merge map was always empty and every row fell back to 0. The FMP-Ultimate path (`getFmpInstitutional`) did not compute QoQ at all — `topHolders` had no `changeQoQ` field and `topFunds` hardcoded it to `0` with a comment explicitly flagging the gap.

**What:**
- `server/data/providers/fmp-institutional.ts`: added `changeQoQ: number` to the `topHolders` interface. After fetching the current quarter's holders, the function now also fetches the prior quarter from `/institutional-ownership/extract-analytics/holder` and builds a normalized name → prevShares map. For each top holder and each top fund, computes `(current - prev) / prev * 100`. Returns 0 for new positions (unknown baseline) rather than `+∞`. Cache key bumped `fmp-inst:v3` → `v4` so stale pre-fix entries don't serve `undefined` for the new field. One extra FMP call per ticker on cache miss (cheap on Ultimate's 3000 req/min budget); existing 24h cache absorbs it.
- `server/routes.ts` `parseInstitutionalData`: top-holders mapping now reads `h.changeQoQ` directly from the FMP response (with a fallback to the legacy Yahoo merge for the EDGAR-only emergency path, which under Ultimate is empty anyway). Funds path was already reading `f.changeQoQ` so it just starts working as soon as FMP populates the field.
- `server/snapshot/institutional.ts`: the FMP-path top-funds mapping previously hardcoded `changeQoQ: 0` ("fund-tab QoQ is a follow-up"); now reads `f.changeQoQ` from the unified FMP source. The institutions-side prior-quarter diff in this file (lines 117-155) is now redundant with the FMP-side computation but still correct — leaving for a separate cleanup pass.

**Files:** `server/data/providers/fmp-institutional.ts`, `server/routes.ts`, `server/snapshot/institutional.ts`.

Rollback tag: `safe/2026-05-06-inst-qoq`.

---
## 2026-05-06 — FMP YoY revenueGrowth + earningsGrowth (regression fix from FMP-primary cutover)

**Why:** Verifying the FMP-primary cutover on PLTR diag, every field was correctly sourced from FMP, BUT Business Quality reasoning showed `"Rev growth N/A"` where Polygon used to give 56.2%. FMP `/ratios-ttm` doesn't expose `revenueGrowth` or `earningsGrowth` because those metrics need YoY comparison of two periods. The existing `fundamentalsFromFmp` even commented this out: `// would need YoY comparison of two periods`.

Score impact: ~-0.20 on Business Quality category for any ticker with strong revenue growth (PLTR went 9 → 7).

**What:** `/income-statement` call bumped from `limit: 1` to `limit: 2` so we have current + prior periods. `fundamentalsFromFmp` now diffs `revenue` and `netIncome` between the two and computes YoY growth as a percent. Falls back to null if either period is missing or prior is zero.

**Files:** `server/snapshot/fundamentals.ts`.

**Also bumped** the verdict route cache key from `v9` to `v10` so cached pre-cutover verdict results clear immediately instead of cycling out over the next hour.

Rollback tag: `safe/2026-05-06-pre-yoy-growth`.

---
## 2026-05-06 — Phase 2.5 (cont): cut /api/verdict over to scoreSnapshot()

**Why:** Trade Analysis (`/api/analyze`) was cut over earlier. The "header grade doesn't match outlook grade" complaint can't go away until `/api/verdict` reads from the same scoring function. This commit closes that loop.

**What:**
- The analysis IIFE inside `/api/verdict` now wraps `getCompanySnapshot` + `scoreSnapshot` instead of `computeScoring`. Returns the same shape the verdict page consumes (`score`, `verdict`, `ruling`, `scoring`).
- Same legacy-`financials` D/E + ROE patch as `/api/analyze` so the verdict page's display fields populate.
- `unifiedScore` and `finalVerdict` (which drive the verdict page's headline) are now derived from `analysis.score * 10` and `analysis.verdict` — both come from `scoreSnapshot`. The verdict bucketing thresholds (STRONG / INVESTMENT / SPEC / HIGH RISK) move to the scoreSnapshot's identical thresholds, so the verdict on `/api/verdict` matches the verdict on `/api/analyze` and matches the score breakdown.
- The `factors` array on the verdict page is now display-only — it shows the verdict-page-specific factors (Fundamental Analysis, Institutional Flow, Stress Resilience, Insider Confidence) as a breakdown for the user, but those weights no longer drive the score. The score comes from the snapshot. This means the displayed factor breakdown and the displayed unified score are computed from different things — flagged as a follow-up to either drop the legacy factors or rebuild them to mirror snapshot categories.
- Fallback to legacy formula when `getCompanySnapshot` fails — same safety net as `/api/analyze`.

**Files:** `server/routes.ts` (the `/api/verdict/:ticker` handler).

**Notes:**
- The 1-hour route-level cache key is `verdict:v9:<ticker>`. Bumping that key would force a fresh compute, but I'm leaving it — natural turnover within an hour will cycle in the new score, and the snapshot path is the source of truth even if some users see a 1h-stale legacy result transitionally.
- The verdict page also still renders stress tests and metals comparison — those are display-only and unaffected.

Rollback tag: `safe/2026-05-06-pre-verdict-cutover`.

---
## 2026-05-06 — FMP-primary across snapshot quote/fundamentals/chart + legacy getChart

**Why:** Owner's stated goal: "tired of fighting data providers." With `FMP_TIER=ultimate` and the field-name fix in the previous commit, FMP can now answer authoritatively for everything Polygon Stocks Starter currently provides. This commit flips the chain order from "Polygon primary, FMP fallback" to "FMP primary, Polygon fallback" across every stock-data adapter. Polygon is kept as a safety net but should now be the source of last resort, not the default.

This is the prerequisite for canceling the **Polygon Stocks Starter sub** (~$29/mo). Polygon Options Starter is untouched — that drop requires building `fmp-options.ts` and dual-sourcing for parity, separate work.

**What:**

1. **`server/snapshot/quote.ts`** — new `fmpQuoteFull()` that calls `/quote` + `/profile` + `/ratios-ttm` in parallel and merges into one `CompanyQuote`. Covers price, marketCap, trailingPE, beta, dividendYield, EPS, 52w range. Forward PE not exposed on FMP basic stable endpoints — left null. Chain reordered: FMP → Polygon → Yahoo. Latency cost: 3 FMP calls (~600ms) vs Polygon's single call (~250ms). Acceptable.

2. **`server/snapshot/fundamentals.ts`** — chain reordered to FMP → Polygon. The FMP fallback was repaired in the previous commit (correct stable-API field names) so it actually works now.

3. **`server/snapshot/chart.ts`** — chain reordered to FMP → Polygon → Yahoo for the snapshot pipeline. Snapshot consumers (Conviction Compass, etc.) now get FMP first.

4. **`server/routes.ts` legacy `getChart`** — used by `/api/analyze`, `/api/trade-analysis`, watchlist refresh, scanner-v2 indicators, etc. New `fmpChartShortRange()` helper converts FMP `/historical-price-eod/full` to Yahoo-shape. Short/mid range: FMP → Polygon. Long range (10y/25y): disk cache → FMP → Polygon → stale disk cache (FMP inserted between disk cache and Polygon — FMP can do ~20y vs Polygon's ~5y).

**Notes:**
- Polygon stays in code as a fallback; if anything breaks, it'll quietly take over rather than fail.
- The dropping of `Polygon Stocks Starter` sub is now safe **once verification passes** — no code path requires it as primary. Recommend leaving the sub active for ~1 week to confirm FMP carries the load on real production traffic before canceling.
- Forward P/E will become null for most tickers after this. The `Valuation Sanity` scoring already tolerates null on this field; impact is small.

Rollback tag: `safe/2026-05-06-pre-fmp-primary`.

---
## 2026-05-06 — Fix actual FMP field names + repair fundamentalsFromFmp wholesale

**Why:** Hit `/api/diag/fmp/PLTR` and inspected the raw FMP response. The actual stable-API field for D/E is **`debtToEquityRatioTTM`** — note the "To" with capital T plus the "Ratio" middle. None of the variants my prior fallback tried matched (I had `debtEquityRatioTTM`, `debtEquityRatio`, `debtToEquityTTM`, `debtToEquity` — all subtly wrong).

Bigger discovery: **the existing `fundamentalsFromFmp` function (the FMP fallback that fires when Polygon entirely fails) has been broken since the FMP migration to the stable API in August 2025.** Every field name it reads — `grossProfitMargin`, `operatingProfitMargin`, `netProfitMargin`, `payoutRatio`, `debtEquityRatio`, `currentRatio`, `returnOnEquity` — is the v3-style legacy name. The stable API returns all of these with TTM suffixes (`grossProfitMarginTTM`, `dividendPayoutRatioTTM`, `debtToEquityRatioTTM`, `currentRatioTTM`, `returnOnEquityTTM`). The function was producing all-nulls for any ticker that hit the FMP fallback — the only reason this hadn't surfaced sooner is that Polygon's `quoteSummary.financialData` succeeds for 95%+ of tickers.

**What:**
- `fundamentalsFromFmp` rewritten to try TTM-suffixed names first, falling back to legacy v3 names. Uses a `pick()` helper to coalesce across variants. Affects every field the function returns.
- Per-field FMP enrichment in `getFundamentalsSnapshot` updated to include `debtToEquityRatioTTM` as the first variant tried. ROE coverage was already correct.

**Files:** `server/snapshot/fundamentals.ts`.

**Expected impact:** PLTR's D/E will now show **~2.5%** (PLTR has very low debt — `totalDebt $229M / equity $7.4B`). Balance Sheet Quality category will score ~8 (D/E < 30 → +2, current ratio > 2 → +1). KO and F should also populate properly.

Rollback tag: `safe/2026-05-06-pre-fmp-stable-fields`.

---
## 2026-05-06 — Fundamentals FMP fallback: try multiple FMP field-name variants

**Why:** Owner reports D/E still N/A on PLTR after the previous fallback shipped. Diagnosis: FMP's stable API returns ratio fields with a `TTM` suffix on the `/ratios-ttm` endpoint (e.g. `debtEquityRatioTTM`), not the v3-style `debtEquityRatio` the existing `fundamentalsFromFmp` was reading. The fallback was firing but reading `r.debtEquityRatio` which doesn't exist on the stable response, so it always got null. Confirmed by owner that MSFT (which Polygon returns D/E for) shows correctly — so the issue was specifically that the FMP fallback never produced a value.

**What:** Updated the fundamentals enrichment to try multiple FMP field-name variants and merge across `/ratios-ttm` + `/key-metrics-ttm`:

```
debtEquityRatioTTM | debtEquityRatio | debtToEquityTTM | debtToEquity
returnOnEquityTTM  | returnOnEquity  | roeTTM          | roe
```

Whichever resolves to a non-null number wins. Removed the percent/fraction heuristic — FMP's stable API consistently returns fractions (0.777 = 77.7%) so multiplying by 100 unconditionally matches the existing `fundamentalsFromFmp` convention.

**Files:** `server/snapshot/fundamentals.ts`.

**Expected impact:** Trade Analysis on PLTR / KO / F should now show a real "Debt / Equity" value and the corresponding scoring category will reflect it. MSFT was already working via the Polygon path so no change there.

Rollback tag: `safe/2026-05-06-pre-fmp-field-variants`.

---
## 2026-05-06 — Wire snapshot D/E + ROE into legacy `financials` so page display picks them up

**Why:** Previous commit (`3853791`) added the FMP fallback for D/E and ROE in the snapshot's fundamentals adapter. The new score correctly used the FMP value. But the Trade Analysis page's "Debt/Equity" display field, plus the red-flag generator, decision-shortcut generator, and bull/bear copy generator, all still pull from `financials.debtToEquity` — a different code path sourced from `extractQuoteData(summary)` → Polygon directly. The page showed "Debt/Equity: N/A" on PLTR even though the snapshot path had the value.

Two code paths, only one got patched.

**What:** Inside the `/api/analyze` Phase 2.5 cutover block, after `getCompanySnapshot` returns, copy `snap.fundamentals.value.debtToEquity` and `.returnOnEquity` into the legacy `financials` object IF the legacy fields are null. The legacy mutators (red flags, decision shortcut, bull/bear) all read from the same `financials` reference, so a single mutation flows everywhere.

**Files:** `server/routes.ts` (the Phase 2.5 cutover block in `/api/analyze`).

**Notes:**
- This is a transitional shim. The proper long-term fix is to make the page's display fields read from the snapshot too, which would happen naturally as more of `/api/analyze` migrates to snapshot-sourced. Today's commit keeps the surface area small.
- After deploy, hard-refresh the trade-analysis page to bypass the React Query cache and confirm "Debt / Equity" shows a real number on PLTR/KO.

Rollback tag: `safe/2026-05-06-pre-de-display-patch`.

---
## 2026-05-06 — Fundamentals: FMP fallback for debtToEquity + returnOnEquity

**Why:** Owner caught D/E showing N/A on PLTR (and KO has the same problem). The fundamentals adapter pulls from Polygon primary, but Polygon's `quoteSummary.financialData.debtToEquity` is patchily null on certain tickers — even when the rest of the fundamentals blob is populated. Because the field is set non-null on most tickers, the existing FMP fallback never fires (it only fires when the entire fundamentals blob is empty).

**What:** After `tryProviders` settles in `getFundamentalsSnapshot`, if `result.value.debtToEquity` (or `returnOnEquity`) is null, fetch FMP `/ratios-ttm` once and patch in the missing field(s). Same pattern as the FMP beta fallback added to `quote.ts` yesterday.

**Why only D/E and ROE (not payoutRatio):** A null payout ratio on Polygon usually means "no dividend." Patching from FMP would force "0%" which scores slightly worse semantically — same conclusion either way, but null is more honest.

**Files:** `server/snapshot/fundamentals.ts`.

**Expected impact:** Balance Sheet Quality scores will now populate for PLTR (D/E ~6%, score ~7) and KO (D/E meaningful, score ~6) where they were neutral 5 before. Trade Analysis and Verdict pages should both reflect.

Rollback tag: `safe/2026-05-06-pre-de-fallback`.

---
## 2026-05-06 — Phase 2.5: cut /api/analyze over to scoreSnapshot()

**Why:** Phase 2 + the follow-ups (`fa65161` + `7f819a4`) shipped the unified `scoreSnapshot()` and the side-by-side diagnostic. Force-refresh verification on AAPL and MSFT this morning confirmed the new score works end-to-end (institutional flow populates, beta populates, insider calibration is sane). MSFT specifically went from SPECULATIVE (legacy) → INVESTMENT GRADE (new) — the structural fix the rebuild was for.

The "trade-analysis header grade doesn't match outlook grade" complaint can't be fixed without flipping the routes. This commit flips the first one.

**What:** `/api/analyze` (`server/routes.ts:2613`) now computes its `verdict`, `score`, `ruling`, and `scoring` (categories array) from `scoreSnapshot(getCompanySnapshot(ticker))` instead of the legacy `computeScoring(fullData)` formula. All other fields in the response (chartData, redFlags, businessQuality, financials, historicalReturns, etc.) stay on the legacy path — wholesale-rewriting `/api/analyze` would be a much bigger change and the score/verdict swap is the load-bearing part.

**Safety net:** if `getCompanySnapshot` or `scoreSnapshot` throws for any reason, the route falls back to the legacy `computeScoring`/`computeVerdict` so the page still renders. A warn-level log fires on fallback so we can spot if the snapshot path is consistently failing.

**Cost:** one extra snapshot fetch per `/api/analyze` call. Adds ~1-2 seconds latency to the trade-analysis page on cache-cold tickers. Acceptable for cutover; can be optimized later by making `/api/analyze` fully snapshot-based.

**What changes for users:**
- Trade Analysis page header score will now reflect institutional flow, insider activity, and analyst consensus on top of the 8 fundamental categories.
- Most tickers will see a small score change (typically ±0.5). Some will see verdict bucket changes (PLTR-class names will downgrade if insiders are dumping; MSFT-class names will upgrade if institutions are accumulating).
- The trade-analysis header grade will now match the verdict outlook for tickers that haven't yet been cut over once `/api/verdict` follows in the next commit.

**Not in this commit:**
- `/api/verdict` cutover — separate follow-up because the verdict response includes a stress-test breakdown and a specific factor display that needs careful mapping. Doing analyze + verdict in one commit would be a bigger blast radius.

**Files:** `server/routes.ts` (one block in the `/api/analyze` handler).

Rollback tag: `safe/2026-05-06-pre-analyze-cutover`.

---
## 2026-05-05 — Phase 2 follow-ups: FMP institutional in snapshot, insider penalty calibration, FMP beta fallback

**Why:** Phase 2 (`fa65161`) shipped the `scoreSnapshot()` function and the side-by-side diag endpoint. Verification on PLTR / AAPL / MSFT / KO / F surfaced three fixable issues before any cutover:

1. **EDGAR returned empty on all 5 megacaps tested.** The snapshot's institutional adapter chained EDGAR → Yahoo, but Yahoo is neutered when `FMP_TIER=ultimate` and EDGAR alone was returning empty for everything. **Institutional Flow (15% weight in the new score) was silently dropping out for every ticker.**
2. **Insider Confidence calibration was punishing routine 10b5-1 sales.** "0 buys / 9 sells" (Tim Cook's normal scheduled selling) scored 1/10 — identical to a panic-selling micro-cap with "0 buys / 50 sells." Same data, completely different signal — the score conflated them.
3. **Beta was null on all 5 tickers.** Polygon hardcodes `beta: null` on every tier, FMP /quote doesn't include beta either, so the snapshot quote ended up populated-but-beta-less in every case. Thesis Durability scoring fell back to neutral every time. Legacy /api/analyze patches this via `getFmpProfileBeta()` from `fmp.adapter.ts` — the snapshot didn't have that hookup.

**What:**

- **`server/snapshot/institutional.ts`** — added FMP Ultimate as the primary institutional source (when `FMP_TIER=ultimate`), pulling current and prior quarter via `/institutional-ownership/extract-analytics/holder` and computing QoQ deltas by holder name. This is effectively Phase 3.4b of the master plan (compute QoQ from two consecutive 13F snapshots ourselves) pulled forward because Phase 2 scoring needed real flow data. EDGAR stays as the fallback, Yahoo stays as the neutered last-ditch. New imports: `getFmpInstitutional` + `isFmpUltimateEnabled` from `fmp-institutional.ts`, `fmpGet` from `fmp.client.ts`.

- **`server/snapshot/score.ts`** — recalibrated `scoreInsiderConfidence`. New buckets:
  - < 4 events → score 5 (no signal, thin activity)
  - 0 buys / 5–15 sells → score 4 (mild negative; covers blue-chip 10b5-1)
  - 0 buys / 15+ sells → score 3 (moderate negative; high-volume sell-only)
  - 0–25% buys → 4–5 linear
  - 25–75% buys → 5–7 linear
  - 75–100% buys → 8–10 linear
  - 5+ buys, 0 sells → 10 (strong net buying — historically the best signal)
  - The "0 buys / 9 sells" case that was scoring 1/10 now scores 4 (mild negative) — directionally correct but no longer max-penalizing every megacap.

- **`server/snapshot/quote.ts`** — after `tryProviders` settles, if `result.value.beta === null`, run `getFmpProfileBeta(T)` and patch it onto the value. Same fallback the legacy `/api/analyze` route uses (`server/routes.ts:2560`). Non-fatal — if FMP profile fetch fails, beta stays null.

**Verification:**
Re-run the diag endpoint on the same 5 tickers and look for:
- `snapshotHealth.fields.ownership.source === "fmp"` (was `null`) — Institutional Flow factor should now be `populated: true` on every megacap.
- `categories[].Insider Confidence` — for AAPL / KO with low-volume sells, score should be ~4 instead of 1.
- `categories[].Thesis Durability` — `populated: true` with a real beta in the reasoning string.
- `factorsContributed: 11` (was 7-9) on healthy tickers.

URLs to check tomorrow:
```
https://stockotter.ai/api/diag/score/PLTR
https://stockotter.ai/api/diag/score/AAPL
https://stockotter.ai/api/diag/score/MSFT
https://stockotter.ai/api/diag/score/KO
https://stockotter.ai/api/diag/score/F
```

If those look right, we're cleared for Phase 2.5 cutover (flip `/api/analyze` and `/api/verdict` to read from `scoreSnapshot()`).

**Notes:**
- No user-visible changes. `/api/analyze` and `/api/verdict` still use the legacy code path. This commit only improves what `/api/diag/score/:ticker` produces.
- Yahoo's branch in the institutional adapter stays in code for emergency manual override but doesn't fire when Ultimate is active. Cleanup is a separate task.
- The fund-tab QoQ computation is still `0` (FMP's holder endpoint doesn't expose enough fund-level metadata to do the same diff cheaply). Follow-up.

Rollback tag: `safe/2026-05-05-pre-phase-2-followups`.

---
## 2026-05-05 — Phase 2: scoreSnapshot() + side-by-side diagnostic routes (no cutover yet)

**Why:** Phase 1 (2026-05-01, commit `0de1864`) built the snapshot foundation but no routes were cut over to it. Two scoring paths still co-exist:
- `computeScoring` (`server/routes.ts:988`) — feeds `/api/analyze` and the trade-analysis header. 8 fundamental categories. **Structurally blind to institutional flow, insider activity, and analyst consensus.**
- The `/api/verdict` route's inline factor-blend (`server/routes.ts:4305+`) — different weighting, includes institutional/insider, but had a 20% strategy factor wired to a hardcoded null.

That's why the trade-analysis header grade and the verdict outlook can disagree — they were computed by two different formulas with different inputs. Phase 2's job is the unified scoring function. **No routes are cut over in this commit** — just the new function and a side-by-side diagnostic so we can verify parity on a sample of tickers before flipping anything.

**What:**
1. **`server/snapshot/score.ts`** (new) — exports `scoreSnapshot(snap)` returning a single canonical score on 0-100 (with `score10`/`score100`/`verdict` fields for legacy compat). Eleven categories totaling 100% weight:
   - 8 fundamental categories from legacy `computeScoring` (Income Strength, Income Quality, Business Quality, Balance Sheet, Performance, Valuation, Liquidity, Thesis Durability) — total 65%.
   - 3 new factors that legacy was blind to: Institutional Flow (15%), Insider Confidence (10%), Analyst Consensus (10%).
   - Each category renormalizes across populated factors only — a missing data source doesn't drag the score toward neutral. Per-category `populated` and `source` (`ProviderSource`) provenance preserved on the way out.
   - Verdict bucketing: STRONG CONVICTION (≥8.5) / INVESTMENT GRADE (≥7.0) / SPECULATIVE (≥5.5) / HIGH RISK (else). Matches the legacy `computeVerdict` thresholds exactly so any verdict change in the diff is meaningful.

2. **`GET /api/diag/snapshot/:ticker[?view=health|?refresh=1]`** (new) — returns the full `CompanySnapshot` or just the per-field health view (`source` + `attempts` + `cached` + `populated`). Source of truth for "blank tab" diagnosis.

3. **`GET /api/diag/score/:ticker[?refresh=1]`** (new) — returns:
   - `new` — the full `scoreSnapshot()` output
   - `legacyView` — same math but only the 8 fundamental categories (i.e., what computeScoring's structural blindness produces)
   - `addedFactors` — the 3 new factors the legacy view doesn't see, with their populated/source/reasoning
   - `delta` — `score10`, `score100`, and `verdictChanged` between new and legacy
   - `snapshotHealth` — same shape as the snapshot diag's health view

**How to verify before cutover:**
Run the diag endpoint on a sample of tickers (recommended: PLTR, AAPL, MSFT, KO, F):
- `https://stockotter.ai/api/diag/score/PLTR`
- Same for AAPL, MSFT, KO, F
- For each, eyeball: does the new `verdict` match what the user would expect given the underlying business? Does `addedFactors` show the institutional/insider/analyst categories actually populated, or is the data thin? Where the `legacyView` and `new` disagree, is the new one telling a more honest story?
- If the diagnostic looks right on those 5 tickers, we're cleared to flip `/api/analyze` and `/api/verdict` over to the new score in a follow-up commit (Phase 2.5 cutover).

**Files:**
- `server/snapshot/score.ts` (new)
- `server/routes.ts` — added imports + the two diag routes (right above the SECTOR TOP LEADERS section)

**Notes:**
- This commit doesn't touch any user-visible behavior. Existing `/api/analyze`, `/api/verdict`, scanner, and watchlist all still use the legacy code paths.
- The two new routes are unauthenticated read-only diagnostics — no analysis-quota check, no cache writes that affect other paths.
- Backlog logged this session: Scanner BUY/SELL filter not honored, scanner universe caps to audit (both saved to memory).

Rollback tag: `safe/2026-05-05-pre-phase-2`.

---
## 2026-05-05 — Sector Heatmap migrated off Polygon to FMP-direct

**Why:** With `FMP_TIER=ultimate` confirmed, Polygon Stocks Starter is a drop candidate. `/api/sectors` was one of the legacy `getChart` call sites still routing through Polygon. Migrating it removes one direct Polygon dependency without waiting for the broader Phase 2 snapshot cutover.

**What:** `/api/sectors` now calls `fmpGet("/historical-price-eod/full", { symbol, from, to })` directly per SPDR ETF, with `from` set to ~95 calendar days ago (enough buffer for the 1mo and 3mo returns). FMP returns rows newest-first so we sort ascending and pull the close array. Inter-call delay dropped 400ms → 150ms since FMP Ultimate's 3000 req/min ceiling makes the prior pacing unnecessary.

**Files:** `server/routes.ts` (the `/api/sectors` handler around line 4668).

**Notes:**
- Same Yahoo-shape `closes` array consumed by the existing returns math, so no frontend changes needed.
- The `getChart` helper still exists for other legacy call sites (`/api/analyze`, `/api/trade-analysis` chart paths) — those'll be migrated as Phase 2 of the snapshot rebuild lands or opportunistically as they're touched.

Rollback tag: `safe/2026-05-05-pre-sectors-fmp`.

---
## 2026-05-05 — Scanner results survive page navigation (gcTime: Infinity)

**Why:** Owner reported scan results were disappearing when leaving the Scanner page and returning, forcing a re-scan every visit. Spec is "stay until refreshed or log out."

**Root cause:** React Query's `gcTime` (formerly `cacheTime`) defaults to 5 minutes. The Scanner page writes scan results into the QueryClient cache via `queryClient.setQueryData(...)` but doesn't keep an active `useQuery` observer subscribed to that key. When the user navigates away, the page unmounts and the cache entry has zero observers, so after 5 minutes it gets garbage-collected. Coming back finds nothing and the page falls back to the empty initial state.

**Fix:** `gcTime: Infinity` added to the global QueryClient `defaultOptions.queries`. Cache entries now live for the entire session and are only cleared on a full page reload (logout) or when explicitly refetched. Matches the existing `staleTime: Infinity` already in place.

**Files:** `client/src/lib/queryClient.ts`.

**Notes:**
- This is a global change but it's safe — the app doesn't generate huge numbers of unique queries, and `staleTime: Infinity` already meant queries don't auto-refresh, so the only behavioral change is that data persists across navigation instead of evicting after 5 min idle.
- Scan results, watchlist, trades, account settings, etc. all benefit from this — anything that was already unmount/remount-flickering should now stay put.

Rollback tag: `safe/2026-05-05-pre-scanner-cache`.

---
## 2026-05-05 — Scroll-to-top on navigation + neutral Open price column

**Why:**
1. Clicking a sidebar link wasn't resetting the scroll position — if you scrolled to the bottom of, say, Trade Analysis and then clicked Profile, you'd land at the bottom of the new page. Regression introduced a couple of changes back.
2. The "Open" column in Current Positions was rendering debit prices as negative red numbers (e.g., `-1.50`). Owner's note: "no other platform uses a negative red number for their trade price" — the open price is the trade's entry price, a constant, and it shouldn't visually change color based on whether it's a credit or debit. The CR/DB direction is already encoded in the trade-type badge to the left of the column.

**What:**
- `client/src/components/AppLayout.tsx` — added a `mainRef` on `<main>` and a `useEffect([location])` that calls `mainRef.current?.scrollTo({ top: 0 })` on every route change. `behavior: "auto"` so it's instant, not a smooth-scroll animation.
- `client/src/pages/trade-tracker.tsx` — three rendering sites of the Open column (parent aggregated row, lot row, closed-flat row) now show `Math.abs(price).toFixed(2)` with neutral `text-foreground` styling. No sign prefix, no green/red tint. The underlying signed value is preserved in the database and in P/L math — only the display is neutralized.

Rollback tag: `safe/2026-05-05-pre-scroll-and-openprice`.

---
## 2026-05-05 — Wheel HelpBlock + Trade Tracker tabs

**What:**
- **Wheel Strategy page** — `<HelpBlock title="What is the Wheel Strategy?" defaultOpen>` was forcing the How-It-Works panel open every visit. Removed `defaultOpen` so it matches every other page (closed by default, click to expand). Files: `client/src/pages/wheel.tsx`.
- **Current Positions tabs** — dropped the "All" tab (the four remaining tabs already cover the universe), changed default tab from `"all"` to `"open"` so the page lands on what the user actually wants to see, and updated the `FilterTab` type to drop `"all"`. Tab labels also now show counts for every tab (previously the All tab had no count and the others did). Files: `client/src/pages/trade-tracker.tsx`.

Rollback tag: `safe/2026-05-05-pre-wheel-tabs`.

---
## 2026-05-05 — Page header polish (post-feedback)

**Why:** Owner caught four follow-up issues on the consistency pass that just shipped.

**What:**
1. **`PageHeader` layout** — icon was floating vertically-centered between the title and the subtitle when both were present. Restructured so the icon sits on the same row as the title and the subtitle drops underneath the row. Files: `client/src/components/PageHeader.tsx`.
2. **Conviction Compass blank on error** — the loading and error branches rendered without a `<PageHeader>`, so when the `/api/conviction/:ticker` call failed the page showed nothing but an error card with no page identity. Both branches now render the title + disclaimer first. Files: `client/src/pages/conviction.tsx`.
3. **Trade Analysis "undefined (TSLA)"** — the subtitle interpolated `${data.companyName}` but `tradeData` is typed `any | null` and the `/api/trade-analysis` response shape doesn't include `companyName` at the top level (that field is on `analysisData`, a different query). Replaced with a static subtitle so it can never read `undefined`. Files: `client/src/pages/trade-analysis.tsx`.
4. **Sidebar groups default expanded** — Watchlist, Active Options, and Active Stocks were initialized to `true` in `groupOpen`, forcing the user to scroll past three open lists every session. Flipped to `false` so they start collapsed; clicking the group header still toggles them open. Files: `client/src/components/AppLayout.tsx`.

Rollback tag: `safe/2026-05-05-pre-page-header-polish`.

---
## 2026-05-05 — Page header consistency: Title → Disclaimer → How It Works on every page

**Why:** Owner's long-standing complaint — pages were inconsistent. Some had a title, some didn't; some put the disclaimer before the title; some buried the How-It-Works inside a card; some had a sidebar icon but no matching icon next to the page title. The pitch is "verify the gurus," and it loses credibility if the chrome looks like four different apps stitched together.

**What:** Standardized the top of every sidebar-reachable page on a single pattern:
1. **`<PageHeader>`** (icon matches the sidebar icon, title matches the sidebar label, optional subtitle, optional right-side actions)
2. **`<Disclaimer />`** (when appropriate — kept off pages that show only your own data, like Trade Tracker / Dividend Positions / Help)
3. **`<HelpBlock title="How … works">`** (always at the top level — pulled out of card wrappers where it had been buried)
4. Page content

**New component:**
- `client/src/components/PageHeader.tsx` — `{ icon, title, subtitle?, right? }`. The `icon` prop is a `LucideIcon` and the convention is to pass the same icon that's used in the sidebar so the page identity is unambiguous.

**Pages touched (all under `client/src/pages/`):**
- `home.tsx` (Profile) — added title + disclaimer + How-It-Works (was bare).
- `trade-analysis.tsx` — added title + disclaimer; moved How-It-Works above the loading/error/limit states.
- `trade-tracker.tsx` (Current Positions) — added matching `ClipboardList` icon to title; buttons moved into the header `right` slot.
- `dividend-portfolio.tsx` (Dividend Positions) — title now uses `Landmark` icon to match sidebar.
- `trade-analytics.tsx` (Performance Analytics) — title now uses `PieChart` icon; pulled How-It-Works out of the Key Metrics card.
- `mm-exposure.tsx` — title now uses `Crosshair` icon; reordered so the Search form sits below How-It-Works.
- `institutional.tsx` — swapped to `<PageHeader>` for visual parity.
- `conviction.tsx` — title on both empty state and loaded state; added a How-It-Works block (was missing on the loaded page).
- `verdict.tsx` (Long-Term Outlook) — title with `Award` icon now renders on the loaded page (previously only on the empty state).
- `scanner.tsx` — added title with `Radar` icon; reordered Disclaimer → HelpBlock → Signal Pulse.
- `sector-heatmap.tsx` — title with `Grid3X3` icon; pulled How-It-Works out of the Sector Performance card.
- `earnings-calendar.tsx` — title with `Calendar` icon; pulled How-It-Works out of the Watchlist Earnings card.
- `dividends.tsx` — title with `DollarSign` icon to match sidebar.
- `track-record.tsx` — title now appears **before** the Disclaimer (was reversed).
- `alerts.tsx` — title now appears **before** the How-It-Works (was reversed); buttons moved into the header `right` slot.
- `options-calculator.tsx` — title with `Calculator` icon; rendered the imported-but-unused `<Disclaimer />`. (Per-section How-It-Works blocks inside each sub-calculator stay where they are.)
- `payoff-diagram.tsx` — title with `LineChart` icon; rendered Disclaimer; pulled How-It-Works out of the Strategy Builder card.
- `greeks-calculator.tsx` — title with `Sigma` icon; rendered Disclaimer; pulled How-It-Works out of the Black-Scholes card.
- `kelly-calculator.tsx` — title with `Percent` icon; rendered Disclaimer; pulled How-It-Works out of the Position Sizing card.
- `wheel.tsx` — moved the Disclaimer from the bottom of the page up to the standard slot.
- `help.tsx` — title swapped to `<PageHeader>` for visual parity (icon already matched).

**Notes:**
- Sidebar icons unchanged — the icons next to the page titles are pulled from the same `lucide-react` set the sidebar uses, so the sidebar entry and the page title visually anchor to the same glyph.
- No backend changes. No type-checker regressions in any of the touched files.

Rollback tag: `safe/2026-05-05-pre-page-headers`.

---
## 2026-05-05 — Site-wide timeframe picker for RSI / score consistency

**Why:** Trade Analysis used 1y daily bars while Scanner / Watchlist / quick gate badge used 6mo daily. Wilder's RSI is path-dependent — same ticker showed slightly different RSI on different pages, which flipped grades around the 30/70 thresholds. Owner's complaint: "header grade doesn't match outlook grade."

**What:** Header dropdown (`1D / 1M / 3M / 6M / 1Y / 2Y / 5Y`) that drives every indicator-computing route. Default `1Y`. Setting persists in localStorage and syncs across tabs. Same lookback feeds RSI/EMA/Bollinger everywhere → same answer everywhere.

**Files added:**
- `server/timeframe.ts` — single source of timeframe presets + `parseTimeframe(req)` helper
- `client/src/contexts/TimeframeContext.tsx` — provider, hook, localStorage persistence
- `client/src/components/TimeframePicker.tsx` — dropdown component

**Files modified (server — accept `?timeframe=`):**
- `server/routes.ts` — `/api/analyze`, `/api/trade-analysis`, `/api/scanner`, `/api/scanner/amc`, `/api/scanner-v2/quick/:ticker`, `/api/scanner-v2/indicators/:ticker`, `/api/favorites/:listType/refresh`. Cache keys now include timeframe so flipping the picker doesn't poison cache.

**Files modified (client — pass timeframe to queries):**
- `client/src/App.tsx` — wraps app in `TimeframeProvider`
- `client/src/components/AppLayout.tsx` — picker in header; favorites refresh sends timeframe
- `client/src/contexts/TickerContext.tsx` — `/api/analyze` + `/api/trade-analysis` queries
- `client/src/pages/scanner.tsx` — main / AMC / v2 scanner queries; cache key swap on timeframe change
- `client/src/pages/trade-tracker.tsx` — quick gate badge query
- `client/src/components/IndicatorOscillator.tsx` — MACD/RSI oscillator query

**Notes:**
- Structural longer-context bars stay fixed (e.g. 2y weekly for SMA200 in trade-analysis, 3y/5y weekly in analyze, verdict's 1y return) — those measure something specific and shouldn't move with the user's pick.
- 1D maps to `range=1d, interval=5m`. Polygon Stocks Starter is end-of-day data, so 1D may return empty until/unless the Polygon plan is upgraded to a tier with intraday access. UI handles empty bars gracefully.
- Conviction Compass and Track Record were left unchanged (they use the snapshot pipeline / historical signal validation, not the user-driven indicator path).

Rollback tag: `safe/2026-05-05-pre-timeframe`.

---
## 2026-05-04 — Institutional page: Yahoo fallback + scan dedup + crash guards

**Symptoms users were seeing:**
- Page crashed on render with `TypeError: Cannot read properties of undefined (reading 'length')` after a previous scan had been cached.
- Scanner ran for ~30s and returned "0 results" (or 1 result) even though Yahoo holdings data had been fetched successfully.
- Hitting Scan a second time while the first was still running was tipping the dev server over (silent process exit on Windows mid-fetch).
- Scanner button labels still said "Top 30 Stocks" / "max 30" even though the recent hotfix `0bcc034` lifted the universe to 50.

**Root causes:**

1. **Response shape mismatch.** `/api/institutional-scan` returned `cached.results` (a bare array) on cache hit but `{ scannedAt, totalScanned, results, ... }` (a wrapper object) on cache miss. The frontend expected the wrapper, so a cached response made `scanData.results` undefined → `.length` crashed during render.

2. **Filter stripped everything when EDGAR was blocked.** `parseInstitutionalData` set `institutionPct` and `institutionCount` to `edgar?.institutionPct ?? 0` / `edgar?.institutionCount ?? 0`. With EDGAR currently blocked (per 2026-05-03 Akamai re-block), every row came back 0/0 and the post-scan filter `r.institutionPct > 0 || r.institutionCount > 0` discarded all 50 even though Yahoo had useful holdings data via the helper added on 2026-04-25.

3. **No in-flight dedup on the scan endpoint.** Each click started a fresh storm of provider calls (50 tickers × ~4 endpoints each ≈ 200 concurrent sockets). Two back-to-back clicks doubled that on Windows defaults, exhausting sockets and silently killing the dev server.

**Fixes:**

- **`server/routes.ts`** —
  - cache-hit path now returns `{ ...cached, cached: true }` (full wrapper) instead of `cached.results`, matching the cache-miss shape.
  - `parseInstitutionalData` falls back to Yahoo's `majorHoldersBreakdown.institutionsPercentHeld` / `institutionsCount` / `institutionsFloatPercentHeld` when EDGAR returns null. `institutionalSource` reports `"yahoo-major-holders"` when the fallback fires (vs `"sec-edgar-13f"` when EDGAR is authoritative) so we don't lose provenance.
  - In-flight scan dedup via `Map<scanCacheKey, Promise>` — second clicks `await` the same promise instead of firing another storm. Cleared in `.finally()` so failures don't permanently block the key.
  - `BATCH_SIZE` lowered 10 → 4 to keep concurrent socket count under ~16 on Windows.
  - Post-scan filter broadened to keep rows that have any signal: institutional ownership (EDGAR or Yahoo fallback), fund holdings, OR insider activity.

- **`client/src/pages/institutional.tsx`** —
  - Defensive `(scanData.results ?? [])` guards on the three render sites that crashed on the bare-array shape (status row, results header, results map, empty-state branch). Also unblocks any browser that already has the bad shape cached in React Query.
  - Updated stale "30 stocks" / "max 30" copy → "50 stocks" / "max 50" to match commit `0bcc034`.

**Operational note:** real fix for "0 results" is the SEC EDGAR unblock (filed 2026-05-03 follow-up); the Yahoo fallback is a soft floor so the page is usable in the meantime.

**Files touched:**
- `server/routes.ts`
- `client/src/pages/institutional.tsx`

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
