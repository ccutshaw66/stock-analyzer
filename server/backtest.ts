/**
 * Signal Backtester
 *
 * For a set of tickers over N years, slides a history window forward one day
 * at a time and evaluates each pure-technical Scanner 2.0 detector. When a
 * detector fires, records forward returns at +1/+5/+10/+20 days using actual
 * historical prices.
 *
 * Only the technical detectors (BBTC squeeze, ATR expansion, relative volume,
 * 52w breakout, gap hold, fib pullback) are backtested — catalyst detectors
 * (earnings, insider, options, analyst) require point-in-time third-party
 * data that isn't replayable here.
 */

import { data as marketData } from "./data";
import { bbSqueezeDetector } from "./scanner-v2-signals/bb-squeeze";
import { atrExpansionDetector } from "./scanner-v2-signals/atr-expansion";
import { relVolumeDetector } from "./scanner-v2-signals/rel-volume";
import { breakout52wDetector } from "./scanner-v2-signals/breakout-52w";
import { gapHoldDetector } from "./scanner-v2-signals/gap-hold";
import { fibPullbackDetector } from "./scanner-v2-signals/fib-pullback";
import type { SignalDetector, ScanContext } from "./scanner-v2";

const TECHNICAL_DETECTORS: { id: string; label: string; fn: SignalDetector }[] = [
  { id: "bb_squeeze", label: "BB Squeeze", fn: bbSqueezeDetector },
  { id: "atr_expansion", label: "ATR Expansion", fn: atrExpansionDetector },
  { id: "rel_volume", label: "Relative Volume", fn: relVolumeDetector },
  { id: "breakout_52w", label: "52w Breakout", fn: breakout52wDetector },
  { id: "gap_hold", label: "Gap Hold", fn: gapHoldDetector },
  { id: "fib_pullback", label: "Fib Pullback", fn: fibPullbackDetector },
];

const CATALYST_IDS = [
  { id: "earnings_soon", label: "Earnings Soon" },
  { id: "analyst_action", label: "Analyst Action" },
  { id: "insider_cluster", label: "Insider Cluster" },
  { id: "unusual_options", label: "Unusual Options" },
  { id: "gamma_squeeze", label: "Gamma Squeeze" },
  { id: "small_float", label: "Small Float" },
];

const HORIZONS = [1, 5, 10, 20] as const;
const HISTORY_WINDOW = 260; // need ~252 for 52w + some buffer
const MIN_STRENGTH = 0.25;

interface FireEvent {
  signalId: string;
  symbol: string;
  dateIdx: number;       // index into bars array where signal fired
  strength: number;
  direction: "up" | "down" | "either";
  entryClose: number;
}

interface PerSignalStats {
  id: string;
  label: string;
  fires: number;
  hit1: { hits: number; avg: number; samples: number };
  hit5: { hits: number; avg: number; samples: number };
  hit10: { hits: number; avg: number; samples: number };
  hit20: { hits: number; avg: number; samples: number };
}

export interface BacktestResult {
  params: { tickers: string[]; years: number; minStrength: number };
  coverage: { tickers: number; daysScanned: number; totalBars: number };
  technical: PerSignalStats[];
  catalystNote: string;
  catalystStubs: Array<{ id: string; label: string }>;
  bestFires: Array<{
    signalId: string;
    symbol: string;
    date: string;
    entryClose: number;
    ret1: number | null;
    ret5: number | null;
    ret10: number | null;
    ret20: number | null;
    strength: number;
  }>;
  ranBy: string;
  ranAt: string;
}

function toHitBucket(returns: number[], directions: ("up" | "down" | "either")[]): { hits: number; avg: number; samples: number } {
  if (returns.length === 0) return { hits: 0, avg: 0, samples: 0 };
  let hits = 0;
  let sum = 0;
  for (let i = 0; i < returns.length; i++) {
    const r = returns[i];
    const dir = directions[i];
    // "up" = win if positive; "down" = win if negative; "either" = win if |ret|>0 and direction matches sign... treat as positive-bias win
    if (dir === "down") {
      if (r < 0) hits++;
      sum += -r;
    } else {
      if (r > 0) hits++;
      sum += r;
    }
  }
  return {
    hits,
    avg: Number((sum / returns.length).toFixed(3)),
    samples: returns.length,
  };
}

export async function runBacktest(params: {
  tickers: string[];
  years?: number;
  minStrength?: number;
  ranBy?: string;
}): Promise<BacktestResult> {
  const years = Math.max(1, Math.min(5, params.years ?? 2));
  const minStrength = params.minStrength ?? MIN_STRENGTH;
  const tickers = params.tickers.map(t => t.toUpperCase()).slice(0, 25); // cap for cost/perf

  const now = new Date();
  const from = new Date(now.getTime() - years * 365 * 24 * 60 * 60 * 1000);

  // Per-signal accumulators
  const accum: Record<string, { returns: Record<number, number[]>; dirs: Record<number, ("up" | "down" | "either")[]>; fires: number }> = {};
  for (const d of TECHNICAL_DETECTORS) {
    accum[d.id] = {
      returns: { 1: [], 5: [], 10: [], 20: [] },
      dirs:    { 1: [], 5: [], 10: [], 20: [] },
      fires: 0,
    };
  }

  let daysScanned = 0;
  let totalBars = 0;
  const bestFires: BacktestResult["bestFires"] = [];

  for (const symbol of tickers) {
    let bars: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }> = [];
    try {
      const agg = await marketData.getAggregates(symbol, from, now, "day");
      bars = Array.isArray(agg) ? agg : [];
    } catch {
      continue;
    }
    if (!bars || bars.length < HISTORY_WINDOW + 25) continue;
    totalBars += bars.length;

    // Walk forward: for each day i where a full window is available and enough
    // future bars exist for +20d return.
    for (let i = HISTORY_WINDOW; i < bars.length - 21; i++) {
      daysScanned++;
      const window = bars.slice(i - HISTORY_WINDOW, i + 1);
      const todayBar = bars[i];
      const ctx: ScanContext = {
        bars: window,
        basics: {
          symbol,
          price: todayBar.c,
          marketCap: 0,   // not used by technical detectors
          volume: todayBar.v,
          sector: "",
        },
        // extras omitted — technical detectors don't depend on it
      };

      for (const det of TECHNICAL_DETECTORS) {
        let res;
        try {
          res = det.fn(ctx);
        } catch {
          continue;
        }
        if (!res || !res.triggered || res.strength < minStrength) continue;

        accum[det.id].fires++;

        const entryClose = todayBar.c;
        const forwardRets: Record<number, number | null> = { 1: null, 5: null, 10: null, 20: null };
        for (const h of HORIZONS) {
          const futureIdx = i + h;
          if (futureIdx < bars.length) {
            const future = bars[futureIdx];
            if (entryClose > 0) {
              const ret = ((future.c - entryClose) / entryClose) * 100;
              forwardRets[h] = ret;
              accum[det.id].returns[h].push(ret);
              accum[det.id].dirs[h].push(res.direction);
            }
          }
        }

        // Track best outcomes by magnitude at 20d
        if (forwardRets[20] != null && Math.abs(forwardRets[20]!) >= 5) {
          bestFires.push({
            signalId: det.id,
            symbol,
            date: new Date(todayBar.t).toISOString().slice(0, 10),
            entryClose,
            ret1: forwardRets[1],
            ret5: forwardRets[5],
            ret10: forwardRets[10],
            ret20: forwardRets[20],
            strength: Number(res.strength.toFixed(2)),
          });
        }
      }
    }
  }

  // Build per-signal stats
  const technical: PerSignalStats[] = TECHNICAL_DETECTORS.map(det => {
    const a = accum[det.id];
    return {
      id: det.id,
      label: det.label,
      fires: a.fires,
      hit1: toHitBucket(a.returns[1], a.dirs[1]),
      hit5: toHitBucket(a.returns[5], a.dirs[5]),
      hit10: toHitBucket(a.returns[10], a.dirs[10]),
      hit20: toHitBucket(a.returns[20], a.dirs[20]),
    };
  });

  // Top 20 best fires by |ret20|
  bestFires.sort((a, b) => Math.abs(b.ret20 || 0) - Math.abs(a.ret20 || 0));
  const topFires = bestFires.slice(0, 20);

  return {
    params: { tickers, years, minStrength },
    coverage: { tickers: tickers.length, daysScanned, totalBars },
    technical,
    catalystNote:
      "Catalyst signals (earnings, insider, options, analyst, gamma, small-float) depend on point-in-time third-party data and cannot be replayed historically. Live performance is tracked via the Scanner 2.0 signal log.",
    catalystStubs: CATALYST_IDS,
    bestFires: topFires,
    ranBy: params.ranBy || "",
    ranAt: new Date().toISOString(),
  };
}
