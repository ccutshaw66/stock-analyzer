/**
 * HTF (High Tight Flag) per-ticker dollar P&L evaluator.
 *
 * Walks each ticker's full N-year bar history through `scanHtf`, simulates
 * Givens' exit rules on every detected hit, and aggregates per-ticker +
 * basket-wide. Produces the same `TickerPnL` / `BasketAgg` shape as
 * `strategy-pnl.ts` so HTF can be compared apples-to-apples against the
 * BBTC+VER and TFT baskets at the same URL pattern.
 *
 * Diverges from `htf-scanner/backtest.ts` in two ways:
 *   1. Fetches bars directly via fmpGet (10y window) instead of going
 *      through `getHtfBars` (1y cache) — apples-to-apples vs strategy-pnl.
 *   2. Emits dollar P&L per trade (returnPct × positionSize) and basket
 *      aggregates, not just per-trade percent returns.
 *
 * Used by `/api/diag/strategy-htf-pnl`.
 */

import { fmpGet } from "../data/providers/fmp.client";
import { scanHtf, type HtfHit } from "../signals/strategies/htf";
import type { OHLCV } from "../data/types";

// ─── Bar fetcher (same shape as strategy-pnl.ts) ───────────────────────────

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

// Convert Bars to OHLCV[] for scanHtf.
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

// ─── Trade simulation (Givens exits, copied from htf-scanner/backtest.ts) ──

export type HtfExitReason = "stop" | "trail_20ma" | "end_of_data" | "failed_breakout";

export interface HtfTrade {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  stopPrice: number;
  partialExitDate: string | null;
  partialExitPrice: number | null;
  exitDate: string;
  exitPrice: number;
  exitReason: HtfExitReason;
  holdingDays: number;
  blendedReturnPct: number;
  maxDrawdownPct: number;
  qualityScore: number;
  /** Dollar P&L = blendedReturnPct/100 × positionSize. */
  pnlDollar: number;
  /** Whether the trade is still open at end of window (true → excluded from $ aggregates). */
  isOpen: boolean;
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

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function simulateHtfTrade(
  bars: OHLCV[],
  hit: HtfHit,
  positionSize: number,
): HtfTrade | null {
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
  const stopPrice = hit.extras.flagLow * 0.99;
  const flagHigh = hit.extras.flagHigh;

  const closes = bars.map(b => b.c);
  const highs = bars.map(b => b.h);
  const lows = bars.map(b => b.l);
  const ma20 = rolling20MA(closes);

  // 2026-05-20 throwback fix piece 2 (relaxed) — failed-breakout exit.
  // Original piece 2 (1 close below flag_high in 3 bars) was too aggressive
  // and killed normal test bars. Relaxed version requires TWO CONSECUTIVE
  // closes below flag_high within a 5-bar window. Catches sustained breakout
  // failures (Wyckoff Upthrust / Woods Hikkake) without cutting normal
  // pullback tests short.
  const FAILED_BREAKOUT_WINDOW_BARS = 5;
  const FAILED_BREAKOUT_CONSECUTIVE = 2;
  let consecClosesBelow = 0;
  let partialExitDate: Date | null = null;
  let partialExitPrice: number | null = null;
  let strengthDays = 0;
  let partialDone = false;
  let maxDrawdown = 0;
  let peakSinceEntry = entryPrice;

  function finish(
    exitDateD: Date,
    exitPrice: number,
    reason: HtfExitReason,
    holdingDays: number,
    isOpen: boolean,
  ): HtfTrade {
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

    if (lowJ <= stopPrice) {
      return finish(bars[j].t, stopPrice, "stop", j - entryI, false);
    }

    // Failed-breakout exit (relaxed): require TWO consecutive closes below
    // flag_high within the first 5 bars after breakout. Exit at next open.
    const barsAfterBreakout = j - breakoutI; // 1 on entry day
    if (
      barsAfterBreakout >= 1 &&
      barsAfterBreakout <= FAILED_BREAKOUT_WINDOW_BARS
    ) {
      if (closeJ < flagHigh) {
        consecClosesBelow++;
        if (consecClosesBelow >= FAILED_BREAKOUT_CONSECUTIVE) {
          const exitI = j + 1 < bars.length ? j + 1 : j;
          const exitPrice = j + 1 < bars.length ? bars[exitI].o : closeJ;
          return finish(bars[exitI].t, exitPrice, "failed_breakout", exitI - entryI, false);
        }
      } else {
        consecClosesBelow = 0;
      }
    }

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

// ─── Per-ticker P&L ────────────────────────────────────────────────────────

export interface HtfTickerPnL {
  symbol: string;
  bars: number;
  rangeFrom: string;
  rangeTo: string;
  buyAndHoldReturnPct: number;
  buyAndHoldDollar: number;
  trades: HtfTrade[];

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
}

function summarizeTicker(
  symbol: string,
  bars: Bars,
  trades: HtfTrade[],
  positionSize: number,
): HtfTickerPnL {
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
  };
}

async function evalTickerPnL(
  symbol: string,
  days: number,
  positionSize: number,
  minScore: number,
): Promise<HtfTickerPnL | null> {
  const bars = await fetchBars(symbol, days);
  if (!bars) return null;
  const ohlcv = barsToOHLCV(bars);
  // Scan the full window — lookbackDays must cover all bars so historical
  // hits inside the window are detected.
  const hits = scanHtf(ohlcv, symbol, { lookbackDays: ohlcv.length, minScore });
  const trades: HtfTrade[] = [];
  for (const h of hits) {
    const t = simulateHtfTrade(ohlcv, h, positionSize);
    if (t) trades.push(t);
  }
  trades.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  return summarizeTicker(symbol, bars, trades, positionSize);
}

// ─── Basket aggregate (matches strategy-pnl.ts shape) ──────────────────────

export interface HtfBasketAgg {
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
  perTicker: HtfTickerPnL[],
  spyTicker: HtfTickerPnL | null,
): HtfBasketAgg {
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
    topPerformers: top,
    bottomPerformers: bottom,
    spyBuyAndHoldReturnPct: spyTicker ? spyTicker.buyAndHoldReturnPct : null,
    spyBuyAndHoldDollar: spyTicker ? spyTicker.buyAndHoldDollar : null,
  };
}

// ─── Top-level ─────────────────────────────────────────────────────────────

export interface StrategyHtfPnLResult {
  basket: { symbols: string[]; days: number; positionSize: number; minScore: number };
  generatedAt: string;
  perTicker: HtfTickerPnL[];
  aggregate: HtfBasketAgg;
  notes: string[];
}

export async function runStrategyHtfPnL(
  symbols: string[],
  days: number,
  positionSize: number,
  includeTradeDetail: boolean,
  minScore: number,
): Promise<StrategyHtfPnLResult> {
  const BATCH = 12;
  const tickerResults: HtfTickerPnL[] = [];
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
      `HTF (High Tight Flag, Givens variant) evaluator. minScore=${minScore} — set to 70 to match production threshold; 0 includes every detected pattern.`,
      "Entry = next day's open after a detected breakout. Stop = flag_low × 0.99 (hard stop, intraday). Partial = sell 1/3 after 3 cumulative close-strength days (close >5% above entry). Trail = exit remaining 2/3 on close < 20-day MA after partial fires.",
      "blendedReturnPct accounts for the 1/3 partial split: (partial − entry)/entry × 1/3 + (final − entry)/entry × 2/3.",
      "positionSize is dollars deployed per trade; pnlDollar = blendedReturnPct/100 × positionSize. One trade per detected setup; no portfolio cap applied here (the live /htf page applies per-trade and portfolio caps separately).",
      "Open trades at end of window are excluded from $ aggregates but counted in trade-count metrics.",
      "No commissions or slippage. Real-world P&L would be lower by ~$1–5 per round trip plus 0.05–0.1% slippage.",
      "Add ?detail=1 to include per-trade records (entryDate, entryPrice, exitDate, exitPrice, blendedReturnPct, etc.) for each ticker.",
      "Comparable to /api/diag/strategy-pnl (BBTC+VER) at the same symbols + days + positionSize — same shape, same SPY benchmark.",
    ],
  };
}
