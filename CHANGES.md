# Stock Otter — Changes Log

This file is the running history of meaningful changes to the project.
Newest entries on top. Each entry should describe **what** changed,
**why**, and which files were touched, so that any human or AI picking
up the project later has the context to keep moving.

For pre-2026-04-25 history, see `FEATURE_CHANGES.md` (focused log of the
Dividend Finder + Position Duration Analysis features that were added
during the prior Perplexity/Claude session).
---
## 2026-05-19 — HTF (High Tight Flag) trading system — full integration

**Why:** Chris dropped a complete HTF design doc + Python reference modules in `docs/htf/` and `backend/patterns/` — Ross Givens' loosened version of Bulkowski's #1-ranked breakout pattern. Goal: detect 30%+ pole / tight-flag breakouts on the small-mid-cap universe and surface position-sized setups for the $7K personal account, with portfolio-level risk gates (max 5 open, 30% total-risk cap, 40% per-sector). The Python was reference-only — production needed to live in TS to plug into the existing signals registry, FMP client, and drizzle DB instead of bolting on a parallel runtime.

**What:**

### Strategy + sizing (Phase 1)
- `server/signals/strategies/htf.ts` — 1:1 TS port of `backend/patterns/htf_givens.py`. Walks each bar as a candidate breakout, tries flag widths 3–30 days, takes longest valid window, verifies 30%+ pole leading in, confirms close above flag-high on ≥1.3× 30-day-avg volume. Returns `HtfHit[]` with measure-rule target + below-flag-low stop + 0–100 quality score.
- `server/signals/risk/position-sizing.ts` — port of `position_sizing.py`. `AccountConfig`, `sizePosition()` (caps shares by both max-risk-per-trade and max-position-size; blocks trades with R/R < 1.0), `PortfolioState` with `canAddPosition()` enforcing max-open / total-risk / sector caps.
- `server/signals/index.ts` — exports `scanHtf`, `sizePosition`, `PortfolioState`, types.

### Universe + cache (Phases 2-3)
- `server/signals/universe/htf-universe.ts` — `getHtfUniverse()` calls FMP `/company-screener` filtered to price $5–$75, avg vol ≥750K, mcap ≥$200M, NYSE/NASDAQ/AMEX, US, active, non-ETF/non-fund, IPOs >6mo. Per-stage counters for logging.
- `server/data/htf-ohlcv-cache.ts` — disk cache at `data/htf-ohlcv-cache/<SYM>.json` mirroring the long-range-cache pattern. 18h TTL = one fetch per trading day. Soft-fails to empty `[]` so the orchestrator can skip bad tickers without aborting a 1,500-name scan.
- `server/data/providers/fmp.client.ts` — added 24h TTL entries for `/company-screener` and `/stock-list`.
- `.gitignore` — excludes `data/htf-ohlcv-cache/`.

### Orchestrator + DB (Phase 4)
- `shared/schema.ts` — new `htf_setups` table (one row per detected breakout, with sizing snapshot + actionable/blocked flag + reason). Indexed on `run_date` and `(symbol, breakout_date)`. Added `htf_config` jsonb column to `account_settings` for HTF-specific overrides.
- `server/compartments/htf-scanner/orchestrator.ts` — `runHtfScan()` pipeline: universe → cached bars → `scanHtf` → `sizePosition` → portfolio gate → persist. Idempotent per `(runDate, symbol)`. Concurrency-pool (default 6) parallelises bar fetches without tripping FMP rate limits.
- `server/compartments/htf-scanner/index.ts` — canonical `htfScannerData` accessor + `htfScannerCompartment` registered in `server/compartments/registry.ts`.

### API (Phase 5)
- `server/compartments/htf-scanner/routes.ts` — `GET /api/htf/setups` · `GET /api/htf/setups/filtered` · `GET /api/htf/portfolio` (reads from existing `trades` table) · `GET /PUT /api/htf/config` (persists in `account_settings.htf_config`) · `POST /api/htf/scan/run` · `POST /api/htf/backtest` · `GET /api/htf/cache/stats`. Self-protecting `requireAuth` per-route (mounted before global API auth).

### Backtester (Phase 7)
- `server/compartments/htf-scanner/backtest.ts` — `backtestSymbol()` simulates Givens' exit rules: entry = next-day open, hard stop at `flag_low × 0.99`, partial 1/3 after 3 cumulative close-strength days (>5% above entry; counter resets only on non-strength), 20-MA trail on remaining 2/3 once partial fires. Returns per-trade list + summary + per-score-bucket breakdown.
- `scripts/htf-backtest.ts` — CLI: `npm run htf:backtest -- AAPL TSLA RKLB`.

### Frontend (Phase 6)
- `client/src/pages/htf-setups.tsx` — `/htf` page with five tabs (Today's Setups / Filtered / Portfolio / Backtest / Config). Score-color-coded rows (green ≥85, yellow 70–84, red <70). Row click navigates to chart. BrandedLoader/BrandedEmptyState/BrandedError for every async state per the quality-bar memory.
- `client/src/App.tsx` — route registration.
- `client/src/lib/page-registry.ts` — page-registry entry under "Investment Opportunities" with `Flag` icon, picked up automatically by the sidebar nav and `<PageHeader />`.

### Tests + tooling (Phase 8)
- `scripts/htf-sizing-parity.ts` — runs the six demo cases from the Python `position_sizing.py` __main__ through the TS `sizePosition()` port and asserts cent-for-cent match (LUNR 74sh@$1745.66, BKSY 42sh@$1737.96, CHEAP 388sh@$1746, EXPENSIVE 18sh@$1710, RKLB/BADRR blocked on R/R, sector cap fires after LUNR fills Aerospace). Passes.
- `scripts/htf-smoke.ts` — pipeline smoke: 5 known tickers through cache → scanHtf → sizePosition. Gracefully exits 0 when FMP_API_KEY isn't set so it can run on dev boxes without keys.
- `package.json` — `htf:smoke` · `htf:parity` · `htf:backtest`.

**Notable choices:**

- **Strict-Bulkowski (`htf.py`, 90% pole) kept as reference only** — production uses only the Givens loosening because the strict variant is far too restrictive for a $7K weekly-setup hunter.
- **Partial-exit rule mirrors the Python code, not the README** — code is *cumulative-with-reset-on-weakness*; README says *consecutive*. Code is what was actually backtested, so the port matches it. One-line comment in `backtest.ts` flags the divergence.
- **No parallel persistence** — portfolio reads from existing `trades` table, account config reads from existing `account_settings.htf_config`. No `portfolio.json` or `account.json` to dual-source.
- **Python tree (`backend/patterns/`) untouched** — kept as reference/research surface; not imported at runtime. The detector/sizer/backtester logic now has two implementations in lock-step.

**Net:** the /htf route is live end-to-end. Hit "Run scan" on the page (or `POST /api/htf/scan/run`) to populate today's setups; the nightly cron hook can be wired into `server/cron.ts` in a follow-up. Backtest tab gives any-ticker per-trade history. Config tab edits the risk caps in place.

---
## 2026-05-18 — Scanner direction filter moved server-side (BUY/SELL counts now honest)

**Why:** After tightening the client-side BUY/SELL filter, Chris reported the counts were still erratic and inconsistent ("Sell shows 1, BUY shows 3, both shows 30+ NO SETUP"). Root cause: the server caps at 50 results — qualified rows on top, NO SETUP fill below. Client filtered AFTER that cap, so BUY/SELL got "whatever survived from the 50-mix." Combined with the universe shuffle (different 500-ticker subset every scan), the counts were both small and randomly varying.

**What:**

### Server-side direction filter on `/api/scanner` (3-strategy)
- `server/routes.ts` — new `direction` query param (`buy` | `sell` | `both`, default `both`). When `buy`/`sell`, the server filters `allResults` to rows whose `gates.signal` matches `^(GO|SET|READY|PULLBACK)` AND `gates.direction` matches the picked side, BEFORE the TOP_N truncation. Fill rows are dropped entirely under BUY/SELL — no more NO SETUP padding.
- `filters` block in the response payload now echoes the `direction` so the client can confirm what the server applied.

### Server-side direction filter on `/api/scanner/amc`
- `server/routes.ts` — same `direction` param. AMC results don't have gate signals — they have `signal: "ENTER" | "HOLD" | "SELL"`. BUY filter → `signal === "ENTER"`, SELL filter → `signal === "SELL"`. Same truncation pattern: drop fill under BUY/SELL.

### Client — pass `direction` to server, drop the redundant client filter
- `client/src/pages/scanner.tsx` — `queryParams` now includes `direction: signalFilter`. The non-v2 client-side filter block is gone — server is authoritative. Display the server's response directly.
- Count labels: BUY/SELL status bar reads `"X buy setups"` / `"X sell setups"` (X = server result count = actual count). BOTH still reads `"X gate-ready of N shown"` or `"X AMC setups of N shown"` depending on scan mode.

**Net effect for the user:**
- BUY/SELL counts now mean "this many actionable entry-direction setups were found in the N stocks scanned." No fill padding, no over-counting.
- The cross-scan variation is now ONLY the universe shuffle (different random 500 tickers each time) — not also "different 50-row mix." More setups means widening the scan count or running again.

**Files touched:** `server/routes.ts`, `client/src/pages/scanner.tsx`, `CHANGES.md`.

**Verification:** TypeScript clean, build clean. Browser spot-check pending — Chris should run a 500-stock scan three ways (BOTH, BUY, SELL) and confirm: BUY shows only ↑-direction setups, SELL shows only ↓-direction setups, BOTH still surfaces the full 50-result mix.

---
## 2026-05-18 — Scanner BUY/SELL filter: drop score-fallback, count gate-ready honestly

**Why:** Same-day follow-up to the BUY/SELL strictness fix earlier today. Chris ran a 500-stock scan: BUY returned 13 cards (correctly mostly READY ↑ / SET ↑ / GO ↑), but SELL returned 3 cards that included a "NO SETUP" and a "GATES CLOSED" — and the BOTH-filter status label said "50 gate-ready" when 35 of those 50 were actually NO SETUP fill rows. Two real defects: (a) score-fallback was leaking NO-SETUP and exit signals into BUY/SELL, and (b) the "gate-ready" count label included server-side fill rows that aren't gate-ready at all.

**What:**

### Scanner.tsx — strict BUY/SELL filter, no more score-fallback
- `client/src/pages/scanner.tsx:703-731` — replaced the gate-direction-with-score-fallback logic with a single pass over `gates.signal`: only rows whose signal matches `^(GO|SET|READY|PULLBACK)` are eligible for BUY/SELL, AND the direction must match the picked side. Excludes `NO SETUP` (nothing actionable), `GATES CLOSED` (exit signal, not a SELL entry), and any row where the gate engine couldn't compute at all (no guessing from score sums).
- The earlier defense-in-depth sub-signal check is gone — superseded by the cleaner signal-shape gate.

### Scanner.tsx — honest gate-ready counts
- `client/src/pages/scanner.tsx:663-680` — the "Scanned N stocks · X gate-ready" status under the scan button used to set `X = data.results.length`, but the server returns up to 50 results including non-gate-ready fill when `showAll=true`. Now `X` is computed client-side as the count of results whose signal matches `^(GO|SET|READY|PULLBACK)`, with the label reading `… X gate-ready of N shown`.
- `client/src/pages/scanner.tsx:735-739` — the section heading for BOTH filter now reads `${filtered.length} Stocks · ${gateReadyCount} Gate-Ready` instead of falsely calling all 50 results gate-ready. BUY/SELL filter heading still reads `${filtered.length} Gate-Ready (buy|sell)` since the strict filter guarantees all surviving rows are gate-ready.

**Files touched:** `client/src/pages/scanner.tsx`, `CHANGES.md`.

**Verification:** TypeScript clean, build clean. Browser spot-check pending — Chris should pick BUY and SELL on a 500-stock scan and confirm:
- SELL no longer includes any "NO SETUP" / "GATES CLOSED" / mismatched-direction cards.
- BOTH filter status label reads honest "X gate-ready of N shown" instead of overstating.

---
## 2026-05-18 — Scanner: BUY/SELL filter strictness + lift the universe restrictions

**Why:** Two long-standing scanner bugs reported on 2026-05-05 and not yet fully closed: (1) BUY toggle still surfaces sell-side results in Scanner v2, and (2) the 3-strategy / AMC scanners visibly restrict the user to a fixed list — only 10/15/25 tickers selectable in the UI even though the server allows up to 1000.

**What:**

### Bug — BUY/SELL filter leaked bias-neutral rows (Scanner v2)
- `server/scanner-v2.ts:610-614` — direction post-filter previously kept rows where `r.direction === filters.direction || r.direction === "either"`. The `|| "either"` clause meant bias-neutral tickers (where `scoreRow` couldn't lean up or down decisively) leaked into both BUY and SELL result sets. Now strict: only rows whose computed direction matches the picked side survive. Comment in code explains why.

### Bug — 3-strategy / AMC scan-count UI capped at 25 stocks
- `client/src/pages/scanner.tsx:598` — replaced the `[10, 15, 25]` button row with `[50, 100, 250, 500]`. Server cap is 1000, no need to gate the user at 25.
- `client/src/pages/scanner.tsx:391` — default `scanCount` bumped `25 → 250`. Existing 250-batch perf profile completes well under nginx's 60s limit (per main-scanner comment block).

### New — Scanner v2 universe-size picker
- Previously hard-coded `universeSize: "2000"` in the URL builder, leaving the user with no UI to widen or narrow the screened set.
- Added `v2UniverseSize` state (default 2000) + a 3-button picker (1000 / 2000 / 3000) inside the v2 filter card next to Min Score.
- The "Scan 2000 Stocks" CTA label now reads dynamically from the picked size (`Scan ${v2UniverseSize} Stocks`).
- Server cap at `Math.min(universeSize, 3000)` already exists — picker stays within it.

### Defense-in-depth — 3-strategy filter score-fallback
- `client/src/pages/scanner.tsx:704-728` — when `gates.direction` is null (gate engine couldn't run), the buy/sell fallback now additionally requires that BBTC / VER / Confirmation sub-signals don't contradict the picked side. Prevents the edge case where a high-score ticker with a strong opposite sub-signal slips through.

**Files touched:** `server/scanner-v2.ts`, `client/src/pages/scanner.tsx`, `CHANGES.md`.

**Verification:** TypeScript clean, build clean. Browser spot-check pending — Chris should pick BUY on Scanner v2 and confirm no "either"-direction rows appear in results.

---
## 2026-05-16 — Type the EMA-toggle contract + bake browser-verify into `verify-work`

**Why:** Same-day follow-up to the EMA-toggle fix. The bug had been "fixed" four times before it actually went away (commits 035bde4, 9af9c23, 5f3b01f, 5467148) — every prior attempt was based on the false signal that `tsc` clean + visible-button-state = working feature. This commit removes the structural conditions that allowed those false signals.

**What:**
- `client/src/components/chart/overlays.ts` — exports `EmaToggleState` as the single source of truth for the four-EMA toggle row shape. `emaOverlays()` signature is now `Partial<EmaToggleState>` instead of an anonymous `{ ema9?: boolean; … }`. A future rename of any key will fail to compile at both producer (`EmaToggleStrip`) and consumer (`emaOverlays`) until they're back in sync. The original bug class — anonymous parameter shape + defaults silently swallowing a key-name mismatch — can no longer occur.
- `client/src/components/chart/EmaToggleStrip.tsx` — imports `EmaToggleState` from `overlays.ts` instead of defining its own. Still re-exported for the existing `@/components/chart` public surface, so no call-site churn.
- `.claude/skills/verify-work/SKILL.md` — new section E ("Interactive UI behavior") is a BLOCKER for any diff touching `onClick` / `onChange` / `onSubmit` / `useState<…>` / new toggle/form/dropdown. Requires (a) tracing the state value end-to-end in the code, with anonymous parameter shapes and `Partial<…>` parameters explicitly called out as the danger zone, and (b) clicking the feature in a running browser. Skill must explicitly state "UI behavior not verified — Chris should spot-check" if it can't run the browser, never silently report clean. New hard rule cites the 2026-05-16 four-attempt loop as precedent.

**Net:** removes both the structural cause (anonymous shape) and the verification gap (false-positive type-check on interactive UI) so this bug class can't repeat.

---
## 2026-05-16 — Fix EMA toggles: align `emaOverlays()` props with `EmaToggleState` shape

**Why:** EMA toggle buttons on every TV-style chart (Strategy Chart, Trade Analysis, Confluence Chart) appeared interactive but never actually toggled the lines on the chart. After multiple prior attempts (commits 035bde4, 9af9c23, 5f3b01f), the real root cause was a silent key-name mismatch between the toggle state and the overlay builder — every key missed the destructure and every overlay fell back to its default.

**What:**
- `client/src/components/chart/overlays.ts` — `emaOverlays()` now destructures `{ ema9, ema21, ema50, ema200 }` (the shape `EmaToggleState` already emits) instead of `{ showEma9, showEma21, showEma50, showEma200 }`. All three consumer pages (`pages/chart.tsx`, `pages/trade-analysis.tsx`, `pages/confluence-chart.tsx`) call `emaOverlays(emaState)` and now wire through correctly. No call-site changes needed.

**Bug mechanic:** `EmaToggleStrip` writes state with `ema9 / ema21 / ema50 / ema200`. `emaOverlays()` was reading `showEma9 / …`. Destructure found none of the expected keys → every value used its default (9/21/50 visible, 200 hidden). React state updated correctly on every click; the result was just discarded by the overlay function. Buttons looked active because the strip reads `state[t.key]` directly, but the chart never saw the change. This closes the TODO captured yesterday in `memory/todo_chart_toggles_and_timeframe.md` for the toggle half; the timeframe-picker half remains open.

---
## 2026-05-15 — Rogue cleanup: API endpoints migrated to constants, Yahoo/Polygon kill plan saved, chart TODO captured

**Why:** Chris went to sleep with the chart EMA toggles + timeframe still flaky and told me to "go back to the rogue stuff and fix all that." This commit (a) captures the chart bugs as a durable TODO so they're not lost, (b) sweeps a chunk of raw `/api/*` strings into the constants module (rogue #3), and (c) saves a planning memory for the Yahoo+Polygon kill — NOT executing the kill itself, since unsupervised provider migration is too risky.

**What:**

### Chart issues saved as TODO memory
- New `memory/todo_chart_toggles_and_timeframe.md` — captures symptoms (toggles flaky, timeframe picker not driving charts) and a debugging plan for when Chris picks it back up. Indexed in MEMORY.md so it doesn't get lost.

### API endpoints sweep — 16 files migrated to `@shared/api/endpoints` constants
Files now reading their `/api/*` paths from the canonical constants module:
- `client/src/contexts/AuthContext.tsx` — `API_AUTH_ME`, `API_AUTH_LOGIN`, `API_AUTH_REGISTER`, `API_AUTH_LOGOUT`
- `client/src/components/AppLayout.tsx` — `API_TRADES`, `API_TRADES_SUMMARY`, `API_ACCOUNT_SETTINGS`, `API_FAVORITES`, `API_FAVORITES_WATCHLIST`, `API_FAVORITES_PORTFOLIO`
- `client/src/components/OnboardingTour.tsx` — `API_AUTH_COMPLETE_TOUR`
- `client/src/components/AlertsBell.tsx` — `API_ALERTS`
- `client/src/components/BacktestPanel.tsx` — `API_TRACK_RECORD_BACKTEST`
- `client/src/lib/dashboard/useDashboardLayout.ts` — `API_DASHBOARD_LAYOUT`
- `client/src/pages/account.tsx` — `API_AUTH_PROFILE`, `API_AUTH_CHANGE_PASSWORD`
- `client/src/pages/auth.tsx` — `API_AUTH_FORGOT_PASSWORD`
- `client/src/pages/alerts.tsx` — `API_ALERT_RULES`, `API_ALERTS_EVALUATE_NOW`
- `client/src/pages/market-pulse.tsx` — `API_MARKET_PULSE`
- `client/src/pages/dividend-portfolio.tsx` — `API_DIVIDEND_PORTFOLIO`
- `client/src/pages/kelly-calculator.tsx` — `API_TRADES_ANALYTICS`
- `client/src/pages/conviction.tsx` — `API_DIAG_CONVICTION_BACKTEST`
- `client/src/pages/options-calculator.tsx` — `API_TRADES`
- `client/src/pages/payoff-diagram.tsx` — `API_TRADES`
- `client/src/pages/greeks-calculator.tsx` — `API_TRADES`

**Not migrated in this ship** — endpoints with embedded path params (e.g. `/api/alerts/${id}/read`, `/api/alert-rules/${id}`). The catalog has path-builder helpers for the common ones (analyzePath, tradePath, etc.); call-site migration is mechanical and can happen in a follow-up sweep.

### Yahoo/Polygon kill — execution plan saved (NOT RUN)
- New `memory/plan_yahoo_polygon_kill.md` documenting the 593-reference migration in tiered risk buckets:
  - Tier 1 — adapter shells to delete (5 files).
  - Tier 2 — data-flow consumers to rewire to FMP (~20 files). Including the tricky ones: MM Exposure + unusual-options depend on Polygon options-chain data that FMP may not provide.
  - Tier 3 — text/docs only (5 files, low risk).
  - Tier 4 — comment-only references (5 files).
- Plan deliberately NOT executed unsupervised. Open questions for Chris listed in the memo (FMP options-chain coverage? Acceptable to feature-kill MM Exposure if no FMP equivalent? Timeline?).

**Files touched:** new `memory/todo_chart_toggles_and_timeframe.md`, new `memory/plan_yahoo_polygon_kill.md`, `memory/MEMORY.md`, 16 client files (API endpoint migrations), `CHANGES.md`.

---
## 2026-05-15 — EMA toggles still broken — switched to add/remove series (skip `visible: false`)

**Why:** After the prior fixes shipped, Chris reported: "still cant turn them off and 200 is gone period." Both bugs were the same root cause — `applyOptions({ visible: false })` on a Lightweight Charts v5 LineSeries wasn't actually hiding the line. SMA 200 looked "gone period" because its default state was `visible: false`, and toggling it on didn't work either (same broken path).

**What:**

### Switched from `visible: false` to add/remove series
- Instead of relying on `applyOptions({ visible })` to show/hide a line — which had v5 quirks — the manage-overlays effect now **adds** the series to the chart when toggled on and **removes** it from the chart when toggled off. Decisive, no library-internal caching to fight.
- Three concerns (create / remove / push-data) consolidated into a single effect because splitting them was causing race conditions where the data push tried to run before the series existed.
- Default invisible overlays (e.g. SMA 200 default-off) now correctly show up the moment the toggle is flipped on — series gets added with data in one operation.

### Trade-off
- Toggling an EMA off → on creates a new series each time (vs. just flipping a flag). Lightweight Charts handles series creation cheaply, so the user-facing cost is invisible. The benefit is no fighting with `visible` option quirks.

**Files touched:** `client/src/components/chart/CandlePane.tsx`, `CHANGES.md`.

---
## 2026-05-15 — EMA toggle resets the chart view — split fitContent off

**Why:** After the prior toggle-fix shipped, Chris reported: "Everytime you turn a EMA off or on it resets the chart." Toggling an EMA was re-fitting the chart's visible range to the full data, blowing away any pan / zoom the user had set. Root cause: the data-push useEffect had `bars, overlays, markers, showVolume` as deps AND called `chartRef.current?.timeScale().fitContent()` at the end. Toggling an overlay = new overlays reference = effect re-runs = `fitContent()` fires = view resets.

**What:**

### Split the single data-push effect into three focused effects
- **Effect A — candles + volume.** Deps: `[bars, showVolume]`. Calls `fitContent()` at the end. Only fires on REAL data loads (new ticker, new timeframe, etc.) — never on overlay/marker toggles.
- **Effect B — overlay data.** Deps: `[bars, JSON.stringify(overlays)]`. Pushes each overlay series' `setData()` and re-asserts visibility. Does NOT call `fitContent()`.
- **Effect C — markers.** Deps: `[markers]`. Calls `setMarkers()` on the markers plugin. Does NOT call `fitContent()`.

Toggling an EMA now triggers only Effect B — the visible range stays exactly where the user had it.

**Files touched:** `client/src/components/chart/CandlePane.tsx`, `CHANGES.md`.

---
## 2026-05-15 — EMA toggles not toggling — robustness fixes in CandlePane

**Why:** Chris reported live: "EMAs are not toggling on any chart." The toggle buttons changed state visually (active/inactive) but the EMA lines on the chart didn't disappear. Two issues teamed up to cause it.

**What:**

### Fix 1 — `JSON.stringify(overlays)` as the manage-overlays dep
- The original useEffect dep was a hand-rolled string `overlays.map(o => `${o.dataKey}:${o.color}:${o.visible}:${o.width}`).join("|")`. That should have caught visibility changes (boolean `true` vs `false` produce different strings), but apparently the effect wasn't re-firing reliably in some paths. Replaced with `JSON.stringify(overlays)` — guaranteed to change whenever any overlay field changes, including the boolean visibility flag. Stable across parent re-renders where overlay content is unchanged.
- Also moved the `visible` option into the `chart.addSeries(LineSeries, {...})` creation call instead of relying on a follow-up `applyOptions()`. First-mount visibility now correct without a second-pass write.

### Fix 2 — re-assert visibility after `setData` (defensive)
- The data-push useEffect calls `setData(...)` on each overlay series. Lightweight Charts shouldn't reset series options on setData, but some chart libraries do. Belt-and-suspenders: immediately after `setData`, call `applyOptions({ visible })` again so visibility is always in sync regardless of internal library behavior. Costs one cheap function call per overlay per data push.

**Files touched:** `client/src/components/chart/CandlePane.tsx`, `CHANGES.md`.

---
## 2026-05-15 — Unified EMA palette + shared EMA toggle strip + 4-EMA on every chart

**Why:** Chris flagged three connected gaps after using the new TV charts: (1) Confluence had only 3 EMA toggles (no EMA 9); (2) Trade Analysis and Strategy Chart had no EMA toggles at all; (3) the two charts used different EMA colors despite the compartmentalization rule — Confluence had a muted yellow/violet/near-white stack, Trade Analysis had a bolder green/orange/cyan/purple stack. Chris: *"if we compartmentalized the charts why are the EMA colors different. I like the trade analysis colors."* One palette, every chart, full toggle controls on all three.

**What:**

### Unified EMA palette — one canonical set across every TV chart
- `lib/design-tokens.ts`: deleted the `CHART_EMA_21_CANDLE`, `CHART_EMA_50_CANDLE`, `CHART_EMA_200_CANDLE` confluence-specific constants. The remaining `CHART_EMA_9` (green) / `CHART_EMA_21` (orange) / `CHART_EMA_50` (cyan) / `CHART_EMA_200` (purple) is the canonical palette per Chris's pick.
- `components/chart/overlays.ts`: collapsed the two preset functions (`confluenceEMAOverlays`, `tradeAnalysisEMAOverlays`) into ONE — `emaOverlays({ showEma9, showEma21, showEma50, showEma200 })`. The old names are kept as deprecated aliases pointing at the unified function so any in-flight call sites keep working.

### `<EmaToggleStrip>` — shared primitive used by every chart page
- New `components/chart/EmaToggleStrip.tsx` — the canonical EMA toggle button row. Driven by `EMA_TOGGLES` config from `overlays.ts`, so adding an EMA to the chart = add to the config; every consumer picks it up.
- Each button uses its EMA line color for visual binding (active button is tinted with the EMA color so the user's eye matches toggle → line).
- Type-safe `EmaToggleState` shape (`{ ema9, ema21, ema50, ema200 }`) — pages own the state, hand it to both `<EmaToggleStrip>` and `emaOverlays(...)`.

### Confluence Chart — gained EMA 9, swapped to shared strip
- 3 hand-rolled toggle buttons (yellow/violet/zinc) replaced with `<EmaToggleStrip>` (green/orange/cyan/purple, 4 EMAs).
- EMA 9 now available alongside 21/50/200. Default-on: 9/21/50. EMA 200 default-off.
- `useConfluenceChart`'s `CandleBar` already had an `ema9` field — backend was emitting it, the chart just wasn't using it.

### Trade Analysis — gained EMA toggles
- `<EmaToggleStrip>` added to the price-chart card header (alongside the existing long/short side filter).
- Overlays now reactive to the toggle state via `emaOverlays(emaState)`. Default-on: 9/21/50/200 (all four).

### Strategy Chart — gained EMA toggles + EMA overlays
- `<EmaToggleStrip>` added above the chart.
- Strategy Chart's `<CandlePane>` now consumes `emaOverlays(emaState)` — previously had no overlays at all.
- **Backend updated:** `server/diag/chart-data.ts` `ChartBar` type extended with optional `ema9` / `ema21` / `ema50` / `sma200` fields. `getChartData()` computes the series via `computeEMA` / `computeSMA` (using the new periods from `shared/indicators/constants`) and includes them in every displayBar. Default-on: 9/21/50. SMA 200 default-off.

**Files touched:** `client/src/lib/design-tokens.ts`, `client/src/components/chart/overlays.ts`, `client/src/components/chart/EmaToggleStrip.tsx` (new), `client/src/components/chart/index.ts`, `client/src/pages/confluence-chart.tsx`, `client/src/pages/trade-analysis.tsx`, `client/src/pages/chart.tsx`, `server/diag/chart-data.ts`, `CHANGES.md`.

---
## 2026-05-15 — TV chart fixes: missing markers (v5 API) + Trade Analysis OHLC

**Why:** Chris reported live: "not one dot on either chart and trade analysis has not dots and no candles." Two bugs in the just-shipped TV migration.

**What:**

### Markers were silently dropped — Lightweight Charts v5 API change
- v5 moved markers out of `series.setMarkers(...)` into a standalone `createSeriesMarkers(series, markers)` plugin function.
- The migration code had a defensive guard: `(series as any).setMarkers?.(markers)` — when the method didn't exist, the guard silently no-op'd. Every marker on every chart disappeared.
- Fix: import `createSeriesMarkers` from `lightweight-charts`, create the markers plugin once at chart init, store the plugin instance in a ref, and call `markersPlugin.setMarkers(...)` whenever the markers prop changes. Also sort markers by time (v5 requires ascending order or it silently drops the list).
- Defensive guards on third-party APIs are a quiet failure mode — this is a banked lesson for the verify-work skill (next iteration could check for `?.` guards on critical APIs).

### Trade Analysis chart had no candles — server returned close-only
- The `/api/trade-analysis/:ticker` endpoint built `chartDataArr` with `{ date, close, ema9, ema21, ema50, sma200, rsi, signals }` — no `open` / `high` / `low` / `volume`. The CandlePane needs OHLC to render candles; without it, the candle series renders blank.
- Fix: include OHLC + volume in every chartDataArr row. Server-side `opens`/`highs`/`lows`/`volumes` arrays were already loaded — just needed to plumb them through. Falls back to `close` when an individual OHLC field is null (Yahoo occasionally returns nulls for illiquid days; better to render a doji than drop the bar).
- Refactored the per-bar payload into a `rowAt(i)` helper so the loop body and the last-bar appender share one shape — eliminates the duplicate field list and the bug that caused the original migration to leak stray code on the last-bar branch.

**Files touched:** `client/src/components/chart/CandlePane.tsx` (v5 markers plugin), `server/routes.ts` (trade-analysis OHLC), `CHANGES.md`.

---
## 2026-05-15 — TV chart rollout: Trade Analysis + Strategy Chart migrated to CandlePane

**Why:** Continuation of the TV-style chart rollout. The shared `CandlePane` primitive landed in the prior commit; this ship migrates the two highest-impact pages that still ran on Recharts — Trade Analysis (per-ticker signal walk-through) and Strategy Chart (`/chart` backtest visualizer). Both now use the same primitive Confluence Chart does, with declarative overlay configs and signal markers.

**What:**

### Trade Analysis price chart migrated
- The price chart (Recharts ComposedChart with Area + four EMA Lines + custom SignalDot scatter) replaced with `<CandlePane>`.
- Overlays sourced from `tradeAnalysisEMAOverlays()` — the bolder green/orange/cyan/purple stack ready since the primitive landed.
- New `buildTradeAnalysisMarkers(rows, sideFilter)` helper translates BBTC/VER signals into `ChartMarker[]` — preserves the existing semantics (long entry / watch / reduce-win / stop-loss / clean exit / info-only short entry / info-only short watch) plus the side filter (both/long/short).
- The 150-line Recharts block deleted; the legend below the chart preserved.
- RSI sub-chart on the same page still uses Recharts — that's a dedicated indicator pane that needs its own primitive (TVChart sub-pane). Follow-up.

### Strategy Chart migrated
- `/chart` page's StrategyChart component replaced its ComposedChart (close line + per-category Scatter dots + ReferenceArea regime bands) with `<CandlePane>`.
- New `buildStrategyChartMarkers(signals, highlightedTradeNum)` translates each signal's DotCategory (core_entry / tactical_entry / long_entry / exit_win / exit_loss / exit_clean / watch / info) into marker shape (arrowUp / arrowDown / circle) + position (aboveBar / belowBar) + color (from CATEGORY_COLOR).
- Highlighted trade-number prefixes the marker text with ★ for visibility.
- **Regime bands deferred.** Lightweight Charts has no native shaded-region API. Adding it requires either: (1) a custom DOM overlay synced to the time axis, or (2) a semi-transparent series with fill. Surfaced as a follow-up — current Strategy Chart loses the bullish/bearish background tint but gains TV-style candles + crosshair + markers. Net upgrade.

### Charts NOT migrated (intentional)
These visualizations are not OHLC/price-based and don't fit TV-style. They stay on Recharts:
- **Conviction Compass** — radar (4-axis polar) chart, not a TV pattern.
- **Payoff Diagram** — option P/L curves (not price candles).
- **Wheel Strategy** — P/L curves.
- **Kelly Calculator** — equity curves.
- **MM Exposure** — gamma exposure / open interest bars (price overlay possible as future enhancement).
- **Trade Analytics** — bar/pie charts of historical performance.
- **Track Record** — return-by-bracket bars.

### Follow-ups documented
- **RSI sub-pane primitive** — current RSI charts on Trade Analysis and Confluence Chart use a small Recharts line. Worth wrapping into a dedicated `<RsiPane>` that uses Lightweight Charts (different y-axis but same time axis as the candle pane).
- **MACD sub-pane primitive** — same pattern.
- **Regime band overlay** — strategy charts with BULLISH/BEARISH/NEUTRAL regime windows need either a DOM-overlay component or a Lightweight Charts background-series workaround.
- **SignalDot helper cleanup** — Trade Analysis still has the legacy `SignalDot` Recharts dot renderer in the file (unused after migration). Will prune in a follow-up sweep along with the unused Recharts imports.

**Files touched:** `client/src/pages/trade-analysis.tsx` (chart replaced + marker builder added), `client/src/pages/chart.tsx` (chart replaced + marker builder added), `CHANGES.md`.

---
## 2026-05-15 — TV-style chart primitive — first step of chart rollout

**Why:** Foundation for the TradingView-style chart rollout across every page. Chris said "go with the charts." The Confluence Chart already had a working candle pane (CandlePane.tsx) built on Lightweight Charts, but it was buried inside the `confluence-chart` compartment with hardcoded EMA21/50/200 props and a compartment-specific bar type. For the rollout, every TV chart on the site needs to use the same primitive — different overlays, different signals, different markers, but ONE rendering implementation.

**What:**

### New `client/src/components/chart/` module — the canonical chart primitive
- **`CandlePane`** — moved from `compartments/confluence-chart/` and parameterized. Now takes a config-driven `overlays` array, optional `markers`, optional volume / watermark toggles. A single call site can render any combination of EMAs, SMAs, or custom indicator lines by passing different overlay configs.
- **`overlays.ts`** — preset overlay sets that pages import directly:
  - `confluenceEMAOverlays({ showEma21, showEma50, showEma200 })` — the muted yellow/violet/near-white EMA stack Confluence uses.
  - `tradeAnalysisEMAOverlays({ showEma9, showEma21, showEma50, showEma200 })` — the bolder green/orange/cyan/purple stack the legacy Trade Analysis Recharts version used. Ready for that page's TV migration.
- **`types.ts`** — `ChartBar`, `LineOverlay`, `ChartMarker` shared interfaces. Every page's per-page bar type (e.g. `CandleBar` in `useConfluenceChart`) now extends `ChartBar`.
- **`index.ts`** — clean public surface so consumers `import { CandlePane, confluenceEMAOverlays } from "@/components/chart"`.

### Composability built in (not "add a flag for every new feature")
- New indicator on the chart = one line in the overlay array: `{ dataKey: "rsiOverlay", label: "RSI", color: CHART_RSI, visible: true }`.
- Hide/show a line without rebuilding the chart — change `visible` in the prop; the component honors it via `applyOptions`.
- Add a signal marker (BUY arrow, STOP triangle) = entry in the `markers` array. Built-in to the primitive; pages don't reach into Lightweight Charts.
- Custom bar types extend `ChartBar` via the optional indicator-field index signature.

### Confluence Chart migrated as proof-of-concept
- `pages/confluence-chart.tsx` now imports from `@/components/chart` and calls `confluenceEMAOverlays({ showEma21, showEma50, showEma200 })` to build its overlays array.
- The old `compartments/confluence-chart/CandlePane.tsx` deleted (orphaned after the move).
- `useConfluenceChart.ts` updated: `CandleBar` now `extends ChartBar`. Self-documenting which fields the `/api/analyze` endpoint emits.
- Visual output identical to the prior commit — pure refactor, zero pixel change.

### `/verify-work` skill updated with TWO new blocker rules
- **Chart rule (#9):** no page imports `createChart` from `lightweight-charts` directly. All TV-style panes go through `@/components/chart`. Custom overlay colors must use design-tokens, not raw hex. Recharts is allowed for non-candle visualizations (radar, payoff curves) that don't fit TV-style.
- **Moveable-widgets rule (#10):** widgets can't import from `@/lib/dashboard/*` or hardcode dashboard assumptions. Per the `architecture_moveable_widgets` memory.

### What this enables (next ships)
- **Trade Analysis migration** — the existing Recharts EMA chart can swap to `<CandlePane>` with `tradeAnalysisEMAOverlays()` + signal markers from the BBTC/VER trade list. Single-file refactor.
- **Strategy Chart migration** — `/chart` page's Recharts becomes `<CandlePane>` with the strategy's entry/exit markers as `ChartMarker[]`.
- **MM Exposure price overlay** — add a TV-style mini candle above the gamma chart.
- **Any future chart** — `<CandlePane bars={bars} overlays={[...]} markers={[...]} />`. Done.

**Files touched:** new `client/src/components/chart/{CandlePane.tsx,overlays.ts,types.ts,index.ts}`, `client/src/pages/confluence-chart.tsx` (migrated), `client/src/compartments/confluence-chart/useConfluenceChart.ts` (CandleBar extends ChartBar), deleted `client/src/compartments/confluence-chart/CandlePane.tsx`, `.claude/skills/verify-work/SKILL.md`, `CHANGES.md`.

---
## 2026-05-15 — Moveable-widgets requirement + motion tokens + format.ts palette fix + branded primitives

**Why:** Continuation of the universal-structure rollout, focused on what the TV-chart rollout will need next: consistent motion timing, single-source loading/empty/error states, and the moveable-widgets architectural requirement Chris flagged (widgets work anywhere, not just on /dashboard). Also caught a real bug — the canonical `lib/format.ts` formatter still used Tailwind palette classes (`text-green-500`, `bg-red-500`), defeating the design-tokens migration for every component that consumes `getChangeColor` / `getVerdictColor` / `getBadgeBgColor`.

**What:**

### Moveable-widgets architectural requirement saved to memory
- New `architecture_moveable_widgets.md` memory file. Captures the rule: every WidgetView must be drop-in placeable on any surface (Profile / Scanner / Sector pages, future drag-and-drop across surfaces), not only `/dashboard`.
- Six concrete sub-rules: no dashboard-specific imports, self-contained sizing, self-contained data fetching, no global event coupling, optional `instanceId` for multi-instance support, all branded loading/empty/error states.
- Outstanding work captured (WidgetFrame primitive, placement registry, cross-surface drag-and-drop) — separate ships.

### Motion / duration tokens
- New `client/src/lib/motion.ts` with six named duration tiers (INSTANT 0, FAST 120, BASE 200, SLOW 300, PAGE 500, DRAMATIC 1000) in ms, three standard easings (EASE_OUT punchy, EASE_IN_OUT default, EASE_LINEAR for spinners), and four chart-specific constants (CHART_CROSSHAIR_DURATION = INSTANT — any visible lag on a chart feels wrong).
- Tiebreaker documented: default to BASE; FAST for micro-feedback; SLOW only when motion crosses ~30% of viewport; DRAMATIC must be intentional.
- Inventory: 6× `duration-200`, 3× `transition-all duration-200`, 2× `duration-300`, single uses of 500/1000. Migration is incremental — new code uses the named tokens.

### `lib/format.ts` migrated to semantic tokens
- `getChangeColor`, `getScoreColor`, `getScoreBgColor`, `getVerdictColor`, `getIndicatorColor`, `getBadgeBgColor` all swapped from Tailwind palette (`text-green-500` etc.) to semantic tokens (`text-bull` / `text-bear` / `text-watch` and alpha variants). High-impact single-file fix — every component consuming these helpers now flows through the design-token system.
- Added a comment block at the top of the color helpers calling out the canonical-file rule.

### Branded loading / empty / error primitives
- New `client/src/components/BrandedLoader.tsx` — three size tiers (sm/md/lg) with optional message and fill mode. Replaces the per-page inline `<Loader2 ... />` block pattern.
- New `client/src/components/BrandedEmptyState.tsx` — icon OR image (e.g. otter mascot), title, optional description, optional CTA. Replaces bare `<p>No data</p>` patterns.
- New `client/src/components/BrandedError.tsx` — for in-page error states (not global ErrorBoundary). Title + friendly description + optional retry CTA. AlertTriangle in bear-tone.
- All three are self-contained, work in any container, and respect the universal-structure rule. Pages migrate progressively.

**Files touched:** new memory `architecture_moveable_widgets.md`, new `client/src/lib/motion.ts`, new `client/src/components/{BrandedLoader,BrandedEmptyState,BrandedError}.tsx`, `client/src/lib/format.ts` (palette → semantic), `MEMORY.md`, `CHANGES.md`.

---
## 2026-05-15 — Indicator constants finished + API endpoints module + z-index tokens + AppLayout cleanup

**Why:** Continuation of the universal-structure rollout. Diag files and conviction pipeline still passed hardcoded `14` / `20` / `9` / `21` / `50` to indicator helpers — those needed to come from the constants module so the TV-chart rollout reads the same periods everywhere. API endpoint strings were also scattered as raw literals across 50+ files (50 distinct paths). And z-index values + AppLayout's icon import block were cleanup debts.

**What:**

### Indicator constants migration finished (rogue #1 wrap-up)
- `server/diag/chart-data.ts`: 6 occurrences of literal `14` for ATR/RSI period → `ATR_PERIOD` / `RSI_PERIOD`.
- `server/diag/strategy-eval.ts`: full sweep — RSI/EMA/ATR/Bollinger/Volume periods all now constants.
- `server/diag/strategy-pnl.ts`: same full sweep.
- `server/diag/strategy-tft-pnl.ts`: same full sweep.
- `server/conviction/pipeline.ts`: RSI period + Bollinger period/stddev now constants.
- Strategy files (TFT/VER/AMC) use `atr14` / `rsi14` as variable names for externally-passed pre-computed series — the period itself lives in the diag layer that produces them, which is now centralized.

### API endpoints module (rogue #3)
- New `shared/api/endpoints.ts` exports every `/api/*` path used by the frontend as a named constant (50 distinct paths catalogued). Plus path-builder helpers (`analyzePath(ticker)`, `tradePath(id)`, etc.) for endpoints with route params.
- Documented organization: auth / account / dashboard / per-ticker analysis / scanners / market / dividends / trades / track-record / alerts / admin / diag. Each section maps to a feature area.
- Living catalog: future endpoints get added here first, every frontend caller imports the constant. Renames become one-edit operations.
- (Not migrated in this ship — the 50 endpoints are catalogued and ready; callers migrate progressively in follow-ups.)

### Z-index constants module
- New `client/src/lib/z-index.ts` with 8 named tiers (Z_BASE 1, Z_STICKY 10, Z_DROPDOWN 20, Z_OVERLAY 40, Z_HEADER 50, Z_MODAL 60, Z_TOAST 70, Z_TOOLTIP 100). Documented tiebreaker: "pick the lowest tier that solves the problem. If you reach for Z_TOOLTIP you're probably racing another stacking context — fix the parent."
- Existing usage inventory: 30× `z-50`, 10× `z-10`, 3× `z-40`, 3× `z-[60]`, 3× `z-20`, 2× `z-[70]`, 2× `z-[100]`. Migration is incremental — new code uses the named tokens.

### AppLayout import cleanup
- After the page-registry refactor, AppLayout no longer imports page-icons inline (the registry supplies them). The lucide import block dropped from 41 icons to 15 — kept only UI-chrome icons actually used in JSX (ChevronDown/Up, Search, X, Loader2, Eye, UserCircle, TrendingUp, Trash2, Shield, RefreshCw, Menu, LogOut, BookOpen, ClipboardList).
- 26 orphaned icon imports removed.

**Files touched:** new `shared/api/endpoints.ts`, new `client/src/lib/z-index.ts`, `server/diag/{chart-data,strategy-eval,strategy-pnl,strategy-tft-pnl}.ts`, `server/conviction/pipeline.ts`, `client/src/components/AppLayout.tsx`, `CHANGES.md`.

---
## 2026-05-15 — Universal structure rule + page registry + indicator constants module

**Why:** Chris established a new architectural rule: no new feature is built independently — every build plugs into compartments, widgets, registries, and shared token modules. The TradingView-style chart rollout is starting across every page, and the building blocks underneath (indicator periods, signal colors, page chrome, layout sizes) must come from one source or drift makes the rollout meaningless. Two concrete violations exposed this ship: (1) sidebar icons and page-header icons lived in two separate files and drifted; (2) RSI period 14, EMA 9/21/50/200, MACD 12/26/9, BB 20/2, ATR 14, Volume MA 20 were hardcoded in indicator files and strategy files. Same numbers, eight places.

**What:**

### Universal structure rule established
- New memory file `rule_universal_structure.md`. Rule text + tiebreaker order + list of the universal-structure infrastructure (design-tokens, layout-tokens, page-registry, compartments registry, etc.) so future-Claude knows where things plug in.
- `/verify-work` gains a "master rule" section at the top of project-rule checks — calls out the universal-structure rule explicitly and lists the specific violations it blocks (unregistered page, unregistered widget/strategy, hardcoded color/size/period, custom page chrome bypassing PageHeader, "just add it here" pattern).
- `/new-strategy` gains a "universal structure rule" section: every new strategy must register, must import indicator periods from `shared/indicators/constants.ts`, must reuse indicator helpers, must use existing chart components, must wire into registry-driven Strategy Chart toggles.

### Page registry — single source for page metadata
- New `client/src/lib/page-registry.ts` exports `PAGE_REGISTRY` — every page declared once with path, label, icon, group, optional subtitle, optional tier gate. Adding a page = one entry, no other edits.
- `PageHeader` component upgraded to auto-resolve icon + title + subtitle from the registry by matching the current route. Pages can still pass overrides (per-state titles in loading/error branches). Default form `<PageHeader />` with no props pulls everything from the registry.
- `AppLayout` sidebar nav now consumes `getNavGroups(tier)` from the registry — the inline 50-line nav array deleted. Sidebar icon ↔ page-header icon can no longer drift.

### Indicator constants module (rogue connection #1)
- New `shared/indicators/constants.ts` — the canonical periods + signal levels:
  - `RSI_PERIOD = 14`, `ATR_PERIOD = 14`, `ADX_PERIOD = 14`
  - `EMA_FAST = 9`, `EMA_MID = 21`, `EMA_SLOW = 50`, `EMA_TREND = 200` (+ tuple `EMA_PERIODS`)
  - `MACD_FAST = 12`, `MACD_SLOW = 26`, `MACD_SIGNAL = 9`
  - `BB_PERIOD = 20`, `BB_STDDEV = 2`
  - `VOLUME_MA_PERIOD = 20`, `SMA_TREND_PERIOD = 200`
  - `RSI_OVERBOUGHT = 70`, `RSI_OVERSOLD = 30`, `RSI_MIDLINE = 50`
  - `COMPACT_PANE_BAR_COUNT = 60`
- Lives in `shared/` so client (chart panes) and server (strategies, indicators) consume the same values. When the TV-chart rollout starts, every chart pane and every strategy reads RSI/EMA/MACD periods from one file.
- Indicator helpers migrated:
  - `server/indicators/rsi.ts` defaults to `RSI_PERIOD`
  - `server/indicators/macd.ts` defaults to `MACD_FAST/SLOW/SIGNAL`
  - `server/indicators/bollinger.ts` defaults to `BB_PERIOD/BB_STDDEV`
  - `server/indicators/volume.ts` defaults to `VOLUME_MA_PERIOD`
- BBTC strategy migrated: ADX period → `ADX_PERIOD`, RSI series period → `RSI_PERIOD`. Strategy-specific thresholds (BBTC's RSI ceiling 65, RSI floor short 35, ATR multipliers) stay strategy-internal — those are intentional strategy choices, not universal indicator settings.

### What remains (next ship)
- Strategy-specific constants in `tft.ts`, `ver.ts`, `amc.ts` still have hardcoded periods in some helpers — sweep the remaining files.
- Client-side chart components (CandlePane, IndicatorOscillator, etc.) currently get periods from API responses; once they compute locally, they'll consume the constants too.
- Some pages still pass explicit `icon=`, `title=`, `subtitle=` props to PageHeader. Those are harmless overrides — the registry is the source. Optional sweep to drop them for full visual consistency.

**Files touched:** new `client/src/lib/page-registry.ts`, new `shared/indicators/constants.ts`, new memory `rule_universal_structure.md`, `client/src/components/PageHeader.tsx` (route-auto-resolve), `client/src/components/AppLayout.tsx` (registry-driven nav), `server/indicators/{rsi,macd,bollinger,volume}.ts`, `server/signals/strategies/bbtc.ts`, `.claude/skills/verify-work/SKILL.md`, `.claude/skills/new-strategy/SKILL.md`, `MEMORY.md`, `CHANGES.md`.

---
## 2026-05-15 — Payoff Diagram icon: LineChart → Spline (more distinct from Strategy Chart)

**Why:** After de-duping Strategy Chart to `FlaskConical`, Payoff Diagram still used the generic `LineChart` icon. Chris said the two pages still looked the same. `LineChart` is too generic for a page that specifically shows option P/L curves; `Spline` (smooth curve) reads as "payoff curve" and is visually completely distinct from a flask.

**What:**
- `payoff-diagram.tsx` PageHeader icon: `LineChart as LineChartIcon` → `Spline`.
- `AppLayout.tsx` sidebar: `LineChart` → `Spline`. Removed orphaned `LineChart` import.

**Files touched:** `client/src/pages/payoff-diagram.tsx`, `client/src/components/AppLayout.tsx`, `CHANGES.md`.

---
## 2026-05-15 — Sidebar menu icons synced with new page icons

**Why:** Prior commit changed page-header icons but left the sidebar nav still pointing at the old icons. Trade Analysis, Confluence Chart, and Strategy Chart all showed `Activity` or `LineChart` in the sidebar even after their PageHeaders were swapped. The PageHeader's own docstring says "The icon should match the same page's sidebar icon" — they were out of sync.

**What:**
- `client/src/components/AppLayout.tsx` nav menu updated:
  - Trade Analysis sidebar icon: `Activity` → `Microscope`
  - Confluence Chart sidebar icon: `Activity` → `Layers`
  - Strategy Chart sidebar icon: `LineChart` → `FlaskConical`
  - Market Pulse and Payoff Diagram sidebar icons unchanged (intentional — Market Pulse kept per directive; Payoff kept `LineChart` since it's no longer a duplicate).
- Imports for `Layers`, `Microscope`, `FlaskConical` added to AppLayout.

**Files touched:** `client/src/components/AppLayout.tsx`, `CHANGES.md`.

---
## 2026-05-15 — Confluence Chart standardized + unique page icons

**Why:** Chris flagged the Confluence Chart page header was different from every other page on the site — branded sticky bar with the Stock Otter logo, "CONFLUENCE" wordmark, ticker chrome, and jump-out chips. Every other page uses the standard `<PageHeader icon=... title=... subtitle=... />` template (one line of chrome). Two-design-language problem. Also asked: pick a unique icon for Confluence and de-duplicate any other duplicate icons across pages, keeping Market Pulse unchanged.

**What:**

### Confluence Chart now uses the standard PageHeader template
- Removed the custom `ChartHeader` component (and deleted the orphaned `compartments/confluence-chart/ChartHeader.tsx` file).
- Removed the Stock Otter logo from the page header — every other page uses the icon-+-title format, this now matches.
- Removed the "CONFLUENCE" wordmark badge and the jump-out chips (Profile / MM Exposure / Scanner) — sidebar nav already has these.
- New page chrome: `<PageHeader icon={Layers} title="Confluence Chart" subtitle="Multi-signal verdict on a single chart — candles + EMAs + signal pulse + MACD/RSI all in one read." />`.
- Ticker context strip (ticker symbol + company name + spot price + day change) preserved BELOW the PageHeader as page-specific content, not chrome.
- Page wrapper switched from full-height flex layout to the standard `p-3 sm:p-4 md:p-6 max-w-[1400px] mx-auto` container used by every other page.

### Site-wide icon audit + de-duplication
Pulled the icon from every page's `<PageHeader>` and identified duplicates. Result:
- `LineChartIcon` was on both `/chart` (Strategy Chart) and `/payoff-diagram` → Strategy Chart now uses `FlaskConical` (it's the backtester); payoff diagram keeps `LineChartIcon`.
- `Activity` was on both `/market-pulse` and `/trade-analysis` → per Chris's directive, **Market Pulse keeps `Activity`** unchanged. Trade Analysis swapped to `Microscope` (close examination of a specific trade).
- Confluence Chart: NEW icon `Layers` (multiple signals stacked into one verdict). Unique across the site.

### Icon map after this ship (every page is unique)
alerts: Bell · chart (Strategy): FlaskConical · confluence-chart: **Layers** · conviction: Compass · dashboard: LayoutDashboard · dividend-portfolio: Landmark · dividends: DollarSign · earnings-calendar: Calendar · greeks-calculator: Sigma · help: BookOpen · home: BarChart3 · institutional: Building2 · kelly-calculator: Percent · market-pulse: Activity (kept) · mm-exposure: Crosshair · options-calculator: Calculator · payoff-diagram: LineChartIcon · scanner: Radar · sector-heatmap: Grid3X3 · track-record: Trophy · trade-analysis: Microscope · trade-analytics: PieChartIcon · trade-tracker: ClipboardList · verdict: Award · wheel: RefreshCw.

**PageHeader is now the enforced template** — every routed page uses `<PageHeader icon={...} title="..." subtitle="..." />` as its top element, no exceptions.

**Files touched:** `client/src/pages/confluence-chart.tsx`, deleted `client/src/compartments/confluence-chart/ChartHeader.tsx`, `client/src/pages/chart.tsx`, `client/src/pages/trade-analysis.tsx`, `CHANGES.md`.

---
## 2026-05-15 — Tailwind signal-palette sweep: ~608 palette classes → semantic tokens

**Why:** The earlier design-tokens ship covered hex codes and arbitrary font sizes, but ~608 places across 55 files still used Tailwind's built-in palette names (`text-green-400`, `bg-red-500/15`, `border-yellow-500/30`, etc.) for BUY/SELL/WATCH signal coloring. Visually identical to the new semantic tokens but breaks the single-source guarantee — a future tweak to bull/bear/watch hue would miss every one of those 608 places.

**What:**
- Bulk sed across all `client/src/**.tsx` files swaps Tailwind palette classes to semantic tokens:
  - `text-green-(300|400)` → `text-bull-light`, `text-green-*` → `text-bull`
  - `text-red-(300|400)` → `text-bear-light`, `text-red-*` → `text-bear`
  - `text-yellow-(300|400)` → `text-watch-light`, `text-yellow-*` → `text-watch`
  - Same for `bg-*`, `border-*`, `ring-*` (with alpha suffixes like `/15`, `/30` preserved).
- 55 files changed, 0 palette signal-color uses remaining.
- Token color values are intentionally identical to the prior Tailwind palette (bull=#22c55e=green-500, bear=#ef4444=red-500, watch=#eab308=yellow-500; bull-light=#4ade80=green-400, etc.) — pure compartmentalization, zero visual change.

**Findings surfaced during sweep (pre-existing bugs, not introduced by this work):**
- `client/src/pages/trade-tracker.tsx` has ~7 TypeScript errors — `closeDate`, `closePrice`, `setCloseDate`, `setClosePrice` referenced in `TradeForm` component but declared only inside a separate component below. These are runtime bugs (would throw on close-trade flow) but vite/esbuild ignores them; `tsc` flags them. Pre-existing on commit `29bc303`. Needs separate fix.
- Confluence Chart page (`/chart/confluence/:ticker`) is a stylistic outlier — branded header, sticky verdict strip, lightweight-charts candle pane, otter mascot empty state — while the rest of the site uses standard `PageHeader` + shadcn chrome. Compartmentalization principle says one design language across all pages. Either Confluence's premium chrome rolls out to the other pages, or Confluence gets standardized. Not in this ship.

---
## 2026-05-15 — `/verify-work` now runs `npm run build` (not just `tsc`)

**Why:** The design-tokens ship earlier today (commit `9234f94`) passed `tsc` but failed `npm run build` because tsc is permissive about JSX patterns that vite/esbuild rejects (e.g. bare-identifier attribute values like `stroke=TOKEN` vs `stroke={TOKEN}`). Production build broke, deploy reported `last_deploy.success: false`, site stayed on the prior SHA until commit `3c11e27` fixed it. The verify pass should have caught this locally.

**What:**
- `/verify-work` Section A now requires BOTH `npm run check` and `npm run build` to pass. They run in parallel to keep the audit fast.
- The 2026-05-15 incident is documented inline as the reason — future-Claude knows why both are mandatory.
- Hard-rules section updated: "Never skip the type check or the build."

**Files touched:** `.claude/skills/verify-work/SKILL.md`, `CHANGES.md`.

---
## 2026-05-15 — Design tokens fix: wrap bare token identifiers in JSX braces

**Why:** Initial design-tokens ship (commit `9234f94`) broke the deploy. The replace_all from `attribute="#hexvalue"` to `attribute=TOKEN_NAME` stripped the string quotes but did not add JSX expression braces, producing 40 invalid JSX attributes like `<Line stroke=SIGNAL_BULL>` where it should be `<Line stroke={SIGNAL_BULL}>`. `npm run check` (tsc) passed because TypeScript is permissive about JSX attribute syntax; `npm run build` (Vite/esbuild) caught the parse error. Production build failed, last_deploy.success was false, site stayed on the prior SHA.

**What:**

- Bulk sed across `client/src/**.tsx` rewrites `(stroke|fill|color)=TOKEN_NAME` → `(stroke|fill|color)={TOKEN_NAME}`.
- 8 files fixed: `chart.tsx`, `conviction.tsx`, `kelly-calculator.tsx`, `mm-exposure.tsx`, `payoff-diagram.tsx`, `trade-analysis.tsx`, `trade-analytics.tsx`, `wheel.tsx`.
- `npm run build` now passes cleanly — vite/esbuild reports `✓ built in 9.48s`.

**Verify-work follow-up:** the existing verify-work runs `npm run check` (tsc) but not `npm run build`. Adding `npm run build` to the verify pass would have caught this before ship. Add as a separate task.

---
## 2026-05-15 — Design system compartmentalized (colors, fonts, tile sizes)

**Why:** Chris asked whether the design elements were compartmentalized like the code. Audit found they were NOT — 188 hardcoded hex codes across 19 files (recurring brand greens, reds, indigo, navy bgs duplicated everywhere), 424 arbitrary `text-[Npx]` font sizes across 48 files, and raw `{ w, h }` literals scattered across 5 compartment manifests + the server default layout. Brand-color or palette changes would have required hunting through dozens of files. Confluence Chart's chart pane in particular had 9 hex codes baked into a single file. After Chris's "Confluence Chart Round 9" episode this was untenable.

**What:**

### Single source of truth — design tokens
- New `client/src/lib/design-tokens.ts` — every recurring color exported as a named TypeScript constant. Brand navy surfaces (BRAND_BG, BRAND_BG_ELEVATED, BRAND_BG_CARD, etc.), brand text tiers (BRIGHT / MUTED / FADED / DIM), semantic signals (SIGNAL_BULL / BEAR / WATCH / REDUCE / TREND_EXIT / SHORT_ADD with light variants), chart series (CHART_EMA_*, CHART_RSI, CHART_CROSSHAIR, CHART_WICK, etc.), brand accents (BRAND_ACCENT indigo + deep), miscellaneous utilities, and rgba overlays for translucent fills.
- Matching CSS variables added to `client/src/index.css` as space-separated RGB triplets so Tailwind's `rgb(var(--token) / <alpha-value>)` pattern unlocks alpha utilities (`bg-bull/10`, `text-brand-text-muted/60`).
- New Tailwind color tokens wired in `tailwind.config.js`: `brand-bg`, `brand-bg-elevated`, `brand-bg-card`, `brand-bg-card-alt`, `brand-surface-raised`, `brand-border`, `brand-border-strong`, `brand-border-subtle`, `brand-text-bright`, `brand-text-muted`, `brand-text-faded`, `brand-text-dim`, `brand-accent`, `brand-accent-deep`, plus semantic signals `bull`, `bear`, `watch`, `watch-short`, `reduce`, `trend-exit`, `short-add`, and light variants `bull-light` / `bear-light` / `watch-light`.

### Extended font-size scale
- Added `text-tiny` (8px), `text-mini` (9px), `text-micro` (10px), `text-2xs` (11px) to the Tailwind `fontSize` scale.
- All 424 arbitrary `text-[Npx]` uses across 48 files swept to the named tokens via bulk sed pass.

### Named tile sizes
- New `shared/dashboard/layout-tokens.ts` (in `shared/` so client + server import from the same place) exports `TILE_SM`, `TILE_MD`, `TILE_LG`, `TILE_FULL`, plus matching `TILE_MIN_*` minimum sizes.
- Client compartment manifests (`favorites`, `scanner`, `trades`, `confluence-chart`) now reference named slots instead of raw `{ w: 3, h: 4 }` objects.
- `server/dashboard/layout.ts` spread-imports the same slots so default-layout widget sizes never drift from manifests.
- `client/src/lib/layout-tokens.ts` re-exports from the shared module so client ergonomics stay the same.

### Sweep summary
- 188 hardcoded hex codes across 19 files → 0 in components, 100% migrated to imported constants or Tailwind color tokens.
- 424 arbitrary `text-[Npx]` values across 48 files → 0 remaining, all named.
- 10 raw `{ w, h }` literals across 4 compartment manifests + server layout → 0 remaining, all named tile slots.
- Allowed exceptions: `client/src/lib/design-tokens.ts` (canonical source), `client/src/index.css` (canonical CSS vars), `client/src/components/ui/chart.tsx` (shadcn Recharts attribute selectors `#ccc`/`#fff` — library override syntax, not app colors), `client/src/components/AppLayout.tsx` (`#add-trade` URL hash fragments, not colors).

### `/verify-work` skill upgraded — load-bearing enforcement
- Added three new BLOCKER rules: design-tokens rule (no new hex/rgb in components), font-size rule (no new `text-[Npx]`), tile-size rule (no new `{ w, h }` literals in manifests).
- Documented the allowed exception files explicitly so reviewers know what `#…` patterns are legitimate.
- Added a "Site-wide audit mode" section: when Chris asks for a full-site audit (vs the current diff), the skill expands scope and reports counts/offenders across the whole tree for compartment-rule adherence — hex leakage, font-size leakage, tile-size leakage, cache-layer bypasses, Yahoo/Polygon ghost code, strategy registry drift, compartments not registered, mixed signal-color palette.

### Existing color values preserved
- This was a pure compartmentalization move, not a rebrand. Every existing color value carries through verbatim — only the source has changed. Visual output is identical to the prior commit.

**Files touched (summary):** new `client/src/lib/design-tokens.ts`, new `client/src/lib/layout-tokens.ts`, new `shared/dashboard/layout-tokens.ts`, expanded `client/src/index.css` + `tailwind.config.js`, sweeps across ~30 client components/pages, 4 compartment manifests, `server/dashboard/layout.ts`, `.claude/skills/verify-work/SKILL.md`, `CHANGES.md`.

**Site-wide audit findings (not in this ship — surfaced for follow-up):**
- ~369 Yahoo references and ~224 Polygon references still in client/server code (both providers slated for kill per memory).
- ~608 Tailwind palette classes (`text-green-400` / `bg-red-500/15` / etc.) used for signal colors instead of the new semantic tokens (`text-bull` / `bg-bear/15`). Visually identical but breaks the "single source" guarantee — a future palette change won't reach them. Cleanup is a separate ship.

**Not in this ship:** `docs/FMP_REFERENCE.md` modifications and `docs/FMP_API_DOCS_RAW.md` — pre-existing in-progress work, separate from this design tokens migration.

---
## 2026-05-15 — `/interview` skill: front-load scope before any new feature

**Why:** Every non-trivial new feature historically started with assumptions that got unwound rounds later. Confluence Chart Round 9 was the high-profile example — built once as a 3-line widget Chris called "useless", rebuilt as a full page. An interview at the start would have caught the scope mismatch before any code was written.

**What:**

- New `/interview` skill at `.claude/skills/interview/SKILL.md`.
- Runs at the start of any new page / widget / strategy / endpoint / non-trivial refactor (skips trivial one-line fixes Chris has fully specified).
- Asks 3–4 plain-English questions in one `AskUserQuestion` batch (never multi-turn, never jargon): core problem, audience, success criteria, non-goals, foundation hook, reversibility.
- Every question includes an "I have a question first" option per `feedback_questions_in_choices`.
- After Chris answers, summarizes back in 5 lines (Building / For / Done when / Not doing / Foundation), waits for confirmation, then saves a `brief_<slug>.md` to project memory so `verify-work` and `ship` can later validate against it.
- Anti-patterns documented inline: no jargon quizzes, no multi-turn interviews, no skipping for "obvious" cases, no unobservable Success criteria, never skip the "I have a question first" escape.

**Files touched:** `.claude/skills/interview/SKILL.md`, `CHANGES.md`.

**Not in this ship:** `docs/FMP_REFERENCE.md` modifications and `docs/FMP_API_DOCS_RAW.md` — pre-existing in-progress work, separate from the skill change.

---
## 2026-05-15 — Ship skill: atomic main+tag push to eliminate deploy race

**Why:** First ship of the new skill suite (commit `5312791`) revealed a 60–90 second window where production reported the OLD git SHA on `/api/health` while marking `last_deploy.success: true`. Root cause: the ship flow pushed the `safe/<timestamp>` tag and `main` as two separate `git push` commands. GitHub fired two webhooks; the first deploy (triggered by the tag push) reset production to `origin/main` BEFORE main had been pushed, so it landed on the prior SHA. The second deploy a moment later caught up, but production briefly ran the wrong code.

**What:**

- `/ship` skill now creates the tag locally only — no `git push origin --tags`.
- `/ship` pushes both refs atomically in one command: `git push origin main "$SAFE_TAG"`.
- One push event = one webhook = one deploy → production resets straight to the new SHA. No race window.
- Added the 2026-05-15 observation inline so the rule's *why* is captured next to the rule itself.
- Added to the skill's hard-rules list: **never push main and the safe tag as two separate commands.**
- Considered `--follow-tags` instead — rejected because it ignores lightweight tags (and our `safe/` tags are lightweight). Documented as an alternative only for annotated-tag setups.

**Files touched:** `.claude/skills/ship/SKILL.md`, `CHANGES.md`.

**Not in this ship:** `docs/FMP_REFERENCE.md` modifications and `docs/FMP_API_DOCS_RAW.md` — still pre-existing in-progress work, separate from the skill change.

---
## 2026-05-15 — Claude Code skill suite + `.claude/` hygiene

**Why:** Chris asked what Claude skills would pay back fastest for stockotter. The repeatable workflows (ship, log changes, look up FMP endpoints, run P&L on a strategy, scaffold a new strategy, audit before ship) were being re-derived from memory every session. Encoding them as `/skill` commands makes the rules executable, not just documented.

**What:**

### Six project-level skills under `.claude/skills/`
- **`/ship`** — Chris's deploy flow: `safe/<timestamp>` tag, CHANGES.md check, explicit-file commit, push to `origin/main`, webhook reload. Hard rules: never `-A`, never `--no-verify`, never `--amend` after push.
- **`/changes-entry`** — drafts the CHANGES.md entry for the current diff in the existing house style. One entry per completed change, not per commit. Prepends rather than appends.
- **`/fmp-endpoint`** — given a data need, finds the canonical FMP endpoint + exact field name (reads `docs/FMP_REFERENCE.md` first, falls back to the raw docs), returns a copy-paste TS snippet. Stops the recurring field-name-guessing problem.
- **`/strategy-pnl`** — runs `/api/diag/strategy-pnl` or `/api/diag/strategy-tft-pnl` against the 10y basket, reports per-trade dollar P&L, win rate, R-multiple, max DD per-ticker and aggregated. Enforces the "positive $ P&L before re-enable" gate for the demoted short side and VER_WATCH_SELL.
- **`/new-strategy`** — scaffolds a strategy under `server/signals/strategies/`, wires it into the registry, adds a P&L harness pass. Foundation-first: pure compute, registry-driven toggle, additive schema.
- **`/verify-work`** — pre-flight audit before ship. Refreshes the diff vs `origin/main` (never trusts a stale baseline), runs `npm run check`, scans for new Yahoo/Polygon refs, hard-coded ticker lists, missing cache layers, missing CHANGES entry, unbranded UI states. Reports verdict as READY / NOT READY / READY WITH NOTES. Never auto-fixes — surfaces findings, Chris decides.

### `.gitignore` hardening
- Added `.claude/settings.local.json` and `.claude/scheduled_tasks.lock` to keep machine-local Claude state out of the repo. The skills directory and the shared `.claude/settings.json` remain committable so the automation travels with the project.

**Files touched:** `.claude/settings.json`, `.claude/skills/{ship,changes-entry,fmp-endpoint,strategy-pnl,new-strategy,verify-work}/SKILL.md`, `.gitignore`, `CHANGES.md`.

**Not in this ship:** `docs/FMP_REFERENCE.md` modifications and `docs/FMP_API_DOCS_RAW.md` (new) — pre-existing in-progress work, separate from the skills.

---
## 2026-05-15 — Round 9: Confluence Chart full-page rebuild (Stock Otter branded, candles, multi-pane)

**Why:** The Round 8 Confluence Chart widget was three lines on black — Chris's reaction: *"Your chart is useless. I have this chart in 2 other places... I need it to look and perform PROFESSIONALLY, not like a 14yo wrote it in his moms basement."* Rebuilt as a full-page chart that surfaces Stockotter's actual tools, with candles, and brand identity.

**What:**

### Candles via TradingView Lightweight Charts
- Added `lightweight-charts` dependency (~45KB gzipped, MIT, canvas-based, designed for OHLC).
- New `CandlePane` component wrapping the library — brand-tuned candle colors, indigo crosshair, EMA21/50/200 overlays as toggle buttons, volume histogram in the lower portion of the pane, otter watermark in the corner.

### Full-page route `/chart/confluence/:ticker?`
- New `client/src/pages/confluence-chart.tsx` composing branded header + candle pane + Signal Pulse pane (drop-in existing component) + MACD/RSI pane (drop-in existing component) + Confluence Dashboard panel + sticky verdict strip.
- Empty state with the otter mascot, friendly copy, ticker search + featured-ticker chips.
- URL ticker syncs with `TickerContext.activeTicker` bus — click any ticker anywhere on the site, navigate to /chart/confluence, it follows.
- Sticky branded header with Stock Otter logo, ticker info stack, timeframe segmented control, quick-jump chips to Profile / MM Exposure / Scanner.

### Confluence Dashboard panel (computed client-side, no new endpoint for v1)
- Rows: RSI(14), MACD Hist, EMA Stack, Price vs 200d, Vol vs 20d, 20-day Break, 60-day Break, Gate Verdict, Gate Score.
- Each row: label + current value + BULL/BEAR/NEUTRAL badge.
- Bias summary line: "X bull · Y bear · N total — **LONG/SHORT BIAS Z%**". Direct lift from the TradingView Advanced Confluence Dashboard reference cited in the plan.

### Sticky verdict strip
- Big color-coded verdict pill (GO ↑ / SET ↑ / READY ↑ / PULLBACK / CLOSED / NO SETUP).
- Plain-English label next to it (STRONG BUY / GOOD BUY / MODERATE BUY / WAIT / AVOID).
- Gate count, last-updated timestamp (live, ticks every second).

### Dashboard widget replaced with a Teaser tile
- The useless 3-line widget is deleted (`ConfluenceChartWidget.tsx` removed). The compartment manifest now exposes `ConfluenceTeaser` as the WidgetView — a small tile showing ticker / spot / day change / verdict pill + "Open full chart →" CTA that navigates to the full page.
- Default size in the server layout dropped from 6×6 to 3×4 (matches the other widgets).
- Existing users' saved layouts keep the same `compartment-id` slot; the new teaser renders in place.

### Files
- New: `client/src/pages/confluence-chart.tsx`, `client/src/compartments/confluence-chart/{CandlePane,ChartHeader,ConfluenceDashboardPanel,VerdictStrip,EmptyState,ConfluenceTeaser}.tsx`
- Modified: `client/src/compartments/confluence-chart/{index.ts,useConfluenceChart.ts}`, `client/src/App.tsx`, `client/src/components/AppLayout.tsx`, `server/dashboard/layout.ts`, `CHANGES.md`, `package.json`, `package-lock.json`
- Deleted: `client/src/compartments/confluence-chart/ConfluenceChartWidget.tsx`

### Deferred to v2 (per the approved plan, separate round)
- Scanner-signal markers on the candle pane (need an endpoint extension to expose per-bar signal firings)
- Backtester trade entry/exit triangles
- MM Exposure horizontal price lines (gamma flip, max pain, call/put walls)
- Gate-history sub-pane (needs new `/api/scanner-v2/gates-history` endpoint)
- Scanner-v2 per-signal breakdown (extending `/api/scanner-v2/quick`)

---
## 2026-05-15 — Phase 1B Round 8: Confluence Chart compartment + per-widget config + auto-discovery of new compartments

**Why:** First user-visible artifact of the per-widget `config` JSONB field designed into the schema in Round 7. Adds a "Confluence Chart" widget that follows the currently selected ticker (Watchlist / Best Opps / My Trades clicks all flow through `TickerContext.activeTicker`) and shows price + EMA overlays + a verdict pill. Inspired by a TradeStation multi-pane chart Chris shared; ships the compact-widget version (Option A from `docs/DASHBOARD_PLAN.md` Round 8a).

**What:**

### New compartment: `confluence-chart` (client-only, no server changes)
- `client/src/compartments/confluence-chart/useConfluenceChart.ts` — canonical hook composing two existing canonical endpoints: `/api/analyze/:ticker` (for `chartData` with close + EMA9/21/50/SMA200) and `/api/scanner-v2/quick/:ticker` (verdict + gate score). Both refresh every 5 min while visible.
- `client/src/compartments/confluence-chart/ConfluenceChartWidget.tsx` — the widget. Recharts `LineChart` with close + EMA21 + EMA50 overlays. Verdict pill (color-coded by GO/SET/READY/PULLBACK/CLOSED) + gate score (X/3) in a compact signal pane. Per-widget timeframe via a dropdown — persisted in `widget.config.timeframe`. Default `3M`. "Click any ticker" empty state when `activeTicker` is null. Click on body → `setActiveTicker` + `wouter` navigate to `/profile` for the full Trade Analysis view.
- `client/src/compartments/confluence-chart/index.ts` — manifest. `widgetDefaultSize: { w: 6, h: 6 }` (a row taller and wider than the other widgets so the chart reads).
- `client/src/compartments/registry.ts` — one new import + array entry.

### Per-widget config plumbing (`WidgetView` now accepts props)
- `client/src/compartments/types.ts` — `ClientCompartmentEntry.WidgetView` is now `ComponentType<WidgetViewProps>`. `WidgetViewProps = { config?: Record<string, unknown>; onConfigChange?: (next) => void }`. Both optional — existing prop-less widgets (Watchlist, Best Opps, My Trades) continue to work without changes.
- `client/src/pages/dashboard.tsx` — passes `config` + `onConfigChange` to each `<WidgetView />`. New `updateWidgetConfig(compartmentId, next)` helper updates the local layout state and persists via the existing PATCH endpoint. First real use of the `WidgetSpec.config` field designed into `shared/dashboard/types.ts` in Round 7.

### Auto-discovery of new compartments
- `client/src/pages/dashboard.tsx` — when computing the header chip strip, also shows registry compartments that aren't in the current tab at all (not just hidden ones). New chips use `bg-primary/20` so users can distinguish "Add (new)" from "Restore (hidden)". `addWidget(compartmentId)` appends with `visible: true` at `y: 999`; the grid's vertical compactor packs it into the first available row.
- Solves the otherwise-blocking UX problem: shipping a new compartment to existing users (Chris in particular) who already have a saved layout. They didn't have a way to add the new widget without resetting their layout. Now they get an "Add Confluence Chart" chip in the header.

### Default layout
- `server/dashboard/layout.ts` — confluence-chart added to the v1 default layout. New members see all four widgets on first visit.

### Deviations from the locked Round 8 plan (documented honestly)
- **Signal pane shows verdict + gate score, NOT "top 5 firing signals."** The locked plan assumed `/api/scanner-v2/quick/:ticker` returned per-signal data; verified it only returns `{ ticker, score, verdict }`. Per-signal breakdown requires extending the endpoint (small server change, deferred to a follow-up round). Gate score is Stockotter's native "one voice for signals" output (per MASTER_PATHWAY Principle #3), so the v1 widget is still aligned with site convention — just less granular than the screenshot inspiration.
- **Close-price line chart, NOT candlesticks.** Recharts has no native candlestick component. At compact widget size (~6 cols wide) candles wouldn't read anyway. Matches the existing Strategy Chart page style.

**Files:** `client/src/compartments/types.ts`, `client/src/compartments/registry.ts`, `client/src/compartments/confluence-chart/index.ts`, `client/src/compartments/confluence-chart/useConfluenceChart.ts`, `client/src/compartments/confluence-chart/ConfluenceChartWidget.tsx`, `client/src/pages/dashboard.tsx`, `server/dashboard/layout.ts`, `CHANGES.md`.

**Branch:** `round8-confluence-chart` (off main). Auto-deploys on merge via the hardened webhook from PR #82.

---
## 2026-05-14 — Phase 1B Round 7: /dashboard route + per-user customizable widget host

**Why:** The compartment foundation (Rounds 4–6) was infrastructure invisible to members. Round 7 ships the first user-visible piece: a personalizable dashboard at `/dashboard` that mounts the three v1 widgets (Watchlist, Best Opps, My Trades). Members can drag widgets to reorder and hide individual widgets; the layout auto-saves and survives across sessions.

**⚠️ Deploy step required:** Before this round goes live, run `npm run db:push` on the server to create the new `dashboard_layouts` table. The route is defensive (returns a default layout if the table is missing) so the page still renders if you forget — saves will fail until the table exists.

**What:**

### Schema + persistence
- `shared/schema.ts` — new `dashboardLayouts` table: `id`, `userId` (FK to users, UNIQUE so it's one row per user), `data` (JSONB), `updatedAt`. Insert schema + types exported.
- `shared/dashboard/types.ts` — typed shape of the JSONB blob: `DashboardLayout` → `TabSpec[]` → `WidgetSpec[]` with `compartmentId`, `visible`, and `{x, y, w, h}` for grid placement. Versioned (`version: 1`) and additive-forward.
- `server/storage.ts` — `getDashboardLayout(userId)` + `saveDashboardLayout(userId, data)` (Drizzle `onConflictDoUpdate` upsert on the unique `userId`).

### Server route
- `server/dashboard/layout.ts` — `buildDefaultDashboardLayout()` returns one "Overview" tab with all three v1 widgets visible (Watchlist 3w×4h, Best Opps 3w×4h, My Trades 4w×4h).
- `server/dashboard/routes.ts` — `GET /api/dashboard/layout` returns the saved layout or the computed default (never 404s). `PATCH /api/dashboard/layout` upserts. Both require `req.user`.
- Wired in via `registerDashboardRoutes(app)` alongside `mountAllCompartmentRoutes`.

### Client page
- Added deps: `react-grid-layout`, `@types/react-grid-layout`.
- `client/src/lib/dashboard/useDashboardLayout.ts` — canonical hook. `useQuery` for load, `useMutation` (PATCH) for save. `setQueryData` on success keeps the cache in sync.
- `client/src/pages/dashboard.tsx` — the page. Wraps `react-grid-layout` (`WidthProvider`-ed for auto-width, 12 columns, 60px rows, vertical compact, drag-but-not-resize). Hide button (X) overlays each widget's top-right; hidden widgets surface as restore chips in the page header. Layout auto-saves on every change with a no-op skip when the diff is empty so the initial render doesn't fire a redundant PATCH. CSS imports for `react-grid-layout/css/styles.css` + `react-resizable/css/styles.css`.
- `client/src/App.tsx` — registered `/dashboard` route (auth-gated by the existing `AuthenticatedApp` wrapper; non-members never reach it).
- `client/src/components/AppLayout.tsx` — added "Dashboard" as the first nav item under "Trade Tracker" with the `LayoutDashboard` icon.

### Behavior changes for users
- **New:** `/dashboard` page exists. First visit shows the default layout. Drag-and-drop reorders. X hides; "X hidden — <name>" chips above the grid restore.
- Existing pages: unchanged.

**Files:** `shared/dashboard/types.ts`, `shared/schema.ts`, `server/storage.ts`, `server/dashboard/layout.ts`, `server/dashboard/routes.ts`, `server/routes.ts`, `client/src/lib/dashboard/useDashboardLayout.ts`, `client/src/pages/dashboard.tsx`, `client/src/App.tsx`, `client/src/components/AppLayout.tsx`, `CHANGES.md`, `package.json`, `package-lock.json`.

**Branch:** `round7-dashboard-route` (off main). After merge, run `npm run db:push` on the server. Multi-tab CRUD UI + widget resize + per-widget config are explicit follow-up rounds.

---
## 2026-05-14 — Phase 1B Round 6: Trade Tracker compartment + shared/pnl/ module + My Trades widget

**Why:** Third compartment in the Phase 1B sequence and the largest of the v1 trio (L effort per the audit). Locks Q-C3: trade P/L math moves to a shared pure-function module (`shared/pnl/`) imported by both the server `/api/trades/summary` route and the new client compartment. Previously the same formulas lived in two places (server `routes.ts:5874+` and client `trade-tracker.tsx:171+`) — drift waiting to happen.

**What:**

### Shared P/L module (Q-C3 lock-in)
- `shared/pnl/index.ts` — pure functions, no React, no Express, no fetches. Imported by both sides.
  - `computeClosedTradeProfit(trade)` — realized P/L on a closed trade
  - `computeOpenStockPL(trade)` — unrealized P/L on an open stock (long or short)
  - `computeOpenOptionPL(trade)` — strike-based option P/L estimation (covers credit spreads, debit spreads, naked calls/puts, butterflies/CTVs)
  - `computeOpenPL(trade)` — dispatches by tradeCategory
  - `aggregateOpenPositions(trades)` — groups open trades by `(symbol, type, strikes, expiration)` into `OpenPosition[]`
- Verbatim port of existing server formulas + client option logic — bit-identical behavior, just relocated.

### Server route migration
- `server/routes.ts` `/api/trades/summary` — replaced inline closed-trade profit calc (was lines 5874-5880) with `computeClosedTradeProfit`. Replaced inline open stock P/L loop (was 5925-5934) with `computeOpenStockPL`. **No behavior change** — same formulas, same numbers, just one source of truth now.

### Trade Tracker compartment (server)
- `server/compartments/trades/index.ts` — manifest + `tradesData.list(userId)` / `tradesData.get(userId, id)` accessors wrapping `storage.getAllTrades` / `storage.getTrade`. Routes stay in legacy `server/routes.ts:5783-6180` for now; future round moves them behind `mountRoutes`.

### Trade Tracker compartment (client)
- `client/src/compartments/trades/useTrades.ts` — canonical hooks `useTrades()` + `useTradesSummary()`. Query keys match `["/api/trades"]` and `["/api/trades/summary"]` already used by `trade-tracker.tsx`, so mutations on the existing page automatically invalidate widget caches.
- `client/src/compartments/trades/MyTradesWidget.tsx` — compact dashboard widget. Two-tile summary (realized P/L + win rate, open positions + unrealized P/L) plus recent-closed list. Clicking a row publishes the ticker to `TickerContext.activeTicker`. Per-trade rendering uses `computeClosedTradeProfit` from `shared/pnl/`.
- `client/src/compartments/trades/index.ts` — manifest + exports.

### Registries
- `server/compartments/registry.ts` — added `tradesCompartment`.
- `client/src/compartments/registry.ts` — added `tradesCompartment`.

**What did NOT change:** `client/src/pages/trade-tracker.tsx` keeps its own client-side `computeStockPL` / `computeOptionPL` / `aggregateOpenPositions` (lines 115-297). Migration of the full page to `shared/pnl/` + `useTrades` is a follow-up task that also retires those duplicated functions. The widget shows numbers that match `/api/trades/summary` (canonical); the existing page's per-row table P/L is computed client-side as before.

**Files:** `shared/pnl/index.ts`, `server/routes.ts`, `server/compartments/trades/index.ts`, `server/compartments/registry.ts`, `client/src/compartments/trades/index.ts`, `client/src/compartments/trades/useTrades.ts`, `client/src/compartments/trades/MyTradesWidget.tsx`, `client/src/compartments/registry.ts`, `CHANGES.md`.

**Branch:** `round6-trade-tracker` (off main). Not merged. Merge to main on Chris's approval. With this round, all three v1 dashboard compartments (Favorites, Scanner v2, Trade Tracker) ship as the foundation for the dashboard route + widget host.

---
## 2026-05-14 — Phase 1B Round 5: Scanner v2 compartment + Best Opps widget + persisted TanStack Query cache

**Why:** Second compartment in the Phase 1B sequence (per `docs/DASHBOARD_PLAN.md` refactor order). Establishes the canonical hook for scanner v2 data — pages, dashboard widgets, alerts all import from one place — and replaces the legacy ad-hoc sessionStorage code in `scanner.tsx` at the queryClient layer rather than per-page. Locked Q-C1 decision: persisted TanStack Query cache.

**What:**

### Persisted TanStack Query cache (Q-C1)
- Added `@tanstack/query-sync-storage-persister` and `@tanstack/react-query-persist-client` dependencies.
- `client/src/lib/queryClient.ts` — exports a sessionStorage-backed `queryPersister` (key `stockotter:rq-cache`).
- `client/src/App.tsx` — swapped `QueryClientProvider` for `PersistQueryClientProvider`. A `dehydrateOptions.shouldDehydrateQuery` filter persists ONLY query keys starting with `/api/scanner` so sessionStorage doesn't bloat with every API response. Same UX as legacy code (scan results survive page reload, gone on tab close), but the persistence logic lives at the queryClient layer instead of bespoke in `scanner.tsx`.

### Scanner v2 compartment (server)
- `server/compartments/scanner/index.ts` — manifest + `scannerData` canonical accessor wrapping `runScannerV2` from `server/scanner-v2.ts`. Routes (`/api/scanner/v2` at `server/routes.ts:4006`) stay in legacy code during strangler migration.
- Removed redundant `server/compartments/scanner/.keep` (placeholder no longer needed).

### Scanner v2 compartment (client)
- `client/src/compartments/scanner/useScannerV2.ts` — canonical hook. `enabled` defaults to `false` so idle widgets don't auto-fire FMP scans on every dashboard mount; consumers call with `{ enabled: true }` or wire a button.
- `client/src/compartments/scanner/BestOppsWidget.tsx` — compact dashboard widget. Opt-in "Run scan" CTA on first load; once a scan runs, results render and persist to sessionStorage for cross-reload survival within the tab. Refresh button on the header. Clicking a row publishes the ticker to `TickerContext.activeTicker` (the shared bus).
- `client/src/compartments/scanner/index.ts` — manifest + exports.

### Registries
- `server/compartments/registry.ts` — added `scannerCompartment`.
- `client/src/compartments/registry.ts` — added `scannerCompartment`.

**What did NOT change:** `client/src/pages/scanner.tsx` keeps its existing sessionStorage code. Migration of the full Scanner page to `useScannerV2` is a follow-up task — not a Round 5 deliverable. The compartment provides the canonical hook so future widgets and alert rules can use it immediately.

**Files:** `package.json`, `package-lock.json`, `client/src/lib/queryClient.ts`, `client/src/App.tsx`, `client/src/compartments/scanner/index.ts`, `client/src/compartments/scanner/useScannerV2.ts`, `client/src/compartments/scanner/BestOppsWidget.tsx`, `client/src/compartments/registry.ts`, `server/compartments/scanner/index.ts`, `server/compartments/registry.ts`, `CHANGES.md`, and removed `server/compartments/scanner/.keep`.

**Branch:** `round5-scanner-v2` (off main). Not merged. Merge to main on Chris's approval.

---
## 2026-05-14 — Phase 1B kickoff: compartment scaffold + Favorites template compartment

**Why:** Multi-round dashboard planning (`docs/DASHBOARD_PLAN.md`) crystallized into a site-wide architecture rule (`docs/MASTER_PATHWAY.md` Principle #6 + Phase 1B): every feature is a self-contained compartment with one canonical data accessor, pure logic, two presentation modes, and a registry entry. Otherwise every future dashboard widget becomes bespoke code. Round 4 ships the scaffold + Favorites as the worked-example template; no behavior changes to current pages.

**What:**

### Scaffold
- Renamed `server/features/` → `server/compartments/` (10 paths, mostly stubs; rename detected by git). Updated TypeScript alias `@features/*` → `@compartments/*` in `tsconfig.json` and the one import in `server/api/routes/search.ts`.
- New directories: `shared/compartments/`, `client/src/compartments/`.
- `shared/compartments/types.ts` — universal `CompartmentMeta` type (id, name, tier, fullPageRoute, description). Import-safe from both server and client.
- `server/compartments/types.ts` — `ServerCompartmentEntry` (meta + optional `mountRoutes(app)`).
- `client/src/compartments/types.ts` — `ClientCompartmentEntry` (meta + optional `FullView`, `WidgetView`, `widgetDefaultSize`, `widgetMinSize`). Widget block is optional — compartments without a dashboard widget yet register without one (progressive contract).

### Favorites compartment (template)
- `server/compartments/favorites/index.ts` — manifest + `favoritesData` canonical accessor wrapping `storage.getFavorites` / `addFavorite` / `removeFavorite` / `getFavorite` / `updateFavoriteScore`. Existing `/api/favorites/*` routes in `server/routes.ts:2984-3034` stay put during strangler migration.
- `client/src/compartments/favorites/useFavorites.ts` — canonical TanStack Query hook reading `/api/favorites/:listType`.
- `client/src/compartments/favorites/WatchlistWidget.tsx` — compact dashboard widget rendering `useFavorites("watchlist")`. Clicking a row publishes to `TickerContext.activeTicker` (the existing shared bus); no direct prop coupling to other widgets.
- `client/src/compartments/favorites/index.ts` — manifest with `WidgetView: WatchlistWidget`, `widgetDefaultSize: { w: 3, h: 4 }`.

### Registries
- `server/compartments/registry.ts` — `listServerCompartments()`, `getServerCompartment(id)`, `mountAllCompartmentRoutes(app)`.
- `client/src/compartments/registry.ts` — `listClientCompartments()`, `getClientCompartment(id)`, `listWidgetCompartments()`.
- Wired `mountAllCompartmentRoutes(app)` into `server/routes.ts:1539` (next to existing `registerSearchRoutes`). Favorites has no `mountRoutes` yet (routes stay in legacy `routes.ts`), so this is currently a no-op but exercises the registry import chain.

**Files:** `tsconfig.json`, `CHANGES.md`, `shared/compartments/types.ts`, `server/compartments/types.ts`, `server/compartments/favorites/index.ts`, `server/compartments/registry.ts`, `client/src/compartments/types.ts`, `client/src/compartments/favorites/index.ts`, `client/src/compartments/favorites/useFavorites.ts`, `client/src/compartments/favorites/WatchlistWidget.tsx`, `client/src/compartments/registry.ts`, `server/routes.ts`, `server/api/routes/search.ts`, plus 10 git renames under `server/features/` → `server/compartments/`.

**Branch:** `round4-favorites` (off main). Not merged. Merge to main on Chris's approval. See `docs/DASHBOARD_PLAN.md` Round log for context.

---
## 2026-05-12 — Settings cash field is now a live override (re-anchor any time)

**Why:** After yesterday's cash auto-derive change, Chris reported the page showed -$3,800 cash and $1,900 portfolio, and "the Settings cash won't let me adjust it." Settings *was* saving — but the field was the hidden anchor, so any value he typed got buried underneath all the trade flows. Page kept showing the derived (negative) cash and looked broken.

**What:** Settings now treats the Brokerage Cash field as the **live current cash**. The server reverse-computes the anchor on save, so the value the user types is what they immediately see on the page.

### `server/routes.ts`

- New helper `computeCashFromActivity(userId)` — sums account_transactions + signed trade opens + signed trade closes − commissions. Single source of truth for the cash flow side of the equation.
- `GET /api/account/settings` — returns `cashBalance = anchor + cashFromActivity` (live), so the Settings UI shows the same number the page shows.
- `PATCH /api/account/settings` — when `cashBalance` is in the body, treats it as live cash and stores `anchor = entered − cashFromActivity`. User types $5,000, system stores whatever anchor makes the live number $5,000 right now. Trades from then on adjust it automatically.
- `/api/trades/summary` continues to call the same helper (keeps cash math consistent across endpoints).

### `client/src/pages/trade-tracker.tsx`

- Settings label updated: "Brokerage Cash ($) — set this to whatever your broker shows right now."
- Help block updated to tell the user: if cash drifts from broker, open Settings and re-type — the system re-anchors.

**Files:** `server/routes.ts`, `client/src/pages/trade-tracker.tsx`

---
## 2026-05-11 — Current Positions: cash auto-derives from trade ledger; Account Value card removed

**Why:** Chris reported that the Brokerage Cash figure on Current Positions never followed his trades — every time he opened or closed a position he had to retype it in Settings. Total Portfolio was therefore always wrong unless he kept cash in sync manually. He also wanted the redundant "Account Value" card gone (Total Portfolio is the only number that matters) and the "Starting Account Value" Settings field gone (cash is the only anchor).

**What:**

### Backend (`server/routes.ts` — `/api/trades/summary`)

- `cashBalance` is now **derived from the trade ledger**, not read from settings as a static value:
  ```
  cash = settings.cashBalance              ← starting-cash anchor (Settings field)
       + sum(account_transactions.amount)  ← deposits/withdrawals
       + sum(allTrades:    openPrice·qty·mult − commIn)   ← cash flow at every open
       + sum(closedTrades: closePrice·qty·mult − commOut) ← cash flow at every close
  ```
  Works for longs, shorts, debits, and credits without special cases because `openPrice` / `closePrice` are stored signed by cash-flow direction (same convention the existing `totalProfit` calc uses).
- `totalPortfolioValue = cashBalance + openPositionMarketValue` — by construction this equals `startingCash + txTotal + realized P/L + unrealized P/L`.
- Dropped `accountValue` from the response (no longer used by any UI).
- `allocatedPct` now divides by `totalPortfolioValue` instead of the old `accountValue`.
- Equity curve baseline switched from `settings.startingAccountValue` to `startingCash`.

### Frontend (`client/src/pages/trade-tracker.tsx`)

- Removed the **Account Value** stat card. Bottom row regridded 6→5 cols.
- Settings: removed the **Starting Account Value** input. The remaining **Brokerage Cash** field is relabeled as the starting-cash anchor — Chris sets it once to his initial deposit, and trades adjust the live cash automatically from there.
- Updated Help block to match (Total Portfolio / Brokerage Cash / Open Positions descriptions).
- Dropped `accountValue` from the `Summary` interface.

**Schema:** `account_settings.starting_account_value` column is left in place — no migration. The server now falls back to it only if `cashBalance` is unset on a legacy account.

**Files:** `server/routes.ts`, `client/src/pages/trade-tracker.tsx`

---
## 2026-05-10 — Strategy Chart fixes: Scatter dots, hover tooltips, sortable trades, removed misleading badge

**Why:** Chris tested the v1 chart page and flagged five issues:
1. "One of the dots are not defined" — some signal dots silently failing to render on the chart
2. "On the hover you could put the trade reference number" — no tooltip on hover
3. "I don't like the 5.28M basket on the button, that implies too much" — replaced misleading badge
4. "the dates need to be able to sort by entry or exit. But the trade number has to be by when you enter the trade not when you exit" — trade list needed sortable columns with stable trade numbering
5. "You have CORE trades on one chart and not the other... but it mysteriously shows up on the 1y. Where did that trade go?" — likely caused by issue #1 (dot rendering)

**What:**

### Backend (`server/diag/chart-data.ts`)

- Added `tradeNumber` field to both `ChartTrade` (required, stable) and `ChartSignalDot` (nullable — info-only signals don't pair to a trade).
- New normalize step in `getChartData` after the strategy adapter runs: sorts trades by `entryDate`, assigns `tradeNumber = 1..N`. CORE trades on TFT enter first by definition so they always get the lowest numbers (CORE = #1).
- Tags ENTRY and EXIT signals with the matching trade's number by date+layer+side lookup. Backend now ships `tradeNumber` on every dot.

### Frontend (`client/src/pages/chart.tsx`)

- **Replaced `ReferenceDot` with `Scatter` overlays** for signal dots. ReferenceDot on a categorical X axis with thousands of bars (5Y/10Y window) silently drops dots that don't fall on rendered ticks — that's the "missing dots" / "mysterious CORE" complaint. `Scatter` renders one point per data row regardless of axis density, AND supports hover tooltips out of the box.
- **One Scatter per dot category** (`core_entry`, `tactical_entry`, `long_entry`, `exit_win`, `exit_loss`, `exit_clean`, `watch`, `info`). Each gets its own consistent color and a custom shape function so highlighted dots can render larger (r=7 vs r=4) with thicker strokes.
- **Custom `ChartTooltip` component** distinguishes line hover from dot hover. Dot hover shows: date, signal label (e.g. "TFT CORE LONG", "BBTC_BUY"), **trade number** (e.g. "Trade #5"), price.
- **Removed the "$5.28M basket" badge** from the TFT Catastrophic button. Replaced with a methodology block below the strategy/timeframe row: *"Backtest methodology: All five strategies were backtested over 10 years (2015–2026) on an 80-ticker basket spanning all 11 sectors plus SPY/QQQ/DIA/IWM benchmarks. Results vary widely by ticker — this page shows you exactly how each strategy traded the active ticker, not basket averages. Past results don't guarantee future performance."* Per Chris: the basket is OUR test methodology, not a user-facing guarantee.
- **Sortable trade list columns**: # / Entry / Exit / Return / P/L $. Click a column header to sort by it; click again to flip direction. The `#` column is the **stable** trade number (set server-side by entry date) — it does NOT change when you re-sort. Default sort: `tradeNumber asc` so CORE trades always appear at the top in TFT modes.
- **Highlight by trade number**, not row index. Click a row → its entry/exit dots on the chart pulse larger; the link is the trade number, so re-sorting doesn't break highlighting.
- Legend gained: "hover any dot to see its trade #".

### Files

- `server/diag/chart-data.ts` — added tradeNumber field + normalize step
- `client/src/pages/chart.tsx` — full rewrite of chart rendering (Scatter), tooltip component, sortable trade list

Strictly additive changes — backend response shape gained two new fields, both safe to ignore by older clients. Existing `/trade` page, scanners, etc. completely unaffected.

Rollback tag: `safe/2026-05-10-chart-page-v1` (rolls back to the buggy-but-working v1 chart page; `safe/2026-05-10-pre-chart-page` rolls back to before any chart-page work).

---
## 2026-05-10 — Strategy Chart page (visual backtester)

**Why:** Phase 2 of the TFT rollout — instead of replacing BBTC+VER on existing pages (high UX risk), build a **separate** chart page where users toggle between strategies side-by-side. Existing trade-analysis page and scanners stay completely untouched. Per Chris on 2026-05-10: "a separate chart page that someone could toggle between the different strategies… add some context to the trades like P/L on the trade and some percentage stuff."

**What:** New `/chart` route. For one ticker, render bars + signal dots + (TFT only) regime bands + paired trades + summary stats, with a strategy selector that lets you toggle between **BBTC+VER**, **AMC**, **TFT 40w**, **TFT 60w**, **TFT catastrophic-only**. Click a trade row to highlight its entry/exit dots on the chart.

### Backend

- **`server/diag/chart-data.ts`** (NEW, ~570 lines) — unified chart-data module with 5 strategy adapters:
  - `bbtc-ver` — fetches bars, runs `computeBBTC` + `computeVER`, pairs entries/exits per sub-strategy (same logic as `strategy-pnl.ts`), emits dots + trades.
  - `amc` — recomputes MACD histogram + VAMI + EMAs + SMA200, walks `scoreAMC` per bar, pairs ENTER → SELL, emits dots + trades.
  - `tft-40w` / `tft-60w` / `tft-catastrophic` — wraps `simulateTFT` with appropriate `coreStopMode`, converts TFT layer entries/exits into chart dots, collapses per-bar regime series into contiguous regime bands.
  - Returns unified shape: `{ bars, signals, regimeBands, trades, summary, notes }`. Summary includes `totalPnLIncludingUnrealized`, `capturedBnHPct`, `marketExposurePct` (TFT only).
- **`server/routes.ts`** — new endpoint `GET /api/chart/:ticker?strategy=X[&days=Y][&positionSize=Z]`. Auth-gated (inherits from `app.use("/api", requireAuth)`). Defaults: `strategy=bbtc-ver`, `days=1825` (5y), `positionSize=10000`.

### Frontend

- **`client/src/pages/chart.tsx`** (NEW, ~430 lines) — new page component. Layout:
  1. PageHeader + Disclaimer
  2. Strategy selector (5 pill buttons; TFT catastrophic-only badged "$5.28M basket" to surface the winner)
  3. Timeframe selector (1Y / 3Y / 5Y / 10Y)
  4. Chart card — Recharts `ComposedChart` with `Line` (close price) + `ReferenceArea` per regime band + `ReferenceDot` per signal. Highlighted dots enlarge from r=4 to r=7 with thicker stroke when their trade is selected in the list. Legend below chart adapts to TFT vs non-TFT strategy.
  5. Summary stats grid — 8 cells: Total P/L (realized + unrealized), B&H Capture %, Win Rate, R-Multiple, Best/Worst, Max DD, Trades, Time in Market (TFT) / Position Type (others).
  6. Trade list — scrollable table, click row to highlight. Columns: #, layer (CORE/TACTICAL/PAIR), source (BBTC/VER/AMC/TFT), side, entry, exit, hold bars, return %, P/L $, exit reason. Open trades flagged "OPEN" in blue.
  7. Notes — strategy-specific disclaimer text from backend.
- **`client/src/App.tsx`** — added `<Route path="/chart" component={ChartPage} />` between `/trade` and `/scanner`.
- **`client/src/components/AppLayout.tsx`** — added "Strategy Chart" nav entry under "Company Research" group, positioned right after "Trade Analysis". Uses lucide `LineChart` icon.

### How users find it

- New sidebar entry: **Company Research → Strategy Chart**
- Type a ticker into the global search bar (uses TickerContext like the rest of the site), then navigate to /chart.
- Existing /trade page and all scanners are completely unaffected.

### Default decisions Chris should review

These were judgment calls per Chris's "do your recommendation and note it" instruction:
1. **Default strategy on first load = BBTC+VER**, not TFT-catastrophic. Reasoning: feels familiar to existing users; they actively click TFT to see the lift. Trade-off: hides the winner on first paint.
2. **Default timeframe = 5Y.** Long enough to show TFT's secular-trend benefit (NVDA, AMD, TSLA), short enough to keep the chart readable.
3. **Toggle UI = pill buttons row, not dropdown.** 5 options fit cleanly on desktop and surface all options at once. TFT catastrophic gets a "$5.28M basket" amber badge.
4. **Sidebar group = "Company Research"** alongside Trade Analysis. Could move to "Investment Opportunities" if it feels more discovery-oriented.
5. **URL = `/chart`** (not `/strategies` / `/strategy-lab` / `/trade-analysis-v2`). Short.
6. **Click-to-highlight only on trade list rows.** Hovering signal dots directly is deferred (would need Scatter overlay refactor).
7. **No per-trade entry-to-exit lines on the chart** (would clutter past 50+ trades). Trade detail lives in the panel below.

### Deferred to future session

- Hover tooltips on signal dots (requires Scatter overlay; bigger refactor)
- Mobile chart polish
- Side-by-side comparison view (two strategies stacked)
- Direct deep-link from /trade page → /chart for the same ticker
- Eventually: more strategies (e.g. AMC + BBTC chained)

Strictly additive — live trade-analysis, scanners, and other pages unchanged. Default flip on `/api/diag/strategy-tft-pnl` (catastrophic-only as default) was NOT made; that decision is still pending.

Rollback tag: `safe/2026-05-10-pre-chart-page` (covers the earlier unrealized-P&L fix too).

---
## 2026-05-10 — TFT eval: report unrealized P&L on open positions

**Why:** Phase 3 catastrophic-only run came back with a basket total of $110K — looked terrible. Diagnosed as a measurement bug, not a strategy failure: catastrophic-only intentionally holds CORE positions forever (the whole point), and 119 of those positions were still open at end-of-window. The eval was excluding ALL open trade P&L from `totalPnLDollar`. NVDA's core entered around 2019 and was sitting on a massive unrealized gain that didn't show up anywhere in the basket totals.

**What:** Added unrealized P&L tracking to TFT evaluator. Strictly additive — existing `totalPnLDollar` field unchanged for backward compat.

- **`server/diag/strategy-tft-pnl.ts`** — new fields on `TFTTickerPnL`:
  - `unrealizedPnLDollar` — mark-to-market on positions still open at end of window
  - `totalPnLIncludingUnrealized` — realized + unrealized; the "if you closed today" answer
  - `capturedBuyAndHoldPctIncludingUnrealized` — honest moonshot-capture metric
- New fields on `TFTBasketAgg`:
  - `totalUnrealizedPnLDollar`
  - `totalPnLIncludingUnrealized`
  - `basketCapturedBuyAndHoldPctIncludingUnrealized`
- `profitableTickers` / `unprofitableTickers` now use `totalPnLIncludingUnrealized` (so catastrophic-only isn't penalized for holding winners)
- `topPerformers` / `bottomPerformers` now sort by `totalPnLIncludingUnrealized` and report both numbers per ticker
- `avgPnLPerTicker` switched to including unrealized

Sim layer (tft.ts) was already populating `pnlDollar` on END_OF_WINDOW open trades — no change needed there.

### Why this isn't double-counting

Realized P&L is fully booked at the moment a layer closes. Unrealized P&L is the would-realize amount if positions were liquidated at the last bar's close. They're disjoint sets — closed trades and open trades are tracked separately. Sum is the honest "what is this strategy worth right now."

Strictly additive change. Live website unaffected. Existing TFT URLs return the new fields alongside the old ones.

Rollback tag: `safe/2026-05-10-pre-unrealized-fix`.

---
## 2026-05-10 — TFT: wider-stop variants for moonshot capture (Phase 3 tuning)

**Why:** Phase 1 (ATR floor) didn't help — measured drag of -$8K to -$174K depending on threshold. Phase 3 chases the other side of the gap: NVDA still captured only 3.6% of its $3.78M B&H even at the $901K basket high. The 40W weekly-close stop kicks the core out during routine trend pullbacks. Going wider should capture more of the move.

Per Chris (the user): "phase 3" — explicit go on this iteration after the Phase 1 verdict came in.

**What:** New `coreStop` query param controlling how aggressively the CORE layer exits. Three modes:

- **`40w`** (default, unchanged) — weekly close < 40W SMA, regime flip, regime neutral, or -15% catastrophic
- **`60w`** — same triggers but uses a 60W SMA instead. Moderate widening; trend has to break harder before exit
- **`catastrophic-only`** — core only exits on -15% catastrophic from entry. **All SMA-based and regime-based exits SKIPPED for the core.** Tactical layers still trail-stop normally; only the core is sticky. Maximum moonshot capture; expects bigger drawdowns when trends genuinely roll over (NFLX 2022 type)

Regime detection still uses the 40W SMA across all modes — `coreStopMode` only changes which SMA gates the CORE exit and whether SMA/regime exits fire at all. Entry confirmation stays consistent.

### Files

- **`server/signals/strategies/tft.ts`** — added `TFTCoreStopMode` type and `coreStopMode` to `TFTInput`. `aggregateWeekly` now also computes `weeklySma60`. Core exit block in `simulateTFT` branches: skipped entirely when `catastrophic-only`, otherwise selects between `weeklySma40` and `weeklySma60` based on mode.
- **`server/diag/strategy-tft-pnl.ts`** — threads `coreStopMode` through `runStrategyTFTPnL` → `evalTickerTFT` → `simulateTFT`. Added per-mode note in the response.
- **`server/routes.ts`** — `/api/diag/strategy-tft-pnl` accepts `&coreStop=40w|60w|catastrophic-only`. Default `40w` preserves prior behavior. Aliases: `catastrophic`, `thesis` → `catastrophic-only`.

### Expected outcomes

- **`60w`** should add roughly $50K-$200K to basket P&L, with most of the lift on names where the 40W broke prematurely (NVDA, AMD, MSFT, COST). Drawdowns will be moderately larger.
- **`catastrophic-only`** is the high-variance bet. NVDA core entry early in the 2015-2026 window should hold the entire run (price never dropped 15% from a $5 entry), which could 10-20× NVDA's contribution alone. But NFLX 2022 type names will lose ~15% before exit instead of getting out earlier on regime break.

Strictly additive (default `40w` preserves prior behavior). Live website unaffected.

Rollback tag: `safe/2026-05-10-pre-phase3`.

Per Chris's plan: this is Phase 3 of the (1)→(3)→(2) sequence. Phase 1 done with negative result; Phase 2 (wire to website) is next after a winner is picked from these variants.

---
## 2026-05-10 — TFT: ATR floor filter (Phase 1 tuning)

**Why:** First TFT eval results came in. Shorts-off variant returned **$901K basket P&L** (vs $415K BBTC+VER baseline, +117%). But 21 of 80 tickers still bled — all low-volatility defensives (utilities ED/DUK/SO/AEP/XEL/EXC, telecom VZ, staples KO/PEP/MO, REITs CCI/AMT, pharma JNJ, etc.). Each lost $1-8K. Total drag from these 21 names: ~$80K. Pattern matches the original 2026-05-08 handoff prediction: trend follower bleeds on stocks that don't trend.

Per Chris (the user): "I lean (1) → (3) → (2). Get the safe lift, ship it, then chase the moonshot in a separate experiment with rollback ready."

**What:** ATR-as-percent-of-price floor filter on TFT entries. Refuses CORE and TACTICAL entries when `atr14[i] / closes[i]` is below the threshold. Exits are NEVER gated — open positions always close on their normal triggers.

- **`server/signals/strategies/tft.ts`** — added `atrFloorPct` (fraction) to `TFTInput`. New helper `atrPassesFloor(i)` short-circuits to `true` when filter is 0 (default off). Gates `openCore` and `addTactical`. Filter applies symmetrically to long and short sides.
- **`server/diag/strategy-tft-pnl.ts`** — threads `atrFloorPct` through `runStrategyTFTPnL` → `evalTickerTFT` → `simulateTFT`. Added `atrFloorPct` to basket result schema and notes.
- **`server/routes.ts`** — `/api/diag/strategy-tft-pnl` accepts `&atrFloor=1.5` (percent). Converts to fraction internally (0.015). Caps at 20% for sanity. Default 0 preserves prior behavior.

**Usage:**
```
# Phase 1 test — TFT shorts-off + 1.5% ATR floor
/api/diag/strategy-tft-pnl?symbols=...&days=3650&shorts=off&atrFloor=1.5
```

Expected lift: **+$50K-$80K** (eliminating the bleed from 21 low-vol names without touching the moonshots). Brings basket from ~$901K toward ~$950K-$1M.

Strictly additive (default `atrFloor=0` preserves prior behavior). Live website unaffected — TFT still lives only in the diag endpoint.

Rollback tag: `safe/2026-05-10-pre-atr-floor`.

Per Chris's plan: this is Phase 1 of the agreed (1)→(3)→(2) sequence:
1. **ATR floor filter** (this commit) — small safe iteration
2. Wider-stop variants for moonshot capture (NVDA, AMD) — separate experiment
3. Wire TFT into the website chart — adopt as the live strategy

---
## 2026-05-09 — TFT (Two-Layer Trend Continuation) strategy + evaluator

**Why:** BBTC+VER 10y eval showed a $415K basket P&L on 80 tickers — beats SPY 15× — but on individual moonshots it leaves enormous money on the table. NVDA: strategy $31K, buy-and-hold $3.78M. AMD: strategy $25K, B&H $2.41M. AMZN, GOOGL, LLY, COST, CAT, MSFT — all show the same pattern. The 3×ATR trail stop gets shaken out by routine 20-30% pullbacks during sustained trends, then the strategy waits months for a fresh setup that may never come. Time-in-market on NVDA was only 45% over 10 years.

Per Chris (the user) on 2026-05-09: "I don't mind leaving 50K on the table, we made 400K, BUT I am not willing to leave 3M.... I need both sides of the moves buy and sell and use the exit of one to determine the entry of the other or something. Test against whatever you want, But I expect a full strategy we can use."

**What:** A new strategy that solves the "sit on cash" problem by holding a core position throughout a confirmed regime, using BBTC/VER as a tactical scaling layer on top, and stop-and-reverse on regime flip.

### Layers

- **CORE** — 1.0 unit (or 0.5 unit on high-vol names where ATR > 5% of price). Held continuously while regime is confirmed bullish/bearish. Exits ONLY on:
  - Weekly close through the 40-week SMA
  - Regime flip (immediately reverses to opposite side at 1.0 unit — stop-and-reverse)
  - Regime going neutral (exits to cash, sits)
  - -15% catastrophic stop from core entry

- **TACTICAL** — 0.5-unit adds on BBTC_BUY / BBTC_ADD_LONG / VER_BUY while regime is bullish. Each tactical layer trails on 5×ATR (vs the old 3×ATR). Stops drop the layer; core stays on. BBTC_REDUCE trims one tactical layer. Max combined position = 2.0 units.

### Regime detection (weekly)

- **BULLISH:** weekly close > 40W SMA AND 40W SMA[t] > 40W SMA[t-4] (slope rising)
- **BEARISH:** weekly close < 40W SMA AND 40W SMA[t] < 40W SMA[t-4]
- **NEUTRAL:** anything else
- **Whipsaw guard:** regime must hold for 2 consecutive weekly closes before flipping direction

### Files

- **`server/signals/strategies/tft.ts`** (NEW, ~340 lines) — pure strategy logic. Exports `simulateTFT(input): TFTResult`. Walks bars, manages a stack of layers (CORE bottom + TACTICAL on top, FIFO), produces per-bar regime + position-units arrays + complete trade records. Weekly aggregation done internally from daily bars (ISO week grouping; last-bar-of-week defines the weekly close).
- **`server/diag/strategy-tft-pnl.ts`** (NEW, ~410 lines) — evaluator wrapping `simulateTFT`. Schema mirrors `strategy-pnl.ts` (`TFTTickerPnL` ≈ `TickerPnL`) with TFT-specific additions: `peakUnitsDeployed`, `daysInMarket`, `marketExposurePct`, `capturedBuyAndHoldPct`. Basket aggregate adds `avgMarketExposurePct`, `avgPeakUnitsDeployed`, `totalBuyAndHoldDollar`, `basketCapturedBuyAndHoldPct`.
- **`server/routes.ts`** — new endpoint:
  ```
  GET /api/diag/strategy-tft-pnl?symbols=AAPL,MSFT&days=3650[&positionSize=10000][&detail=1][&shorts=on|off]
  ```

### Position sizing note (IMPORTANT for comparison)

`positionSize` here means dollars per **UNIT**. A 1.0-unit core deploys $10K. A max 2.0-unit position deploys $20K notional. **This differs from `strategy-pnl.ts` where `positionSize` is per trade with 1× max deployment.** When comparing TFT to BBTC+VER:
- Same `positionSize=10000` means TFT can deploy up to 2× the capital
- For a fair "same capital" comparison, halve TFT's `positionSize` to 5000
- Or look at `avgPeakUnitsDeployed` in the basket aggregate to see how often max deployment actually happened

### Defensive behavior preserved

- Long-only on names where regime never confirms bearish (e.g. KO, PG defensives) — they just sit out, generating no return rather than bleeding
- Shorts demoted to info-only on BBTC/VER stays unchanged in those modules — TFT's shorts come from regime confirmation, not from BBTC_SELL/VER_SELL events
- Default `shorts=on` because two-sided coverage is the design goal; `shorts=off` available for ablation

### Usage example

```bash
# Full 80-ticker basket, 10 years, $10K per unit (max $20K notional), shorts on
curl -s "https://stockotter.ai/api/diag/strategy-tft-pnl?days=3650&positionSize=10000&shorts=on&symbols=AAPL,MSFT,NVDA,..."

# Apples-to-apples capital comparison vs strategy-pnl: $5K per unit (max $10K notional)
curl -s "https://stockotter.ai/api/diag/strategy-tft-pnl?days=3650&positionSize=5000&symbols=..."
```

Strictly additive (new strategy file, new evaluator, new route — nothing in existing strategy code changed). Live website behavior unaffected — TFT does not run anywhere except this diag endpoint.

Rollback tag: `safe/2026-05-09-pre-tft`.

---
## 2026-05-09 — AMC confirmation gate added to per-trade $ P&L evaluator

**Why:** The `/api/diag/strategy-pnl` evaluator was scoring entries on BBTC + VER alone, which does NOT match what the live website tells users. The website's "Ready / Set / Go" chain is **VER (red) → AMC (yellow) → BBTC (green)** — a 3-phase confirmation chain. The evaluator was skipping AMC entirely, so the $419K basket P&L number didn't represent what an actual user following the website's signals would have seen. Need to gate entries by AMC confirmation to get an honest read.

**What:**
- **`server/diag/strategy-pnl.ts`** — added MACD histogram, VAMI scaled, and SMA200 helpers (matching `routes.ts:3246–3267` canonical computations). Added `computeAMCSeries()` that inlines `computeAMC`'s logic per-bar so the full historical AMC score/signal series can be built without N² array slicing. New `AMCGateMode = "off" | "loose" | "strict"` type. `pairTrades` now accepts `amcGate` + AMC score/signal arrays and gates entries (NOT exits — open positions can always close):
  - **off** (default): legacy behavior, no AMC requirement
  - **loose**: AMC score ≥ 3 (3+ of 5 momentum conditions met) at the entry bar
  - **strict**: AMC has signaled ENTER at the entry bar OR within the prior 10 bars — matches the live website's 3-phase confirmation chain
  - SPY benchmark uses the same gate so the comparison stays apples-to-apples.
- **`server/routes.ts`** — `/api/diag/strategy-pnl` now accepts `&amcGate=off|loose|strict`. Default remains `off` (no behavior change for existing callers).
- AMC inputs match the live Trade Analysis configuration: `trendShortEma=EMA9, trendLongEma=EMA50, trendStrengthRefEma=EMA21, vamiScaled=VAMI×8, reversionRefLevel=SMA200×0.95, reversionDirection="above"`.

**Usage:**
```
# off (legacy / current website-eval-doesn't-match-website behavior)
/api/diag/strategy-pnl?symbols=...&days=3650

# loose: at least 3 of 5 AMC conditions at entry bar
/api/diag/strategy-pnl?symbols=...&days=3650&amcGate=loose

# strict: matches what the live website actually requires
/api/diag/strategy-pnl?symbols=...&days=3650&amcGate=strict
```

**Files:** `server/diag/strategy-pnl.ts`, `server/routes.ts`.

Rollback tag: `safe/2026-05-09-pre-amc-gate`. Strictly additive (default `amcGate=off` preserves prior behavior).

---
## 2026-05-08 — Per-trade dollar P&L evaluator

**Why:** Chris's exact words: "Percentages don't mean shit if there ain't any money made." The existing strategy-eval endpoint measures forward-N-day dir-adjusted returns from each fire — useful for measuring per-fire EDGE but not actual P&L. Need a way to answer "did this strategy actually make money on AAPL? on NVDA? across the basket?"

**What:**
- **`server/diag/strategy-pnl.ts`** (NEW) — full per-trade P&L evaluator that walks each ticker's signal series, pairs LONG entries with their exits, and computes:
  - **Per-trade**: entryDate, entryPrice, exitDate, exitPrice, returnPct, **pnlDollar** (returnPct × position size), holdBars, exitReason, strategy (BBTC or VER)
  - **Per-ticker**: closed/open trade counts, win rate, avg win % and $, avg loss % and $, **totalPnLDollar**, R-multiple, compoundReturnPct (chained 1+r), **compoundReturnDollar**, best/worst trade %, avgHoldBars, maxDrawdownPct, buyAndHoldReturnPct (benchmark)
  - **Basket aggregate**: totalSymbols, totalClosedTrades, basketWinRate, totalPnLDollar, avgPnLPerTrade, avgPnLPerTicker, basketCompoundReturnPct, profitable vs unprofitable ticker counts, top10 + bottom10 performers by $ P&L, SPY buy-and-hold benchmark
- **BBTC and VER trades tracked SEPARATELY** then merged. They have independent position state in the live strategy (BBTC = trend continuation, VER = oversold reversal — often fire on different setups). Tracking separately means a VER_BUY at a pullback bottom is paired with the next VER_STOP_HIT, not closed early by a BBTC exit.
- **Long-only** — strategy is long-only post-2026-05-08 short demote, so no short trades to pair. Validating shorts post-hoc would require a "synthetic shorts" mode (apply same stop logic to short setups) — flagged for a future iteration.
- **`server/routes.ts`** — new endpoint:
  ```
  GET /api/diag/strategy-pnl?symbols=AAPL,MSFT,...&days=3650[&positionSize=10000][&detail=1]
  ```
  - days: 30..3650 (default 365)
  - positionSize: dollars per trade, 100..1000000 (default 10000)
  - detail=1 to include per-trade records

**No commissions or slippage applied.** Real-world P&L would be lower by ~$1–5 per round trip plus 0.05–0.1% slippage. Note included in the response.

**Open trades excluded from $ aggregates** but counted in trade-count metrics. A position open at end of window has unrealized P&L not booked.

**Files:** `server/diag/strategy-pnl.ts` (new), `server/routes.ts`.

**Usage example for Chris's morning review:**
```
curl -s "https://stockotter.ai/api/diag/strategy-pnl?symbols=AAPL,MSFT,NVDA,AMD,...&days=3650&positionSize=10000"
```

Returns JSON with `aggregate.totalPnLDollar` (the basket-wide $ made/lost), `aggregate.topPerformers` (top 10 tickers by $ P&L), and `perTicker[].totalPnLDollar` for the ticker-by-ticker view he asked for.

Rollback tag: not needed — strictly additive (new file + new endpoint, no existing code changed).

---
## 2026-05-08 — Shorts demoted to info-only

**Why:** Post-pivot 10-year broad-basket eval showed shorts have no edge in the current market regime:

| Metric | Pre-pivot (event-based) | Post-pivot (state-based) |
|---|---:|---:|
| Short fires | 522 | 3,403 (6.5x more) |
| Short win rate +20d | 48.0% | **42.9%** |
| Short median return +20d | −0.38% | **−1.25%** |

The state-based entry pivot caught more short setups (good for visibility) but each setup lost more on average than the prior event-based design (bad for capital). 10-year cumulative: 3,403 × −1.25% = ~42% of capital deployed in shorts would have been lost. Even with 2018, 2020, and 2022 bear cycles in the window, shorts didn't recover. Long side is doing the work; shorts are dragging.

**What:**
- **`server/signals/strategies/bbtc.ts`** — short side demoted. Strategy is now LONG-ONLY at the position-state level. Short conditions still evaluated every bar; on the rising edge of "short conditions met (after being false)", a single `SELL` signal with `signalSides[i] = "SHORT"` is emitted for chart visibility. Strategy does NOT enter a short position. The entire `else if (positionSide === "SHORT")` management block was removed — dead code now. `topSignal` logic updated to ignore info-only short SELL events (won't trigger UI "exit a long" semantics).
- **`server/signals/strategies/ver.ts`** — VER_SELL demoted to info-only with the same treatment. Strategy no longer sets `position = "short"` on VER_SELL. The dormant SHORT management block in ver.ts is left in place but never fires.
- **`client/src/pages/trade-analysis.tsx`** — `SignalDot` renders `isShortEntry` as a hollow magenta dashed ring (mirrors VER_WATCH_SELL's hollow orange treatment). Tooltip color and "(info-only)" suffix added. Legend updated: "Short entry" → "Short setup (info-only)" with hover tooltip explaining the demote.

**Impact:**
- All 3,400+ short fires per 10-year basket now render as hollow magenta dots (one per bearish setup, not per bar)
- Long side strategy and rendering unchanged — green entries, teal REDUCE wins, red stops, slate trend exits
- Visible dot density on charts drops materially (hollow info dots are visually quieter)
- Honest UX: users see "the system identified a short setup" without misleading them that this is a tradeable signal
- Reversible: rebuild the short side later as a separate effort. The eval will continue to track short setup performance for the rebuild discussion.

**Files:** `server/signals/strategies/bbtc.ts`, `server/signals/strategies/ver.ts`, `client/src/pages/trade-analysis.tsx`.

Rollback tag: `safe/2026-05-08-shorts-info-only`.

---
## 2026-05-08 — Major: BBTC pivots to real trend follower

**Why:** Two structural problems forced this rewrite, both surfaced via charts (NVDA 5Y dead zone 2022→2024, AAPB charts with deep EMA9 crosses that didn't fire entries):

1. **Entry side missed sustained trends.** BBTC required an EMA9 cross-up *event* to fire. In a continuing uptrend, EMA9 stays above EMA21, so no new cross fires. Once stopped out, the strategy waited for the EMAs to invert and re-cross — which can take months in a smooth trend. NVDA 2022-2024 had ONE entry early, got stopped, and the strategy sat out a 6x return. Multiple entry gates (SMA200 strict-above, RSI < 65 strict ceiling) compounded the problem by rejecting valid recovery setups.

2. **Exit side capped winners and stopped winners.** Hard stop at 2.5×ATR (or 5% floor) plus profit target at 5×ATR meant: small losses (good) but small wins too (capped). Realized R-multiple was around 1.5:1 instead of the 3-5:1 trend followers need. Plus trail stop was anchored to entry-bar high and gated to "only fire above entry," which was a hack rather than a clean stop framework.

Per Chris (the user): "We are looking for the profit not the percentage. I can lose 4 out of 5 times as long as the time I win is more than what I lost." That's R-multiple thinking — what trend followers actually do. The old strategy was built like a mean-reversion setup with high win rate aspirations and capped winners, fighting itself.

**What changed in `server/signals/strategies/bbtc.ts`:**

### Entry side — STATE-based, not event-based

Old entry: `EMA9 crosses above EMA21` (event) + `close > EMA50` + `ADX >= 20` + `close > SMA200` (strict) + `RSI < 65` (strict).

New entry, evaluated every flat bar:
- `EMA9 > EMA21` (state, not event — fires on first qualifying bar after exit)
- `close > EMA50` (medium-term trend stack)
- `ADX >= 20` (chop filter, unchanged)
- `close > SMA200` OR **SMA200 rising** over last 20 bars (catches early recoveries before price has fully reclaimed SMA200)
- `RSI < 65` OR (`RSI < 75` AND **RSI turning up** over last 3 bars — catches continuation entries after pullbacks where RSI is recovering)

Mirror conditions for shorts (EMA9 < EMA21, close < EMA50, SMA200 falling, RSI > 35 or > 25 with turning down).

### Exit side — two-stop ladder (futures-style)

```
HARD STOP  = entryPrice − 2.5 × entryATR  (locked at entry, defines max loss)
TRAIL STOP = highestSinceEntry − 3.0 × currentATR  (ratchets up with new highs)
EFFECTIVE  = max(hardStop, trailStop)  (whichever is higher for longs)
```

- Trail multiplier widened from 1.5 to **3.0** so trail starts BELOW hard stop. Hard stop is active early — protects the "trade went to shit before it had a chance to develop" case. As price runs up, trail ratchets up. Once trail > hard, trail takes over. Classic futures stop-ladder Chris used.
- 5% percent floor REMOVED — the trail handles "give the trade room" naturally, scaling per ticker volatility (AAPL ATR 1.4% → 4.2% trail; NVDA ATR 4.2% → 12.5% trail).
- `trailActive` gate REMOVED — `max(hard, trail)` does the right thing automatically without the gate.
- **Profit target REMOVED.** No more REDUCE signal. Winners run as long as the trail allows.
- State-based exit: `EMA9 < EMA21 AND close < EMA50` (was event-based crossBelow + close < EMA50). Mirror for shorts.

### Removed / never-emitted signals

- `REDUCE` — no profit target → no REDUCE fires. Type retained for downstream tolerance; will simply never appear in new evals.
- `ADD_LONG` — pyramid logic removed. State-based entries don't need it; once flat we re-enter on next qualifying bar via the main entry rule.

### Why NO explicit cooldown on continuation entries

Earlier draft had a 60-bar (3-month) cooldown after stop. Chris correctly pointed out 60 bars is far too long, and is also timeframe-dependent. Removed. The state-based conditions act as a natural cooldown:
- After a stop, RSI is low and just turning. The "RSI turning up over 3 bars" requirement enforces a multi-bar recovery before re-entry.
- Re-entry also requires close > EMA50 + EMA9 > EMA21 + ADX > 20 — the trade must have genuinely re-entered trend conditions.

This makes the strategy timeframe-agnostic. Same code works on daily, hourly, or 5-minute bars when the timeframe-aware-bars TODO ships.

### Expected impact (will validate via eval)

- Long fire count: **rises** materially (state-based catches missed trends)
- Win rate per fire: probably drops from ~57% to ~45-50% (more entries, more stops)
- **Average win size doubles or triples** (no profit target cap)
- Realized R-multiple: from ~1.5:1 to **~3:1+** on trending names
- Total capital captured per ticker: substantially higher on trending stocks (NVDA, AMD, COST), modestly higher on choppy stocks (AAPL stays a hard case but at least participates more)
- BBTC_REDUCE disappears from evals
- BBTC_ADD_LONG disappears from evals

**Files:** `server/signals/strategies/bbtc.ts`.

Rollback tag: `safe/2026-05-08-trend-follower`.

---
## 2026-05-08 — Chart: differentiate exit dot colors so trade outcomes are visible

**Why:** Chris's complaint on the AAPL 5Y chart was "all I see are enter/exit a few days later, over and over." Looking carefully, the chart was lumping THREE completely different exit events into one red dot:
1. **STOP_HIT** — hard/trailing stop triggered — a LOSS
2. **REDUCE** — profit target hit at 5×ATR — a WIN
3. **SELL via EMA cross-down** — trend reversed, clean exit — neutral

So every chart looked like "constant whipsaw" even when many of those reds were winning trades or clean exits. The visual conflation made the strategy look broken when it wasn't.

**What:**
- **`client/src/pages/trade-analysis.tsx`** — `SignalDot` rewritten with distinct fill colors per event type. New palette:
  - 🟢 Green — long entry
  - 🟡 Yellow — long watch (RSI 35-45)
  - 🔵 Teal (#14b8a6) — REDUCE / profit target hit (WIN)
  - 🔴 Red — STOP_HIT (LOSS)
  - ⚫ Slate (#94a3b8) — cross-down SELL on long / cross-up BUY on short (clean trend exit)
  - 🟣 Magenta (#d946ef) — short entry
  - ⭕ Hollow dashed orange — info-only WATCH_SELL (unchanged)
- Tooltip `colorFor()` updated to mirror — hovered tooltip line color now matches the dot on the chart, including direction-aware coloring (a `BUY` is green when it's a long entry, slate when it's a short cover).
- Legend below chart expanded to show each new color with hover-tooltips explaining: "Profit target (WIN)", "Stopped (LOSS)", "Trend exit", "Short entry".

**Impact:** No strategy logic changed — every fire that used to render as red still renders as a dot, just in the *correct* color for what it actually is. Charts now read at-a-glance: green→teal sequences = winning trades, green→red = losing trades, green→slate = neutral exits.

**Files:** `client/src/pages/trade-analysis.tsx`.

Rollback tag: `safe/2026-05-08-dot-colors`.

---
## 2026-05-08 — Stop: 5% percent floor for low-volatility names

**Why:** The post-fix 10y eval validated the ATR-lock fix (BBTC_STOP_HIT count dropped 29%, post-stop premium dropped from +1.06% to +0.65%), but AAPL specifically still showed 11/11 entries stopping with 0 REDUCE hits. Root cause: AAPL's daily ATR is only ~1.4% of price, so 2.5×ATR = ~3.5% stop — tighter than normal in-trend pullbacks. The strategy was buying continuations and stopping on routine pullbacks before the trend resumed.

**What:**
- **`server/signals/strategies/bbtc.ts`** — `MIN_STOP_PCT = 0.05` (5% percent floor) added. Hard stop distance now `max(2.5 × entryATR, 5% × entryPrice)`. Low-vol names (AAPL, KO, JNJ, utilities) get 5% breathing room regardless of ATR. High-vol names (TSLA, NVDA, AMD) where 2.5×ATR > 5% are completely unchanged — this is a one-sided fix that only widens stops, never tightens them.

**Concrete impact (AAPL example):**
- Entry $292, entry-bar ATR $4 → 2.5×ATR = $10 (3.4% stop). Pre-floor stop at $282.
- 5% floor = $14.60 → post-floor stop at $277.40 (5%).
- AAPL pullbacks of 4% within continuing uptrends will no longer stop.

**Concrete impact (TSLA example):**
- Entry $200, entry-bar ATR $8 → 2.5×ATR = $20 (10% stop). 5% = $10.
- max(20, 10) = 20 → stop at $180 (10%). Unchanged.

**Expected impact on broad eval:**
- BBTC_BUY win rate at +20d should improve a few percentage points on low-vol names
- BBTC_STOP_HIT count should drop another 5–15% (mostly from low-vol tickers)
- BBTC_REDUCE count should rise (entries finally given room to reach 5×ATR target)

**Files:** `server/signals/strategies/bbtc.ts`.

Rollback tag: `safe/2026-05-08-stop-pct-floor`.

---
## 2026-05-08 — Fix: hard stop shrinks with ATR contraction (premature stop-outs)

**Why:** Chris confirmed via tooltip that the green/red dot pairs on AAPL 5Y were `BBTC STOP_HIT (long)` — real hard-stop fires, not REDUCE or cross-down. The trail-fix from the prior commit didn't help because hard stops were firing first.

Root cause: `stopLoss = entryPrice - atr14[i] * ATR_STOP_MULT` uses the *current* bar's ATR, not the entry bar's ATR. When ATR contracts after a volatile entry — which happens routinely as the post-cross volatility settles — the stop level pulls IN closer to entry. A normal pullback inside a continuing trend then trips it.

**Concrete AAPL example:**
- Enter at $200 with ATR $5 → expected stop $187.50 (6% below)
- ATR contracts to $3 over the next week → stop now sits at $192.50 (3.75% below)
- Routine 4% pullback inside trend triggers the stop

**What:**
- **`server/signals/strategies/bbtc.ts`** — added `entryATR` position-state variable, captured at entry. Hard stop now locked at `entryPrice - 2.5 × entryATR` for the life of the position. Profit target also locked at `entryPrice + 5 × entryATR` for symmetry. Trailing stop continues to use the current bar's ATR (it should adapt with live volatility — that's the point of a trail). Mirror fix on the short side: hard stop locked at `entryPrice + 2.5 × entryATR`.

**Expected impact:** dramatic reduction in same-week stop-outs on volatile-entry → quiet-followup setups. Long win rate at +20d should rise materially. The 10y eval claim (BBTC_STOP_HIT had +1.06% median return at +20d post-stop = stops firing in profitable spots) was actually evidence of THIS bug, not just the trail-stop one.

**Files:** `server/signals/strategies/bbtc.ts`.

Rollback tag: `safe/2026-05-08-stop-atr-lock`.

---
## 2026-05-08 — Fix: trailing stop activates too early, choking entries

**Why:** Chris noticed on AAPL 5Y that BUY and STOP_HIT dots were firing one bar apart. Reading the BBTC code revealed the cause: the trailing stop was anchored to `highestSinceEntry`, which equals the entry-bar high on day 1. The trail level (1.5×ATR below the high) was therefore ~2% below entry on the very first post-entry bar — *tighter than the hard 2.5×ATR stop*. Any normal pullback within a continuing trend triggered an immediate stop-out.

This is the bug behind the puzzling 10-year eval result: **BBTC_STOP_HIT had +1.06% median return at +20d post-stop**. Stops fire in profitable spots → stops are firing prematurely → trades would have worked.

**What:**
- **`server/signals/strategies/bbtc.ts`** — long side: trailing stop now only activates when `highestSinceEntry - 1.5×ATR > entryPrice`, i.e. peak has run up at least 1.5×ATR above entry. Until then, only the hard 2.5×ATR stop applies. Trail behaves as a profit-lock, not as a tight initial stop.
- Same mirror fix on the short side: trail only fires once `lowestSinceEntry + 1.5×ATR < entryPrice`.

The hard stop logic, profit target, and entry conditions are unchanged.

**Expected impact:** materially fewer same-week stop-outs on long entries. Win rate at +20d should rise (currently 57.6% — a chunk of the losing/break-even fires were premature trail-stops on entries that would have worked). REDUCE rate may also rise as trades are given room to reach the 5×ATR target.

**Files:** `server/signals/strategies/bbtc.ts`.

Rollback tag: `safe/2026-05-08-trail-stop-fix` (created at HEAD before this commit).

---
## 2026-05-08 — Side-aware stops/exits on Trade Analysis chart

**Why:** The Long/Short side filter was leaking exit dots: a `STOP_HIT` after a long position showed in the Short view (and vice versa) because the chart payload only carried the signal *name*, not which direction the trade was. Same problem for `REDUCE` (long profit-take vs short profit-take) and the cross-exit `BUY`/`SELL` signals (a `BUY` emitted while in a short = short cover, not a new long entry).

**What:**
- **`server/signals/strategies/bbtc.ts`** — added `BBTCSignalSide = "LONG" | "SHORT" | null` and `signalSides: BBTCSignalSide[]` to `BBTCResult`. Annotated every signal emission point with its position side: long entries/adds/exits/stops/reduces tagged `LONG`; short entries/exits/stops/reduces tagged `SHORT`. The cross-down-while-in-long `SELL` and the cross-up-while-in-short `BUY` are tagged with the side they're closing, not the side they'd be opening.
- **`server/signals/strategies/ver.ts`** — same treatment. `VERSignalSide` + `signalSides` array. BUY/WATCH_BUY/long-stop tagged `LONG`; SELL/WATCH_SELL/short-stop tagged `SHORT`.
- **`server/routes.ts`** — `/api/analyze` chart payload now includes `bbtcSide` and `verSide` per bar (both subsampled and last-bar paths).
- **`client/src/pages/trade-analysis.tsx`** — `SignalDot` filter rewritten to use `bbtcSide`/`verSide` directly: a long-view filter hides any bar whose BBTC or VER signal is on the SHORT side (and vice versa). Stops, reduces, and cross-exit buys/sells now route to the correct side. Tooltip enhanced with `(long)` or `(short)` suffix on direction-ambiguous signal names (STOP_HIT, REDUCE, BUY, SELL) so a hovered dot reads e.g. "Signal: BBTC STOP_HIT (long)".

**Files:** `server/signals/strategies/bbtc.ts`, `server/signals/strategies/ver.ts`, `server/routes.ts`, `client/src/pages/trade-analysis.tsx`.

---
## 2026-05-08 — Trade Analysis chart: signal name in tooltip

**Why:** Hovering a dot showed price and EMA values but not which signal actually fired. Chris asked to surface the signal name in the existing rollover so a glance at any dot tells you what triggered there.

**What:**
- **`client/src/pages/trade-analysis.tsx`** — replaced the price-chart `Tooltip` formatter with a custom `content` render. Same look as before for price/EMA/SMA lines (one line each, color-matched), and when a bar has a BBTC or VER signal a divider + colored "Signal: BBTC BUY" / "Signal: VER WATCH_SELL (info-only)" line is appended below. Both can fire on the same bar — both will show. Dot color in the tooltip text matches the dot on the chart.

**Files:** `client/src/pages/trade-analysis.tsx`.

---
## 2026-05-08 — Strategy tightening: BBTC RSI ceiling, VER_SELL > 80, WATCH_SELL info-only

**Why:** 10-year strategy-eval backtest (3,006 fires across 80 tickers, Sep 2015 → May 2026) gave us fact-driven signal quality data across multiple market cycles. Three findings drove this commit, each one chosen as a direct conclusion from the 10y data — not patches:

1. **BBTC long entries skewed to high RSI.** Median RSI at long entry was 57.4; the 60-70 RSI bucket fired 278 times and the 70+ bucket fired 15 times. Late-cycle entries are the lower-edge set we want to cut. **Fix:** RSI < 65 ceiling on BBTC `BUY` and `ADD_LONG`. Mirror floor RSI > 35 on BBTC `SELL` short entries for symmetry. ADX/SMA200 regime gates retained.
2. **VER_SELL was bad even with the 75 threshold.** Only 7 fires in 10 years, 14% win at +20d, −4.53% median. Tightening rather than dropping (the rule is otherwise correctly structured — it just needs deeper exhaustion). **Fix:** RSI threshold 75 → 80.
3. **VER_WATCH_SELL was a confirmed net loser across every backtested window.** 82 fires, 43% win at +20d, −1.06% median, −2.11% mean — losing in 2y, 5y, AND 10y windows. Not a single-regime fluke. **Fix:** demoted to info-only — still computed and rendered (hollow dashed orange ring on the chart, "info-only" label in the legend) so users see the RSI overbought condition, but it's no longer a tradeable signal. Full rebuild is queued as a follow-up TODO; do not re-enable as tradeable until a rebuild has positive backtest edge.

**What:**
- **`server/signals/strategies/bbtc.ts`** — `BBTCInput` gains optional `rsi14`. Self-contained `computeRSISeries` helper added so callers don't have to thread it. Long-entry path requires `rsi14[i] < 65` (NaN → defaults to true to preserve early-window fires through warmup); short-entry path requires `rsi14[i] > 35`. Same RSI ceiling applies to `ADD_LONG` — adding to a long at high RSI is the late-cycle chase we're filtering.
- **`server/signals/strategies/ver.ts`** — VER_SELL threshold raised to RSI > 80 (was 75). WATCH_SELL still emits at RSI 65-80 but commented as info-only. New exported `isTradeableVERSignal()` helper returns `false` for WATCH_SELL.
- **`server/routes.ts`** — both BBTC call sites updated to pass `rsi14`. `/api/analyze` already had `rsi14` in scope; scanner site has `rsi14` computed; in the second site (`/api/scanner` line ~3754) RSI computation moved up before BBTC.
- **`server/diag/strategy-eval.ts`** — passes `rsi14` to `computeBBTC` so the eval reflects the live strategy.
- **`server/signal-engine.ts`** — passes `rsi14` to `computeBBTC` (single source of truth path used by scanner/watchlist/portfolio).
- **`client/src/pages/trade-analysis.tsx`** — `SignalDot` renders WATCH_SELL as a dashed hollow orange ring (no fill) at radius 3.5 instead of a solid orange dot. Legend updated to "Short watch (info-only, RSI 65-80)" with a hollow-circle swatch.

**Files:** `server/signals/strategies/bbtc.ts`, `server/signals/strategies/ver.ts`, `server/routes.ts`, `server/diag/strategy-eval.ts`, `server/signal-engine.ts`, `client/src/pages/trade-analysis.tsx`.

**Validation:** typecheck clean for all touched files (preexisting baseline noise from routes.ts unrelated to this commit).

**Follow-up TODOs (saved to memory):**
- `todo_ver_watch_sell_rebuild.md` — full rebuild of WATCH_SELL with positive-edge requirement
- `todo_timeframe_aware_bars.md` — replace zoom-only timeframe selector with real intraday/multi-day bar resolution

Rollback tag: `safe/2026-05-08-strategy-final`.

---
## 2026-05-07 — Scanner: shuffle the universe + bump default to 1500

**Why:** After lifting the 200-row cap, the scanner still returned the same tech megacaps every run (ORCL, PLTR, NVDA…). Root cause: `fmpScreener` sorted by dollar volume desc, so the top of the result list was always the most-traded names — overwhelmingly tech.

**What:**
- **`server/data/providers/fmp.adapter.ts`** — replaced the `sort by dollar volume` with a Fisher-Yates shuffle. The minVolume filter on the FMP server side still enforces liquidity, so the shuffled subset is all tradeable names — just a different cross-section every call.
- **`server/routes.ts`** — bumped main scanner + AMC defaults from count=500 to count=1500 (cap stays 2000). 1500 tickers across the shuffled liquid universe surface diverse sectors per scan.

**Files:** `server/data/providers/fmp.adapter.ts`, `server/routes.ts`.

**Caveat:** within the 30-min route cache window, the same query parameters return the same shuffled subset. After 30 min, next scan reshuffles. If you want truly fresh-every-click results, we can lower the cache TTL or wire a "force refresh" param.

Rollback tag: `safe/2026-05-07-scanner-diversity`.

---
## 2026-05-07 — Scanners: kill Polygon dep in V2, lift universe cap, fix BUY/SELL filter

**Why:** All three scanner modes were broken. Main scanner felt "stuck on the same tickers" (200-row hard cap making every scan return the same top-200 by liquidity). V2/Explosion was non-functional because it called `getPolygonChart` directly and that path is dying as Polygon Stocks Starter approaches drop. AMC ran but was capped at 200 rows the same way. BUY/SELL toggle on the main scanner used `dir === "BULLISH" || r.score > 0` — the OR let bearish-direction-but-positive-score rows through BUY (and worse, when `gates` was null for many rows the disjunction misfired entirely).

**What:**
- **`server/scanner-v2.ts`** — `loadBars` rewritten to use FMP `/historical-price-eod/full` directly via `fmpGet`. Polygon import dropped. Cache key bumped to `scanner-v2:bars:v2`.
- **`server/routes.ts` `/api/scanner`** — count cap 200 → 2000, default 500. Cache key bumped to `scanner:main:v2`.
- **`server/routes.ts` `/api/scanner/amc`** — same cap and default. Cache key `scanner:amc:v2`.
- **`client/src/pages/scanner.tsx`** — BUY/SELL filter uses direction as the source of truth when present (rejects opposite direction explicitly). Score fallback only fires when `gates` is null, and uses tighter thresholds (`score >= 5` for buy, `score <= -3` for sell) so neutral rows don't leak through.

**Files:** `server/scanner-v2.ts`, `server/routes.ts`, `client/src/pages/scanner.tsx`.

**Notes:**
- Performance is still per-ticker FMP fetches (2000 tickers × ~250ms ≈ 50s wall time first run, then 30-min cache). The right speed fix is the `/stable/eod-bulk` cron-warmed disk cache that scans read from in-memory — flagged as the next job, NOT in this commit.
- V2/Explosion now functional but slow on cold cache. Same caveat.

Rollback tag: `safe/2026-05-07-scanner-fixes`.

---
## 2026-05-08 — Strategy overhaul (data-driven, from /api/diag/strategy-eval results)

**Why:** Owner's visual inspection of ORCL/NVTS/GLW/DOCS/TOST/BABA charts flagged that buy/sell dots were firing at the wrong RSI levels. Built `/api/diag/strategy-eval` (read-only, runs `computeBBTC` + `computeVER` over a basket and reports forward-return win rates) and pulled an 81-ticker, 11-sector basket over 365 days (1,321 fires, SPY benchmark +25.64%). Data confirmed the visual diagnosis and surfaced more.

**Key data findings:**
- **BBTC_BUY (542 fires)**: zero fires below RSI 50. Median RSI at fire = **57.2**. Win rate 53% at +5d, 52% at +20d. Mean +20d return only +0.96% vs SPY's ~6.8%/20d. 30% stopped within 20 days. The chart legend "Buy (RSI<30)" was structurally false because BBTC requires price > EMA50, which correlates with mid/high RSI.
- **BBTC_SELL (447 fires)**: 47% win rate at +5d (worse than random). Median +20d return **-0.62%** (shorts went up). 34% stopped. Net loser.
- **BBTC_ADD_LONG (80 fires)**: 71% win rate at +20d, +2.41% median return. The one strategy with real edge.
- **VER_BUY post-tightening (4 fires)**: too rare to be useful even when win rate looked OK.
- **VER_SELL (4 fires)**: 0% win rate at +20d (4/4 wrong-way), 100% stopped. Structurally broken.
- **BBTC_STOP_HIT**: positive forward returns after stops (+0.85% median +20d) — stops were premature.
- **BBTC_REDUCE**: -2.02% mean +20d return after trim — exits firing too early; price kept running.

**Changes shipped:**

1. **BBTC long-only.** Dropped the short-entry path entirely (the !inPosition crossBelow branch). The 447-fire money-losing path is gone. SELL signal still fires as an exit-from-long but never opens a short position.
2. **BBTC ADX gate.** Entries (BUY and ADD_LONG) now require ADX(14) ≥ 20. Rejects EMA crossings during chop. ADX is computed inline if not passed in input — no caller updates required.
3. **BBTC stop widened.** 2.0× ATR → 2.5× ATR. Premature stops were causing 30% of longs to get knocked out before a recovery.
4. **BBTC REDUCE target widened.** 3.0× ATR → 5.0× ATR. Stops trimming winners during continuation.
5. **VER BUY threshold loosened.** RSI<30 → RSI<35. The strict <30 only fired 4 times in the eval; <35 should produce 15-25× more density while staying in legitimate oversold zone.
6. **VER short side removed.** SELL and WATCH_SELL signal types deleted from `VERSignal` and `VERTopSignal`. Strategy is now long-only + WATCH + STOP_HIT.
7. **Chart legend honest.** "Buy (RSI<30)" / "Sell / Stop" / "Watch Sell" → "Entry" / "Watch (oversold setup)" / "Exit / Stop". Three colors, three meanings — no more sell-side dots.

**Files:** `server/signals/strategies/bbtc.ts`, `server/signals/strategies/ver.ts`, `client/src/pages/trade-analysis.tsx`.

**Verification path:** re-run `/api/diag/strategy-eval` with the same 81-ticker basket. Expected:
- BBTC_BUY count drops ~50% (ADX gate); win rate should rise.
- BBTC_SELL count → 0.
- BBTC_ADD_LONG roughly unchanged.
- BBTC_STOP_HIT count drops; win rate of survivors rises.
- BBTC_REDUCE count drops sharply; remaining ones at higher RSI.
- VER_BUY count up 15-25×.
- VER_SELL / VER_WATCH_SELL → 0.
- Total fires ~600-800 (was 1321). Aggregate win rate up.

If verification matches expectation, we have a real edge. If not, the data is honest baseline for the next iteration.

Rollback tag: `safe/2026-05-08-strategy-fixes`.

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
