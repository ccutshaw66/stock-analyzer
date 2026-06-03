/**
 * Unified chart-data endpoint backing the new /chart/:ticker comparison page.
 *
 * Returns: bars + signal dots + regime bands + paired trades + summary stats
 * for one strategy on one ticker. Designed so the frontend can switch
 * strategies via a dropdown without changing endpoint shape.
 *
 * Strategies supported (IDs match `STRATEGY_REGISTRY` in shared/strategies):
 *   - "bbtc-ver"  — current website strategy (BBTC + VER, paired per-strategy)
 *   - "amc"       — AMC-only entries (ENTER → SELL pairing)
 *   - "tft-40w"   — TFT with 40W core stop (default TFT)
 *   - "tft-60w"   — TFT with 60W core stop
 *   - "tft-cat"   — TFT with catastrophic-only core (the $5.28M winner)
 *                   Legacy aliases "tft-catastrophic" / "tft-catastrophic-only"
 *                   are normalized to "tft-cat" by the route handler.
 *
 * Used by `GET /api/chart/:ticker`.
 */

import { fmpGet } from "../data/providers/fmp.client";
import { computeBBTC, type BBTCSignal, type BBTCSignalSide } from "../signals/strategies/bbtc";
import { computeVER, type VERSignal, type VERSignalSide } from "../signals/strategies/ver";
import { scoreAMC, type AMCInput } from "../signals/strategies/amc";
import { simulateTFT, type TFTTrade, type TFTCoreStopMode, type TFTRegime } from "../signals/strategies/tft";
import {
  RSI_PERIOD,
  ATR_PERIOD,
  EMA_FAST,
  EMA_MID,
  EMA_SLOW,
  SMA_TREND_PERIOD,
} from "@shared/indicators/constants";

export type ChartStrategy = "bbtc-ver" | "amc" | "tft-40w" | "tft-60w" | "tft-cat";

// ─── Indicator helpers (duplicated from strategy-pnl/strategy-tft-pnl) ─────

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
/**
 * Full MACD(12,26,9) — returns the MACD line, signal line, and histogram
 * as three aligned series. One computation so the chart's MACD pane and any
 * histogram consumer read identical numbers (single source of truth).
 */
function computeMACDFull(closes: number[]): { macd: number[]; signal: number[]; hist: number[] } {
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);
  const macd = closes.map((_, i) =>
    !isNaN(ema12[i]) && !isNaN(ema26[i]) ? ema12[i] - ema26[i] : NaN,
  );
  const validMacd: number[] = [];
  const validIdx: number[] = [];
  macd.forEach((v, i) => { if (!isNaN(v)) { validMacd.push(v); validIdx.push(i); } });
  const sigEma = computeEMA(validMacd, 9);
  const signal = new Array(closes.length).fill(NaN);
  validIdx.forEach((idx, j) => { signal[idx] = sigEma[j]; });
  const hist = closes.map((_, i) =>
    !isNaN(macd[i]) && !isNaN(signal[i]) ? macd[i] - signal[i] : NaN,
  );
  return { macd, signal, hist };
}
function computeMACDHistogram(closes: number[]): number[] {
  return computeMACDFull(closes).hist;
}
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

// ─── Bar fetching ──────────────────────────────────────────────────────────

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
    // Generous warmup for SMA200/40W weekly etc.
    const from = new Date(Date.now() - (days + 350) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const data: any = await fmpGet("/historical-price-eod/full", { symbol, from, to });
    const arr: any[] = Array.isArray(data) ? data : (data?.historical || []);
    if (arr.length < 60) return null;
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

// ─── Response shape ────────────────────────────────────────────────────────

export interface ChartBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  // Indicator overlays — emitted so the TV-style CandlePane can render
  // EMA line overlays without recomputing on the client.
  ema9?: number | null;
  ema21?: number | null;
  ema50?: number | null;
  sma200?: number | null;
  // Momentum oscillators — emitted so the chart's MACD/RSI sub-panes render
  // from the SAME bars as the candle (no separate fetch, no drift). RSI(14),
  // MACD(12,26,9).
  rsi?: number | null;
  macd?: number | null;
  macdSignal?: number | null;
  macdHist?: number | null;
}

export interface ChartSignalDot {
  date: string;
  price: number;
  /** "ENTRY" | "EXIT" | "ADD" | "REDUCE" | "WATCH" | "INFO" */
  type: string;
  side: "LONG" | "SHORT";
  /** Only set on TFT. */
  layer?: "CORE" | "TACTICAL";
  /** Display label, e.g. "BBTC_BUY", "VER_STOP", "TFT CORE LONG", "AMC SELL". */
  label: string;
  /** Hex color hint for the dot — frontend can override. */
  color: string;
  /** false = info-only (e.g. demoted shorts, watch signals). */
  filled: boolean;
  /**
   * 1-indexed trade number this signal belongs to (entry order, stable
   * regardless of how the trade list is sorted in the UI). null for
   * info-only signals (WATCH, demoted shorts) that don't pair to a trade.
   */
  tradeNumber: number | null;
}

export interface RegimeBand {
  /** Inclusive start date of this regime block. */
  startDate: string;
  /** Inclusive end date. */
  endDate: string;
  regime: "BULLISH" | "BEARISH" | "NEUTRAL";
}

export interface ChartTrade {
  /** 1-indexed trade number, assigned by entry-date order. STABLE — does not change when the UI re-sorts the trade list. CORE trades on TFT always get the lowest numbers since they enter first. */
  tradeNumber: number;
  /** "CORE" / "TACTICAL" only on TFT; "PAIR" on bbtc-ver/amc. */
  layer: "CORE" | "TACTICAL" | "PAIR";
  side: "LONG" | "SHORT";
  entryDate: string;
  entryPrice: number;
  exitDate: string | null;
  exitPrice: number | null;
  exitReason: string | null;
  isOpen: boolean;
  holdBars: number;
  returnPct: number | null;
  pnlDollar: number | null;
  /** Sub-strategy / signal name that opened this trade ("BBTC", "VER", "AMC", "TFT"). */
  source: string;
}

export interface ChartSummary {
  tradeCount: number;
  closedTradeCount: number;
  openTradeCount: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnLDollar: number;          // realized only
  unrealizedPnLDollar: number;
  totalPnLIncludingUnrealized: number;
  rMultiple: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  avgWinDollar: number | null;
  avgLossDollar: number | null;
  bestTradePct: number | null;
  worstTradePct: number | null;
  avgHoldBars: number | null;
  maxDrawdownPct: number;
  buyAndHoldDollar: number;
  buyAndHoldReturnPct: number;
  capturedBnHPct: number | null;            // total/B&H × 100, when B&H > 0
  /** TFT only: bars with nonzero position / total bars × 100. */
  marketExposurePct: number | null;
}

export interface ChartDataResponse {
  ticker: string;
  strategy: ChartStrategy;
  rangeFrom: string;
  rangeTo: string;
  positionSize: number;
  bars: ChartBar[];
  signals: ChartSignalDot[];
  regimeBands: RegimeBand[];
  trades: ChartTrade[];
  summary: ChartSummary;
  notes: string[];
}

// ─── Strategy adapters ─────────────────────────────────────────────────────

interface Adapter {
  signals: ChartSignalDot[];
  regimeBands: RegimeBand[];
  trades: ChartTrade[];
}

function tftCoreStopFromStrategy(strategy: ChartStrategy): TFTCoreStopMode | null {
  if (strategy === "tft-40w") return "40w";
  if (strategy === "tft-60w") return "60w";
  if (strategy === "tft-cat") return "catastrophic-only";
  return null;
}

// ── BBTC + VER ────────────────────────────────────────────────────────────

function adaptBBTCVer(
  bars: Bars,
  startIdx: number,
  positionSize: number,
): Adapter {
  const closes = bars.close;
  const highs = bars.high;
  const lows = bars.low;
  const volumes = bars.volume;
  const dates = bars.date;

  const ema9 = computeEMA(closes, 9);
  const ema21 = computeEMA(closes, 21);
  const ema50 = computeEMA(closes, 50);
  const atr14 = computeATR(highs, lows, closes, ATR_PERIOD);
  const rsi14 = computeRSI(closes, RSI_PERIOD);
  const bb = computeBollinger(closes, 20, 2);
  const volAvg20 = computeVolAvg(volumes, 20);

  const bbtc = computeBBTC({
    closes, highs, lows, ema9, ema21, ema50, atr14, rsi14,
  });
  const ver = computeVER({
    closes, highs, lows, volumes, rsi14, bbUpper: bb.upper, bbLower: bb.lower, volAvg20, atr14,
  });

  // Signal dots — emit one dot per non-empty signal in the displayed window.
  const signals: ChartSignalDot[] = [];
  for (let i = startIdx; i < closes.length; i++) {
    const bs = bbtc.signals[i];
    const bSide = bbtc.signalSides[i];
    if (bs) {
      signals.push({
        date: dates[i],
        price: closes[i],
        type: bbtcDotType(bs),
        side: bSide as "LONG" | "SHORT",
        label: `BBTC_${bs}`,
        color: bbtcDotColor(bs, bSide),
        filled: bSide !== "SHORT", // shorts demoted to info-only
        tradeNumber: null,
      });
    }
    const vs = ver.signals[i];
    const vSide = ver.signalSides[i];
    if (vs) {
      signals.push({
        date: dates[i],
        price: closes[i],
        type: verDotType(vs),
        side: vSide as "LONG" | "SHORT",
        label: `VER_${vs}`,
        color: verDotColor(vs, vSide),
        filled: !(vs === "WATCH_BUY" || vs === "WATCH_SELL" || vSide === "SHORT"),
        tradeNumber: null,
      });
    }
  }

  // Trade pairing — same logic as strategy-pnl.ts (BBTC and VER tracked
  // independently then merged chronologically).
  const trades: ChartTrade[] = [];
  function pairOne(
    source: "BBTC" | "VER",
    sigs: (string | undefined)[],
    sides: (string | undefined)[],
    isEntry: (s: string, side: string | undefined) => boolean,
    isExit: (s: string, side: string | undefined) => boolean,
    reasonName: (s: string) => string,
  ): void {
    let openEntryIdx = -1;
    let openEntryPrice = 0;
    let openEntryDate = "";
    let openReason = "";
    for (let i = startIdx; i < closes.length; i++) {
      const sig = sigs[i];
      const side = sides[i];
      if (!sig) continue;
      if (openEntryIdx >= 0 && isExit(sig, side)) {
        const exitPrice = closes[i];
        const ret = (exitPrice - openEntryPrice) / openEntryPrice;
        trades.push({
          tradeNumber: 0,
          layer: "PAIR",
          side: "LONG",
          entryDate: openEntryDate,
          entryPrice: Number(openEntryPrice.toFixed(2)),
          exitDate: dates[i],
          exitPrice: Number(exitPrice.toFixed(2)),
          exitReason: reasonName(sig),
          isOpen: false,
          holdBars: i - openEntryIdx,
          returnPct: Number(ret.toFixed(4)),
          pnlDollar: Number((ret * positionSize).toFixed(2)),
          source,
        });
        openEntryIdx = -1;
      } else if (openEntryIdx < 0 && isEntry(sig, side)) {
        openEntryIdx = i;
        openEntryPrice = closes[i];
        openEntryDate = dates[i];
        openReason = reasonName(sig);
      }
    }
    if (openEntryIdx >= 0) {
      // Mark-to-last-close as open trade
      const lastIdx = closes.length - 1;
      const lastClose = closes[lastIdx];
      const ret = (lastClose - openEntryPrice) / openEntryPrice;
      trades.push({
        tradeNumber: 0,
        layer: "PAIR",
        side: "LONG",
        entryDate: openEntryDate,
        entryPrice: Number(openEntryPrice.toFixed(2)),
        exitDate: dates[lastIdx],
        exitPrice: Number(lastClose.toFixed(2)),
        exitReason: "END_OF_WINDOW",
        isOpen: true,
        holdBars: lastIdx - openEntryIdx,
        returnPct: Number(ret.toFixed(4)),
        pnlDollar: Number((ret * positionSize).toFixed(2)),
        source,
      });
    }
  }

  pairOne(
    "BBTC",
    bbtc.signals as Array<string | undefined>,
    bbtc.signalSides as Array<string | undefined>,
    (s, side) => (s === "BUY" && side === "LONG") || (s === "ADD_LONG" && side === "LONG"),
    (s, side) =>
      (s === "STOP_HIT" && side === "LONG") ||
      (s === "SELL" && side === "LONG") ||
      (s === "REDUCE" && side === "LONG"),
    s => `BBTC_${s}`,
  );
  pairOne(
    "VER",
    ver.signals as Array<string | undefined>,
    ver.signalSides as Array<string | undefined>,
    (s, side) => s === "BUY" && side === "LONG",
    (s, side) => s === "STOP_HIT" && side === "LONG",
    s => `VER_${s}`,
  );

  trades.sort((a, b) => a.entryDate.localeCompare(b.entryDate));

  return { signals, regimeBands: [], trades };
}

function bbtcDotType(s: BBTCSignal): string {
  if (s === "BUY" || s === "ADD_LONG") return "ENTRY";
  if (s === "REDUCE") return "REDUCE";
  if (s === "STOP_HIT" || s === "SELL") return "EXIT";
  return "INFO";
}
function bbtcDotColor(s: BBTCSignal, side?: BBTCSignalSide): string {
  if (side === "SHORT") return "#d946ef"; // magenta info-only
  if (s === "BUY" || s === "ADD_LONG") return "#10b981"; // green
  if (s === "REDUCE") return "#14b8a6";  // teal — profit-take win
  if (s === "STOP_HIT") return "#ef4444"; // red — loss
  if (s === "SELL") return "#64748b";    // slate — clean trend exit
  return "#94a3b8";
}
function verDotType(s: VERSignal): string {
  if (s === "BUY") return "ENTRY";
  if (s === "WATCH_BUY") return "WATCH";
  if (s === "WATCH_SELL") return "WATCH";
  if (s === "STOP_HIT") return "EXIT";
  if (s === "SELL") return "INFO"; // demoted
  return "INFO";
}
function verDotColor(s: VERSignal, side?: VERSignalSide): string {
  if (side === "SHORT") return "#d946ef";
  if (s === "BUY") return "#10b981";
  if (s === "WATCH_BUY") return "#eab308"; // yellow
  if (s === "WATCH_SELL") return "#f97316"; // hollow orange
  if (s === "STOP_HIT") return "#ef4444";
  if (s === "SELL") return "#d946ef"; // info-only short
  return "#94a3b8";
}

// ── AMC ────────────────────────────────────────────────────────────────────

function adaptAMC(
  bars: Bars,
  startIdx: number,
  positionSize: number,
): Adapter {
  const closes = bars.close;
  const highs = bars.high;
  const lows = bars.low;
  const volumes = bars.volume;
  const dates = bars.date;

  const ema9 = computeEMA(closes, 9);
  const ema21 = computeEMA(closes, 21);
  const ema50 = computeEMA(closes, 50);
  const atr14 = computeATR(highs, lows, closes, ATR_PERIOD);
  const rsi14 = computeRSI(closes, RSI_PERIOD);
  const histogram = computeMACDHistogram(closes);
  const vamiScaled = computeVAMIScaled(closes, volumes);
  const sma200 = computeSMA(closes, 200);
  const sma200Scaled = sma200.map(v => isNaN(v) ? NaN : v * 0.95);

  const amcInput: AMCInput = {
    closes,
    histogram,
    rsi14,
    trendShortEma: ema9,
    trendLongEma: ema50,
    trendStrengthRefEma: ema21,
    vamiScaled,
    reversionRefLevel: sma200Scaled,
    reversionDirection: "above",
  };

  const signals: ChartSignalDot[] = [];
  const trades: ChartTrade[] = [];
  let openEntryIdx = -1;
  let openEntryPrice = 0;
  let openEntryDate = "";

  for (let i = Math.max(1, startIdx); i < closes.length; i++) {
    const sc = scoreAMC(i, amcInput);
    const greenClose = closes[i] > closes[i - 1];
    const momentumEntry = sc >= 4 && greenClose;
    const reversionEntry =
      !isNaN(rsi14[i]) && rsi14[i] < 30 && closes[i] > sma200Scaled[i] && greenClose &&
      vamiScaled[i] > vamiScaled[i - 1];
    const isEnter = momentumEntry || reversionEntry;
    const isSell =
      (!isNaN(rsi14[i]) && rsi14[i] > 75) ||
      (!isNaN(histogram[i]) && histogram[i] < 0 && !isNaN(histogram[i - 1]) && histogram[i - 1] >= 0);

    if (openEntryIdx < 0 && isEnter) {
      openEntryIdx = i;
      openEntryPrice = closes[i];
      openEntryDate = dates[i];
      signals.push({
        date: dates[i], price: closes[i], type: "ENTRY", side: "LONG",
        label: `AMC ${momentumEntry ? "ENTER (M)" : "ENTER (R)"}`,
        color: "#10b981", filled: true, tradeNumber: null,
      });
    } else if (openEntryIdx >= 0 && isSell) {
      const exitPrice = closes[i];
      const ret = (exitPrice - openEntryPrice) / openEntryPrice;
      trades.push({
        tradeNumber: 0,
        layer: "PAIR", side: "LONG",
        entryDate: openEntryDate, entryPrice: Number(openEntryPrice.toFixed(2)),
        exitDate: dates[i], exitPrice: Number(exitPrice.toFixed(2)),
        exitReason: "AMC_SELL", isOpen: false,
        holdBars: i - openEntryIdx, returnPct: Number(ret.toFixed(4)),
        pnlDollar: Number((ret * positionSize).toFixed(2)),
        source: "AMC",
      });
      signals.push({
        date: dates[i], price: closes[i], type: "EXIT", side: "LONG",
        label: "AMC SELL", color: "#ef4444", filled: true, tradeNumber: null,
      });
      openEntryIdx = -1;
    }
  }

  if (openEntryIdx >= 0) {
    const lastIdx = closes.length - 1;
    const lastClose = closes[lastIdx];
    const ret = (lastClose - openEntryPrice) / openEntryPrice;
    trades.push({
      tradeNumber: 0,
      layer: "PAIR", side: "LONG",
      entryDate: openEntryDate, entryPrice: Number(openEntryPrice.toFixed(2)),
      exitDate: dates[lastIdx], exitPrice: Number(lastClose.toFixed(2)),
      exitReason: "END_OF_WINDOW", isOpen: true,
      holdBars: lastIdx - openEntryIdx, returnPct: Number(ret.toFixed(4)),
      pnlDollar: Number((ret * positionSize).toFixed(2)),
      source: "AMC",
    });
  }

  return { signals, regimeBands: [], trades };
}

// ── TFT ────────────────────────────────────────────────────────────────────

function adaptTFT(
  bars: Bars,
  startIdx: number,
  positionSize: number,
  coreStopMode: TFTCoreStopMode,
): Adapter {
  const closes = bars.close;
  const highs = bars.high;
  const lows = bars.low;
  const volumes = bars.volume;
  const dates = bars.date;

  const ema9 = computeEMA(closes, 9);
  const ema21 = computeEMA(closes, 21);
  const ema50 = computeEMA(closes, 50);
  const atr14 = computeATR(highs, lows, closes, ATR_PERIOD);
  const rsi14 = computeRSI(closes, RSI_PERIOD);
  const bb = computeBollinger(closes, 20, 2);
  const volAvg20 = computeVolAvg(volumes, 20);

  const bbtc = computeBBTC({ closes, highs, lows, ema9, ema21, ema50, atr14, rsi14 });
  const ver = computeVER({
    closes, highs, lows, volumes, rsi14, bbUpper: bb.upper, bbLower: bb.lower, volAvg20, atr14,
  });

  const slicedDates = dates.slice(startIdx);
  const slicedCloses = closes.slice(startIdx);
  const slicedHighs = highs.slice(startIdx);
  const slicedLows = lows.slice(startIdx);
  const slicedAtr = atr14.slice(startIdx);

  const sim = simulateTFT({
    dates: slicedDates,
    closes: slicedCloses,
    highs: slicedHighs,
    lows: slicedLows,
    atr14: slicedAtr,
    bbtcSignals: bbtc.signals.slice(startIdx) as Array<string | undefined>,
    bbtcSides: bbtc.signalSides.slice(startIdx) as Array<string | undefined>,
    verSignals: ver.signals.slice(startIdx) as Array<string | undefined>,
    verSides: ver.signalSides.slice(startIdx) as Array<string | undefined>,
    positionSize,
    enableShorts: false, // shorts demoted to info-only; chart page ignores them
    atrFloorPct: 0,
    coreStopMode,
  });

  // Convert TFT trades to chart trades (already nicely structured).
  const trades: ChartTrade[] = sim.trades.map((t: TFTTrade) => ({
    tradeNumber: 0, // assigned in normalize step
    layer: t.layerType,
    side: t.side,
    entryDate: t.entryDate,
    entryPrice: t.entryPrice,
    exitDate: t.exitDate,
    exitPrice: t.exitPrice,
    exitReason: t.exitReason,
    isOpen: t.isOpen,
    holdBars: t.holdBars,
    returnPct: t.returnPct,
    pnlDollar: t.pnlDollar,
    source: "TFT",
  }));

  // Signal dots — one per layer entry and per layer exit (where exit dates exist).
  const signals: ChartSignalDot[] = [];
  for (const t of sim.trades) {
    // Entry dot
    signals.push({
      date: t.entryDate,
      price: t.entryPrice,
      type: "ENTRY",
      side: t.side,
      layer: t.layerType,
      label: `TFT ${t.layerType} ${t.side}`,
      color: t.layerType === "CORE" ? "#0ea5e9" : "#10b981", // sky for CORE, green for TACTICAL
      filled: true,
      tradeNumber: null, // assigned in normalize step
    });
    // Exit dot if closed
    if (!t.isOpen && t.exitDate && t.exitPrice != null) {
      const won = (t.returnPct ?? 0) > 0;
      signals.push({
        date: t.exitDate,
        price: t.exitPrice,
        type: "EXIT",
        side: t.side,
        layer: t.layerType,
        label: `TFT EXIT (${t.exitReason})`,
        color: won ? "#14b8a6" : "#ef4444", // teal win, red loss
        filled: true,
        tradeNumber: null, // assigned in normalize step
      });
    }
  }

  // Regime bands — collapse the per-bar regime[] series into contiguous blocks.
  const regimeBands: RegimeBand[] = [];
  let curRegime: TFTRegime = sim.regime[0];
  let blockStart = 0;
  for (let i = 1; i < sim.regime.length; i++) {
    if (sim.regime[i] !== curRegime) {
      regimeBands.push({
        startDate: slicedDates[blockStart],
        endDate: slicedDates[i - 1],
        regime: curRegime,
      });
      curRegime = sim.regime[i];
      blockStart = i;
    }
  }
  if (blockStart < sim.regime.length) {
    regimeBands.push({
      startDate: slicedDates[blockStart],
      endDate: slicedDates[sim.regime.length - 1],
      regime: curRegime,
    });
  }

  return { signals, regimeBands, trades };
}

// ─── Summary aggregation ───────────────────────────────────────────────────

function summarize(
  trades: ChartTrade[],
  bars: Bars,
  startIdx: number,
  positionSize: number,
  marketExposurePct: number | null,
): ChartSummary {
  const closed = trades.filter(t => !t.isOpen);
  const open = trades.filter(t => t.isOpen);
  const wins = closed.filter(t => (t.returnPct ?? 0) > 0);
  const losses = closed.filter(t => (t.returnPct ?? 0) <= 0);

  const avgWinPct = wins.length ? wins.reduce((a, t) => a + (t.returnPct || 0), 0) / wins.length : null;
  const avgLossPct = losses.length ? losses.reduce((a, t) => a + (t.returnPct || 0), 0) / losses.length : null;
  const totalPnLDollar = closed.reduce((a, t) => a + (t.pnlDollar || 0), 0);
  const unrealizedPnLDollar = open.reduce((a, t) => a + (t.pnlDollar || 0), 0);
  const totalPnLIncludingUnrealized = totalPnLDollar + unrealizedPnLDollar;

  // Drawdown on per-trade equity curve (sequential, realized only).
  let cum = 0;
  let peak = 0;
  let maxDDPct = 0;
  for (const t of closed) {
    cum += t.pnlDollar || 0;
    if (cum > peak) peak = cum;
    const dd = peak > 0 ? (peak - cum) / Math.max(peak, positionSize) : 0;
    if (dd > maxDDPct) maxDDPct = dd;
  }

  const returns = closed.map(t => t.returnPct || 0);
  const bestTradePct = returns.length ? Math.max(...returns) : null;
  const worstTradePct = returns.length ? Math.min(...returns) : null;
  const avgHoldBars = closed.length ? closed.reduce((a, t) => a + t.holdBars, 0) / closed.length : null;

  const firstClose = bars.close[startIdx];
  const lastClose = bars.close[bars.close.length - 1];
  const buyAndHoldReturnPct = firstClose > 0 ? (lastClose - firstClose) / firstClose : 0;
  const buyAndHoldDollar = buyAndHoldReturnPct * positionSize;
  const captured = buyAndHoldDollar > 0
    ? Number((totalPnLIncludingUnrealized / buyAndHoldDollar * 100).toFixed(1))
    : null;

  return {
    tradeCount: trades.length,
    closedTradeCount: closed.length,
    openTradeCount: open.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? Number((wins.length / closed.length).toFixed(3)) : null,
    totalPnLDollar: Number(totalPnLDollar.toFixed(2)),
    unrealizedPnLDollar: Number(unrealizedPnLDollar.toFixed(2)),
    totalPnLIncludingUnrealized: Number(totalPnLIncludingUnrealized.toFixed(2)),
    rMultiple: (avgWinPct != null && avgLossPct != null && avgLossPct < 0)
      ? Number((avgWinPct / Math.abs(avgLossPct)).toFixed(2))
      : null,
    avgWinPct: avgWinPct != null ? Number((avgWinPct * 100).toFixed(2)) : null,
    avgLossPct: avgLossPct != null ? Number((avgLossPct * 100).toFixed(2)) : null,
    avgWinDollar: avgWinPct != null ? Number((avgWinPct * positionSize).toFixed(2)) : null,
    avgLossDollar: avgLossPct != null ? Number((avgLossPct * positionSize).toFixed(2)) : null,
    bestTradePct: bestTradePct != null ? Number((bestTradePct * 100).toFixed(2)) : null,
    worstTradePct: worstTradePct != null ? Number((worstTradePct * 100).toFixed(2)) : null,
    avgHoldBars: avgHoldBars != null ? Number(avgHoldBars.toFixed(1)) : null,
    maxDrawdownPct: Number((maxDDPct * 100).toFixed(2)),
    buyAndHoldDollar: Number(buyAndHoldDollar.toFixed(2)),
    buyAndHoldReturnPct: Number((buyAndHoldReturnPct * 100).toFixed(2)),
    capturedBnHPct: captured,
    marketExposurePct,
  };
}

// ─── Top-level ─────────────────────────────────────────────────────────────

export async function getChartData(
  ticker: string,
  strategy: ChartStrategy,
  days: number,
  positionSize: number,
): Promise<ChartDataResponse | null> {
  const bars = await fetchBars(ticker, days);
  if (!bars) return null;

  // Slice display window — keep warmup for indicator validity, but signals
  // and trades only fire from startIdx forward. For TFT the simulator handles
  // its own slicing internally, so use a smaller buffer there.
  const tftMode = tftCoreStopFromStrategy(strategy);
  const startIdx = tftMode != null
    ? Math.max(0, bars.close.length - days - 50)
    : Math.max(0, bars.close.length - days - 25);

  let adapter: Adapter;
  let exposurePct: number | null = null;

  if (strategy === "bbtc-ver") {
    adapter = adaptBBTCVer(bars, startIdx, positionSize);
  } else if (strategy === "amc") {
    adapter = adaptAMC(bars, startIdx, positionSize);
  } else if (tftMode != null) {
    adapter = adaptTFT(bars, startIdx, positionSize, tftMode);
    // Compute market exposure from TFT trades (days held / days in window).
    // Approximation: sum holdBars across all trades, divided by total bars.
    const totalBars = bars.close.length - startIdx;
    const heldBars = adapter.trades.reduce((a, t) => a + t.holdBars, 0);
    exposurePct = totalBars > 0 ? Number((Math.min(heldBars, totalBars) / totalBars * 100).toFixed(1)) : 0;
  } else {
    return null;
  }

  // Normalize trade numbers — sort by entry date, assign 1..N. CORE trades
  // on TFT enter early so they always get the lowest numbers (CORE = #1).
  // Stable across UI re-sorting; pure metadata field on the trade record.
  const sortedForNumbering = [...adapter.trades].sort((a, b) =>
    a.entryDate.localeCompare(b.entryDate),
  );
  const tradeNumberByKey = new Map<string, number>();
  sortedForNumbering.forEach((t, i) => {
    t.tradeNumber = i + 1;
    // Tag every trade-related ENTRY signal by entry date+layer+side, and
    // every EXIT signal by exit date+layer+side. Keys collide-resistant
    // because TFT puts at most one CORE plus 1-2 tactical adds per bar.
    tradeNumberByKey.set(`${t.entryDate}|ENTRY|${t.layer}|${t.side}`, i + 1);
    if (t.exitDate) {
      tradeNumberByKey.set(`${t.exitDate}|EXIT|${t.layer}|${t.side}`, i + 1);
    }
  });

  // Now tag signals. ENTRY/EXIT type signals get matched against the trade
  // map. Other signal types (WATCH, INFO from demoted shorts) stay null.
  for (const sig of adapter.signals) {
    if (sig.tradeNumber != null) continue;
    if (sig.type === "ENTRY" || sig.type === "EXIT") {
      const layerKey = sig.layer ?? "PAIR";
      const key = `${sig.date}|${sig.type}|${layerKey}|${sig.side}`;
      const num = tradeNumberByKey.get(key);
      if (num != null) sig.tradeNumber = num;
    }
  }

  // Indicator series for the displayed bars — emitted so the TV-style
  // CandlePane can render EMA overlays. Computed off the full closes
  // array so the warmup window is real.
  const ema9Series = computeEMA(bars.close, EMA_FAST);
  const ema21Series = computeEMA(bars.close, EMA_MID);
  const ema50Series = computeEMA(bars.close, EMA_SLOW);
  const sma200Series = computeSMA(bars.close, SMA_TREND_PERIOD);
  // Oscillators off the SAME closes — emitted per bar so the chart's MACD/RSI
  // sub-panes render from this one series (not a separate 60-bar fetch).
  const rsiSeries = computeRSI(bars.close, RSI_PERIOD);
  const macdFull = computeMACDFull(bars.close);

  // Bars for display (sliced).
  const displayBars: ChartBar[] = [];
  const finite = (v: number) => (isNaN(v) ? null : Number(v.toFixed(2)));
  const finite4 = (v: number) => (isNaN(v) ? null : Number(v.toFixed(4)));
  for (let i = startIdx; i < bars.close.length; i++) {
    displayBars.push({
      date: bars.date[i],
      open: Number(bars.open[i].toFixed(2)),
      high: Number(bars.high[i].toFixed(2)),
      low: Number(bars.low[i].toFixed(2)),
      close: Number(bars.close[i].toFixed(2)),
      volume: bars.volume[i],
      ema9: finite(ema9Series[i]),
      ema21: finite(ema21Series[i]),
      ema50: finite(ema50Series[i]),
      sma200: finite(sma200Series[i]),
      rsi: finite(rsiSeries[i]),
      macd: finite4(macdFull.macd[i]),
      macdSignal: finite4(macdFull.signal[i]),
      macdHist: finite4(macdFull.hist[i]),
    });
  }

  const summary = summarize(adapter.trades, bars, startIdx, positionSize, exposurePct);

  const notes: string[] = [];
  if (strategy === "bbtc-ver") {
    notes.push("BBTC + VER paired per sub-strategy (BBTC and VER positions tracked independently then merged chronologically).");
    notes.push("Long-only: shorts are info-only since 2026-05-08 demote.");
  } else if (strategy === "amc") {
    notes.push("AMC ENTER → SELL pairing. ENTER fires when AMC score ≥4 with green close, OR RSI<30 reversion. SELL fires on RSI>75 or MACD histogram flip.");
  } else if (tftMode === "40w") {
    notes.push("TFT default: CORE exits on weekly close < 40W SMA, regime flip, regime neutral, or -15% catastrophic. TACTICAL adds on BBTC/VER buys, trail on 5×ATR.");
  } else if (tftMode === "60w") {
    notes.push("TFT 60W: same exits as 40W mode but uses 60-week SMA. Slower trigger; designed to capture longer secular runs.");
  } else if (tftMode === "catastrophic-only") {
    notes.push("TFT catastrophic-only: CORE exits ONLY on -15% catastrophic from entry. SMA/regime exits SKIPPED for the core. Maximum moonshot capture; the $5.28M basket result on the 80-ticker eval.");
  }
  notes.push(`Position size: $${positionSize.toLocaleString()} per unit. ${tftMode ? "TFT can deploy up to 2.0 units total = 2× notional." : "Strategy deploys 1× notional per trade."}`);
  notes.push("totalPnLIncludingUnrealized adds open positions marked-to-last-close. Compare across strategies for honest moonshot capture.");

  return {
    ticker,
    strategy,
    rangeFrom: displayBars[0]?.date ?? "",
    rangeTo: displayBars[displayBars.length - 1]?.date ?? "",
    positionSize,
    bars: displayBars,
    signals: adapter.signals,
    regimeBands: adapter.regimeBands,
    trades: adapter.trades,
    summary,
    notes,
  };
}
