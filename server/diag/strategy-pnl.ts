/**
 * Per-trade dollar P&L evaluator.
 *
 * Walks BBTC + VER signals chronologically, pairs each LONG entry with its
 * corresponding exit, computes round-trip return and dollar P&L assuming a
 * fixed position size per trade. Returns per-ticker and basket-aggregate
 * metrics including total $ P&L, win rate, R-multiple, compound return,
 * and max drawdown.
 *
 * This complements `strategy-eval.ts` (which measures forward-N-day edge
 * per fire) by answering the practical question: **did the strategy
 * actually make money?**
 *
 * Long-only as of 2026-05-08 short demote. Short entries are info-only
 * signals on the chart; they never enter position state, so no short
 * trades exist to pair. To validate the short demote post-hoc, build a
 * "synthetic shorts" mode (simulate short hold with same stop rules) —
 * not in this version.
 *
 * Used by `/api/diag/strategy-pnl`.
 */

import { fmpGet } from "../data/providers/fmp.client";
import { computeBBTC, type BBTCSignal, type BBTCSignalSide } from "../signals/strategies/bbtc";
import { computeVER, type VERSignal, type VERSignalSide } from "../signals/strategies/ver";
import { scoreAMC, type AMCInput } from "../signals/strategies/amc";

export type AMCGateMode = "off" | "loose" | "strict";

// ─── Indicator helpers (duplicated from strategy-eval — same math) ──────────

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

// MACD histogram (12/26/9), matching routes.ts:3246–3254 canonical computation.
function computeMACDHistogram(closes: number[]): number[] {
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);
  const macdLine = closes.map((_, i) =>
    !isNaN(ema12[i]) && !isNaN(ema26[i]) ? ema12[i] - ema26[i] : NaN,
  );
  const validMacd: number[] = [];
  const validIdx: number[] = [];
  macdLine.forEach((v, i) => { if (!isNaN(v)) { validMacd.push(v); validIdx.push(i); } });
  const sigEma = computeEMA(validMacd, 9);
  const signal = new Array(closes.length).fill(NaN);
  validIdx.forEach((idx, j) => { signal[idx] = sigEma[j]; });
  return closes.map((_, i) =>
    !isNaN(macdLine[i]) && !isNaN(signal[i]) ? macdLine[i] - signal[i] : NaN,
  );
}

// VAMI scaled ×8, matching routes.ts:3256–3267 canonical computation.
function computeVAMIScaled(closes: number[], volumes: number[]): number[] {
  const vami = new Array(closes.length).fill(0);
  const avgVol20 = computeSMA(volumes.map(v => v || 0), 20);
  const k = 2 / (12 + 1);
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] === 0 || isNaN(avgVol20[i]) || avgVol20[i] === 0) continue;
    const ret = ((closes[i] - closes[i - 1]) / closes[i - 1]) * 100;
    const vr = Math.min(2.5, Math.max(0.5, volumes[i] / avgVol20[i]));
    const wr = ret * vr;
    vami[i] = wr * k + vami[i - 1] * (1 - k);
  }
  return vami.map(v => v * 8);
}

// Per-bar AMC signal series (ENTER/HOLD/SELL). Inlines computeAMC's logic so we
// can score every historical bar without N² array slicing. Matches the live
// Trade Analysis configuration: trendShortEma=EMA9, trendLongEma=EMA50,
// trendStrengthRefEma=EMA21, reversionRefLevel=SMA200×0.95, direction="above".
function computeAMCSeries(input: AMCInput): { score: number[]; signal: ("ENTER" | "HOLD" | "SELL")[] } {
  const { closes, histogram, rsi14, vamiScaled, reversionRefLevel, reversionDirection } = input;
  const n = closes.length;
  const score: number[] = new Array(n).fill(0);
  const signal: ("ENTER" | "HOLD" | "SELL")[] = new Array(n).fill("HOLD");
  for (let i = 1; i < n; i++) {
    const sc = scoreAMC(i, input);
    score[i] = sc;
    const greenClose = closes[i] > closes[i - 1];
    const momentumEntry = sc >= 4 && greenClose;
    let reversionEntry = false;
    if (
      !isNaN(rsi14[i]) && rsi14[i] < 30 &&
      !isNaN(reversionRefLevel[i]) && greenClose &&
      vamiScaled[i] > vamiScaled[i - 1]
    ) {
      reversionEntry = reversionDirection === "above"
        ? closes[i] > reversionRefLevel[i]
        : closes[i] <= reversionRefLevel[i];
    }
    let s: "ENTER" | "HOLD" | "SELL" = "HOLD";
    if (momentumEntry || reversionEntry) s = "ENTER";
    if (!isNaN(rsi14[i]) && rsi14[i] > 75) s = "SELL";
    if (
      !isNaN(histogram[i]) && histogram[i] < 0 &&
      !isNaN(histogram[i - 1]) && histogram[i - 1] >= 0
    ) s = "SELL";
    signal[i] = s;
  }
  return { score, signal };
}

// ─── FMP fetcher (same as strategy-eval) ────────────────────────────────────

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
    const arr: any[] = Array.isArray(data) ? data : (data?.historical || []);
    if (arr.length < 100) return null;
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

// ─── Trade pairing ──────────────────────────────────────────────────────────

export interface Trade {
  strategy: "BBTC" | "VER";   // which sub-strategy generated this trade
  entryDate: string;
  entryPrice: number;
  entryReason: string;        // "BBTC_BUY" / "BBTC_ADD_LONG" / "VER_BUY"
  entryRSI: number | null;
  exitDate: string | null;
  exitPrice: number | null;
  exitReason: string | null;  // "BBTC_STOP_HIT" / "BBTC_SELL" / "BBTC_REDUCE" / "VER_STOP_HIT" / null if open
  holdBars: number;
  returnPct: number | null;   // (exit - entry) / entry; null if open
  pnlDollar: number | null;   // returnPct × positionSize; null if open
  isOpen: boolean;
}

/**
 * Walks the bar series and pairs LONG entries with exits, **per sub-strategy**.
 * BBTC and VER have independent position state internally; they often fire
 * on different setups (BBTC = trend continuation, VER = oversold reversal).
 * Tracking them separately means a VER_BUY at a pullback bottom is paired
 * with the next VER_STOP_HIT, not closed early by a BBTC exit.
 *
 * Long-only post-2026-05-08 — short signals are info-only and skipped.
 *
 * If a trade is still open at the end of the window, it's recorded with
 * isOpen=true and excluded from $ P&L aggregates (no realized return) but
 * counted in trade-count metrics.
 */
function pairTrades(
  bbtcSignals: BBTCSignal[],
  bbtcSides: BBTCSignalSide[],
  verSignals: VERSignal[],
  verSides: VERSignalSide[],
  closes: number[],
  dates: string[],
  rsi14: number[],
  positionSize: number,
  amcGate: AMCGateMode,
  amcScore: number[],
  amcSignal: ("ENTER" | "HOLD" | "SELL")[],
): Trade[] {
  // AMC confirmation gate semantics:
  //   "off"    — no gate; current/legacy behavior
  //   "loose"  — at the entry bar, AMC score must be >= 3 (3+ of 5 conditions met)
  //   "strict" — AMC must have signaled ENTER at the entry bar OR within prior 10 bars
  // Returns true when an entry at bar `i` is allowed.
  const STRICT_LOOKBACK = 10;
  function amcAllows(i: number): boolean {
    if (amcGate === "off") return true;
    if (amcGate === "loose") return amcScore[i] >= 3;
    // strict
    const start = Math.max(0, i - STRICT_LOOKBACK);
    for (let j = start; j <= i; j++) {
      if (amcSignal[j] === "ENTER") return true;
    }
    return false;
  }
  // Helper that walks a single signal/side pair stream and produces trades.
  function pairOne(
    strategy: "BBTC" | "VER",
    sigs: (BBTCSignal | VERSignal)[],
    sides: (BBTCSignalSide | VERSignalSide)[],
    isEntry: (sig: BBTCSignal | VERSignal, side: BBTCSignalSide | VERSignalSide) => boolean,
    isExit:  (sig: BBTCSignal | VERSignal, side: BBTCSignalSide | VERSignalSide) => boolean,
    reasonName: (sig: BBTCSignal | VERSignal) => string,
  ): Trade[] {
    const trades: Trade[] = [];
    let openTrade: Trade | null = null;
    let openEntryBar = -1;

    for (let i = 0; i < closes.length; i++) {
      const sig = sigs[i];
      const side = sides[i];
      if (!sig) continue;

      // Close FIRST so a same-bar exit-then-entry sequence works correctly
      // (close the old trade at this bar's close, open new on the next entry).
      if (openTrade && isExit(sig, side)) {
        const exitPrice = closes[i];
        const ret = (exitPrice - openTrade.entryPrice) / openTrade.entryPrice;
        openTrade.exitDate = dates[i];
        openTrade.exitPrice = Number(exitPrice.toFixed(2));
        openTrade.exitReason = reasonName(sig);
        openTrade.returnPct = Number(ret.toFixed(4));
        openTrade.pnlDollar = Number((ret * positionSize).toFixed(2));
        openTrade.holdBars = i - openEntryBar;
        openTrade.isOpen = false;
        trades.push(openTrade);
        openTrade = null;
        openEntryBar = -1;
      } else if (!openTrade && isEntry(sig, side) && amcAllows(i)) {
        openTrade = {
          strategy,
          entryDate: dates[i],
          entryPrice: Number(closes[i].toFixed(2)),
          entryReason: reasonName(sig),
          entryRSI: Number.isFinite(rsi14[i]) ? Number(rsi14[i].toFixed(1)) : null,
          exitDate: null,
          exitPrice: null,
          exitReason: null,
          holdBars: 0,
          returnPct: null,
          pnlDollar: null,
          isOpen: true,
        };
        openEntryBar = i;
      }
    }

    if (openTrade) {
      openTrade.holdBars = closes.length - 1 - openEntryBar;
      trades.push(openTrade);
    }
    return trades;
  }

  const bbtcTrades = pairOne(
    "BBTC",
    bbtcSignals,
    bbtcSides,
    (s, side) => (s === "BUY" && side === "LONG") || (s === "ADD_LONG" && side === "LONG"),
    (s, side) =>
      (s === "STOP_HIT" && side === "LONG") ||
      (s === "SELL"     && side === "LONG") ||
      (s === "REDUCE"   && side === "LONG"),
    (s) => `BBTC_${s}`,
  );

  const verTrades = pairOne(
    "VER",
    verSignals,
    verSides,
    (s, side) => s === "BUY" && side === "LONG",
    (s, side) => s === "STOP_HIT" && side === "LONG",
    (s) => `VER_${s}`,
  );

  // Combined chronologically by entry date so the equity curve / drawdown
  // computation reflects real timeline.
  return [...bbtcTrades, ...verTrades].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
}

// ─── Per-ticker P&L summary ─────────────────────────────────────────────────

export interface TickerPnL {
  symbol: string;
  bars: number;
  rangeFrom: string;
  rangeTo: string;
  buyAndHoldReturnPct: number; // buy first close, hold to last close
  buyAndHoldDollar: number;    // positionSize × buyAndHoldReturnPct
  trades: Trade[];

  // Aggregates over CLOSED trades only:
  closedTradeCount: number;
  openTradeCount: number;
  wins: number;
  losses: number;
  winRate: number | null;       // wins / closed
  avgWinPct: number | null;
  avgLossPct: number | null;    // negative number
  avgWinDollar: number | null;
  avgLossDollar: number | null;
  totalPnLDollar: number;       // sum of pnlDollar across closed trades
  rMultiple: number | null;     // |avgWinPct / avgLossPct|
  compoundReturnPct: number;    // (1+r1)*(1+r2)*... - 1, sequential
  compoundReturnDollar: number; // positionSize × compoundReturnPct
  bestTradePct: number | null;
  worstTradePct: number | null;
  avgHoldBars: number | null;
  maxDrawdownPct: number;       // worst peak-to-trough drop on equity curve
}

function summarizeTicker(symbol: string, bars: Bars, trades: Trade[], positionSize: number): TickerPnL {
  const closed = trades.filter(t => !t.isOpen);
  const open = trades.filter(t => t.isOpen);

  const wins = closed.filter(t => (t.returnPct ?? 0) > 0);
  const losses = closed.filter(t => (t.returnPct ?? 0) <= 0);

  const avgWinPct = wins.length ? wins.reduce((a, t) => a + (t.returnPct || 0), 0) / wins.length : null;
  const avgLossPct = losses.length ? losses.reduce((a, t) => a + (t.returnPct || 0), 0) / losses.length : null;

  const totalPnLDollar = closed.reduce((a, t) => a + (t.pnlDollar || 0), 0);

  // Compound return: chain (1 + return) across all closed trades sequentially.
  // Equivalent to "always reinvest gains/losses into the next trade."
  let cum = 1;
  let peak = 1;
  let maxDD = 0;
  const equityCurve: number[] = [1];
  for (const t of closed) {
    cum *= (1 + (t.returnPct || 0));
    equityCurve.push(cum);
    if (cum > peak) peak = cum;
    const dd = peak > 0 ? (peak - cum) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  const compoundReturnPct = cum - 1;

  const returns = closed.map(t => t.returnPct || 0);
  const bestTradePct = returns.length ? Math.max(...returns) : null;
  const worstTradePct = returns.length ? Math.min(...returns) : null;

  const avgHoldBars = closed.length ? closed.reduce((a, t) => a + t.holdBars, 0) / closed.length : null;

  const firstClose = bars.close[0];
  const lastClose = bars.close[bars.close.length - 1];
  const buyAndHoldReturnPct = firstClose > 0 ? (lastClose - firstClose) / firstClose : 0;

  return {
    symbol,
    bars: bars.close.length,
    rangeFrom: bars.date[0],
    rangeTo: bars.date[bars.date.length - 1],
    buyAndHoldReturnPct: Number((buyAndHoldReturnPct * 100).toFixed(2)),
    buyAndHoldDollar: Number((buyAndHoldReturnPct * positionSize).toFixed(2)),
    trades,
    closedTradeCount: closed.length,
    openTradeCount: open.length,
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
    compoundReturnPct: Number((compoundReturnPct * 100).toFixed(2)),
    compoundReturnDollar: Number((compoundReturnPct * positionSize).toFixed(2)),
    bestTradePct: bestTradePct != null ? Number((bestTradePct * 100).toFixed(2)) : null,
    worstTradePct: worstTradePct != null ? Number((worstTradePct * 100).toFixed(2)) : null,
    avgHoldBars: avgHoldBars != null ? Number(avgHoldBars.toFixed(1)) : null,
    maxDrawdownPct: Number((maxDD * 100).toFixed(2)),
  };
}

async function evalTickerPnL(symbol: string, days: number, positionSize: number, amcGate: AMCGateMode): Promise<TickerPnL | null> {
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

  // AMC inputs match the live Trade Analysis configuration (routes.ts:3269–3282).
  let amcScore: number[] = new Array(bars.close.length).fill(0);
  let amcSignal: ("ENTER" | "HOLD" | "SELL")[] = new Array(bars.close.length).fill("HOLD");
  if (amcGate !== "off") {
    const histogram = computeMACDHistogram(bars.close);
    const vamiScaled = computeVAMIScaled(bars.close, bars.volume);
    const sma200 = computeSMA(bars.close, 200);
    const sma200Scaled = sma200.map(v => isNaN(v) ? NaN : v * 0.95);
    const amc = computeAMCSeries({
      closes: bars.close,
      histogram,
      rsi14,
      trendShortEma: ema9,
      trendLongEma: ema50,
      trendStrengthRefEma: ema21,
      vamiScaled,
      reversionRefLevel: sma200Scaled,
      reversionDirection: "above",
    });
    amcScore = amc.score;
    amcSignal = amc.signal;
  }

  // Restrict eval window to the requested days (with warmup margin).
  const startIdx = Math.max(0, bars.close.length - days - 25);
  const slicedBars: Bars = {
    date: bars.date.slice(startIdx),
    open: bars.open.slice(startIdx),
    high: bars.high.slice(startIdx),
    low: bars.low.slice(startIdx),
    close: bars.close.slice(startIdx),
    volume: bars.volume.slice(startIdx),
  };

  const trades = pairTrades(
    bbtc.signals.slice(startIdx),
    bbtc.signalSides.slice(startIdx),
    ver.signals.slice(startIdx),
    ver.signalSides.slice(startIdx),
    slicedBars.close,
    slicedBars.date,
    rsi14.slice(startIdx),
    positionSize,
    amcGate,
    amcScore.slice(startIdx),
    amcSignal.slice(startIdx),
  );

  return summarizeTicker(symbol, slicedBars, trades, positionSize);
}

// ─── Basket aggregation ─────────────────────────────────────────────────────

export interface BasketAgg {
  totalSymbols: number;
  symbolsWithData: number;
  totalClosedTrades: number;
  totalOpenTrades: number;
  totalWins: number;
  totalLosses: number;
  basketWinRate: number | null;
  totalPnLDollar: number;        // sum across all tickers, all closed trades
  avgPnLPerTrade: number | null; // totalPnL / totalClosedTrades
  avgPnLPerTicker: number;       // totalPnL / symbolsWithData
  basketCompoundReturnPct: number; // average compound return across tickers
  profitableTickers: number;
  unprofitableTickers: number;
  flatTickers: number;
  topPerformers: Array<{ symbol: string; pnlDollar: number; trades: number; winRate: number | null; rMultiple: number | null }>;
  bottomPerformers: Array<{ symbol: string; pnlDollar: number; trades: number; winRate: number | null; rMultiple: number | null }>;
  spyBuyAndHoldReturnPct: number | null;
  spyBuyAndHoldDollar: number | null;
}

function aggregateBasket(perTicker: TickerPnL[], spyTicker: TickerPnL | null, positionSize: number): BasketAgg {
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
  const bottom = sortedByPnL.slice(-10).reverse().map(t => ({
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
    basketWinRate: totalClosedTrades > 0 ? Number((totalWins / totalClosedTrades).toFixed(3)) : null,
    totalPnLDollar: Number(totalPnLDollar.toFixed(2)),
    avgPnLPerTrade: totalClosedTrades > 0 ? Number((totalPnLDollar / totalClosedTrades).toFixed(2)) : null,
    avgPnLPerTicker: perTicker.length > 0 ? Number((totalPnLDollar / perTicker.length).toFixed(2)) : 0,
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

// ─── Top-level ──────────────────────────────────────────────────────────────

export interface StrategyPnLResult {
  basket: { symbols: string[]; days: number; positionSize: number; amcGate: AMCGateMode };
  generatedAt: string;
  perTicker: TickerPnL[];
  aggregate: BasketAgg;
  notes: string[];
}

export async function runStrategyPnL(
  symbols: string[],
  days: number,
  positionSize: number,
  includeTradeDetail: boolean,
  amcGate: AMCGateMode = "off",
): Promise<StrategyPnLResult> {
  const BATCH = 12;
  const tickerResults: TickerPnL[] = [];
  for (let i = 0; i < symbols.length; i += BATCH) {
    const slice = symbols.slice(i, i + BATCH);
    const results = await Promise.allSettled(slice.map(s => evalTickerPnL(s, days, positionSize, amcGate)));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) tickerResults.push(r.value);
    }
    if (i + BATCH < symbols.length) await new Promise(r => setTimeout(r, 150));
  }

  // SPY benchmark uses the same AMC gate so the comparison is apples-to-apples.
  const spy = await evalTickerPnL("SPY", days, positionSize, amcGate).catch(() => null);

  // Optionally strip per-trade detail to keep payload small.
  const perTicker = includeTradeDetail
    ? tickerResults
    : tickerResults.map(t => ({ ...t, trades: [] }));

  const amcNote =
    amcGate === "off"
      ? "AMC confirmation gate is OFF — entries scored on BBTC + VER alone (does not match the website's 3-phase Ready/Set/Go chain)."
      : amcGate === "loose"
      ? "AMC LOOSE gate active — each BBTC/VER long entry only counts if AMC scored ≥3/5 (3+ of 5 momentum conditions met) at the entry bar."
      : "AMC STRICT gate active — each BBTC/VER long entry only counts if AMC signaled ENTER at the entry bar or within the prior 10 bars (matches the live website's 3-phase confirmation chain).";

  return {
    basket: { symbols, days, positionSize, amcGate },
    generatedAt: new Date().toISOString(),
    perTicker,
    aggregate: aggregateBasket(tickerResults, spy, positionSize),
    notes: [
      amcNote,
      "Long-only evaluator. Short signals are info-only since 2026-05-08 demote and never form pairable trades here.",
      "Each LONG entry is paired with its corresponding exit (STOP_HIT, REDUCE, or cross-down SELL). Open trades at end of window are excluded from $ P&L aggregates.",
      "positionSize is the assumed dollar amount per trade. totalPnLDollar = sum of (returnPct × positionSize) across closed trades.",
      "compoundReturnPct chains (1 + returnPct) across closed trades sequentially — equivalent to fully reinvesting gains/losses.",
      "rMultiple = |avgWinPct / avgLossPct|. Above 1.0 means winners are bigger than losers (the trend-follower target).",
      "maxDrawdownPct is the worst peak-to-trough drop on the per-trade equity curve.",
      "No commissions or slippage applied. Real-world P&L would be lower by ~$1-5 per round trip plus 0.05-0.1% slippage.",
      "Add ?detail=1 to include per-trade records (entryDate, entryPrice, exitDate, exitPrice, returnPct, etc.) for each ticker.",
      "Add ?amcGate=loose|strict|off to require AMC confirmation. Strict matches the live Ready/Set/Go chain; loose accepts 3+/5 AMC conditions met.",
    ],
  };
}
