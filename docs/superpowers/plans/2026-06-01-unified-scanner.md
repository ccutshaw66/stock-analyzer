# Unified Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four scattered, shuffle-based scanners with one registry-driven scanner that scans the complete market deterministically, gates to green-grade (80+) setups, and is filtered by a required market-cap tier + adaptive price band + sector.

**Architecture:** A pure scan **engine** runs each registry-declared strategy detector over a deterministic, filter-narrowed universe and returns scored hits sorted best-first. A nightly **cron** pre-computes a market-wide ranked cache (disk, mirroring `long-range-cache.ts`); the **API** slices that cache by the user's required filters (instant) and offers a manual on-demand refresh. The **page + widget** are a standard compartment. Determinism comes from removing the Fisher-Yates shuffle for this path.

**Tech Stack:** TypeScript, Express, React + wouter + TanStack Query, existing FMP client (`fmpGet`), existing compartment/cron/disk-cache patterns. No new libraries.

**Testing convention:** This repo has no jest/vitest runner — it verifies via `npx tsc` (typecheck), `tsx` smoke scripts under `scripts/`, and live `/api/diag/*` endpoints. Each task's "test" step uses that convention. The FMP API key is NOT available locally, so engine smoke tests that hit FMP run against the deployed prod endpoint after deploy.

---

## File Structure

**New files:**
- `server/compartments/unified-scanner/engine.ts` — pure scan engine: universe resolve → per-strategy detect → score-gate → rank.
- `server/compartments/unified-scanner/warmup.ts` — market-wide pre-compute that writes the ranked disk cache.
- `server/compartments/unified-scanner/routes.ts` — `GET /api/unified-scanner` (+ `mountRoutes` export).
- `server/compartments/unified-scanner/index.ts` — server compartment manifest.
- `server/unified-scan-cache.ts` — disk cache read/write/fresh/age/list (mirror of `long-range-cache.ts`).
- `client/src/compartments/unified-scanner/index.ts` — client compartment manifest.
- `client/src/compartments/unified-scanner/useUnifiedScanner.ts` — query hook + filter types.
- `client/src/compartments/unified-scanner/UnifiedScannerWidget.tsx` — compact dashboard widget (top-5 green).
- `client/src/pages/unified-scanner.tsx` — full page (filters + results).
- `shared/scanner/types.ts` — shared `ScanHit`, `ScanFilters`, market-cap tiers + adaptive price bands.
- `scripts/unified-scan-smoke.ts` — local/prod smoke harness.

**Modified files:**
- `shared/strategies/registry.ts` — add optional `liveScan` field to `StrategyManifest`.
- `server/data/providers/fmp.adapter.ts` — add `noShuffle?: boolean` to `FmpScreenerFilters` + honor it.
- `server/cron.ts` — register `unified-scanner-warmup` job.
- `server/compartments/registry.ts` — register the server compartment.
- `client/src/compartments/registry.ts` — register the client compartment.
- `client/src/lib/page-registry.ts` — add `/scanner` entry pointing at the unified page (replace existing scanner entry).
- `client/src/App.tsx` — point `/scanner` route at the new page; redirect legacy routes.

---

## Task 1: Shared scanner types + market-cap/price taxonomy

**Files:**
- Create: `shared/scanner/types.ts`

- [ ] **Step 1: Define the shared contract.** Write `shared/scanner/types.ts`:

```typescript
/** One scored setup returned by the unified scanner. Provider-independent. */
export interface ScanHit {
  symbol: string;
  companyName: string;
  strategyId: string;       // matches a StrategyManifest.id
  strategyLabel: string;    // manifest.shortName for the badge
  score: number;            // 0–100 (only ≥ MIN_GREEN ever surfaced)
  direction: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  price: number;            // last close at scan time
  marketCap: number;
  sector: string;
  asOf: string;             // ISO date of the bar the hit fired on
}

export const MIN_GREEN = 80;            // hard floor — never show below this
export const DEFAULT_TOP_N = 25;

export type MarketCapTierId = "micro" | "small" | "mid" | "large" | "mega";

export interface MarketCapTier {
  id: MarketCapTierId;
  label: string;
  min: number;            // USD
  max: number | null;     // null = no upper bound
  /** Adaptive price bands shown for this tier. */
  priceBands: { id: string; label: string; min: number; max: number | null }[];
}

export const MARKET_CAP_TIERS: MarketCapTier[] = [
  { id: "micro", label: "Micro (<$300M)", min: 0, max: 300_000_000,
    priceBands: [
      { id: "p1", label: "$1–5", min: 1, max: 5 },
      { id: "p2", label: "$5–15", min: 5, max: 15 },
      { id: "p3", label: "$15–50", min: 15, max: 50 },
    ] },
  { id: "small", label: "Small ($300M–$2B)", min: 300_000_000, max: 2_000_000_000,
    priceBands: [
      { id: "p1", label: "$1–5", min: 1, max: 5 },
      { id: "p2", label: "$5–15", min: 5, max: 15 },
      { id: "p3", label: "$15–50", min: 15, max: 50 },
    ] },
  { id: "mid", label: "Mid ($2B–$10B)", min: 2_000_000_000, max: 10_000_000_000,
    priceBands: [
      { id: "p1", label: "$10–30", min: 10, max: 30 },
      { id: "p2", label: "$30–75", min: 30, max: 75 },
      { id: "p3", label: "$75–150", min: 75, max: 150 },
    ] },
  { id: "large", label: "Large ($10B–$200B)", min: 10_000_000_000, max: 200_000_000_000,
    priceBands: [
      { id: "p1", label: "$20–100", min: 20, max: 100 },
      { id: "p2", label: "$100–300", min: 100, max: 300 },
      { id: "p3", label: "$300+", min: 300, max: null },
    ] },
  { id: "mega", label: "Mega ($200B+)", min: 200_000_000_000, max: null,
    priceBands: [
      { id: "p1", label: "$20–100", min: 20, max: 100 },
      { id: "p2", label: "$100–300", min: 100, max: 300 },
      { id: "p3", label: "$300+", min: 300, max: null },
    ] },
}];

export interface ScanFilters {
  marketCapTier: MarketCapTierId;   // REQUIRED (no "all")
  priceBandId: string;              // REQUIRED, must belong to the tier
  sector: string | "all";           // optional
  strategyIds: string[];            // which strategies to run
  minScore: number;                 // ≥ MIN_GREEN, defaults to MIN_GREEN
  topN: number;                     // default DEFAULT_TOP_N
}
```

- [ ] **Step 2: Typecheck.** Run: `npx tsc` — Expected: no new errors referencing `shared/scanner/types.ts`.

- [ ] **Step 3: Commit.**
```bash
git add shared/scanner/types.ts
git commit -m "feat(scanner): shared scan types + market-cap/price taxonomy"
```

---

## Task 2: Make `fmpScreener` deterministic for the scanner path

**Files:**
- Modify: `server/data/providers/fmp.adapter.ts` (`FmpScreenerFilters` interface + the shuffle block in `fmpScreener`)

**Why:** the Fisher-Yates shuffle is the root cause of "russian roulette." Add an opt-in `noShuffle` so the unified scanner gets a stable, deterministic universe (sorted by market cap desc) while existing callers keep their current behavior.

- [ ] **Step 1: Add the flag to the interface.** In `FmpScreenerFilters` add:
```typescript
  /** When true, skip the Fisher-Yates shuffle and return a deterministic
   *  (market-cap desc) ordering. Used by the unified scanner so results are
   *  identical run-to-run. Existing callers omit it and keep the shuffle. */
  noShuffle?: boolean;
```

- [ ] **Step 2: Honor it in `fmpScreener`.** Replace the shuffle block with:
```typescript
  if (filters.noShuffle) {
    us.sort((a, b) => (Number(b.marketCap) || 0) - (Number(a.marketCap) || 0));
  } else {
    for (let i = us.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [us[i], us[j]] = [us[j], us[i]];
    }
  }
```

- [ ] **Step 3: Typecheck.** Run: `npx tsc` — Expected: no new errors.

- [ ] **Step 4: Commit.**
```bash
git add server/data/providers/fmp.adapter.ts
git commit -m "feat(scanner): opt-in deterministic fmpScreener (noShuffle)"
```

---

## Task 3: Extend the strategy registry with a `liveScan` declaration

**Files:**
- Modify: `shared/strategies/registry.ts` (`StrategyManifest` interface + the manifests that are live-scannable)

**Why:** the engine must discover scannable strategies from the registry (foundation-first), not hardcode them. `liveScan` declares the strategy id is runnable as a live detector and whether it's on by default.

- [ ] **Step 1: Add the field to `StrategyManifest`:**
```typescript
  /**
   * Marks a strategy that has a live bar-scanning detector wired into the
   * unified scanner. `defaultOn` controls whether it's selected by default
   * (experimental strategies set defaultOn:false). The detector itself is
   * registered server-side in server/compartments/unified-scanner/engine.ts
   * keyed by this manifest id — the registry just declares scannability so
   * the UI can list it.
   */
  liveScan?: { defaultOn: boolean };
```

- [ ] **Step 2: Declare it on the scannable manifests.** Add `liveScan: { defaultOn: true }` to: `HTF_MANIFEST`, `ROUNDING_BOTTOM_MANIFEST`, `WYCKOFF_SPRING_MANIFEST`, `BBTC_VER_MANIFEST`, `AMC_MANIFEST`. Add `liveScan: { defaultOn: false }` to `PIPE_BOTTOM_MANIFEST` (experimental — rare). Leave TFT/Insider/Manual/Other without `liveScan` (TFT = regime/weekly, Insider = filing-driven, both wired in a later piece).

- [ ] **Step 3: Add a helper at the bottom of the file:**
```typescript
/** Manifests that have a live scanning detector, for the unified scanner UI. */
export function listScannableStrategies(): StrategyManifest[] {
  return Object.values(STRATEGY_REGISTRY).filter(m => m.liveScan);
}
```

- [ ] **Step 4: Typecheck.** Run: `npx tsc` — Expected: no new errors.

- [ ] **Step 5: Commit.**
```bash
git add shared/strategies/registry.ts
git commit -m "feat(scanner): registry liveScan declaration for scannable strategies"
```

---

## Task 4: The scan engine (pure, deterministic)

**Files:**
- Create: `server/compartments/unified-scanner/engine.ts`
- Test: `scripts/unified-scan-smoke.ts`

**Responsibility:** given `ScanFilters` and a ticker list, fetch bars (reusing the existing FMP bar fetch + cache), run each selected strategy's detector adapter, keep only the most-recent hit per (symbol, strategy) within a freshness window, gate ≥ minScore, return `ScanHit[]` sorted by score desc then top-N.

- [ ] **Step 1: Build the detector adapter map.** In `engine.ts`, import the existing detectors (`scanHtf`, `scanRoundingBottom`, `scanWyckoffSpring`, `scanPipeBottom`, `computeBBTC`, `computeVER`, `scoreAMC` per the predictive-validate file's usage) and define an adapter per strategy id that returns the latest hit as a partial `ScanHit` (symbol/strategyId/score/direction/entry/stop/target/asOf). Pattern detectors already return `{breakoutDate, breakoutPrice, stopPrice, targetPrice, qualityScore}` — map those directly. For BBTC/VER/AMC, take the latest BUY/LONG bar within the freshness window and use its score.

```typescript
import type { OHLCV } from "../../data/types";
import type { ScanHit, ScanFilters } from "@shared/scanner/types";
import { MIN_GREEN } from "@shared/scanner/types";
import { scanHtf } from "../../signals/strategies/htf";
import { scanRoundingBottom } from "../../signals/strategies/rounding-bottom";
import { scanWyckoffSpring } from "../../signals/strategies/wyckoff-spring";
import { scanPipeBottom } from "../../signals/strategies/pipe-bottom";

const FRESHNESS_BARS = 3; // a hit counts if it fired within the last N bars

type DetectorFn = (bars: OHLCV[], symbol: string) => Array<{
  strategyId: string; score: number; direction: "long" | "short";
  entry: number; stop: number; target: number; asOf: Date;
}>;

const PATTERN_ADAPTERS: Record<string, DetectorFn> = {
  "htf": (b, s) => scanHtf(b, s, { lookbackDays: b.length }).map(h => ({
    strategyId: "htf", score: h.qualityScore, direction: "long",
    entry: h.breakoutPrice, stop: h.stopPrice, target: h.targetPrice, asOf: h.breakoutDate,
  })),
  "rounding-bottom": (b, s) => scanRoundingBottom(b, s, { lookbackDays: b.length }).map(h => ({
    strategyId: "rounding-bottom", score: h.qualityScore, direction: "long",
    entry: h.breakoutPrice, stop: h.stopPrice, target: h.targetPrice, asOf: h.breakoutDate,
  })),
  "wyckoff-spring": (b, s) => scanWyckoffSpring(b, s, { lookbackDays: b.length }).map(h => ({
    strategyId: "wyckoff-spring", score: h.qualityScore, direction: "long",
    entry: h.breakoutPrice, stop: h.stopPrice, target: h.targetPrice, asOf: h.breakoutDate,
  })),
  "pipe-bottom": (b, s) => scanPipeBottom(b, s, { lookbackWeeks: 104 }).map(h => ({
    strategyId: "pipe-bottom", score: h.qualityScore, direction: "long",
    entry: h.breakoutPrice, stop: h.stopPrice, target: h.targetPrice, asOf: h.breakoutDate,
  })),
  // bbtc-ver, amc adapters added in Step 2.
};
```

- [ ] **Step 2: Add BBTC+VER and AMC adapters** using the same indicator series the predictive-validate harness computes (copy the `computeEMA/ATR/Bollinger/RSI` setup from `server/diag/predictive-score-validate.ts:buildSamples`). Each returns the latest LONG BUY bar within `FRESHNESS_BARS` as a hit; entry = that close, stop = entry × 0.92 (BBTC hard-stop rule), target = entry × 1.2 placeholder until lifecycle target is wired. Quality = the strategy's own per-bar score (AMC `scoreAMC`; for BBTC/VER use a 0–100 mapped strength). **Keep these in a helper `computeIndicatorHits(bars, symbol)` so the file stays focused.**

- [ ] **Step 3: The engine entrypoint:**
```typescript
export interface UniverseRow { symbol: string; companyName: string; marketCap: number; sector: string; price: number; }

export async function scanOne(
  bars: OHLCV[], row: UniverseRow, strategyIds: string[], labelOf: (id: string) => string,
): Promise<ScanHit[]> {
  if (bars.length < 250) return [];
  const now = bars[bars.length - 1].t.getTime();
  const out: ScanHit[] = [];
  for (const id of strategyIds) {
    const adapter = PATTERN_ADAPTERS[id] ?? indicatorAdapterFor(id);
    if (!adapter) continue;
    const hits = adapter(bars, row.symbol)
      .filter(h => (now - h.asOf.getTime()) <= FRESHNESS_BARS * 86400000);
    // keep the single most-recent hit per strategy
    const latest = hits.sort((a, b) => b.asOf.getTime() - a.asOf.getTime())[0];
    if (!latest || latest.score < MIN_GREEN) continue;
    out.push({
      symbol: row.symbol, companyName: row.companyName, strategyId: id,
      strategyLabel: labelOf(id), score: latest.score, direction: latest.direction,
      entry: latest.entry, stop: latest.stop, target: latest.target,
      price: row.price, marketCap: row.marketCap, sector: row.sector,
      asOf: latest.asOf.toISOString().slice(0, 10),
    });
  }
  return out;
}

export function rankHits(hits: ScanHit[], minScore: number, topN: number): ScanHit[] {
  return hits.filter(h => h.score >= Math.max(minScore, MIN_GREEN))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
```

- [ ] **Step 4: Write the smoke harness** `scripts/unified-scan-smoke.ts`: loads `dotenv`, fetches bars for 3 HTF-band tickers via the existing bar fetcher, runs `scanOne` for `["htf","rounding-bottom","bbtc-ver","amc"]`, prints hits. (Mirrors `scripts/` smoke style.)

- [ ] **Step 5: Typecheck.** Run: `npx tsc` — Expected: no new errors in `engine.ts`.

- [ ] **Step 6: Commit.**
```bash
git add server/compartments/unified-scanner/engine.ts scripts/unified-scan-smoke.ts
git commit -m "feat(scanner): pure deterministic scan engine + smoke harness"
```

---

## Task 5: Disk cache for ranked results

**Files:**
- Create: `server/unified-scan-cache.ts`

- [ ] **Step 1: Mirror `long-range-cache.ts`** with `CACHE_DIR = ./data/unified-scan-cache`, a 26h TTL, and functions `readUnifiedScan(key)`, `readUnifiedScanFresh(key)`, `writeUnifiedScan(key, payload)`, `unifiedScanAgeHours(key)`, `listUnifiedScan()`. `payload` is `ScanHit[]` for the full market (pre-filter). `key` is the scan-config signature (e.g. `"market-all"` for the nightly full run).

- [ ] **Step 2: Typecheck + Commit.**
```bash
npx tsc
git add server/unified-scan-cache.ts
git commit -m "feat(scanner): disk cache for pre-ranked market-wide scan results"
```

---

## Task 6: Market-wide warmup + cron

**Files:**
- Create: `server/compartments/unified-scanner/warmup.ts`
- Modify: `server/cron.ts`

- [ ] **Step 1: `warmUnifiedScanCache({ maxSymbols })`** in `warmup.ts`: resolve the universe via `fmpScreener({ isActivelyTrading:true, minVolume: 500_000, count: maxSymbols, noShuffle: true })`, fetch bars per symbol in batches of 12 (reuse the diag bar fetcher pattern), run `scanOne` for all `defaultOn` scannable strategies, accumulate all hits market-wide, `writeUnifiedScan("market-all", hits)`. Return `{ written, errors }`.

- [ ] **Step 2: Register the cron job** in `server/cron.ts` (after the long-range warmup job):
```typescript
registerJob({
  id: "unified-scanner-warmup",
  description: "Nightly market-wide unified scan pre-compute (primes disk cache)",
  cron: "15 8 * * *",            // 3:15am ET
  timeoutMs: 40 * 60 * 1000,
  preventOverrun: true,
  runOnStart: false,
  handler: async () => {
    const { warmUnifiedScanCache } = await import("./compartments/unified-scanner/warmup");
    const res = await warmUnifiedScanCache({ maxSymbols: 3000 });
    console.log(`[CRON] unified scan warmup: ${res.written} hits, ${res.errors} errors`);
  },
});
```

- [ ] **Step 3: Typecheck + Commit.**
```bash
npx tsc
git add server/compartments/unified-scanner/warmup.ts server/cron.ts
git commit -m "feat(scanner): market-wide warmup + nightly cron"
```

---

## Task 7: API route + server compartment

**Files:**
- Create: `server/compartments/unified-scanner/routes.ts`, `server/compartments/unified-scanner/index.ts`
- Modify: `server/compartments/registry.ts`

- [ ] **Step 1: `routes.ts`** exports `mountRoutes(app)` registering `GET /api/unified-scanner` with `checkFeatureAccess('scansPerDay')` + `checkScanRateLimit`. Validate REQUIRED filters: 400 if `marketCapTier` missing/invalid or `priceBandId` not in that tier. Read `readUnifiedScanFresh("market-all")`; if missing (cold cache) OR `?refresh=1`, run `warmUnifiedScanCache` for the narrowed universe synchronously. Then filter the cached `ScanHit[]` by tier (marketCap range), price band, sector, strategyIds, `minScore` (floored at `MIN_GREEN`), and `rankHits(..., topN)`. Respond `{ filters, generatedAt, ageHours, hits }`.

- [ ] **Step 2: `index.ts`** server manifest:
```typescript
import type { ServerCompartmentEntry } from "../types";
import { mountRoutes } from "./routes";
export const unifiedScannerCompartment: ServerCompartmentEntry = {
  meta: { id: "unified-scanner", name: "Unified Scanner", tier: "free",
    description: "One scanner across every strategy; required filters + green-only gate." },
  mountRoutes,
};
```

- [ ] **Step 3: Register** in `server/compartments/registry.ts` (import + array entry).

- [ ] **Step 4: Typecheck + Commit.**
```bash
npx tsc
git add server/compartments/unified-scanner/ server/compartments/registry.ts
git commit -m "feat(scanner): /api/unified-scanner route + server compartment"
```

- [ ] **Step 5: Deploy + prod smoke (FMP key only on prod).** After merge to main + webhook deploy, hit `https://stockotter.ai/api/unified-scanner?marketCapTier=small&priceBandId=p2&minScore=80&topN=25` and confirm JSON `hits` are all score ≥ 80, sorted desc, and identical on a second call. Then `&refresh=1` returns fresh results.

---

## Task 8: Client hook + types

**Files:**
- Create: `client/src/compartments/unified-scanner/useUnifiedScanner.ts`

- [ ] **Step 1:** Export a `useUnifiedScanner(filters: ScanFilters | null)` hook (TanStack Query, `enabled: filters !== null` so it does NOT fire until required filters are set), querying `/api/unified-scanner?<params>`. Re-export `MARKET_CAP_TIERS`, `MIN_GREEN`, `ScanHit`, `ScanFilters` from `@shared/scanner/types` for the page.

- [ ] **Step 2: Typecheck + Commit.**
```bash
npx tsc
git add client/src/compartments/unified-scanner/useUnifiedScanner.ts
git commit -m "feat(scanner): client query hook (gated on required filters)"
```

---

## Task 9: Full page

**Files:**
- Create: `client/src/pages/unified-scanner.tsx`

- [ ] **Step 1: Filter bar** — Market-Cap select (options from `MARKET_CAP_TIERS`, **placeholder "Choose a tier", no "All"**); Price select (options = the chosen tier's `priceBands`, disabled until a tier is picked); Sector select (includes "All"); strategy multi-select (default = `listScannableStrategies().filter(defaultOn)`); top-N input; a min-score control floored at 80 with copy **"Showing green-grade setups only (80+)."** The **Scan** button is `disabled` until `marketCapTier && priceBandId` are set. A **Refresh now** button passes `refresh=1`.

- [ ] **Step 2: Results** — map `hits` to result cards: ticker + company name (the name calls `useTickerNavigate()(symbol)` → routes to `/profile`), strategy badge (brand color via design tokens — `SIGNAL_BULL` for long), score pill, entry/stop/target row, price/cap/sector line. Sort already done server-side.

- [ ] **Step 3: Branded states** — loading skeleton (not a bare spinner), empty state (otter + "No green-grade setups in <tier>/<price>/<sector> right now — widen a filter."), error state (friendly + retry). Use existing `PageHeader`.

- [ ] **Step 4: Typecheck + Commit.**
```bash
npx tsc
git add client/src/pages/unified-scanner.tsx
git commit -m "feat(scanner): unified scanner page (required filters + green gate)"
```

---

## Task 10: Dashboard widget + client compartment + registries + route

**Files:**
- Create: `client/src/compartments/unified-scanner/UnifiedScannerWidget.tsx`, `client/src/compartments/unified-scanner/index.ts`
- Modify: `client/src/compartments/registry.ts`, `client/src/lib/page-registry.ts`, `client/src/App.tsx`

- [ ] **Step 1: Widget** — compact view: a small market-cap + price picker (or a saved-default from widget `config`) and the top-5 green hits as condensed rows (ticker, strategy badge, score). Self-contained data via `useUnifiedScanner`. `widgetDefaultSize: TILE_MD`, `widgetMinSize: TILE_MIN_MD`.

- [ ] **Step 2: Client manifest `index.ts`:**
```typescript
import { TILE_MD, TILE_MIN_MD } from "@shared/dashboard/layout-tokens";
import type { ClientCompartmentEntry } from "../types";
import { UnifiedScannerWidget } from "./UnifiedScannerWidget";
export const unifiedScannerCompartment: ClientCompartmentEntry = {
  meta: { id: "unified-scanner", name: "Scanner", tier: "free",
    fullPageRoute: "/scanner",
    description: "One scanner across every strategy; green-grade setups only." },
  WidgetView: UnifiedScannerWidget,
  widgetDefaultSize: TILE_MD,
  widgetMinSize: TILE_MIN_MD,
};
```

- [ ] **Step 3: Register** in `client/src/compartments/registry.ts` (import + array entry).

- [ ] **Step 4: Route + page registry.** In `App.tsx` point `<Route path="/scanner" component={UnifiedScannerPage} />` at the new page (replacing the old `Scanner`). Update the existing `/scanner` entry in `page-registry.ts` subtitle to "One scanner, every strategy, green-grade only." Keep path `/scanner` so existing links/sidebar work.

- [ ] **Step 5: Typecheck + Commit.**
```bash
npx tsc
git add client/src/compartments/unified-scanner/ client/src/compartments/registry.ts client/src/lib/page-registry.ts client/src/App.tsx
git commit -m "feat(scanner): dashboard widget + register page/route at /scanner"
```

---

## Task 11: Consolidate / retire the legacy scanners

**Files:**
- Modify: `client/src/App.tsx` (legacy route redirects), `client/src/pages/scanner.tsx` (retire or reduce), `client/src/lib/page-registry.ts`

- [ ] **Step 1: Redirect legacy discovery routes.** The old `/scanner` page modes (3strategy/amc/v2) are replaced by the unified page. Keep the old component file for reference but stop routing to it. If any sidebar entries point to AMC/V2-specific surfaces, repoint to `/scanner`. (HTF's `/htf` pattern-chart drill-in stays.)

- [ ] **Step 2: Note the old API routes.** Leave `/api/scanner`, `/api/scanner/amc`, `/api/scanner/v2` in place for one release (no consumer once the page is swapped) and add a `// DEPRECATED — replaced by /api/unified-scanner` comment above each. Removal is a follow-up once confirmed unused.

- [ ] **Step 3: Typecheck + Commit.**
```bash
npx tsc
git add client/src/App.tsx client/src/lib/page-registry.ts client/src/pages/scanner.tsx
git commit -m "refactor(scanner): consolidate legacy scanners into the unified scanner"
```

---

## Task 12: CHANGES.md + ship

- [ ] **Step 1:** Add a CHANGES.md entry (use the `changes-entry` skill) summarizing the unified scanner: required filters, green-only gate, deterministic engine (shuffle root-cause fixed), nightly pre-rank cache + refresh, page + widget, legacy consolidation.

- [ ] **Step 2: Ship** via the `ship` skill (safe tag → push main → webhook deploy).

- [ ] **Step 3: Prod verification (small-first per sanity-check rule):** single filter combo first (`?marketCapTier=small&priceBandId=p2`), confirm deterministic + all ≥80, THEN exercise a few tier/price combos and the dashboard widget.

---

## Self-Review notes (done)

- **Spec coverage:** required filters (T1, T9), green gate (T1 MIN_GREEN, T7, T9), deterministic engine (T2, T4), complete-market + price filter (T6 universe, T1 bands), registry-driven (T3), page + widget (T9, T10), company name → /profile (T9 step 2), consolidation (T11). All covered.
- **Out of scope confirmed:** chart toggles, Profile narrative, usage workflow — not in any task.
- **Type consistency:** `ScanHit`/`ScanFilters`/`MIN_GREEN`/`MARKET_CAP_TIERS` defined once in T1 and reused verbatim in T4/T7/T8/T9. `liveScan`/`listScannableStrategies` defined T3, used T6/T9. `noShuffle` defined+used T2/T6.
- **Known execution caveat:** BBTC/VER/AMC score→0–100 mapping (T4 step 2) and the placeholder target need the real lifecycle target rule; flagged in-task. FMP key is prod-only, so engine validation is via the deployed endpoint (T7 step 5, T12 step 3).
