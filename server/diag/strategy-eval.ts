/**
 * Strategy evaluator — fact-driven snapshot of how BBTC + VER signals have
 * fired across a basket of tickers, with forward returns at 1 / 5 / 20
 * trading days.
 *
 * Used by `/api/diag/strategy-eval`. Read-only: pulls bars from FMP, runs
 * the same `computeBBTC` / `computeVER` the live system uses, then walks
 * forward N bars from each fire to record the actual forward return and
 * whether the position would have been stopped.
 *
 * No production logic — purely for analyzing whether the strategies are
 * working. Output is meant to be aggregated client-side / by an analyst.
 */

import { fmpGet } from "../data/providers/fmp.client";
import { computeBBTC } from "../signals/strategies/bbtc";
import { computeVER, type VERSignal } from "../signals/strategies/ver";
import type { BBTCSignal } from "../signals/strategies/bbtc";
import {
  RSI_PERIOD, ATR_PERIOD, EMA_FAST, EMA_MID, EMA_SLOW,
  BB_PERIOD, BB_STDDEV, VOLUME_MA_PERIOD,
} from "@shared/indicators/constants";

// ─── Indicator helpers (self-contained — same math as routes.ts) ────────────

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

// ─── FMP fetcher ────────────────────────────────────────────────────────────

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

// ─── Per-fire record + per-ticker eval ──────────────────────────────────────

interface FireRecord {
  date: string;
  type: string;            // "BBTC_BUY" / "VER_WATCH_BUY" / etc.
  price: number;
  rsi: number | null;
  volRatio: number | null; // volume / 20-bar avg
  fwd1: number | null;     // forward 1d % return
  fwd5: number | null;     // forward 5d %
  fwd20: number | null;    // forward 20d %
  stopped5: boolean;       // was a 7% stop hit by bar+5?
  stopped20: boolean;      // was a 7% stop hit by bar+20?
}

const STOP_PCT = 0.07;

function makeForward(closes: number[], i: number, dir: 1 | -1, n: number): number | null {
  const j = i + n;
  if (j >= closes.length) return null;
  return ((closes[j] - closes[i]) / closes[i]) * dir;
}

function checkStop(highs: number[], lows: number[], closes: number[], entry: number, i: number, n: number, side: "LONG" | "SHORT"): boolean {
  const last = Math.min(i + n, closes.length - 1);
  for (let k = i + 1; k <= last; k++) {
    if (side === "LONG" && lows[k] <= entry * (1 - STOP_PCT)) return true;
    if (side === "SHORT" && highs[k] >= entry * (1 + STOP_PCT)) return true;
  }
  return false;
}

function isLongSide(t: string): boolean {
  return t === "BBTC_BUY" || t === "BBTC_ADD_LONG" || t === "VER_BUY" || t === "VER_WATCH_BUY";
}
function isShortSide(t: string): boolean {
  return t === "BBTC_SELL" || t === "VER_SELL" || t === "VER_WATCH_SELL";
}
function isStopOrExit(t: string): boolean {
  return t === "BBTC_STOP_HIT" || t === "BBTC_REDUCE" || t === "VER_STOP_HIT";
}

export type SideFilter = "long" | "short" | "both";

function directionOf(t: string): "long" | "short" | "exit" {
  if (isLongSide(t)) return "long";
  if (isShortSide(t)) return "short";
  return "exit";
}

interface TickerEval {
  symbol: string;
  bars: number;
  rangeFrom: string;
  rangeTo: string;
  totalReturnPct: number; // raw close-to-close return over the eval window
  fires: FireRecord[];
}

async function evalTicker(symbol: string, days: number): Promise<TickerEval | null> {
  const b = await fetchBars(symbol, days);
  if (!b) return null;

  const rsi14 = computeRSI(b.close, RSI_PERIOD);
  const ema9 = computeEMA(b.close, EMA_FAST);
  const ema21 = computeEMA(b.close, EMA_MID);
  const ema50 = computeEMA(b.close, EMA_SLOW);
  const atr14 = computeATR(b.high, b.low, b.close, ATR_PERIOD);
  const bb = computeBollinger(b.close, BB_PERIOD, BB_STDDEV);
  const volAvg20 = computeVolAvg(b.volume, VOLUME_MA_PERIOD);

  const bbtc = computeBBTC({ closes: b.close, highs: b.high, lows: b.low, ema9, ema21, ema50, atr14, rsi14 });
  const ver = computeVER({
    closes: b.close, highs: b.high, lows: b.low, volumes: b.volume,
    rsi14, bbUpper: bb.upper, bbLower: bb.lower, volAvg20, atr14,
  });

  // Restrict the eval window to the most recent `days` bars (with a margin
  // so warmup indicators are valid at i=0 of the window).
  const startIdx = Math.max(0, b.close.length - days - 25);
  const fires: FireRecord[] = [];

  for (let i = startIdx; i < b.close.length; i++) {
    const bSig: BBTCSignal = bbtc.signals[i];
    const vSig: VERSignal = ver.signals[i];
    if (!bSig && !vSig) continue;

    const tag =
      bSig === "BUY"        ? "BBTC_BUY" :
      bSig === "ADD_LONG"   ? "BBTC_ADD_LONG" :
      bSig === "SELL"       ? "BBTC_SELL" :
      bSig === "STOP_HIT"   ? "BBTC_STOP_HIT" :
      bSig === "REDUCE"     ? "BBTC_REDUCE" :
      vSig === "BUY"        ? "VER_BUY" :
      vSig === "WATCH_BUY"  ? "VER_WATCH_BUY" :
      vSig === "SELL"       ? "VER_SELL" :
      vSig === "WATCH_SELL" ? "VER_WATCH_SELL" :
      vSig === "STOP_HIT"   ? "VER_STOP_HIT" :
      "UNKNOWN";

    const dir: 1 | -1 = isShortSide(tag) ? -1 : 1;
    const r = Number.isFinite(rsi14[i]) ? Number(rsi14[i].toFixed(1)) : null;
    const va = Number.isFinite(volAvg20[i]) && volAvg20[i] > 0 ? Number((b.volume[i] / volAvg20[i]).toFixed(2)) : null;

    fires.push({
      date: b.date[i],
      type: tag,
      price: Number(b.close[i].toFixed(2)),
      rsi: r,
      volRatio: va,
      fwd1: makeForward(b.close, i, dir, 1),
      fwd5: makeForward(b.close, i, dir, 5),
      fwd20: makeForward(b.close, i, dir, 20),
      stopped5: isLongSide(tag) || isShortSide(tag)
        ? checkStop(b.high, b.low, b.close, b.close[i], i, 5, isLongSide(tag) ? "LONG" : "SHORT")
        : false,
      stopped20: isLongSide(tag) || isShortSide(tag)
        ? checkStop(b.high, b.low, b.close, b.close[i], i, 20, isLongSide(tag) ? "LONG" : "SHORT")
        : false,
    });
  }

  // round forwards to 4 decimals for readability
  for (const f of fires) {
    if (f.fwd1 != null)  f.fwd1  = Number(f.fwd1.toFixed(4));
    if (f.fwd5 != null)  f.fwd5  = Number(f.fwd5.toFixed(4));
    if (f.fwd20 != null) f.fwd20 = Number(f.fwd20.toFixed(4));
  }

  const first = b.close[startIdx];
  const last = b.close[b.close.length - 1];
  const totalReturnPct = first > 0 ? Number((((last - first) / first) * 100).toFixed(2)) : 0;

  return {
    symbol,
    bars: b.close.length - startIdx,
    rangeFrom: b.date[startIdx],
    rangeTo: b.date[b.date.length - 1],
    totalReturnPct,
    fires,
  };
}

// ─── Aggregation ────────────────────────────────────────────────────────────

interface PerTypeAgg {
  count: number;
  winRate1d: number | null;
  winRate5d: number | null;
  winRate20d: number | null;
  medianReturn1d: number | null;
  medianReturn5d: number | null;
  medianReturn20d: number | null;
  meanReturn5d: number | null;
  meanReturn20d: number | null;
  stoppedRate5d: number | null;
  stoppedRate20d: number | null;
  rsiBuckets: { "<30": number; "30-40": number; "40-50": number; "50-60": number; "60-70": number; ">70": number };
  medianRSI: number | null;
}

function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function winRate(arr: number[]): number | null {
  if (!arr.length) return null;
  const wins = arr.filter(v => v > 0).length;
  return Number((wins / arr.length).toFixed(3));
}

function bucketRsi(rsi: number): keyof PerTypeAgg["rsiBuckets"] {
  if (rsi < 30) return "<30";
  if (rsi < 40) return "30-40";
  if (rsi < 50) return "40-50";
  if (rsi < 60) return "50-60";
  if (rsi < 70) return "60-70";
  return ">70";
}

function aggregate(allFires: FireRecord[]): Record<string, PerTypeAgg> {
  const out: Record<string, PerTypeAgg> = {};
  const types = Array.from(new Set(allFires.map(f => f.type)));
  for (const t of types) {
    const subset = allFires.filter(f => f.type === t);
    const r1 = subset.map(f => f.fwd1).filter((v): v is number => v != null);
    const r5 = subset.map(f => f.fwd5).filter((v): v is number => v != null);
    const r20 = subset.map(f => f.fwd20).filter((v): v is number => v != null);
    const rsis = subset.map(f => f.rsi).filter((v): v is number => v != null);
    const buckets: PerTypeAgg["rsiBuckets"] = { "<30": 0, "30-40": 0, "40-50": 0, "50-60": 0, "60-70": 0, ">70": 0 };
    for (const r of rsis) buckets[bucketRsi(r)]++;
    const stopped5 = subset.filter(f => f.stopped5).length;
    const stopped20 = subset.filter(f => f.stopped20).length;
    out[t] = {
      count: subset.length,
      winRate1d: winRate(r1),
      winRate5d: winRate(r5),
      winRate20d: winRate(r20),
      medianReturn1d: r1.length ? Number((median(r1)!).toFixed(4)) : null,
      medianReturn5d: r5.length ? Number((median(r5)!).toFixed(4)) : null,
      medianReturn20d: r20.length ? Number((median(r20)!).toFixed(4)) : null,
      meanReturn5d: r5.length ? Number((r5.reduce((a, b) => a + b, 0) / r5.length).toFixed(4)) : null,
      meanReturn20d: r20.length ? Number((r20.reduce((a, b) => a + b, 0) / r20.length).toFixed(4)) : null,
      stoppedRate5d: subset.length ? Number((stopped5 / subset.length).toFixed(3)) : null,
      stoppedRate20d: subset.length ? Number((stopped20 / subset.length).toFixed(3)) : null,
      rsiBuckets: buckets,
      medianRSI: rsis.length ? Number(median(rsis)!.toFixed(1)) : null,
    };
  }
  return out;
}

// ─── Top-level ──────────────────────────────────────────────────────────────

export interface StrategyEvalResult {
  basket: { symbols: string[]; days: number; side: SideFilter };
  generatedAt: string;
  benchmark: { spyTotalReturnPct: number | null };
  perTicker: Array<TickerEval & { summary: { fires: number; longs: number; shorts: number; stops: number } }>;
  aggregate: {
    totalFires: number;
    bySignalType: Record<string, PerTypeAgg>;
    byDirection: Record<"long" | "short" | "exit", PerTypeAgg & { signalTypes: string[] }>;
  };
  notes: string[];
}

function aggregateDirection(allFires: FireRecord[]): StrategyEvalResult["aggregate"]["byDirection"] {
  const dirs: Array<"long" | "short" | "exit"> = ["long", "short", "exit"];
  const out: any = {};
  for (const dir of dirs) {
    const subset = allFires.filter(f => directionOf(f.type) === dir);
    const r1 = subset.map(f => f.fwd1).filter((v): v is number => v != null);
    const r5 = subset.map(f => f.fwd5).filter((v): v is number => v != null);
    const r20 = subset.map(f => f.fwd20).filter((v): v is number => v != null);
    const rsis = subset.map(f => f.rsi).filter((v): v is number => v != null);
    const buckets: PerTypeAgg["rsiBuckets"] = { "<30": 0, "30-40": 0, "40-50": 0, "50-60": 0, "60-70": 0, ">70": 0 };
    for (const r of rsis) buckets[bucketRsi(r)]++;
    const stopped5 = subset.filter(f => f.stopped5).length;
    const stopped20 = subset.filter(f => f.stopped20).length;
    const types = Array.from(new Set(subset.map(f => f.type)));
    out[dir] = {
      count: subset.length,
      winRate1d: winRate(r1),
      winRate5d: winRate(r5),
      winRate20d: winRate(r20),
      medianReturn1d: r1.length ? Number((median(r1)!).toFixed(4)) : null,
      medianReturn5d: r5.length ? Number((median(r5)!).toFixed(4)) : null,
      medianReturn20d: r20.length ? Number((median(r20)!).toFixed(4)) : null,
      meanReturn5d: r5.length ? Number((r5.reduce((a, b) => a + b, 0) / r5.length).toFixed(4)) : null,
      meanReturn20d: r20.length ? Number((r20.reduce((a, b) => a + b, 0) / r20.length).toFixed(4)) : null,
      stoppedRate5d: subset.length ? Number((stopped5 / subset.length).toFixed(3)) : null,
      stoppedRate20d: subset.length ? Number((stopped20 / subset.length).toFixed(3)) : null,
      rsiBuckets: buckets,
      medianRSI: rsis.length ? Number(median(rsis)!.toFixed(1)) : null,
      signalTypes: types,
    };
  }
  return out;
}

export async function runStrategyEval(symbols: string[], days: number, includeDetail: boolean, side: SideFilter = "both"): Promise<StrategyEvalResult> {
  // Fetch in concurrent batches of 12 to stay polite to FMP.
  const BATCH = 12;
  const tickerEvals: TickerEval[] = [];
  for (let i = 0; i < symbols.length; i += BATCH) {
    const slice = symbols.slice(i, i + BATCH);
    const results = await Promise.allSettled(slice.map(s => evalTicker(s, days)));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) tickerEvals.push(r.value);
    }
    if (i + BATCH < symbols.length) await new Promise(r => setTimeout(r, 150));
  }

  // Apply side filter to all fires before aggregation. Tickers retain
  // their full fire list internally for the perTicker summary, but the
  // filtered list is what flows into bySignalType / byDirection.
  const sideFilterFn = (f: FireRecord): boolean => {
    if (side === "both") return true;
    if (side === "long")  return isLongSide(f.type) || isStopOrExit(f.type);
    if (side === "short") return isShortSide(f.type) || isStopOrExit(f.type);
    return true;
  };
  // Filter per-ticker fires too (so the detail view matches the aggregate).
  for (const t of tickerEvals) {
    t.fires = t.fires.filter(sideFilterFn);
  }
  const allFires: FireRecord[] = tickerEvals.flatMap(t => t.fires);

  // SPY benchmark (close-to-close return over the same window).
  const spyEval = await evalTicker("SPY", days).catch(() => null);
  const spyReturn = spyEval ? spyEval.totalReturnPct : null;

  const perTicker = tickerEvals.map(t => ({
    ...t,
    fires: includeDetail ? t.fires : [],
    summary: {
      fires: t.fires.length,
      longs: t.fires.filter(f => isLongSide(f.type)).length,
      shorts: t.fires.filter(f => isShortSide(f.type)).length,
      stops: t.fires.filter(f => isStopOrExit(f.type)).length,
    },
  }));

  return {
    basket: { symbols, days, side },
    generatedAt: new Date().toISOString(),
    benchmark: { spyTotalReturnPct: spyReturn },
    perTicker,
    aggregate: {
      totalFires: allFires.length,
      bySignalType: aggregate(allFires),
      byDirection: aggregateDirection(allFires),
    },
    notes: [
      "Forward returns are dir-adjusted: long-side fires use +1, short-side use -1, so a positive forward return = trade went the predicted direction.",
      "stoppedRate is the % of fires where price would have hit a 7% stop within the forward window.",
      "winRate is the % of fires with a positive (dir-adjusted) forward return.",
      "byDirection rolls all long-side signal types into one block, all short-side into another, exits separately.",
      "Pass &side=long or &side=short to restrict the response to one direction (exits/stops always included).",
      "Add ?detail=1 to include per-ticker fire records.",
    ],
  };
}
