/**
 * TFT — Two-Layer Trend Continuation strategy.
 *
 * Designed to fix the "sit on cash for months" failure mode of BBTC+VER on
 * secular uptrends. NVDA 2015→2026 is the canonical case: per-trade $ P&L
 * eval shows BBTC+VER captured ~$31K on a stock that returned ~$3.78M
 * buy-and-hold. The 3×ATR trail stop kept getting shaken out by routine
 * 20-30% pullbacks that resolved higher.
 *
 * TFT keeps a CORE position on for the entire regime and uses BBTC/VER as a
 * TACTICAL scaling layer on top. Stop-and-reverse on regime flip — exit of
 * one position triggers consideration of the opposite (the user's explicit
 * design ask).
 *
 * Architecture:
 *   Layer 1 (CORE) — 1.0 unit, held while regime is confirmed bullish/bearish.
 *     Exits ONLY on a weekly close through the 40-week SMA OR a -15%
 *     catastrophic stop. No daily noise stops on the core.
 *   Layer 2 (TACTICAL) — 0.5-unit adds on BBTC_BUY / BBTC_ADD_LONG / VER_BUY
 *     while regime is bullish. Each tactical layer trails on 5×ATR. Tactical
 *     stops drop the layer but leave core intact. Re-engages on next signal.
 *
 * Regime (weekly):
 *   BULLISH  — weekly close > 40W SMA AND 40W SMA[t] > 40W SMA[t-4]
 *              (slope rising over 4 weeks)
 *   BEARISH  — weekly close < 40W SMA AND 40W SMA[t] < 40W SMA[t-4]
 *   NEUTRAL  — anything else; sit fully in cash
 *
 *   Whipsaw guard: regime must hold for 2 consecutive weekly closes before
 *   flipping direction. Single-week violations don't kick the core out.
 *
 * Position sizing:
 *   Each unit = positionSize dollars (default $10K). Max position = 2.0 units
 *   = $20K notional. NOTE: This means TFT can deploy up to 2× the capital of
 *   the per-trade strategy. The comparison to strategy-pnl.ts must account
 *   for this; basket aggregate reports max-units-deployed as a metric.
 *
 *   Volatility-adjusted core: if entry-bar ATR > 5% of price, core entry is
 *   0.5 unit instead of 1.0 (keeps dollar-risk consistent on high-vol names).
 *
 * Shorts:
 *   Demoted-to-info-only since 2026-05-08 across BBTC/VER. TFT brings shorts
 *   back BEHIND a strict regime filter (not via BBTC_SELL/VER_SELL events,
 *   which lost money historically). Short = regime confirmed bearish for 2
 *   consecutive weekly closes. Optional via input flag (default ON for TFT
 *   since stop-and-reverse is the whole point).
 */

export type TFTSide = "LONG" | "SHORT" | "FLAT";
export type TFTRegime = "BULLISH" | "BEARISH" | "NEUTRAL";
export type TFTLayerType = "CORE" | "TACTICAL";

/**
 * Core-stop sensitivity, governing how aggressively the CORE layer exits.
 *   - "40w" (default) — exit on weekly close < 40W SMA OR regime flip OR
 *     regime neutral OR -15% catastrophic. Same as the original TFT design.
 *   - "60w" — same exit triggers but uses a 60W SMA instead of 40W. Slower,
 *     captures more of long secular runs at the cost of bigger drawdowns
 *     when trends finally break.
 *   - "catastrophic-only" — ignores ALL regime / SMA-based exits. Core only
 *     closes on the -15% catastrophic stop from entry. Designed to capture
 *     the full NVDA-style moonshot at the cost of holding through worse
 *     drawdowns on names that genuinely roll over (NFLX 2022, MTCH, etc.).
 *     Tactical layers still trail-stop normally; only core is sticky.
 *
 * Regime detection itself always uses the 40W SMA; coreStopMode only changes
 * which SMA gates the core exit. Entry confirmation stays consistent.
 */
export type TFTCoreStopMode = "40w" | "60w" | "catastrophic-only";

export type TFTExitReason =
  | "WEEKLY_REGIME_BREAK"   // weekly close through 40W SMA → core exit
  | "REGIME_FLIP"           // regime reversed → exit current core, possibly reverse
  | "REGIME_NEUTRAL"        // regime went neutral → exit, sit in cash
  | "CATASTROPHIC_STOP"     // -15% from layer entry
  | "TACTICAL_TRAIL_STOP"   // 5×ATR trail on a tactical layer
  | "END_OF_WINDOW";        // open position at end of eval window

export interface TFTLayer {
  type: TFTLayerType;
  side: "LONG" | "SHORT";
  units: number;            // 1.0 for core, 0.5 for tactical
  entryDate: string;
  entryPrice: number;
  entryATR: number;
  highWaterPrice: number;   // for trail stop reference (long: max close since entry; short: min)
}

export interface TFTTrade {
  layerType: TFTLayerType;
  side: "LONG" | "SHORT";
  units: number;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  exitReason: TFTExitReason;
  holdBars: number;
  returnPct: number;        // (exit-entry)/entry, sign-adjusted for shorts
  pnlDollar: number;        // returnPct * units * positionSize
  isOpen: boolean;
}

export interface TFTInput {
  // Daily bars (sorted ascending by date)
  dates: string[];
  closes: number[];
  highs: number[];
  lows: number[];
  atr14: number[];

  // BBTC + VER signal streams from existing strategies (long-side only matters)
  bbtcSignals: Array<string | undefined>;     // "BUY" | "ADD_LONG" | "SELL" | "STOP_HIT" | "REDUCE" | undefined
  bbtcSides: Array<string | undefined>;       // "LONG" | "SHORT" | undefined
  verSignals: Array<string | undefined>;      // "BUY" | "STOP_HIT" | "SELL" | "WATCH_BUY" | undefined
  verSides: Array<string | undefined>;        // "LONG" | "SHORT" | undefined

  positionSize: number;                       // dollars per unit
  enableShorts: boolean;                      // default true for TFT

  /**
   * Minimum ATR-as-percent-of-price at entry, expressed as a fraction (e.g.
   * 0.015 = 1.5%). When set, CORE and TACTICAL entries are refused on bars
   * where atr14[i] / closes[i] < atrFloorPct. Designed to skip low-volatility
   * defensives (utilities, telecom, staples) where the trend follower bleeds
   * on chop without ever having room to capture a real move.
   *
   * 0 (default) disables the filter. Recommended starting value: 0.015.
   * Filter applies to entries only — never gates exits, so existing positions
   * always close on their normal triggers.
   */
  atrFloorPct: number;

  /** Core-stop sensitivity (see TFTCoreStopMode). */
  coreStopMode: TFTCoreStopMode;
}

export interface TFTResult {
  regime: TFTRegime[];                        // per-bar regime label (after whipsaw guard)
  positionUnits: number[];                    // per-bar net position (+long, −short)
  trades: TFTTrade[];
  finalEquity: number;                        // cash + open mark-to-market
  peakUnitsDeployed: number;                  // max simultaneous units (1.0, 1.5, or 2.0)
  daysInMarket: number;                       // bars where position was nonzero
  totalBars: number;
}

// ─── Weekly aggregation ───────────────────────────────────────────────────
// Groups daily bars into ISO weeks (Mon-Fri). For each week, the "weekly close"
// is the close of the LAST daily bar in that week. Maps the resulting weekly
// SMA(40) and slope back to every daily bar — the daily bar inherits the
// regime label as of its containing week's last close.

interface WeeklyAgg {
  weekIdx: number[];        // length = daily bars; -1 until the first week completes
  weeklyClose: number[];    // length = number of weeks
  weeklySma40: number[];    // length = number of weeks; used by regime + 40w core stop
  weeklySma40_4WkAgo: number[]; // length = number of weeks; SMA40[w-4] (slope check)
  weeklySma60: number[];    // length = number of weeks; used by 60w core stop only
}

function aggregateWeekly(dates: string[], closes: number[]): WeeklyAgg {
  // ISO week key = year + ISO week number
  function isoWeekKey(d: string): string {
    const dt = new Date(d + "T00:00:00Z");
    const target = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
    const dayNum = (target.getUTCDay() + 6) % 7;        // Mon=0..Sun=6
    target.setUTCDate(target.getUTCDate() - dayNum + 3);
    const firstThursday = target.getTime();
    target.setUTCMonth(0, 1);
    if (target.getUTCDay() !== 4) {
      target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
    }
    const weekNum = 1 + Math.ceil((firstThursday - target.getTime()) / 604800000);
    return `${new Date(firstThursday).getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
  }

  const weekIdx = new Array(dates.length).fill(-1);
  const weeklyClose: number[] = [];
  const weekKeys: string[] = [];
  let currentKey = "";
  let currentWeekIdx = -1;
  for (let i = 0; i < dates.length; i++) {
    const k = isoWeekKey(dates[i]);
    if (k !== currentKey) {
      currentKey = k;
      currentWeekIdx++;
      weekKeys.push(k);
      weeklyClose.push(closes[i]);
    } else {
      weeklyClose[currentWeekIdx] = closes[i]; // overwrite each day; last wins
    }
    weekIdx[i] = currentWeekIdx;
  }

  // 40-week SMA on weekly closes
  const weeklySma40 = new Array(weeklyClose.length).fill(NaN);
  for (let w = 39; w < weeklyClose.length; w++) {
    let s = 0;
    for (let j = w - 39; j <= w; j++) s += weeklyClose[j];
    weeklySma40[w] = s / 40;
  }

  // SMA40 four weeks ago (for slope check)
  const weeklySma40_4WkAgo = new Array(weeklyClose.length).fill(NaN);
  for (let w = 4; w < weeklyClose.length; w++) {
    weeklySma40_4WkAgo[w] = weeklySma40[w - 4];
  }

  // 60-week SMA on weekly closes (used only when coreStopMode = "60w")
  const weeklySma60 = new Array(weeklyClose.length).fill(NaN);
  for (let w = 59; w < weeklyClose.length; w++) {
    let s = 0;
    for (let j = w - 59; j <= w; j++) s += weeklyClose[j];
    weeklySma60[w] = s / 60;
  }

  return { weekIdx, weeklyClose, weeklySma40, weeklySma40_4WkAgo, weeklySma60 };
}

// ─── Per-bar regime computation ────────────────────────────────────────────
// Returns the RAW regime per bar (no whipsaw smoothing yet). A bar's regime
// uses the last-completed week's data — we only flip on the LAST DAILY BAR
// of a week (when the weekly close is fresh). Mid-week bars carry forward
// the prior week's regime.

function computeRawRegime(agg: WeeklyAgg, dailyBars: number): TFTRegime[] {
  const raw: TFTRegime[] = new Array(dailyBars).fill("NEUTRAL");
  for (let i = 0; i < dailyBars; i++) {
    const w = agg.weekIdx[i];
    // Need at least 40 weeks of data + 4 weeks for slope
    if (w < 0 || w < 43) { raw[i] = "NEUTRAL"; continue; }
    const closeW = agg.weeklyClose[w];
    const sma = agg.weeklySma40[w];
    const sma4 = agg.weeklySma40_4WkAgo[w];
    if (isNaN(sma) || isNaN(sma4)) { raw[i] = "NEUTRAL"; continue; }
    const aboveSma = closeW > sma;
    const slopeUp = sma > sma4;
    if (aboveSma && slopeUp) raw[i] = "BULLISH";
    else if (!aboveSma && !slopeUp) raw[i] = "BEARISH";
    else raw[i] = "NEUTRAL";
  }
  return raw;
}

// Whipsaw guard: a CONFIRMED regime requires 2 consecutive weekly closes in
// the same direction. We compute this by looking at the regime as of each
// weekly-close boundary and only flipping after 2 consecutive matches.

function applyWhipsawGuard(rawRegime: TFTRegime[], weekIdx: number[]): TFTRegime[] {
  const confirmed: TFTRegime[] = new Array(rawRegime.length).fill("NEUTRAL");
  let lastConfirmed: TFTRegime = "NEUTRAL";
  let pendingCandidate: TFTRegime = "NEUTRAL";
  let pendingWeeks = 0;
  let currentWeek = -1;

  for (let i = 0; i < rawRegime.length; i++) {
    const w = weekIdx[i];
    // Only re-evaluate at the LAST DAILY BAR of a week (when weekly close just settled).
    // We approximate this by detecting week-boundary transitions: when w increments,
    // the PRIOR bar was the last bar of the previous week.
    const isLastBarOfWeek = (i + 1 < rawRegime.length && weekIdx[i + 1] !== w) || (i === rawRegime.length - 1);
    if (isLastBarOfWeek && w !== currentWeek) {
      currentWeek = w;
      const proposed = rawRegime[i];
      if (proposed === lastConfirmed) {
        pendingCandidate = "NEUTRAL";
        pendingWeeks = 0;
      } else if (proposed === pendingCandidate) {
        pendingWeeks++;
        if (pendingWeeks >= 1) { // 2 consecutive: this week + the prior pending week = 2
          lastConfirmed = proposed;
          pendingCandidate = "NEUTRAL";
          pendingWeeks = 0;
        }
      } else {
        pendingCandidate = proposed;
        pendingWeeks = 0;
      }
    }
    confirmed[i] = lastConfirmed;
  }
  return confirmed;
}

// ─── Main simulator ───────────────────────────────────────────────────────

const TACTICAL_TRAIL_ATR = 5.0;             // 5×ATR trail on tactical layers
const CATASTROPHIC_STOP_PCT = 0.15;         // -15% absolute floor on any layer
const HIGH_VOL_ATR_PCT = 0.05;              // ATR > 5% of price → half-size core
const MAX_TOTAL_UNITS = 2.0;                // hard cap on combined position

export function simulateTFT(input: TFTInput): TFTResult {
  const {
    dates, closes, highs, lows, atr14,
    bbtcSignals, bbtcSides, verSignals, verSides,
    positionSize, enableShorts, atrFloorPct, coreStopMode,
  } = input;

  function atrPassesFloor(i: number): boolean {
    if (atrFloorPct <= 0) return true;
    const atr = atr14[i];
    if (!Number.isFinite(atr) || closes[i] <= 0) return false;
    return atr / closes[i] >= atrFloorPct;
  }

  const n = closes.length;
  const agg = aggregateWeekly(dates, closes);
  const rawRegime = computeRawRegime(agg, n);
  const regime = applyWhipsawGuard(rawRegime, agg.weekIdx);

  const positionUnits: number[] = new Array(n).fill(0);
  const trades: TFTTrade[] = [];
  let layers: TFTLayer[] = []; // FIFO stack — bottom is core
  let peakUnits = 0;
  let daysInMarket = 0;

  function totalUnits(): number {
    return layers.reduce((a, l) => a + l.units * (l.side === "LONG" ? 1 : -1), 0);
  }
  function absUnits(): number {
    return layers.reduce((a, l) => a + l.units, 0);
  }
  function currentSide(): "LONG" | "SHORT" | "FLAT" {
    if (layers.length === 0) return "FLAT";
    return layers[0].side;
  }
  function getCore(): TFTLayer | null {
    return layers.find(l => l.type === "CORE") || null;
  }

  function closeLayer(layer: TFTLayer, exitDate: string, exitPrice: number, reason: TFTExitReason, exitBarIdx: number, entryBarIdx: number): void {
    const isLong = layer.side === "LONG";
    const ret = isLong
      ? (exitPrice - layer.entryPrice) / layer.entryPrice
      : (layer.entryPrice - exitPrice) / layer.entryPrice;
    trades.push({
      layerType: layer.type,
      side: layer.side,
      units: layer.units,
      entryDate: layer.entryDate,
      entryPrice: Number(layer.entryPrice.toFixed(2)),
      exitDate,
      exitPrice: Number(exitPrice.toFixed(2)),
      exitReason: reason,
      holdBars: exitBarIdx - entryBarIdx,
      returnPct: Number(ret.toFixed(4)),
      pnlDollar: Number((ret * layer.units * positionSize).toFixed(2)),
      isOpen: false,
    });
  }

  function closeAllLayers(exitDate: string, exitPrice: number, reason: TFTExitReason, exitBarIdx: number): void {
    // Close in reverse order (top of stack first)
    for (let li = layers.length - 1; li >= 0; li--) {
      const layer = layers[li];
      // We don't track entry bar index per layer — use a sentinel based on dates
      const entryIdx = dates.indexOf(layer.entryDate);
      closeLayer(layer, exitDate, exitPrice, reason, exitBarIdx, entryIdx >= 0 ? entryIdx : exitBarIdx);
    }
    layers = [];
  }

  function openCore(side: "LONG" | "SHORT", i: number): void {
    const atr = atr14[i];
    if (!Number.isFinite(atr)) return;
    if (!atrPassesFloor(i)) return;
    // Volatility-adjusted: high-vol names get half-size core
    const atrPct = atr / closes[i];
    const units = atrPct > HIGH_VOL_ATR_PCT ? 0.5 : 1.0;
    layers.push({
      type: "CORE",
      side,
      units,
      entryDate: dates[i],
      entryPrice: closes[i],
      entryATR: atr,
      highWaterPrice: closes[i],
    });
  }

  function addTactical(side: "LONG" | "SHORT", i: number): boolean {
    if (absUnits() + 0.5 > MAX_TOTAL_UNITS) return false;
    const atr = atr14[i];
    if (!Number.isFinite(atr)) return false;
    if (!atrPassesFloor(i)) return false;
    layers.push({
      type: "TACTICAL",
      side,
      units: 0.5,
      entryDate: dates[i],
      entryPrice: closes[i],
      entryATR: atr,
      highWaterPrice: closes[i],
    });
    return true;
  }

  function popTopTactical(i: number, reason: TFTExitReason): void {
    for (let li = layers.length - 1; li >= 0; li--) {
      if (layers[li].type === "TACTICAL") {
        const layer = layers[li];
        const entryIdx = dates.indexOf(layer.entryDate);
        closeLayer(layer, dates[i], closes[i], reason, i, entryIdx >= 0 ? entryIdx : i);
        layers.splice(li, 1);
        return;
      }
    }
  }

  // Per-bar walk
  for (let i = 0; i < n; i++) {
    const close = closes[i];
    const high = highs[i];
    const low = lows[i];
    const today = dates[i];
    const todayRegime = regime[i];

    // ── 1) Update high-water marks for trail stops ──
    for (const layer of layers) {
      if (layer.side === "LONG" && high > layer.highWaterPrice) layer.highWaterPrice = high;
      if (layer.side === "SHORT" && low < layer.highWaterPrice) layer.highWaterPrice = low;
    }

    // ── 2) Check core exits (in priority order) ──
    const core = getCore();
    if (core) {
      // 2a) Catastrophic stop (-15% from core entry)
      const catastrophicHit = core.side === "LONG"
        ? close <= core.entryPrice * (1 - CATASTROPHIC_STOP_PCT)
        : close >= core.entryPrice * (1 + CATASTROPHIC_STOP_PCT);
      if (catastrophicHit) {
        closeAllLayers(today, close, "CATASTROPHIC_STOP", i);
      } else if (coreStopMode !== "catastrophic-only") {
        // 2b) Regime-based core exits — only act on the LAST DAILY BAR of a week
        // (when weekly close just settled). Approximated by detecting week boundary.
        // Skipped entirely in catastrophic-only mode where the core only closes
        // on the -15% catastrophic stop above.
        const isLastBarOfWeek = (i + 1 < n && agg.weekIdx[i + 1] !== agg.weekIdx[i]) || (i === n - 1);
        if (isLastBarOfWeek) {
          const w = agg.weekIdx[i];
          const weeklyClose = agg.weeklyClose[w];
          const stopSma = coreStopMode === "60w" ? agg.weeklySma60[w] : agg.weeklySma40[w];
          const regimeFlipped =
            (core.side === "LONG" && todayRegime === "BEARISH") ||
            (core.side === "SHORT" && todayRegime === "BULLISH");
          const regimeNeutral = todayRegime === "NEUTRAL";
          const weeklyBreak = !isNaN(stopSma) && (
            (core.side === "LONG" && weeklyClose < stopSma) ||
            (core.side === "SHORT" && weeklyClose > stopSma)
          );
          if (regimeFlipped) {
            closeAllLayers(today, close, "REGIME_FLIP", i);
          } else if (weeklyBreak) {
            closeAllLayers(today, close, "WEEKLY_REGIME_BREAK", i);
          } else if (regimeNeutral) {
            closeAllLayers(today, close, "REGIME_NEUTRAL", i);
          }
        }
      }
    }

    // ── 3) Check tactical trail stops on remaining layers ──
    if (layers.length > 0 && Number.isFinite(atr14[i])) {
      // Walk top-down so popping doesn't shift indices we still need
      for (let li = layers.length - 1; li >= 0; li--) {
        const layer = layers[li];
        if (layer.type !== "TACTICAL") continue;
        const trailDistance = TACTICAL_TRAIL_ATR * layer.entryATR;
        const stopHit = layer.side === "LONG"
          ? low <= layer.highWaterPrice - trailDistance
          : high >= layer.highWaterPrice + trailDistance;
        const catastrophicTactical = layer.side === "LONG"
          ? close <= layer.entryPrice * (1 - CATASTROPHIC_STOP_PCT)
          : close >= layer.entryPrice * (1 + CATASTROPHIC_STOP_PCT);
        if (stopHit || catastrophicTactical) {
          const entryIdx = dates.indexOf(layer.entryDate);
          const reason: TFTExitReason = catastrophicTactical ? "CATASTROPHIC_STOP" : "TACTICAL_TRAIL_STOP";
          closeLayer(layer, today, close, reason, i, entryIdx >= 0 ? entryIdx : i);
          layers.splice(li, 1);
        }
      }
    }

    // ── 4) Entries (after exits, so same-bar reversal is possible) ──
    const sideNow = currentSide();
    if (sideNow === "FLAT") {
      // Only enter if regime is confirmed
      if (todayRegime === "BULLISH") {
        openCore("LONG", i);
      } else if (todayRegime === "BEARISH" && enableShorts) {
        openCore("SHORT", i);
      }
    } else {
      // Tactical adds — only on long-side BBTC/VER signals while bullish regime,
      // or short-side equivalents while bearish (but short signals are info-only
      // post-2026-05-08 so we only see the BUY-side signals firing). For shorts
      // the core is already in; we don't tactical-add shorts in V1.
      if (sideNow === "LONG" && todayRegime === "BULLISH") {
        const bbSig = bbtcSignals[i];
        const bbSide = bbtcSides[i];
        const vSig = verSignals[i];
        const vSide = verSides[i];
        const bbAddLong = (bbSig === "BUY" || bbSig === "ADD_LONG") && bbSide === "LONG";
        const verAddLong = vSig === "BUY" && vSide === "LONG";
        if (bbAddLong || verAddLong) {
          addTactical("LONG", i);
        }
        // BBTC_REDUCE on the long side trims one tactical layer (don't touch core)
        if (bbSig === "REDUCE" && bbSide === "LONG") {
          popTopTactical(i, "TACTICAL_TRAIL_STOP");
        }
      }
    }

    // ── 5) Bookkeeping ──
    positionUnits[i] = totalUnits();
    const u = absUnits();
    if (u > peakUnits) peakUnits = u;
    if (u > 0) daysInMarket++;
  }

  // ── Final: close any open positions at last close as END_OF_WINDOW ──
  // BUT report them with isOpen=true for the per-trade detail, mark realized
  // P&L excluded from aggregates (handled by the evaluator).
  if (layers.length > 0) {
    const lastIdx = n - 1;
    const lastDate = dates[lastIdx];
    const lastClose = closes[lastIdx];
    for (const layer of layers) {
      const isLong = layer.side === "LONG";
      const ret = isLong
        ? (lastClose - layer.entryPrice) / layer.entryPrice
        : (layer.entryPrice - lastClose) / layer.entryPrice;
      const entryIdx = dates.indexOf(layer.entryDate);
      trades.push({
        layerType: layer.type,
        side: layer.side,
        units: layer.units,
        entryDate: layer.entryDate,
        entryPrice: Number(layer.entryPrice.toFixed(2)),
        exitDate: lastDate,
        exitPrice: Number(lastClose.toFixed(2)),
        exitReason: "END_OF_WINDOW",
        holdBars: lastIdx - (entryIdx >= 0 ? entryIdx : lastIdx),
        returnPct: Number(ret.toFixed(4)),
        pnlDollar: Number((ret * layer.units * positionSize).toFixed(2)),
        isOpen: true,
      });
    }
  }

  // Equity (simple — assumes 1.0 unit ≡ positionSize cash deployed; sums realized P&L)
  const realizedPnL = trades
    .filter(t => !t.isOpen)
    .reduce((a, t) => a + t.pnlDollar, 0);
  const finalEquity = realizedPnL;

  return {
    regime,
    positionUnits,
    trades,
    finalEquity,
    peakUnitsDeployed: Number(peakUnits.toFixed(2)),
    daysInMarket,
    totalBars: n,
  };
}
