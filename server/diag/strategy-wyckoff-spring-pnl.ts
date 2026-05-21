/**
 * Wyckoff Spring per-ticker dollar P&L evaluator.
 *
 * Walks each ticker's full N-year bar history through `scanWyckoffSpring`,
 * simulates the spec's lifecycle rules on every detected SOS hit, and
 * aggregates per-ticker + basket-wide. Same response shape as
 * `strategy-htf-pnl.ts` so direct head-to-head comparison is a URL swap.
 *
 * Spec lifecycle (differs from HTF on the partial rule only):
 *   Entry  = next day's open after SOS bar
 *   Stop   = hit.stopPrice (spring_low × 0.98)
 *   Target = hit.targetPrice (SOS_close + TR_high − TR_low) — informational, not an auto-exit
 *   Partial = sell 1/3 when close > entry × 1.10 for 2 consecutive days
 *   Trail  = exit remaining 2/3 on close < 20-day MA after partial fires
 *
 * Used by `/api/diag/strategy-wyckoff-spring-pnl`.
 */

import { fmpGet } from "../data/providers/fmp.client";
import { scanWyckoffSpring, type WyckoffSpringHit } from "../signals/strategies/wyckoff-spring";
import type { OHLCV } from "../data/types";

// ─── Bar fetcher (identical to strategy-htf-pnl.ts) ────────────────────────

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
    const from = new Date(Date.now() - (days + 250) * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const data: any = await fmpGet("/historical-price-eod/full", { symbol, from, to });
    const arr: any[] = Array.isArray(data) ? data : data?.historical || [];
    if (arr.length < 100) return null;
    const sorted = [...arr].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const date: string[] = [];
    const open: number[] = [];
    const high: number[] = [];
    const low: number[] = [];
    const close: number[] = [];
    const volume: number[] = [];
    for (const r of sorted) {
      const o = Number(r.open),
        h = Number(r.high),
        l = Number(r.low),
        c = Number(r.close),
        v = Number(r.volume);
      if (!Number.isFinite(c)) continue;
      date.push(String(r.date));
      open.push(o);
      high.push(h);
      low.push(l);
      close.push(c);
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
    out.push({
      t: new Date(b.date[i]),
      o: b.open[i],
      h: b.high[i],
      l: b.low[i],
      c: b.close[i],
      v: b.volume[i],
    });
  }
  return out;
}

// ─── Trade simulation (Wyckoff Spring lifecycle) ───────────────────────────

export type SpringExitReason = "stop" | "trail_20ma" | "end_of_data";

export interface SpringTrade {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  partialExitDate: string | null;
  partialExitPrice: number | null;
  exitDate: string;
  exitPrice: number;
  exitReason: SpringExitReason;
  holdingDays: number;
  blendedReturnPct: number;
  maxDrawdownPct: number;
  qualityScore: number;
  pnlDollar: number;
  positionSizeDollar: number;
  /** Whether the spring had a Test bar — useful for tested-vs-untested cohort analysis. */
  hadTest: boolean;
  isOpen: boolean;
}

// Spec partial-exit thresholds — exported so they can be tuned via the harness later.
export const PARTIAL_GAIN_PCT = 0.10;          // close > entry × 1.10
export const PARTIAL_CONSECUTIVE_DAYS = 2;     // for N bars in a row

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

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function simulateSpringTrade(
  bars: OHLCV[],
  hit: WyckoffSpringHit,
  positionSize: number,
): SpringTrade | null {
  let breakoutI = -1;
  const breakoutTs = hit.breakoutDate.getTime();
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].t.getTime() === breakoutTs) {
      breakoutI = i;
      break;
    }
  }
  if (breakoutI < 0) return null;
  const entryI = breakoutI + 1;
  if (entryI >= bars.length) return null;

  const entryDate = bars[entryI].t;
  const entryPrice = bars[entryI].o;
  const stopPrice = hit.stopPrice;
  const targetPrice = hit.targetPrice;
  const partialThreshold = entryPrice * (1 + PARTIAL_GAIN_PCT);

  const closes = bars.map(b => b.c);
  const highs = bars.map(b => b.h);
  const lows = bars.map(b => b.l);
  const ma20 = rolling20MA(closes);

  let partialExitDate: Date | null = null;
  let partialExitPrice: number | null = null;
  let consecutiveGainDays = 0;
  let partialDone = false;
  let maxDrawdown = 0;
  let peakSinceEntry = entryPrice;

  function finish(
    exitDateD: Date,
    exitPrice: number,
    reason: SpringExitReason,
    holdingDays: number,
    isOpen: boolean,
  ): SpringTrade {
    const ret =
      partialDone && partialExitPrice !== null
        ? (partialExitPrice / entryPrice - 1) * (1 / 3) +
          (exitPrice / entryPrice - 1) * (2 / 3)
        : exitPrice / entryPrice - 1;
    const pct = ret * 100;
    return {
      symbol: hit.symbol,
      entryDate: ymd(entryDate),
      entryPrice: Number(entryPrice.toFixed(4)),
      stopPrice: Number(stopPrice.toFixed(4)),
      targetPrice: Number(targetPrice.toFixed(4)),
      partialExitDate: partialExitDate ? ymd(partialExitDate) : null,
      partialExitPrice: partialExitPrice !== null ? Number(partialExitPrice.toFixed(4)) : null,
      exitDate: ymd(exitDateD),
      exitPrice: Number(exitPrice.toFixed(4)),
      exitReason: reason,
      holdingDays,
      blendedReturnPct: Number(pct.toFixed(4)),
      maxDrawdownPct: Number((maxDrawdown * 100).toFixed(4)),
      qualityScore: hit.qualityScore,
      pnlDollar: Number((ret * positionSize).toFixed(2)),
      positionSizeDollar: Number(positionSize.toFixed(2)),
      hadTest: hit.extras.hasTest,
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

    // Stop check (intraday low touches stop) — runs first so a same-bar stop
    // wins over a same-bar partial trigger.
    if (lowJ <= stopPrice) {
      return finish(bars[j].t, stopPrice, "stop", j - entryI, false);
    }

    // Partial: N consecutive daily closes above entry × (1+PARTIAL_GAIN_PCT).
    if (!partialDone) {
      if (closeJ > partialThreshold) {
        consecutiveGainDays++;
        if (consecutiveGainDays >= PARTIAL_CONSECUTIVE_DAYS) {
          partialExitDate = bars[j].t;
          partialExitPrice = closeJ;
          partialDone = true;
          consecutiveGainDays = 0;
        }
      } else {
        consecutiveGainDays = 0;
      }
    }

    // Trail: after partial fires, exit remaining 2/3 on close < 20-day MA.
    if (partialDone && j >= 20) {
      const m = ma20[j];
      if (!isNaN(m) && closeJ < m && partialExitPrice !== null) {
        return finish(bars[j].t, closeJ, "trail_20ma", j - entryI, false);
      }
    }
  }

  const lastIdx = bars.length - 1;
  return finish(bars[lastIdx].t, closes[lastIdx], "end_of_data", lastIdx - entryI, true);
}

// ─── Per-ticker P&L (matches strategy-htf-pnl.ts shape) ────────────────────

export interface SpringTickerPnL {
  symbol: string;
  bars: number;
  rangeFrom: string;
  rangeTo: string;
  buyAndHoldReturnPct: number;
  buyAndHoldDollar: number;
  trades: SpringTrade[];

  closedTradeCount: number;
  openTradeCount: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  avgWinDollar: number | null;
  avgLossDollar: number | null;
  totalPnLDollar: number;
  rMultiple: number | null;
  compoundReturnPct: number;
  compoundReturnDollar: number;
  bestTradePct: number | null;
  worstTradePct: number | null;
  avgHoldDays: number | null;
  maxDrawdownPct: number;
  /** Tested-vs-untested cohort breakdown — Springs-specific. */
  tradesWithTest: number;
  tradesWithoutTest: number;
}

function summarizeTicker(
  symbol: string,
  bars: Bars,
  trades: SpringTrade[],
  positionSize: number,
): SpringTickerPnL {
  const closed = trades.filter(t => !t.isOpen);
  const open = trades.filter(t => t.isOpen);

  const wins = closed.filter(t => t.blendedReturnPct > 0);
  const losses = closed.filter(t => t.blendedReturnPct <= 0);

  const avgWinPct = wins.length
    ? wins.reduce((a, t) => a + t.blendedReturnPct, 0) / wins.length
    : null;
  const avgLossPct = losses.length
    ? losses.reduce((a, t) => a + t.blendedReturnPct, 0) / losses.length
    : null;

  const totalPnLDollar = closed.reduce((a, t) => a + t.pnlDollar, 0);

  let cum = 1;
  let peak = 1;
  let maxDD = 0;
  for (const t of closed) {
    cum *= 1 + t.blendedReturnPct / 100;
    if (cum > peak) peak = cum;
    const dd = peak > 0 ? (peak - cum) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  const compoundReturnPct = (cum - 1) * 100;

  const returnsPct = closed.map(t => t.blendedReturnPct);
  const bestTradePct = returnsPct.length ? Math.max(...returnsPct) : null;
  const worstTradePct = returnsPct.length ? Math.min(...returnsPct) : null;

  const avgHoldDays = closed.length
    ? closed.reduce((a, t) => a + t.holdingDays, 0) / closed.length
    : null;

  const firstClose = bars.close[0];
  const lastClose = bars.close[bars.close.length - 1];
  const buyAndHoldReturnPct = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;

  return {
    symbol,
    bars: bars.close.length,
    rangeFrom: bars.date[0],
    rangeTo: bars.date[bars.date.length - 1],
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
    avgWinDollar: avgWinPct != null ? Number(((avgWinPct / 100) * positionSize).toFixed(2)) : null,
    avgLossDollar:
      avgLossPct != null ? Number(((avgLossPct / 100) * positionSize).toFixed(2)) : null,
    totalPnLDollar: Number(totalPnLDollar.toFixed(2)),
    rMultiple:
      avgWinPct != null && avgLossPct != null && avgLossPct < 0
        ? Number((avgWinPct / Math.abs(avgLossPct)).toFixed(2))
        : null,
    compoundReturnPct: Number(compoundReturnPct.toFixed(2)),
    compoundReturnDollar: Number(((compoundReturnPct / 100) * positionSize).toFixed(2)),
    bestTradePct: bestTradePct != null ? Number(bestTradePct.toFixed(2)) : null,
    worstTradePct: worstTradePct != null ? Number(worstTradePct.toFixed(2)) : null,
    avgHoldDays: avgHoldDays != null ? Number(avgHoldDays.toFixed(1)) : null,
    maxDrawdownPct: Number((maxDD * 100).toFixed(2)),
    tradesWithTest: trades.filter(t => t.hadTest).length,
    tradesWithoutTest: trades.filter(t => !t.hadTest).length,
  };
}

async function evalTickerPnL(
  symbol: string,
  days: number,
  positionSize: number,
  minScore: number,
): Promise<SpringTickerPnL | null> {
  const bars = await fetchBars(symbol, days);
  if (!bars) return null;
  const ohlcv = barsToOHLCV(bars);
  const hits = scanWyckoffSpring(ohlcv, symbol, { lookbackDays: ohlcv.length, minScore });
  const trades: SpringTrade[] = [];
  for (const h of hits) {
    const r = simulateSpringTrade(ohlcv, h, positionSize);
    if (r == null) continue;
    trades.push(r);
  }
  trades.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  return summarizeTicker(symbol, bars, trades, positionSize);
}

// ─── Basket aggregate ──────────────────────────────────────────────────────

export interface SpringBasketAgg {
  totalSymbols: number;
  symbolsWithData: number;
  totalClosedTrades: number;
  totalOpenTrades: number;
  totalWins: number;
  totalLosses: number;
  basketWinRate: number | null;
  totalPnLDollar: number;
  avgPnLPerTrade: number | null;
  avgPnLPerTicker: number;
  basketCompoundReturnPct: number;
  profitableTickers: number;
  unprofitableTickers: number;
  flatTickers: number;
  /** Tested-vs-untested cohort totals — Springs-specific. */
  totalTradesWithTest: number;
  totalTradesWithoutTest: number;
  /** Cohort P&L breakdown — does the Test bar actually add alpha? */
  pnlWithTestDollar: number;
  pnlWithoutTestDollar: number;
  topPerformers: Array<{
    symbol: string;
    pnlDollar: number;
    trades: number;
    winRate: number | null;
    rMultiple: number | null;
  }>;
  bottomPerformers: Array<{
    symbol: string;
    pnlDollar: number;
    trades: number;
    winRate: number | null;
    rMultiple: number | null;
  }>;
  spyBuyAndHoldReturnPct: number | null;
  spyBuyAndHoldDollar: number | null;
}

function aggregateBasket(
  perTicker: SpringTickerPnL[],
  spyTicker: SpringTickerPnL | null,
): SpringBasketAgg {
  const totalClosedTrades = perTicker.reduce((a, t) => a + t.closedTradeCount, 0);
  const totalOpenTrades = perTicker.reduce((a, t) => a + t.openTradeCount, 0);
  const totalWins = perTicker.reduce((a, t) => a + t.wins, 0);
  const totalLosses = perTicker.reduce((a, t) => a + t.losses, 0);
  const totalPnLDollar = perTicker.reduce((a, t) => a + t.totalPnLDollar, 0);
  const avgCompound = perTicker.length
    ? perTicker.reduce((a, t) => a + t.compoundReturnPct, 0) / perTicker.length
    : 0;

  const profitable = perTicker.filter(t => t.totalPnLDollar > 0).length;
  const unprofitable = perTicker.filter(t => t.totalPnLDollar < 0).length;
  const flat = perTicker.filter(t => t.totalPnLDollar === 0).length;

  // Cohort P&L (closed trades only — open trades don't have a final $ result).
  let pnlWithTest = 0;
  let pnlWithoutTest = 0;
  let countWithTest = 0;
  let countWithoutTest = 0;
  for (const t of perTicker) {
    for (const tr of t.trades) {
      if (tr.isOpen) continue;
      if (tr.hadTest) {
        pnlWithTest += tr.pnlDollar;
        countWithTest++;
      } else {
        pnlWithoutTest += tr.pnlDollar;
        countWithoutTest++;
      }
    }
  }

  const sortedByPnL = [...perTicker].sort((a, b) => b.totalPnLDollar - a.totalPnLDollar);
  const top = sortedByPnL.slice(0, 10).map(t => ({
    symbol: t.symbol,
    pnlDollar: t.totalPnLDollar,
    trades: t.closedTradeCount,
    winRate: t.winRate,
    rMultiple: t.rMultiple,
  }));
  const bottom = sortedByPnL
    .slice(-10)
    .reverse()
    .map(t => ({
      symbol: t.symbol,
      pnlDollar: t.totalPnLDollar,
      trades: t.closedTradeCount,
      winRate: t.winRate,
      rMultiple: t.rMultiple,
    }));

  return {
    totalSymbols: perTicker.length,
    symbolsWithData: perTicker.length,
    totalClosedTrades,
    totalOpenTrades,
    totalWins,
    totalLosses,
    basketWinRate:
      totalClosedTrades > 0 ? Number((totalWins / totalClosedTrades).toFixed(3)) : null,
    totalPnLDollar: Number(totalPnLDollar.toFixed(2)),
    avgPnLPerTrade:
      totalClosedTrades > 0 ? Number((totalPnLDollar / totalClosedTrades).toFixed(2)) : null,
    avgPnLPerTicker:
      perTicker.length > 0 ? Number((totalPnLDollar / perTicker.length).toFixed(2)) : 0,
    basketCompoundReturnPct: Number(avgCompound.toFixed(2)),
    profitableTickers: profitable,
    unprofitableTickers: unprofitable,
    flatTickers: flat,
    totalTradesWithTest: countWithTest,
    totalTradesWithoutTest: countWithoutTest,
    pnlWithTestDollar: Number(pnlWithTest.toFixed(2)),
    pnlWithoutTestDollar: Number(pnlWithoutTest.toFixed(2)),
    topPerformers: top,
    bottomPerformers: bottom,
    spyBuyAndHoldReturnPct: spyTicker ? spyTicker.buyAndHoldReturnPct : null,
    spyBuyAndHoldDollar: spyTicker ? spyTicker.buyAndHoldDollar : null,
  };
}

// ─── Top-level ─────────────────────────────────────────────────────────────

export interface StrategyWyckoffSpringPnLResult {
  basket: {
    symbols: string[];
    days: number;
    positionSize: number;
    minScore: number;
  };
  generatedAt: string;
  perTicker: SpringTickerPnL[];
  aggregate: SpringBasketAgg;
  notes: string[];
}

export async function runStrategyWyckoffSpringPnL(
  symbols: string[],
  days: number,
  positionSize: number,
  includeTradeDetail: boolean,
  minScore: number,
): Promise<StrategyWyckoffSpringPnLResult> {
  const BATCH = 12;
  const tickerResults: SpringTickerPnL[] = [];
  for (let i = 0; i < symbols.length; i += BATCH) {
    const slice = symbols.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      slice.map(s => evalTickerPnL(s, days, positionSize, minScore)),
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) tickerResults.push(r.value);
    }
    if (i + BATCH < symbols.length) await new Promise(r => setTimeout(r, 150));
  }

  const spy = await evalTickerPnL("SPY", days, positionSize, minScore).catch(() => null);

  const perTicker = includeTradeDetail
    ? tickerResults
    : tickerResults.map(t => ({ ...t, trades: [] }));

  return {
    basket: { symbols, days, positionSize, minScore },
    generatedAt: new Date().toISOString(),
    perTicker,
    aggregate: aggregateBasket(tickerResults, spy),
    notes: [
      `Wyckoff Spring evaluator. minScore=${minScore} — 70 = production threshold; 0 includes every detected hit.`,
      "Entry = next day's open after the SOS bar. Stop = spring_low × 0.98 (hard stop, intraday).",
      `Partial = sell 1/3 after ${PARTIAL_CONSECUTIVE_DAYS} consecutive daily closes above entry × ${1 + PARTIAL_GAIN_PCT} (+${PARTIAL_GAIN_PCT * 100}%).`,
      "Trail = exit remaining 2/3 on close < 20-day MA after partial fires (same as HTF).",
      "Target = SOS_close + (TR_high − TR_low) is informational only — trail handles the exit so we don't clip runners.",
      "blendedReturnPct accounts for the 1/3 partial split: (partial − entry)/entry × 1/3 + (final − entry)/entry × 2/3.",
      "pnlDollar = blendedReturnPct/100 × positionSize. One trade per detected setup; no portfolio cap applied here.",
      "Tested-vs-untested cohort split (pnlWithTestDollar vs pnlWithoutTestDollar) lets us decide whether to require a test bar.",
      "Open trades at end of window are excluded from $ aggregates but counted in trade-count metrics.",
      "No commissions or slippage. Real-world P&L would be lower by ~$1–5 per round trip plus 0.05–0.1% slippage.",
      "Add ?detail=1 to include per-trade records for each ticker.",
      "Comparable to /api/diag/strategy-htf-pnl at the same symbols + days + positionSize — same SPY benchmark, same lifecycle skeleton with the partial-rule swap.",
    ],
  };
}
