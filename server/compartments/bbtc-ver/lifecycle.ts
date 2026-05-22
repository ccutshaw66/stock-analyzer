/**
 * BBTC+VER live-lifecycle simulator.
 *
 * For an OPEN BBTC+VER position, walks the symbol's bars from entry date to
 * today and returns the trade's current lifecycle state, in particular the
 * trailing-stop value that ratchets up as new highs print.
 *
 * Standard stop rule (CHANGES 2026-05-22):
 *   - Hard stop:  entry × (1 - HARD_STOP_PCT)        — fixed at entry, locks max loss
 *   - Trail stop: highest_close × (1 - TRAIL_PCT)    — ratchets up with new highs
 *   - Active stop: max(hardStop, trailStop)          — what the broker order should be
 *
 * On day 1 the hard stop is active; once price runs +(TRAIL_PCT − HARD_STOP_PCT)
 * past entry, the trail rises above the hard stop and takes over.
 *
 * Pure function. Caller fetches bars + the trade and passes them in.
 */

import type { OHLCV } from "../../data/types";

const HARD_STOP_PCT = 0.08;     // 8% below entry
const TRAIL_PCT = 0.10;         // 10% below highest close since entry

export interface BbtcVerLifecycleState {
  /** Days held (calendar) since the entry date. */
  daysHeld: number;
  /** Trading bars walked since entry. */
  barsHeld: number;
  /** Highest close seen since entry — what the trail anchors to. */
  highestCloseSinceEntry: number;
  /** Highest high seen since entry (intraday peak). */
  peakSinceEntry: number;
  /** Lowest low seen since entry. */
  troughSinceEntry: number;
  /** Max % gain on any closing price since entry. */
  maxGainPct: number;
  /** Max % drawdown from peak. */
  maxDrawdownPct: number;

  /** Locked hard stop: entry × (1 − HARD_STOP_PCT). */
  hardStop: number;
  /** Live trail stop: highestCloseSinceEntry × (1 − TRAIL_PCT). */
  trailStop: number;
  /** Whichever is higher right now — what the broker should reflect. */
  activeStop: number;
  /** True once the trail has climbed above the hard stop. */
  trailActive: boolean;

  /** True if intraday low ever hit the hard stop. */
  hasHardStopped: boolean;
  /** Date the hard stop fired (YYYY-MM-DD). */
  hardStoppedDate: string | null;
  /** True if a daily close ever fell to/under the trail (close-based, not intraday). */
  hasTrailStopped: boolean;
  /** Date the trail-stop close fired. */
  trailStoppedDate: string | null;

  /** Latest close — the "where am I right now" price. */
  lastClose: number;
  /** Percent change from entry to lastClose. */
  currentPct: number;
}

/**
 * Walks bars from entry forward and returns the trade's live lifecycle.
 *
 * @param bars         All available bars for the symbol, oldest → newest.
 * @param entryDateIso Entry date in YYYY-MM-DD. The bar AT this date (or the
 *                     first bar AFTER) becomes the first walked bar.
 * @param entryPrice   Fill price (positive — caller passes Math.abs of openPrice).
 */
export function computeBbtcVerLifecycle(
  bars: OHLCV[],
  entryDateIso: string,
  entryPrice: number,
): BbtcVerLifecycleState {
  const hardStop = round4(entryPrice * (1 - HARD_STOP_PCT));

  // Find the first bar at or after the entry date.
  const entryT = new Date(entryDateIso).getTime();
  let entryIdx = -1;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].t.getTime() >= entryT) {
      entryIdx = i;
      break;
    }
  }
  if (entryIdx < 0 || bars.length === 0) {
    // Entry is in the future or no bars — return a static initial state.
    return emptyState(entryPrice, hardStop, entryDateIso);
  }

  let highestClose = entryPrice;
  let peak = entryPrice;
  let trough = entryPrice;
  let maxGainPct = 0;
  let maxDrawdownPct = 0;
  let hasHardStopped = false;
  let hardStoppedDate: string | null = null;
  let hasTrailStopped = false;
  let trailStoppedDate: string | null = null;
  let trailStop = round4(entryPrice * (1 - TRAIL_PCT));

  for (let j = entryIdx; j < bars.length; j++) {
    const bar = bars[j];
    const closeJ = bar.c;
    const highJ = bar.h;
    const lowJ = bar.l;

    if (closeJ > highestClose) {
      highestClose = closeJ;
      trailStop = round4(highestClose * (1 - TRAIL_PCT));
    }
    if (highJ > peak) peak = highJ;
    if (lowJ < trough) trough = lowJ;
    const gainPct = ((closeJ - entryPrice) / entryPrice) * 100;
    if (gainPct > maxGainPct) maxGainPct = gainPct;
    const dd = peak > 0 ? ((peak - lowJ) / peak) * 100 : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;

    // Hard-stop hit (intraday — broker order would have filled).
    if (!hasHardStopped && lowJ <= hardStop) {
      hasHardStopped = true;
      hardStoppedDate = bar.t.toISOString().slice(0, 10);
    }
    // Trail-stop close (we use close-based to match the strategy — intraday
    // wicks below the trail shouldn't auto-exit).
    const activeStopJ = Math.max(hardStop, trailStop);
    if (!hasTrailStopped && closeJ <= activeStopJ && j > entryIdx) {
      // Don't fire on entry day itself.
      hasTrailStopped = true;
      trailStoppedDate = bar.t.toISOString().slice(0, 10);
    }
  }

  const lastBar = bars[bars.length - 1];
  const lastClose = lastBar.c;
  const daysHeld = Math.max(0, Math.floor((lastBar.t.getTime() - entryT) / 86400000));
  const barsHeld = bars.length - 1 - entryIdx;
  const activeStop = round4(Math.max(hardStop, trailStop));
  const trailActive = trailStop > hardStop;
  const currentPct = ((lastClose - entryPrice) / entryPrice) * 100;

  return {
    daysHeld,
    barsHeld,
    highestCloseSinceEntry: round4(highestClose),
    peakSinceEntry: round4(peak),
    troughSinceEntry: round4(trough),
    maxGainPct: round2(maxGainPct),
    maxDrawdownPct: round2(maxDrawdownPct),
    hardStop,
    trailStop,
    activeStop,
    trailActive,
    hasHardStopped,
    hardStoppedDate,
    hasTrailStopped,
    trailStoppedDate,
    lastClose: round4(lastClose),
    currentPct: round2(currentPct),
  };
}

function emptyState(
  entryPrice: number,
  hardStop: number,
  _entryDateIso: string,
): BbtcVerLifecycleState {
  const trailStop = round4(entryPrice * (1 - TRAIL_PCT));
  return {
    daysHeld: 0,
    barsHeld: 0,
    highestCloseSinceEntry: entryPrice,
    peakSinceEntry: entryPrice,
    troughSinceEntry: entryPrice,
    maxGainPct: 0,
    maxDrawdownPct: 0,
    hardStop,
    trailStop,
    activeStop: hardStop,
    trailActive: false,
    hasHardStopped: false,
    hardStoppedDate: null,
    hasTrailStopped: false,
    trailStoppedDate: null,
    lastClose: entryPrice,
    currentPct: 0,
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }
