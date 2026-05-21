/**
 * HTF live-lifecycle simulator.
 *
 * For an OPEN HTF position, walks the symbol's bars from entry date to
 * today and returns the trade's current lifecycle state:
 *   - has the stop already been hit (intraday low)?
 *   - has the target been hit?
 *   - has the breakout failed (close back below flag_high within first 3 bars)?
 *   - has the 1/3 partial fired? when? at what price?
 *   - current 20-day MA (only relevant after partial fires)
 *   - current cumulative close-strength day counter (before partial)
 *   - max favorable excursion (highest high since entry)
 *   - max adverse excursion (lowest low since entry)
 *
 * The lifecycle persists for the WHOLE life of the trade, not just for the
 * 1-day live scan window. Used by the Current Positions page to show
 * truthful "Took 1/3 ✓", "Trail below 20-MA at $X", "Stop hit" state on
 * every render — driven by bars, not by what the live scan happens to see.
 *
 * Pure function. Caller fetches bars + the trade and passes them in.
 */

import type { OHLCV } from "../../data/types";

export interface HtfLifecycleState {
  /** Days held (calendar) since the entry date. */
  daysHeld: number;
  /** Number of trading bars walked since entry. */
  barsHeld: number;
  /** Highest high seen since entry. */
  peakSinceEntry: number;
  /** Lowest low seen since entry. */
  troughSinceEntry: number;
  /** Max % gain from entry on any closing price since entry. */
  maxGainPct: number;
  /** Max % drawdown from peak since entry. */
  maxDrawdownPct: number;
  /** True if intraday low ever hit stopPrice. */
  hasStopped: boolean;
  /** Date the stop fired (YYYY-MM-DD), if hasStopped. */
  stoppedDate: string | null;
  /** True if intraday high ever hit targetPrice. */
  hasTargeted: boolean;
  /** Date the target fired (YYYY-MM-DD), if hasTargeted. */
  targetedDate: string | null;
  /**
   * True if within first 3 bars after entry, close fell back below
   * `flag_high` — Wyckoff Upthrust / Woods Hikkake signature. Informational
   * (we don't auto-exit; that experiment failed in 2026-05-20 testing).
   */
  hadFailedBreakout: boolean;
  /** True if the take-1/3 partial rule has fired. */
  partialDone: boolean;
  /** Date the partial fired (YYYY-MM-DD), if partialDone. */
  partialDate: string | null;
  /** Close price at the bar that triggered the partial. */
  partialPrice: number | null;
  /**
   * Cumulative count of close-strength days since entry (close >5% above entry).
   * Resets to 0 on any non-strength close. Reaches 3 = partial fires.
   * Stops mattering after partialDone.
   */
  currentStrengthDays: number;
  /** Latest 20-bar SMA on closes (post-entry bars + a 20-bar warm-up window). */
  currentMa20: number | null;
  /**
   * Total trade-level percent change from entry to the LATEST close in the
   * window. The "where am I right now" number.
   */
  currentPct: number;
}

/**
 * Walks bars from entry forward and returns the trade's live lifecycle.
 *
 * @param bars     All available bars for the symbol, oldest → newest.
 * @param entryDateIso  Entry date in YYYY-MM-DD. The bar AT this date (or the
 *                      first bar AFTER) becomes the first walked bar.
 * @param entryPrice    Fill price (positive — caller passes Math.abs of the
 *                      signed openPrice).
 * @param flagHigh      For failed-breakout detection. Optional.
 * @param flagLow       For stop computation. flagLow × 0.99 is the stop.
 *                      If not provided, stop logic is skipped.
 * @param targetPrice   For target-hit detection. Optional.
 */
export function computeHtfLifecycle(
  bars: OHLCV[],
  entryDateIso: string,
  entryPrice: number,
  flagHigh: number | null,
  flagLow: number | null,
  targetPrice: number | null,
): HtfLifecycleState {
  const STRENGTH_THRESHOLD = entryPrice * 1.05;
  const STOP_PRICE = flagLow != null ? flagLow * 0.99 : null;
  const FAILED_BREAKOUT_WINDOW = 3;

  // Find the first bar at or after the entry date.
  const entryT = new Date(entryDateIso).getTime();
  let entryIdx = -1;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].t.getTime() >= entryT) {
      entryIdx = i;
      break;
    }
  }
  if (entryIdx < 0) {
    // Entry is in the future (or after all available bars) — nothing happened yet.
    return emptyState(entryDateIso, entryPrice);
  }

  let peak = entryPrice;
  let trough = entryPrice;
  let maxGainPct = 0;
  let maxDrawdownPct = 0;
  let hasStopped = false;
  let stoppedDate: string | null = null;
  let hasTargeted = false;
  let targetedDate: string | null = null;
  let hadFailedBreakout = false;
  let partialDone = false;
  let partialDate: string | null = null;
  let partialPrice: number | null = null;
  let strengthDays = 0;
  let currentMa20: number | null = null;
  let prevClose: number | null = null;

  // Walk from entry to the latest bar.
  for (let j = entryIdx; j < bars.length; j++) {
    const bar = bars[j];
    const closeJ = bar.c;
    const highJ = bar.h;
    const lowJ = bar.l;
    const openJ = bar.o;
    const barsAfterEntry = j - entryIdx; // 0 on entry day

    if (highJ > peak) peak = highJ;
    if (lowJ < trough) trough = lowJ;
    const gainPct = ((closeJ - entryPrice) / entryPrice) * 100;
    if (gainPct > maxGainPct) maxGainPct = gainPct;
    const dd = peak > 0 ? ((peak - lowJ) / peak) * 100 : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;

    // Stop hit (intraday).
    if (!hasStopped && STOP_PRICE != null && lowJ <= STOP_PRICE) {
      hasStopped = true;
      stoppedDate = bar.t.toISOString().slice(0, 10);
    }

    // Target hit (intraday).
    if (!hasTargeted && targetPrice != null && highJ >= targetPrice) {
      hasTargeted = true;
      targetedDate = bar.t.toISOString().slice(0, 10);
    }

    // Failed-breakout detector — informational only.
    if (!hadFailedBreakout && flagHigh != null && barsAfterEntry >= 1 && barsAfterEntry <= FAILED_BREAKOUT_WINDOW) {
      if (closeJ < flagHigh) hadFailedBreakout = true;
    }

    // Partial-1/3 rule: 3 STRONG close days (not 3 days that happen to be
    // above the +5% threshold). A "strong" day must satisfy ALL of:
    //   1. Up day:        close > previous close
    //   2. Closing strength: close in the upper half of the bar's range
    //                        (buyers in control at the close, not selling
    //                        into weakness)
    //   3. Profit zone:   close > entry × 1.05 (above the strength threshold)
    //   4. Bullish body:  close > open (real-body up bar, not a doji that
    //                     happens to print above prior close)
    // Any non-qualifying day resets the counter to 0 — strength must be
    // consecutive, not cumulative across red days.
    if (!partialDone) {
      const range = highJ - lowJ;
      const midRange = lowJ + range / 2;
      const isUpDay = prevClose != null && closeJ > prevClose;
      const closingInStrength = range <= 0 ? true : closeJ >= midRange;
      const aboveThreshold = closeJ > STRENGTH_THRESHOLD;
      const bullishBody = closeJ > openJ;
      const isStrongDay = isUpDay && closingInStrength && aboveThreshold && bullishBody;
      if (isStrongDay) {
        strengthDays++;
        if (strengthDays >= 3) {
          partialDone = true;
          partialDate = bar.t.toISOString().slice(0, 10);
          partialPrice = closeJ;
          strengthDays = 0;
        }
      } else {
        strengthDays = 0;
      }
    }

    prevClose = closeJ;

    // 20-bar SMA at the latest bar. Compute from the full bar history so
    // there's a sensible warmup; we want the 20-MA at today, not just
    // post-entry data.
    if (j === bars.length - 1) {
      const windowStart = Math.max(0, j - 19);
      if (j - windowStart + 1 >= 20) {
        let sum = 0;
        for (let k = windowStart; k <= j; k++) sum += bars[k].c;
        currentMa20 = sum / (j - windowStart + 1);
      }
    }
  }

  const lastBar = bars[bars.length - 1];
  const lastClose = lastBar.c;
  const currentPct = ((lastClose - entryPrice) / entryPrice) * 100;
  const daysHeld = Math.floor((lastBar.t.getTime() - entryT) / 86400000);
  const barsHeld = bars.length - 1 - entryIdx;

  return {
    daysHeld: Math.max(0, daysHeld),
    barsHeld,
    peakSinceEntry: Number(peak.toFixed(4)),
    troughSinceEntry: Number(trough.toFixed(4)),
    maxGainPct: Number(maxGainPct.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    hasStopped,
    stoppedDate,
    hasTargeted,
    targetedDate,
    hadFailedBreakout,
    partialDone,
    partialDate,
    partialPrice: partialPrice != null ? Number(partialPrice.toFixed(4)) : null,
    currentStrengthDays: strengthDays,
    currentMa20: currentMa20 != null ? Number(currentMa20.toFixed(4)) : null,
    currentPct: Number(currentPct.toFixed(2)),
  };
}

function emptyState(entryDateIso: string, entryPrice: number): HtfLifecycleState {
  void entryDateIso;
  void entryPrice;
  return {
    daysHeld: 0,
    barsHeld: 0,
    peakSinceEntry: entryPrice,
    troughSinceEntry: entryPrice,
    maxGainPct: 0,
    maxDrawdownPct: 0,
    hasStopped: false,
    stoppedDate: null,
    hasTargeted: false,
    targetedDate: null,
    hadFailedBreakout: false,
    partialDone: false,
    partialDate: null,
    partialPrice: null,
    currentStrengthDays: 0,
    currentMa20: null,
    currentPct: 0,
  };
}
