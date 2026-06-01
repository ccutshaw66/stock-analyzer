/**
 * Generic per-ticker dollar P&L evaluator for breakout-style long strategies.
 *
 * Factored out of strategy-wyckoff-spring-pnl.ts so new pattern strategies
 * (Pipe Bottom, Rounding Bottom, …) don't each duplicate ~500 lines of trade
 * simulation + basket aggregation. A strategy plugs in by passing its scan
 * function and a small lifecycle config.
 *
 * Same response shape as strategy-htf-pnl.ts / strategy-wyckoff-spring-pnl.ts
 * so head-to-head comparison stays a URL swap.
 *
 * Standard long lifecycle (shared by all current pattern strategies):
 *   Entry  = next bar's open after the breakout bar
 *   Stop   = hit.stopPrice (hard, intraday/intra-week low)
 *   Partial = sell 1/3 after N consecutive closes above entry × (1 + gain)
 *   Trail  = exit remaining 2/3 on close < trail-MA after partial fires
 *   Target = hit.targetPrice — informational only (trail handles the exit)
 */

import { fmpGet } from "../data/providers/fmp.client";
import type { OHLCV } from "../data/types";
import { resampleWeekly } from "../signals/strategies/pipe-bottom";

// ─── Common hit shape every pattern detector already satisfies ─────────────
export interface GenericHit {
  symbol: string;
  breakoutDate: Date;
  breakoutPrice: number;
  stopPrice: number;
  targetPrice: number;
  qualityScore: number;
}

export interface GenericStrategyConfig {
  /** Strategy id, used in notes / labels. */
  id: string;
  /** Human label for the notes block. */
  label: string;
  /** Bar timeframe the detector + simulation run on. */
  timeframe: "daily" | "weekly";
  /** Detector — returns hits on the given OHLCV series. */
  scan: (bars: OHLCV[], symbol: string, opts: { lookbackDays?: number; lookbackWeeks?: number; minScore: number }) => GenericHit[];
  /** Trailing-MA period (bars) used for the post-partial exit. Default 20. */
  trailMaPeriod?: number;
  /** Partial fires after this many consecutive closes above the gain line. Default 2. */
  partialDays?: number;
  /** Gain line as a fraction above entry. Default 0.10 (+10%). */
  partialGainPct?: number;
}

// ─── Bar fetcher (identical to strategy-htf-pnl.ts / wyckoff) ───────────────
interface Bars {
  date: string[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

async function fetchBars(symbol: string, days: number): Promise<Bars | null> {
  try {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - (days + 250) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const data: any = await fmpGet("/historical-price-eod/full", { symbol, from, to });
    const arr: any[] = Array.isArray(data) ? data : data?.historical || [];
    if (arr.length < 100) return null;
    const sorted = [...arr].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const date: string[] = [], open: number[] = [], high: number[] = [], low: number[] = [], close: number[] = [], volume: number[] = [];
    for (const r of sorted) {
      const o = Number(r.open), h = Number(r.high), l = Number(r.low), c = Number(r.close), v = Number(r.volume);
      if (!Number.isFinite(c)) continue;
      date.push(String(r.date)); open.push(o); high.push(h); low.push(l); close.push(c);
      volume.push(Number.isFinite(v) ? v : 0);
    }
    return { date, open, high, low, close, volume };
  } catch {
    return null;
  }
}

function barsToOHLCV(b: Bars): OHLCV[] {
  const out: OHLCV[] = [];
  for (let i = 0; i < b.close.length; i++) {
    out.push({ t: new Date(b.date[i]), o: b.open[i], h: b.high[i], l: b.low[i], c: b.close[i], v: b.volume[i] });
  }
  return out;
}

// ─── Trade simulation ───────────────────────────────────────────────────────
export type GenericExitReason = "stop" | "trail_ma" | "end_of_data";

export interface GenericTrade {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  partialExitDate: string | null;
  partialExitPrice: number | null;
  exitDate: string;
  exitPrice: number;
  exitReason: GenericExitReason;
  holdingBars: number;
  blendedReturnPct: number;
  maxDrawdownPct: number;
  qualityScore: number;
  pnlDollar: number;
  positionSizeDollar: number;
  isOpen: boolean;
}

function rollingMA(closes: number[], period: number): number[] {
  const out = new Array(closes.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function simulateTrade(
  bars: OHLCV[],
  hit: GenericHit,
  positionSize: number,
  cfg: Required<Pick<GenericStrategyConfig, "trailMaPeriod" | "partialDays" | "partialGainPct">>,
): GenericTrade | null {
  let breakoutI = -1;
  const breakoutTs = hit.breakoutDate.getTime();
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].t.getTime() === breakoutTs) { breakoutI = i; break; }
  }
  if (breakoutI < 0) return null;
  const entryI = breakoutI + 1;
  if (entryI >= bars.length) return null;

  const entryDate = bars[entryI].t;
  const entryPrice = bars[entryI].o;
  const stopPrice = hit.stopPrice;
  const partialThreshold = entryPrice * (1 + cfg.partialGainPct);

  const closes = bars.map(b => b.c);
  const highs = bars.map(b => b.h);
  const lows = bars.map(b => b.l);
  const ma = rollingMA(closes, cfg.trailMaPeriod);

  let partialExitDate: Date | null = null;
  let partialExitPrice: number | null = null;
  let consecutiveGainBars = 0;
  let partialDone = false;
  let maxDrawdown = 0;
  let peakSinceEntry = entryPrice;

  function finish(exitDateD: Date, exitPrice: number, reason: GenericExitReason, holdingBars: number, isOpen: boolean): GenericTrade {
    const ret = partialDone && partialExitPrice !== null
      ? (partialExitPrice / entryPrice - 1) * (1 / 3) + (exitPrice / entryPrice - 1) * (2 / 3)
      : exitPrice / entryPrice - 1;
    return {
      symbol: hit.symbol,
      entryDate: ymd(entryDate),
      entryPrice: Number(entryPrice.toFixed(4)),
      stopPrice: Number(stopPrice.toFixed(4)),
      targetPrice: Number(hit.targetPrice.toFixed(4)),
      partialExitDate: partialExitDate ? ymd(partialExitDate) : null,
      partialExitPrice: partialExitPrice !== null ? Number(partialExitPrice.toFixed(4)) : null,
      exitDate: ymd(exitDateD),
      exitPrice: Number(exitPrice.toFixed(4)),
      exitReason: reason,
      holdingBars,
      blendedReturnPct: Number((ret * 100).toFixed(4)),
      maxDrawdownPct: Number((maxDrawdown * 100).toFixed(4)),
      qualityScore: hit.qualityScore,
      pnlDollar: Number((ret * positionSize).toFixed(2)),
      positionSizeDollar: Number(positionSize.toFixed(2)),
      isOpen,
    };
  }

  for (let j = entryI; j < bars.length; j++) {
    const closeJ = closes[j];
    const lowJ = lows[j];
    const highJ = highs[j];
    if (highJ > peakSinceEntry) peakSinceEntry = highJ;
    const dd = (peakSinceEntry - lowJ) / peakSinceEntry;
    if (dd > maxDrawdown) maxDrawdown = dd;

    // Stop wins same-bar ties.
    if (lowJ <= stopPrice) return finish(bars[j].t, stopPrice, "stop", j - entryI, false);

    if (!partialDone) {
      if (closeJ > partialThreshold) {
        consecutiveGainBars++;
        if (consecutiveGainBars >= cfg.partialDays) {
          partialExitDate = bars[j].t;
          partialExitPrice = closeJ;
          partialDone = true;
          consecutiveGainBars = 0;
        }
      } else {
        consecutiveGainBars = 0;
      }
    }

    if (partialDone && j >= cfg.trailMaPeriod) {
      const m = ma[j];
      if (!isNaN(m) && closeJ < m && partialExitPrice !== null) {
        return finish(bars[j].t, closeJ, "trail_ma", j - entryI, false);
      }
    }
  }

  const lastIdx = bars.length - 1;
  return finish(bars[lastIdx].t, closes[lastIdx], "end_of_data", lastIdx - entryI, true);
}

// ─── Per-ticker + basket aggregation (mirrors wyckoff harness) ──────────────
export interface GenericTickerPnL {
  symbol: string;
  bars: number;
  rangeFrom: string;
  rangeTo: string;
  buyAndHoldReturnPct: number;
  buyAndHoldDollar: number;
  trades: GenericTrade[];
  closedTradeCount: number;
  openTradeCount: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  totalPnLDollar: number;
  rMultiple: number | null;
  compoundReturnPct: number;
  bestTradePct: number | null;
  worstTradePct: number | null;
  avgHoldBars: number | null;
  maxDrawdownPct: number;
}

function summarizeTicker(symbol: string, simBars: OHLCV[], trades: GenericTrade[], positionSize: number): GenericTickerPnL {
  const closed = trades.filter(t => !t.isOpen);
  const open = trades.filter(t => t.isOpen);
  const wins = closed.filter(t => t.blendedReturnPct > 0);
  const losses = closed.filter(t => t.blendedReturnPct <= 0);
  const avgWinPct = wins.length ? wins.reduce((a, t) => a + t.blendedReturnPct, 0) / wins.length : null;
  const avgLossPct = losses.length ? losses.reduce((a, t) => a + t.blendedReturnPct, 0) / losses.length : null;
  const totalPnLDollar = closed.reduce((a, t) => a + t.pnlDollar, 0);

  let cum = 1, peak = 1, maxDD = 0;
  for (const t of closed) {
    cum *= 1 + t.blendedReturnPct / 100;
    if (cum > peak) peak = cum;
    const dd = peak > 0 ? (peak - cum) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  const returnsPct = closed.map(t => t.blendedReturnPct);
  const firstClose = simBars.length ? simBars[0].c : 0;
  const lastClose = simBars.length ? simBars[simBars.length - 1].c : 0;
  const buyAndHoldReturnPct = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;

  return {
    symbol,
    bars: simBars.length,
    rangeFrom: simBars.length ? ymd(simBars[0].t) : "",
    rangeTo: simBars.length ? ymd(simBars[simBars.length - 1].t) : "",
    buyAndHoldReturnPct: Number(buyAndHoldReturnPct.toFixed(2)),
    buyAndHoldDollar: Number(((buyAndHoldReturnPct / 100) * positionSize).toFixed(2)),
    trades,
    closedTradeCount: closed.length,
    openTradeCount: open.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? Number((wins.length / closed.length).toFixed(3)) : null,
    avgWinPct: avgWinPct != null ? Number(avgWinPct.toFixed(2)) : null,
    avgLossPct: avgLossPct != null ? Number(avgLossPct.toFixed(2)) : null,
    totalPnLDollar: Number(totalPnLDollar.toFixed(2)),
    rMultiple: avgWinPct != null && avgLossPct != null && avgLossPct < 0
      ? Number((avgWinPct / Math.abs(avgLossPct)).toFixed(2)) : null,
    compoundReturnPct: Number(((cum - 1) * 100).toFixed(2)),
    bestTradePct: returnsPct.length ? Number(Math.max(...returnsPct).toFixed(2)) : null,
    worstTradePct: returnsPct.length ? Number(Math.min(...returnsPct).toFixed(2)) : null,
    avgHoldBars: closed.length ? Number((closed.reduce((a, t) => a + t.holdingBars, 0) / closed.length).toFixed(1)) : null,
    maxDrawdownPct: Number((maxDD * 100).toFixed(2)),
  };
}

async function evalTickerPnL(symbol: string, days: number, positionSize: number, minScore: number, cfg: GenericStrategyConfig): Promise<GenericTickerPnL | null> {
  const bars = await fetchBars(symbol, days);
  if (!bars) return null;
  const daily = barsToOHLCV(bars);
  // Detector runs on daily bars; the simulation runs on whatever timeframe the
  // strategy trades. Weekly strategies resample so breakout dates line up with
  // simulated bars.
  const simBars = cfg.timeframe === "weekly" ? resampleWeekly(daily) : daily;
  const hits = cfg.scan(daily, symbol, { lookbackDays: daily.length, lookbackWeeks: simBars.length, minScore });
  const trailMaPeriod = cfg.trailMaPeriod ?? 20;
  const partialDays = cfg.partialDays ?? 2;
  const partialGainPct = cfg.partialGainPct ?? 0.1;
  const trades: GenericTrade[] = [];
  for (const h of hits) {
    const r = simulateTrade(simBars, h, positionSize, { trailMaPeriod, partialDays, partialGainPct });
    if (r) trades.push(r);
  }
  trades.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  return summarizeTicker(symbol, simBars, trades, positionSize);
}

export interface GenericBasketAgg {
  totalSymbols: number;
  totalClosedTrades: number;
  totalOpenTrades: number;
  totalWins: number;
  totalLosses: number;
  basketWinRate: number | null;
  totalPnLDollar: number;
  avgPnLPerTrade: number | null;
  avgPnLPerTicker: number;
  profitableTickers: number;
  unprofitableTickers: number;
  topPerformers: Array<{ symbol: string; pnlDollar: number; trades: number; winRate: number | null }>;
  bottomPerformers: Array<{ symbol: string; pnlDollar: number; trades: number; winRate: number | null }>;
  spyBuyAndHoldReturnPct: number | null;
}

function aggregateBasket(perTicker: GenericTickerPnL[], spy: GenericTickerPnL | null): GenericBasketAgg {
  const totalClosedTrades = perTicker.reduce((a, t) => a + t.closedTradeCount, 0);
  const totalWins = perTicker.reduce((a, t) => a + t.wins, 0);
  const totalPnLDollar = perTicker.reduce((a, t) => a + t.totalPnLDollar, 0);
  const sorted = [...perTicker].sort((a, b) => b.totalPnLDollar - a.totalPnLDollar);
  const mapPerf = (t: GenericTickerPnL) => ({ symbol: t.symbol, pnlDollar: t.totalPnLDollar, trades: t.closedTradeCount, winRate: t.winRate });
  return {
    totalSymbols: perTicker.length,
    totalClosedTrades,
    totalOpenTrades: perTicker.reduce((a, t) => a + t.openTradeCount, 0),
    totalWins,
    totalLosses: perTicker.reduce((a, t) => a + t.losses, 0),
    basketWinRate: totalClosedTrades > 0 ? Number((totalWins / totalClosedTrades).toFixed(3)) : null,
    totalPnLDollar: Number(totalPnLDollar.toFixed(2)),
    avgPnLPerTrade: totalClosedTrades > 0 ? Number((totalPnLDollar / totalClosedTrades).toFixed(2)) : null,
    avgPnLPerTicker: perTicker.length ? Number((totalPnLDollar / perTicker.length).toFixed(2)) : 0,
    profitableTickers: perTicker.filter(t => t.totalPnLDollar > 0).length,
    unprofitableTickers: perTicker.filter(t => t.totalPnLDollar < 0).length,
    topPerformers: sorted.slice(0, 10).map(mapPerf),
    bottomPerformers: sorted.slice(-10).reverse().map(mapPerf),
    spyBuyAndHoldReturnPct: spy ? spy.buyAndHoldReturnPct : null,
  };
}

export interface GenericStrategyPnLResult {
  strategy: string;
  basket: { symbols: string[]; days: number; positionSize: number; minScore: number };
  generatedAt: string;
  perTicker: GenericTickerPnL[];
  aggregate: GenericBasketAgg;
  notes: string[];
}

export async function runGenericStrategyPnL(
  cfg: GenericStrategyConfig,
  symbols: string[],
  days: number,
  positionSize: number,
  includeTradeDetail: boolean,
  minScore: number,
): Promise<GenericStrategyPnLResult> {
  const BATCH = 12;
  const tickerResults: GenericTickerPnL[] = [];
  for (let i = 0; i < symbols.length; i += BATCH) {
    const slice = symbols.slice(i, i + BATCH);
    const results = await Promise.allSettled(slice.map(s => evalTickerPnL(s, days, positionSize, minScore, cfg)));
    for (const r of results) if (r.status === "fulfilled" && r.value) tickerResults.push(r.value);
    if (i + BATCH < symbols.length) await new Promise(r => setTimeout(r, 150));
  }
  const spy = await evalTickerPnL("SPY", days, positionSize, minScore, cfg).catch(() => null);
  const perTicker = includeTradeDetail ? tickerResults : tickerResults.map(t => ({ ...t, trades: [] }));
  const trailMaPeriod = cfg.trailMaPeriod ?? 20;
  const partialDays = cfg.partialDays ?? 2;
  const partialGainPct = cfg.partialGainPct ?? 0.1;
  return {
    strategy: cfg.id,
    basket: { symbols, days, positionSize, minScore },
    generatedAt: new Date().toISOString(),
    perTicker,
    aggregate: aggregateBasket(tickerResults, spy),
    notes: [
      `${cfg.label} evaluator (${cfg.timeframe} bars). minScore=${minScore} — 70 = production threshold; 0 = every detected hit.`,
      `Entry = next ${cfg.timeframe === "weekly" ? "week" : "day"}'s open after the breakout bar. Stop = detector stopPrice (hard, intra-bar low).`,
      `Partial = sell 1/3 after ${partialDays} consecutive closes above entry × ${1 + partialGainPct}. Trail = exit remaining 2/3 on close < ${trailMaPeriod}-bar MA after partial fires.`,
      "Target is informational; the trail handles the exit so runners aren't clipped.",
      "Open trades at window end are excluded from $ aggregates but counted in trade-count metrics. No commissions/slippage.",
      "Add ?detail=1 for per-trade records. Comparable to /api/diag/strategy-htf-pnl at the same symbols + days + positionSize.",
    ],
  };
}
