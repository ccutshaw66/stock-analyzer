# Wyckoff Spring — Strategy Spec

**Status:** SPEC (not implemented). Top-3 #3 from `reference_trading_library_findings`.
**Plugs into:** `STRATEGY_REGISTRY` (`shared/strategies/registry.ts`) under id `wyckoff-spring`.
**Detector lives at:** `server/signals/strategies/wyckoff-spring.ts` (parallel to `htf.ts`).
**Backtest harness:** `server/diag/strategy-wyckoff-spring-pnl.ts` (parallel to `strategy-htf-pnl.ts`).

---

## 1. Pattern definition

Wyckoff's classic accumulation Spring: a **false breakdown** at the bottom of a multi-week trading range that flushes weak hands, then reverses sharply. The setup has 4 ordered phases:

1. **Trading range (TR)** — N bars where price oscillates between a defined support and resistance band.
2. **Spring** — a single bar that pierces below TR support intraday and closes back **inside** the range (or at most 1% below it).
3. **Test** (optional but adds quality) — a later bar that revisits the spring low on materially lighter volume than the spring bar.
4. **Sign of Strength (SOS)** — close above TR midpoint on volume > range average, confirming demand.

The setup fires on the SOS bar. Entry is the next day's open.

---

## 2. Detection rules (numeric)

All thresholds tunable as `const` exports (match HTF style):

```ts
// Trading range
export const TR_MIN_DAYS = 20;            // ≥ 4 weeks of oscillation
export const TR_MAX_DAYS = 120;           // ≤ 6 months
export const TR_MAX_WIDTH_PCT = 0.25;     // top within 25% of bottom (tight range)
export const TR_MIN_TOUCHES = 4;          // ≥2 highs + ≥2 lows touching boundaries

// Spring
export const SPRING_PIERCE_MIN_PCT = 0.005;  // must pierce ≥ 0.5% below TR_low intraday
export const SPRING_CLOSE_MAX_BELOW_PCT = 0.01; // closes within 1% below TR_low (or above)
export const SPRING_VOL_MIN_RATIO = 1.0;  // ≥ avg range volume

// Test (optional — adds +15 to score when present)
export const TEST_LOOKAHEAD_MAX_BARS = 10;     // test must occur within 10 bars of spring
export const TEST_VOL_MAX_RATIO = 0.7;         // test volume ≤ 70% of spring volume
export const TEST_PRICE_BAND_PCT = 0.02;       // test low within 2% of spring low

// Sign of Strength (SOS) — the FIRE bar
export const SOS_MAX_BARS_AFTER_SPRING = 15;   // SOS must come within 15 bars of spring
export const SOS_CLOSE_ABOVE_MID = true;       // close > (TR_high + TR_low) / 2
export const SOS_VOL_MIN_RATIO = 1.2;          // ≥1.2× range average

// Resistance look-back (info-only, mirrors htf.ts piece 3)
export const OVERHEAD_RESISTANCE_PCT = 0.10;
export const OVERHEAD_RESISTANCE_LOOKBACK_BARS = 252;
```

**Quality score** (0–100, same scale as HTF so Chris's `minScore=70` rule transfers):

| Component | Points | Logic |
|---|---|---|
| Spring pierce depth | 0–20 | linear 0.5%→0pt, 5%→20pt (deeper flush = stronger reversal) |
| Spring vol surge | 0–15 | `min((vol/range_avg − 1) × 30, 15)` |
| Test present? | 0–15 | binary — adds 15 if a clean test bar exists in window |
| SOS vol confirmation | 0–20 | `min((SOS_vol/range_avg − 1) × 40, 20)` |
| Range tightness | 0–15 | linear 25%→0pt, 8%→15pt (tighter range = stronger setup) |
| Range duration | 0–15 | linear 20d→0pt, 60d+→15pt (longer accumulation = more energy) |

Score ≥ 70 = production fire. Below that = noise.

---

## 3. Entry / stop / target / exit lifecycle

Mirrors HTF lifecycle shape so the trade-tracker manifest is a near-copy of `HTF_MANIFEST`.

- **Entry:** next day's open after SOS bar.
- **Hard stop:** `spring_low × 0.98` (intraday). If the spring low gets violated, the pattern failed — exit.
- **Initial target (measure rule):** `entry + (TR_high − TR_low)` — the classic Wyckoff projection (range height projected up from breakout).
- **Partial exit:** sell 1/3 when price closes above `entry × 1.10` (10% gain) for 2 consecutive days. Less aggressive than HTF's 3-day strength rule because Spring trades expand into the empty range faster.
- **Trailing stop:** trail remaining 2/3 below the **20-day SMA** after partial fires (same as HTF — proven mechanism).

**Exit reasons** (for harness compatibility): `stop_hit`, `target_hit`, `partial_taken`, `trail_exit`, `time_stop` (disabled by default, same as HTF).

---

## 4. Strategy registry plug-in

Add to `shared/strategies/registry.ts`:

```ts
const WYCKOFF_SPRING_MANIFEST: StrategyManifest = {
  id: "wyckoff-spring",
  name: "Wyckoff Spring",
  shortName: "Spring",
  description: "False breakdown at TR bottom → SOS → trend up. Wyckoff accumulation.",
  color: "bull",
  requiresReason: false,
  columnOrder: ["Stop", "Take 1/3", "Took 1/3", "Trail 20-MA", "Target", "TR range", "Spring"],
  evaluate(trade) { /* near-copy of HTF_MANIFEST.evaluate; see note below */ },
};

export const STRATEGY_REGISTRY: Record<string, StrategyManifest> = {
  htf: HTF_MANIFEST,
  "wyckoff-spring": WYCKOFF_SPRING_MANIFEST,  // ← new
  "bbtc-ver": BBTC_VER_MANIFEST,
  // ...
};
```

The `evaluate()` body is a near-copy of `HTF_MANIFEST.evaluate` with the partial rule swapped (2 consecutive +10% days instead of 3 cumulative +5% strength days). All other points (Stop, Trail 20-MA, Target, vs entry) are identical.

`strategyData` fields the detector writes onto a new trade:

```ts
{
  trRangeStart: Date,
  trRangeEnd: Date,         // = spring date
  trHigh: number,
  trLow: number,
  springLow: number,
  springVolRatio: number,
  hasTest: boolean,
  testDate: Date | null,
  sosDate: Date,
  sosVolRatio: number,
  stopPrice: number,        // spring_low × 0.98
  targetPrice: number,      // entry + (TR_high − TR_low)
  ma20: number,             // snapshot at entry
}
```

---

## 5. Files to create / modify

| File | Action | Notes |
|---|---|---|
| `server/signals/strategies/wyckoff-spring.ts` | **create** | Detector. Parallel to `htf.ts`. Exports `scanWyckoffSpring()` and `WyckoffSpringHit`. |
| `server/diag/strategy-wyckoff-spring-pnl.ts` | **create** | Backtest harness. Parallel to `strategy-htf-pnl.ts`. Same per-ticker JSON shape so the comparison endpoint logic stays uniform. |
| `server/routes.ts` | **modify** | Add `/api/diag/strategy-wyckoff-spring-pnl` route mirroring HTF route. |
| `shared/strategies/registry.ts` | **modify** | Add `WYCKOFF_SPRING_MANIFEST` + register under id `wyckoff-spring`. |
| `server/signals/universe/wyckoff-spring-universe.ts` | **create later** | Universe filter. Defer until detector + backtest prove the strategy is positive-EV. Until then, reuse the HTF universe (491 tickers). |
| `client/src/pages/...` | **defer** | No Live/Watch UI yet. Detector + backtest first. Wire UI only after positive-EV gate clears. |

---

## 6. Acceptance criteria (ship gate)

The strategy ships into the live pipeline ONLY IF, on the same 491-ticker / 10-year / $1,750-per-trade / `minScore=70` basket Chris uses for HTF evaluation:

- **Total P&L > $0** across the basket (positive-EV — the demote rules from `todo_short_side_rebuild` apply: nothing re-enables until per-trade dollar P&L is positive on backtest).
- **Per-trade $ EV ≥ $30** (HTF baseline is $64.12/trade; lower bar acceptable for a new diversifying strategy, but not negative).
- **Win rate ≥ 50%** OR **R-multiple ≥ 1.5** (one or the other — Wyckoff Springs may have lower hit-rate but bigger wins).
- **Max drawdown ≤ HTF baseline max DD** (don't add a strategy that worsens portfolio risk profile).

If any criterion fails, the harness ships (gated behind the route) but the manifest **does not** register in `STRATEGY_REGISTRY`. The Add-Trade dropdown stays HTF-only until the gate clears.

---

## 7. Implementation order (cut-and-paste path)

1. Create `wyckoff-spring.ts` detector + unit-test it against 3–5 known historical Springs (e.g. AAPL 2016, AMZN 2018, NVDA 2022). Manually verify by eye on `/htf/:symbol` chart route.
2. Create `strategy-wyckoff-spring-pnl.ts` harness — copy `strategy-htf-pnl.ts` and swap detector + entry/exit rules.
3. Wire `/api/diag/strategy-wyckoff-spring-pnl` route.
4. Run against the 491-ticker basket. Check acceptance criteria. Paste result into CHANGES.md.
5. If gate clears → add `WYCKOFF_SPRING_MANIFEST` to registry → ship to Live tab.
6. If gate fails → log result, leave detector + harness in place for future tuning, do NOT register manifest.

Each step ships behind its own `safe/<timestamp>` tag per the deploy workflow.

---

## 8. Open questions (decisions made — no jargon quiz)

- **Spring detection on intraday data?** No. Daily OHLCV only. The "pierce below intraday, close back inside" check uses bar low vs bar close — equivalent on daily bars and matches the existing data layer.
- **Test bar required?** No. Tested Springs score higher but un-tested Springs still fire if the rest of the components clear `minScore=70`. Bulkowski data shows un-tested Springs work; just smaller cohort.
- **Volume scale comparison?** All volume ratios compare against the **trading-range average** (not 30-day SMA used in HTF) — Wyckoff's framing is range-relative.
- **Range definition?** Top = highest high in window. Bottom = lowest low in window. Both excluded from the spring bar itself (the spring is the bar that PIERCES the established bottom, so the bottom is the prior low).
