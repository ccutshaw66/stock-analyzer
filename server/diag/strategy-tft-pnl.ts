/**
 * TFT (Two-Layer Trend Continuation) per-ticker dollar P&L evaluator.
 *
 * Walks each ticker's bars through `simulateTFT`, collects layer-by-layer
 * trade records, and produces per-ticker + basket aggregates with the same
 * shape as `strategy-pnl.ts` so the URLs are directly comparable.
 *
 * The TFT result schema mostly matches strategy-pnl.ts's TickerPnL with
 * three additions: `peakUnitsDeployed` (max simultaneous units, 1.0–2.0),
 * `daysInMarket` (bars with nonzero position), and `marketExposurePct`
 * (daysInMarket / totalBars × 100). The first answers "how much capital did
 * TFT deploy at peak?" — important because TFT can hold up to 2.0 units
 * vs strategy-pnl's 1.0. The other two answer "did we still sit out for
 * months on NVDA?" — the original failure mode.
 *
 * Used by `/api/diag/strategy-tft-pnl`.
 */

import { fmpGet } from "../data/providers/fmp.client";
import { computeBBTC } from "../signals/strategies/bbtc";
import { computeVER } from "../signals/strategies/ver";
import { simulateTFT, type TFTTrade } from "../signals/strategies/tft";

// ─── Indicator helpers (duplicated from strategy-pnl.ts — same math) ───────

function computeEMA(data: number[], period: number): number[] {
  const out = new Array(data.length).fill(NaN);
  if (data.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  out[period - 1] = sum / period;
  const k = 2 / (period + 1);
  for (let i = period; i < data.length; i++) out[i] = data[i] * k + out[i - 1] * (1 - k);
  return out;
}

function computeSMA(data: number[], period: number): number[] {
  const out = new Array(data.length).fill(NaN);
  for (let i = period - 1; i < data.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += data[j];
    out[i] = s / period;
  }
  return out;
}

function computeATR(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const tr = new Array(closes.length).fill(NaN);
  for (let i = 1; i < closes.length; i++) {
    const a = highs[i] - lows[i];
    const b = Math.abs(highs[i] - closes[i - 1]);
    const c = Math.abs(lows[i] - closes[i - 1]);
    tr[i] = Math.max(a, b, c);
  }
  const atr = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return atr;
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  atr[period] = sum / period;
  for (let i = period + 1; i < closes.length; i++) atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  return atr;
}

function computeRSI(closes: number[], period: number): number[] {
  const rsi = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return rsi;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch > 0) gainSum += ch; else lossSum -= ch;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

function computeBollinger(closes: number[], period: number, mult: number): { upper: number[]; lower: number[] } {
  const sma = computeSMA(closes, period);
  const upper = new Array(closes.length).fill(NaN);
  const lower = new Array(closes.length).fill(NaN);
  for (let i = period - 1; i < closes.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += (closes[j] - sma[i]) ** 2;
    const sd = Math.sqrt(s / period);
    upper[i] = sma[i] + mult * sd;
    lower[i] = sma[i] - mult * sd;
  }
  return { upper, lower };
}

function computeVolAvg(volumes: number[], period: number): number[] {
  const out = new Array(volumes.length).fill(NaN);
  for (let i = period - 1; i < volumes.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += volumes[j] || 0;
    out[i] = s / period;
  }
  return out;
}

// ─── FMP fetcher ───────────────────────────────────────────────────────────

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
    // Need extra warmup for 40-week SMA = 280 bars + slope lookback
    const from = new Date(Date.now() - (days + 350) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const data: any = await fmpGet("/historical-price-eod/full", { symbol, from, to });
    const arr: any[] = Array.isArray(data) ? data : (data?.historical || []);
    if (arr.length < 300) return null;
    const sorted = [...arr].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const date: string[] = [];
    const open: number[] = [];
    const high: number[] = [];
    const low: number[] = [];
    const close: number[] = [];
    const volume: number[] = [];
    for (const r of sorted) {
      const o = Number(r.open), h = Number(r.high), l = Number(r.low), c = Number(r.close), v = Number(r.volume);
      if (!Number.isFinite(c)) continue;
      date.push(String(r.date));
      open.push(o); high.push(h); low.push(l); close.push(c); volume.push(Number.isFinite(v) ? v : 0);
    }
    return { date, open, high, low, close, volume };
  } catch {
    return null;
  }
}

// ─── Per-ticker P&L summary ─────────────────────────────────────────────────

export interface TFTTickerPnL {
  symbol: string;
  bars: number;
  rangeFrom: string;
  rangeTo: string;
  buyAndHoldReturnPct: number;
  buyAndHoldDollar: number;
  trades: TFTTrade[];

  // Aggregates over CLOSED layer-trades only:
  closedTradeCount: number;
  openTradeCount: number;
  coreTrades: number;
  tacticalTrades: number;
  longTrades: number;
  shortTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  avgWinDollar: number | null;
  avgLossDollar: number | null;
  totalPnLDollar: number;          // sum of pnlDollar across closed layer-trades
  rMultiple: number | null;
  bestTradePct: number | null;
  worstTradePct: number | null;
  avgHoldBars: number | null;
  maxDrawdownPct: number;          // worst peak-to-trough on per-trade equity curve

  // TFT-specific:
  peakUnitsDeployed: number;       // max simultaneous units (1.0, 1.5, or 2.0)
  daysInMarket: number;
  marketExposurePct: number;       // daysInMarket / totalBars × 100
  capturedBuyAndHoldPct: number | null; // totalPnLDollar / buyAndHoldDollar × 100 (when B&H > 0)
}

function summarizeTicker(symbol: string, bars: Bars, sim: ReturnType<typeof simulateTFT>, positionSize: number): TFTTickerPnL {
  const trades = sim.trades;
  const closed = trades.filter(t => !t.isOpen);
  const open = trades.filter(t => t.isOpen);

  const wins = closed.filter(t => (t.returnPct ?? 0) > 0);
  const losses = closed.filter(t => (t.returnPct ?? 0) <= 0);

  const avgWinPct = wins.length ? wins.reduce((a, t) => a + (t.returnPct || 0), 0) / wins.length : null;
  const avgLossPct = losses.length ? losses.reduce((a, t) => a + (t.returnPct || 0), 0) / losses.length : null;
  const totalPnLDollar = closed.reduce((a, t) => a + (t.pnlDollar || 0), 0);

  // Drawdown on per-trade equity curve (sequential)
  let cum = 0;
  let peak = 0;
  let maxDDPct = 0;
  let peakAtMaxDD = 0;
  for (const t of closed) {
    cum += t.pnlDollar || 0;
    if (cum > peak) peak = cum;
    const dd = peak > 0 ? (peak - cum) / Math.max(peak, positionSize) : 0;
    if (dd > maxDDPct) { maxDDPct = dd; peakAtMaxDD = peak; }
  }

  const returns = closed.map(t => t.returnPct || 0);
  const bestTradePct = returns.length ? Math.max(...returns) : null;
  const worstTradePct = returns.length ? Math.min(...returns) : null;
  const avgHoldBars = closed.length ? closed.reduce((a, t) => a + t.holdBars, 0) / closed.length : null;

  const firstClose = bars.close[0];
  const lastClose = bars.close[bars.close.length - 1];
  const buyAndHoldReturnPct = firstClose > 0 ? (lastClose - firstClose) / firstClose : 0;
  const buyAndHoldDollar = buyAndHoldReturnPct * positionSize;

  const captured = buyAndHoldDollar > 0
    ? Number((totalPnLDollar / buyAndHoldDollar * 100).toFixed(1))
    : null;

  return {
    symbol,
    bars: bars.close.length,
    rangeFrom: bars.date[0],
    rangeTo: bars.date[bars.date.length - 1],
    buyAndHoldReturnPct: Number((buyAndHoldReturnPct * 100).toFixed(2)),
    buyAndHoldDollar: Number(buyAndHoldDollar.toFixed(2)),
    trades,
    closedTradeCount: closed.length,
    openTradeCount: open.length,
    coreTrades: trades.filter(t => t.layerType === "CORE").length,
    tacticalTrades: trades.filter(t => t.layerType === "TACTICAL").length,
    longTrades: trades.filter(t => t.side === "LONG").length,
    shortTrades: trades.filter(t => t.side === "SHORT").length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? Number((wins.length / closed.length).toFixed(3)) : null,
    avgWinPct: avgWinPct != null ? Number((avgWinPct * 100).toFixed(2)) : null,
    avgLossPct: avgLossPct != null ? Number((avgLossPct * 100).toFixed(2)) : null,
    avgWinDollar: avgWinPct != null ? Number((avgWinPct * positionSize).toFixed(2)) : null,
    avgLossDollar: avgLossPct != null ? Number((avgLossPct * positionSize).toFixed(2)) : null,
    totalPnLDollar: Number(totalPnLDollar.toFixed(2)),
    rMultiple: (avgWinPct != null && avgLossPct != null && avgLossPct < 0)
      ? Number((avgWinPct / Math.abs(avgLossPct)).toFixed(2))
      : null,
    bestTradePct: bestTradePct != null ? Number((bestTradePct * 100).toFixed(2)) : null,
    worstTradePct: worstTradePct != null ? Number((worstTradePct * 100).toFixed(2)) : null,
    avgHoldBars: avgHoldBars != null ? Number(avgHoldBars.toFixed(1)) : null,
    maxDrawdownPct: Number((maxDDPct * 100).toFixed(2)),
    peakUnitsDeployed: sim.peakUnitsDeployed,
    daysInMarket: sim.daysInMarket,
    marketExposurePct: sim.totalBars > 0 ? Number((sim.daysInMarket / sim.totalBars * 100).toFixed(1)) : 0,
    capturedBuyAndHoldPct: captured,
  };
}

async function evalTickerTFT(symbol: string, days: number, positionSize: number, enableShorts: boolean, atrFloorPct: number): Promise<TFTTickerPnL | null> {
  const bars = await fetchBars(symbol, days);
  if (!bars) return null;

  const rsi14 = computeRSI(bars.close, 14);
  const ema9 = computeEMA(bars.close, 9);
  const ema21 = computeEMA(bars.close, 21);
  const ema50 = computeEMA(bars.close, 50);
  const atr14 = computeATR(bars.high, bars.low, bars.close, 14);
  const bb = computeBollinger(bars.close, 20, 2);
  const volAvg20 = computeVolAvg(bars.volume, 20);

  const bbtc = computeBBTC({
    closes: bars.close, highs: bars.high, lows: bars.low,
    ema9, ema21, ema50, atr14, rsi14,
  });
  const ver = computeVER({
    closes: bars.close, highs: bars.high, lows: bars.low, volumes: bars.volume,
    rsi14, bbUpper: bb.upper, bbLower: bb.lower, volAvg20, atr14,
  });

  // Restrict eval window to the requested days (with warmup margin for 40W SMA).
  const startIdx = Math.max(0, bars.close.length - days - 50);
  const slicedBars: Bars = {
    date: bars.date.slice(startIdx),
    open: bars.open.slice(startIdx),
    high: bars.high.slice(startIdx),
    low: bars.low.slice(startIdx),
    close: bars.close.slice(startIdx),
    volume: bars.volume.slice(startIdx),
  };

  const sim = simulateTFT({
    dates: slicedBars.date,
    closes: slicedBars.close,
    highs: slicedBars.high,
    lows: slicedBars.low,
    atr14: atr14.slice(startIdx),
    bbtcSignals: bbtc.signals.slice(startIdx) as Array<string | undefined>,
    bbtcSides: bbtc.signalSides.slice(startIdx) as Array<string | undefined>,
    verSignals: ver.signals.slice(startIdx) as Array<string | undefined>,
    verSides: ver.signalSides.slice(startIdx) as Array<string | undefined>,
    positionSize,
    enableShorts,
    atrFloorPct,
  });

  return summarizeTicker(symbol, slicedBars, sim, positionSize);
}

// ─── Basket aggregation ─────────────────────────────────────────────────────

export interface TFTBasketAgg {
  totalSymbols: number;
  symbolsWithData: number;
  totalClosedTrades: number;
  totalOpenTrades: number;
  totalCoreTrades: number;
  totalTacticalTrades: number;
  totalLongTrades: number;
  totalShortTrades: number;
  totalWins: number;
  totalLosses: number;
  basketWinRate: number | null;
  totalPnLDollar: number;
  avgPnLPerTrade: number | null;
  avgPnLPerTicker: number;
  profitableTickers: number;
  unprofitableTickers: number;
  flatTickers: number;
  avgMarketExposurePct: number;        // mean across tickers
  avgPeakUnitsDeployed: number;        // mean peak units across tickers
  totalBuyAndHoldDollar: number;       // sum of B&H $ across all tickers
  basketCapturedBuyAndHoldPct: number; // totalPnLDollar / totalBuyAndHoldDollar × 100
  topPerformers: Array<{
    symbol: string; pnlDollar: number; trades: number; winRate: number | null;
    rMultiple: number | null; capturedBnH: number | null; exposurePct: number;
  }>;
  bottomPerformers: Array<{
    symbol: string; pnlDollar: number; trades: number; winRate: number | null;
    rMultiple: number | null; capturedBnH: number | null; exposurePct: number;
  }>;
  spyBuyAndHoldReturnPct: number | null;
  spyBuyAndHoldDollar: number | null;
}

function aggregateBasket(perTicker: TFTTickerPnL[], spyTicker: TFTTickerPnL | null): TFTBasketAgg {
  const totalClosedTrades = perTicker.reduce((a, t) => a + t.closedTradeCount, 0);
  const totalOpenTrades = perTicker.reduce((a, t) => a + t.openTradeCount, 0);
  const totalCoreTrades = perTicker.reduce((a, t) => a + t.coreTrades, 0);
  const totalTacticalTrades = perTicker.reduce((a, t) => a + t.tacticalTrades, 0);
  const totalLongTrades = perTicker.reduce((a, t) => a + t.longTrades, 0);
  const totalShortTrades = perTicker.reduce((a, t) => a + t.shortTrades, 0);
  const totalWins = perTicker.reduce((a, t) => a + t.wins, 0);
  const totalLosses = perTicker.reduce((a, t) => a + t.losses, 0);
  const totalPnLDollar = perTicker.reduce((a, t) => a + t.totalPnLDollar, 0);

  const profitable = perTicker.filter(t => t.totalPnLDollar > 0).length;
  const unprofitable = perTicker.filter(t => t.totalPnLDollar < 0).length;
  const flat = perTicker.filter(t => t.totalPnLDollar === 0).length;

  const avgExposure = perTicker.length
    ? perTicker.reduce((a, t) => a + t.marketExposurePct, 0) / perTicker.length
    : 0;
  const avgPeak = perTicker.length
    ? perTicker.reduce((a, t) => a + t.peakUnitsDeployed, 0) / perTicker.length
    : 0;

  const totalBnH = perTicker.reduce((a, t) => a + t.buyAndHoldDollar, 0);
  const basketCaptured = totalBnH > 0
    ? Number((totalPnLDollar / totalBnH * 100).toFixed(1))
    : 0;

  const sortedByPnL = [...perTicker].sort((a, b) => b.totalPnLDollar - a.totalPnLDollar);
  const top = sortedByPnL.slice(0, 10).map(t => ({
    symbol: t.symbol,
    pnlDollar: t.totalPnLDollar,
    trades: t.closedTradeCount,
    winRate: t.winRate,
    rMultiple: t.rMultiple,
    capturedBnH: t.capturedBuyAndHoldPct,
    exposurePct: t.marketExposurePct,
  }));
  const bottom = sortedByPnL.slice(-10).reverse().map(t => ({
    symbol: t.symbol,
    pnlDollar: t.totalPnLDollar,
    trades: t.closedTradeCount,
    winRate: t.winRate,
    rMultiple: t.rMultiple,
    capturedBnH: t.capturedBuyAndHoldPct,
    exposurePct: t.marketExposurePct,
  }));

  return {
    totalSymbols: perTicker.length,
    symbolsWithData: perTicker.length,
    totalClosedTrades,
    totalOpenTrades,
    totalCoreTrades,
    totalTacticalTrades,
    totalLongTrades,
    totalShortTrades,
    totalWins,
    totalLosses,
    basketWinRate: totalClosedTrades > 0 ? Number((totalWins / totalClosedTrades).toFixed(3)) : null,
    totalPnLDollar: Number(totalPnLDollar.toFixed(2)),
    avgPnLPerTrade: totalClosedTrades > 0 ? Number((totalPnLDollar / totalClosedTrades).toFixed(2)) : null,
    avgPnLPerTicker: perTicker.length > 0 ? Number((totalPnLDollar / perTicker.length).toFixed(2)) : 0,
    profitableTickers: profitable,
    unprofitableTickers: unprofitable,
    flatTickers: flat,
    avgMarketExposurePct: Number(avgExposure.toFixed(1)),
    avgPeakUnitsDeployed: Number(avgPeak.toFixed(2)),
    totalBuyAndHoldDollar: Number(totalBnH.toFixed(2)),
    basketCapturedBuyAndHoldPct: basketCaptured,
    topPerformers: top,
    bottomPerformers: bottom,
    spyBuyAndHoldReturnPct: spyTicker ? spyTicker.buyAndHoldReturnPct : null,
    spyBuyAndHoldDollar: spyTicker ? spyTicker.buyAndHoldDollar : null,
  };
}

// ─── Top-level ──────────────────────────────────────────────────────────────

export interface TFTStrategyPnLResult {
  basket: { symbols: string[]; days: number; positionSize: number; enableShorts: boolean; atrFloorPct: number };
  generatedAt: string;
  perTicker: TFTTickerPnL[];
  aggregate: TFTBasketAgg;
  notes: string[];
}

export async function runStrategyTFTPnL(
  symbols: string[],
  days: number,
  positionSize: number,
  includeTradeDetail: boolean,
  enableShorts: boolean,
  atrFloorPct: number,
): Promise<TFTStrategyPnLResult> {
  const BATCH = 12;
  const tickerResults: TFTTickerPnL[] = [];
  for (let i = 0; i < symbols.length; i += BATCH) {
    const slice = symbols.slice(i, i + BATCH);
    const results = await Promise.allSettled(slice.map(s => evalTickerTFT(s, days, positionSize, enableShorts, atrFloorPct)));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) tickerResults.push(r.value);
    }
    if (i + BATCH < symbols.length) await new Promise(r => setTimeout(r, 150));
  }

  const spy = await evalTickerTFT("SPY", days, positionSize, enableShorts, atrFloorPct).catch(() => null);

  const perTicker = includeTradeDetail
    ? tickerResults
    : tickerResults.map(t => ({ ...t, trades: [] }));

  return {
    basket: { symbols, days, positionSize, enableShorts, atrFloorPct },
    generatedAt: new Date().toISOString(),
    perTicker,
    aggregate: aggregateBasket(tickerResults, spy),
    notes: [
      "TFT (Two-Layer Trend Continuation) — designed to keep capital deployed throughout secular trends instead of sitting in cash between BBTC/VER signals.",
      "CORE layer: 1.0 unit held while regime is confirmed bullish/bearish on the weekly chart (close vs 40W SMA + 4-week slope). Exits ONLY on weekly close through 40W SMA, regime flip, regime neutral, or a -15% catastrophic stop.",
      "TACTICAL layer: 0.5-unit adds on BBTC_BUY/ADD_LONG/VER_BUY while regime is bullish. Each tactical layer trails on 5×ATR. Stops drop the layer but leave the core intact. Max 2.0 units total.",
      "Stop-and-reverse: when core exits because the regime flipped, immediately enters the opposite side at 1.0 unit. Captures both sides of trend changes (e.g. NFLX 2022 long → short → long).",
      "Whipsaw guard: regime must hold for 2 consecutive weekly closes before flipping direction. Single-week violations don't kick the core out.",
      "Volatility-adjusted core: if entry-bar ATR > 5% of price, core entry is 0.5 unit instead of 1.0 (keeps dollar-risk consistent on high-vol names like TSLA).",
      "POSITION SIZE NOTE: each unit = positionSize dollars. Max position = 2.0 units = 2× positionSize notional. THIS IS DIFFERENT FROM strategy-pnl.ts which deploys ONE positionSize per trade. To compare apples-to-apples on capital deployment, see `aggregate.avgPeakUnitsDeployed` (mean peak units across tickers).",
      "totalPnLDollar = sum of (returnPct × units × positionSize) across all closed layer-trades.",
      "marketExposurePct = bars with nonzero position / total bars × 100. Compare to BBTC+VER which historically held ~45% on NVDA. TFT target is 80%+ on names in confirmed regimes.",
      "capturedBuyAndHoldPct per ticker = totalPnLDollar / buyAndHoldDollar × 100. Tells you what fraction of the simple-hold return the strategy captured.",
      "shorts=on by default (the whole point of TFT is two-sided coverage). Add ?shorts=off for ablation testing.",
      "atrFloor (percent) refuses entries on bars where ATR/close is below the threshold. Default 0 (no filter). Recommended starting value: 1.5 (filters most low-vol defensives like utilities, telecom, staples without touching trending names).",
      "No commissions or slippage applied. Real-world P&L would be lower by ~$1-5 per round trip plus 0.05-0.1% slippage. Higher trade count than strategy-pnl.ts, so slippage matters more.",
      "Add ?detail=1 to include per-trade records (every layer entry/exit) for each ticker.",
    ],
  };
}
