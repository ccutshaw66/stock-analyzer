/**
 * HTF backtester — 1:1 TypeScript port of `backend/patterns/backtest_givens.py`.
 *
 * Givens exit rules:
 *   - Entry  = next day's open after a detected breakout
 *   - Stop   = flag_low × 0.99 (slight buffer below)
 *   - Partial exit = sell 1/3 once *cumulative* close-strength days reach 3
 *                    (close > entry × 1.05). Counter resets on a non-strength
 *                    day. Mirrors the Python code, not the README — see
 *                    docs/htf/README.md note in the integration plan.
 *   - Trail  = on remaining 2/3, exit at close below the 20-day MA (only
 *              active after the partial has fired)
 */

import { getHtfBars } from "../../data/htf-ohlcv-cache";
import { scanHtf, type HtfHit } from "../../signals/strategies/htf";
import type { OHLCV } from "../../data/types";

export type HtfExitReason = "stop" | "trail_20ma" | "end_of_data" | "failed_breakout";

export interface HtfTrade {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  consolidationLow: number;
  stopPrice: number;
  partialExitDate: string | null;
  partialExitPrice: number | null;
  exitDate: string;
  exitPrice: number;
  exitReason: HtfExitReason;
  holdingDays: number;
  blendedReturnPct: number;     // accounts for the 1/3 partial split
  maxDrawdownPct: number;
  poleGainPct: number;
  flagDays: number;
  flagPullbackPct: number;
  breakoutVolRatio: number;
  qualityScore: number;
}

export interface HtfBacktestSummary {
  nTrades: number;
  winRatePct: number;
  avgReturnPct: number;
  medianReturnPct: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;
  expectancyPerTradePct: number;
  avgHoldDays: number;
  avgDrawdownPct: number;
  stopOuts: number;
  trailExits: number;
  bestTrade: number;
  worstTrade: number;
}

export interface HtfBacktestResult {
  symbol: string;
  trades: HtfTrade[];
  summary: HtfBacktestSummary | { nTrades: 0 };
  byScoreBucket: Array<HtfBacktestSummary & { scoreRange: string }>;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rolling20MA(closes: number[]): number[] {
  const out = new Array(closes.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= 20) sum -= closes[i - 20];
    if (i >= 19) out[i] = sum / 20;
  }
  return out;
}

function simulateTrade(bars: OHLCV[], hit: HtfHit): HtfTrade | null {
  // Find breakout bar index
  let breakoutI = -1;
  const breakoutTs = hit.breakoutDate.getTime();
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].t.getTime() === breakoutTs) {
      breakoutI = i;
      break;
    }
  }
  if (breakoutI < 0) return null;

  // Entry = next day's open
  const entryI = breakoutI + 1;
  if (entryI >= bars.length) return null;

  const entryDate = bars[entryI].t;
  const entryPrice = bars[entryI].o;
  const consolLow = hit.extras.flagLow;
  const stopPrice = consolLow * 0.99;
  const flagHigh = hit.extras.flagHigh;

  const closes = bars.map(b => b.c);
  const highs = bars.map(b => b.h);
  const lows = bars.map(b => b.l);
  const ma20 = rolling20MA(closes);

  // Failed-breakout exit (piece 2 relaxed) — mirrors strategy-htf-pnl.ts.
  // Two consecutive closes below flag_high within 5 bars → exit next open.
  const FAILED_BREAKOUT_WINDOW_BARS = 5;
  const FAILED_BREAKOUT_CONSECUTIVE = 2;
  let consecClosesBelow = 0;

  let partialExitDate: Date | null = null;
  let partialExitPrice: number | null = null;
  let strengthDays = 0;
  let partialDone = false;
  let maxDrawdown = 0;
  let peakSinceEntry = entryPrice;

  function commonExtras(): Pick<
    HtfTrade,
    "poleGainPct" | "flagDays" | "flagPullbackPct" | "breakoutVolRatio" | "qualityScore"
  > {
    return {
      poleGainPct: hit.extras.poleGainPct,
      flagDays: hit.extras.flagDays,
      flagPullbackPct: hit.extras.flagPullbackPct,
      breakoutVolRatio: hit.extras.breakoutVolRatio,
      qualityScore: hit.qualityScore,
    };
  }

  for (let j = entryI; j < bars.length; j++) {
    const closeJ = closes[j];
    const lowJ = lows[j];
    const highJ = highs[j];

    if (highJ > peakSinceEntry) peakSinceEntry = highJ;
    const dd = (peakSinceEntry - lowJ) / peakSinceEntry;
    if (dd > maxDrawdown) maxDrawdown = dd;

    // Hard stop (intraday)
    if (lowJ <= stopPrice) {
      const exitPrice = stopPrice;
      const ret = partialDone && partialExitPrice !== null
        ? (partialExitPrice / entryPrice - 1) * (1 / 3) + (exitPrice / entryPrice - 1) * (2 / 3)
        : exitPrice / entryPrice - 1;
      return {
        symbol: hit.symbol,
        entryDate: ymd(entryDate),
        entryPrice,
        consolidationLow: consolLow,
        stopPrice,
        partialExitDate: partialExitDate ? ymd(partialExitDate) : null,
        partialExitPrice,
        exitDate: ymd(bars[j].t),
        exitPrice,
        exitReason: "stop",
        holdingDays: j - entryI,
        blendedReturnPct: ret * 100,
        maxDrawdownPct: maxDrawdown * 100,
        ...commonExtras(),
      };
    }

    // Failed-breakout exit (piece 2 relaxed): 2 consecutive closes below
    // flag_high in 5-bar window → exit next open.
    const barsAfterBreakout = j - breakoutI;
    if (
      barsAfterBreakout >= 1 &&
      barsAfterBreakout <= FAILED_BREAKOUT_WINDOW_BARS
    ) {
      if (closeJ < flagHigh) {
        consecClosesBelow++;
        if (consecClosesBelow >= FAILED_BREAKOUT_CONSECUTIVE) {
          const exitI = j + 1 < bars.length ? j + 1 : j;
          const exitPrice = j + 1 < bars.length ? bars[exitI].o : closeJ;
          const ret = partialDone && partialExitPrice !== null
            ? (partialExitPrice / entryPrice - 1) * (1 / 3) + (exitPrice / entryPrice - 1) * (2 / 3)
            : exitPrice / entryPrice - 1;
          return {
            symbol: hit.symbol,
            entryDate: ymd(entryDate),
            entryPrice,
            consolidationLow: consolLow,
            stopPrice,
            partialExitDate: partialExitDate ? ymd(partialExitDate) : null,
            partialExitPrice,
            exitDate: ymd(bars[exitI].t),
            exitPrice,
            exitReason: "failed_breakout",
            holdingDays: exitI - entryI,
            blendedReturnPct: ret * 100,
            maxDrawdownPct: maxDrawdown * 100,
            ...commonExtras(),
          };
        }
      } else {
        consecClosesBelow = 0;
      }
    }

    // Partial: cumulative strength counter (matches Python — counter resets
    // only on a non-strength day, NOT on a hit)
    if (!partialDone && closeJ > entryPrice * 1.05) {
      strengthDays++;
      if (strengthDays >= 3) {
        partialExitDate = bars[j].t;
        partialExitPrice = closeJ;
        partialDone = true;
        strengthDays = 0;
      }
    } else {
      strengthDays = 0;
    }

    // 20-MA trail (only active post-partial)
    if (partialDone && j >= 20) {
      const m = ma20[j];
      if (!isNaN(m) && closeJ < m && partialExitPrice !== null) {
        const exitPrice = closeJ;
        const ret =
          (partialExitPrice / entryPrice - 1) * (1 / 3) +
          (exitPrice / entryPrice - 1) * (2 / 3);
        return {
          symbol: hit.symbol,
          entryDate: ymd(entryDate),
          entryPrice,
          consolidationLow: consolLow,
          stopPrice,
          partialExitDate: ymd(partialExitDate!),
          partialExitPrice,
          exitDate: ymd(bars[j].t),
          exitPrice,
          exitReason: "trail_20ma",
          holdingDays: j - entryI,
          blendedReturnPct: ret * 100,
          maxDrawdownPct: maxDrawdown * 100,
          ...commonExtras(),
        };
      }
    }
  }

  // Ran out of data — mark to market at last close
  const lastClose = closes[closes.length - 1];
  const ret = partialDone && partialExitPrice !== null
    ? (partialExitPrice / entryPrice - 1) * (1 / 3) + (lastClose / entryPrice - 1) * (2 / 3)
    : lastClose / entryPrice - 1;
  return {
    symbol: hit.symbol,
    entryDate: ymd(entryDate),
    entryPrice,
    consolidationLow: consolLow,
    stopPrice,
    partialExitDate: partialExitDate ? ymd(partialExitDate) : null,
    partialExitPrice,
    exitDate: ymd(bars[bars.length - 1].t),
    exitPrice: lastClose,
    exitReason: "end_of_data",
    holdingDays: bars.length - 1 - entryI,
    blendedReturnPct: ret * 100,
    maxDrawdownPct: maxDrawdown * 100,
    ...commonExtras(),
  };
}

function summarize(trades: HtfTrade[]): HtfBacktestSummary | { nTrades: 0 } {
  if (trades.length === 0) return { nTrades: 0 };
  const returns = trades.map(t => t.blendedReturnPct);
  const wins = returns.filter(r => r > 0);
  const losses = returns.filter(r => r <= 0);
  const winRate = (wins.length / returns.length) * 100;
  const avgReturn = mean(returns);
  const medianReturn = median(returns);
  const avgWin = wins.length ? mean(wins) : 0;
  const avgLoss = losses.length ? mean(losses) : 0;
  const lossSum = losses.reduce((a, b) => a + b, 0);
  const winSum = wins.reduce((a, b) => a + b, 0);
  const profitFactor = losses.length && lossSum !== 0 ? Math.abs(winSum / lossSum) : Infinity;
  const expectancy = (winRate / 100) * avgWin + (1 - winRate / 100) * avgLoss;
  return {
    nTrades: trades.length,
    winRatePct: round1(winRate),
    avgReturnPct: round2(avgReturn),
    medianReturnPct: round2(medianReturn),
    avgWinPct: round2(avgWin),
    avgLossPct: round2(avgLoss),
    profitFactor: round2(profitFactor),
    expectancyPerTradePct: round2(expectancy),
    avgHoldDays: round1(mean(trades.map(t => t.holdingDays))),
    avgDrawdownPct: round2(mean(trades.map(t => t.maxDrawdownPct))),
    stopOuts: trades.filter(t => t.exitReason === "stop").length,
    trailExits: trades.filter(t => t.exitReason === "trail_20ma").length,
    bestTrade: round2(Math.max(...returns)),
    worstTrade: round2(Math.min(...returns)),
  };
}

function summarizeByScoreBucket(trades: HtfTrade[]) {
  const buckets: Array<[number, number]> = [
    [0, 50], [50, 70], [70, 85], [85, 101],
  ];
  const out: Array<HtfBacktestSummary & { scoreRange: string }> = [];
  for (const [lo, hi] of buckets) {
    const slice = trades.filter(t => t.qualityScore >= lo && t.qualityScore < hi);
    if (slice.length === 0) continue;
    const s = summarize(slice);
    if ("winRatePct" in s) {
      out.push({ ...s, scoreRange: `${lo}-${hi - 1}` });
    }
  }
  return out;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }

/**
 * Backtest a single ticker end-to-end. Loads bars from cache (or FMP on miss),
 * scans for every historical HTF setup, simulates Givens' exits, returns the
 * per-trade list + aggregate summary + per-score-bucket breakdown.
 */
export async function backtestSymbol(
  symbol: string,
  minScore = 0,
): Promise<HtfBacktestResult> {
  const bars = await getHtfBars(symbol);
  if (bars.length === 0) {
    return { symbol, trades: [], summary: { nTrades: 0 }, byScoreBucket: [] };
  }
  const hits = scanHtf(bars, symbol, { lookbackDays: bars.length, minScore });
  const trades: HtfTrade[] = [];
  for (const h of hits) {
    const t = simulateTrade(bars, h);
    if (t) trades.push(t);
  }
  trades.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  return {
    symbol,
    trades,
    summary: summarize(trades),
    byScoreBucket: summarizeByScoreBucket(trades),
  };
}
