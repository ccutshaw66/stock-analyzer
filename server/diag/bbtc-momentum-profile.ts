/**
 * BBTC entry/exit momentum profile — what RSI & MACD does it actually buy/sell at,
 * and how often does it trade (churn check). Read-only. Uses the REAL post-fix
 * computeBBTC over a sample of the live $5-75 HTF universe.
 *   npx tsx server/diag/bbtc-momentum-profile.ts
 *
 * MACD scales with price, so averaging raw MACD across stocks is meaningless —
 * we report MACD histogram & line as % of price (cross-stock comparable) plus the
 * sign stats (% of entries where MACD>0 and MACD>signal).
 */
import "dotenv/config";
import { fmpGet } from "../data/providers/fmp.client";
import { computeBBTC } from "../signals/strategies/bbtc";
import { getHtfUniverse } from "../signals/universe/htf-universe";
import { RSI_PERIOD, ATR_PERIOD, EMA_FAST, EMA_MID, EMA_SLOW } from "@shared/indicators/constants";

function computeEMA(data: number[], period: number): number[] {
  const out = new Array(data.length).fill(NaN);
  if (data.length < period) return out;
  let sum = 0; for (let i = 0; i < period; i++) sum += data[i];
  out[period - 1] = sum / period;
  const k = 2 / (period + 1);
  for (let i = period; i < data.length; i++) out[i] = data[i] * k + out[i - 1] * (1 - k);
  return out;
}
function computeATR(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const tr = new Array(closes.length).fill(NaN);
  for (let i = 1; i < closes.length; i++) tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  const atr = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return atr;
  let sum = 0; for (let i = 1; i <= period; i++) sum += tr[i];
  atr[period] = sum / period;
  for (let i = period + 1; i < closes.length; i++) atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  return atr;
}
function computeRSI(closes: number[], period: number): number[] {
  const rsi = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return rsi;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const c = closes[i] - closes[i - 1]; if (c > 0) g += c; else l -= c; }
  let ag = g / period, al = l / period;
  rsi[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < closes.length; i++) {
    const c = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (c > 0 ? c : 0)) / period;
    al = (al * (period - 1) + (c < 0 ? -c : 0)) / period;
    rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return rsi;
}
// MACD 12/26/9 — matches routes.ts canonical computation.
function computeMACD(closes: number[]) {
  const e12 = computeEMA(closes, 12), e26 = computeEMA(closes, 26);
  const line = closes.map((_, i) => (!isNaN(e12[i]) && !isNaN(e26[i])) ? e12[i] - e26[i] : NaN);
  const valid: number[] = [], idx: number[] = [];
  line.forEach((v, i) => { if (!isNaN(v)) { valid.push(v); idx.push(i); } });
  const sigE = computeEMA(valid, 9);
  const signal = new Array(closes.length).fill(NaN);
  idx.forEach((ix, j) => { signal[ix] = sigE[j]; });
  const hist = closes.map((_, i) => (!isNaN(line[i]) && !isNaN(signal[i])) ? line[i] - signal[i] : NaN);
  return { line, signal, hist };
}

interface Bars { date: string[]; open: number[]; high: number[]; low: number[]; close: number[]; volume: number[]; }
async function fetchBars(symbol: string, days: number): Promise<Bars | null> {
  try {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - (days + 250) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const data: any = await fmpGet("/historical-price-eod/full", { symbol, from, to });
    const arr: any[] = Array.isArray(data) ? data : (data?.historical || []);
    if (arr.length < 100) return null;
    const s = [...arr].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const out: Bars = { date: [], open: [], high: [], low: [], close: [], volume: [] };
    for (const r of s) { const c = Number(r.close); if (!Number.isFinite(c)) continue; out.date.push(String(r.date)); out.open.push(Number(r.open)); out.high.push(Number(r.high)); out.low.push(Number(r.low)); out.close.push(c); out.volume.push(Number(r.volume) || 0); }
    return out;
  } catch { return null; }
}

interface Point { rsi: number | null; macd: number; macdPctPrice: number; histPctPrice: number; macdGtSignal: boolean; macdGt0: boolean; }
interface Trip { entry: Point; exit: Point; holdDays: number; gapToNextEntry: number | null; }

const DAYS = 2555;
async function profileTicker(symbol: string): Promise<{ trips: Trip[]; years: number } | null> {
  const b = await fetchBars(symbol, DAYS);
  if (!b) return null;
  const rsi = computeRSI(b.close, RSI_PERIOD);
  const ema9 = computeEMA(b.close, EMA_FAST), ema21 = computeEMA(b.close, EMA_MID), ema50 = computeEMA(b.close, EMA_SLOW);
  const atr = computeATR(b.high, b.low, b.close, ATR_PERIOD);
  const macd = computeMACD(b.close);
  const bbtc = computeBBTC({ closes: b.close, highs: b.high, lows: b.low, ema9, ema21, ema50, atr14: atr, rsi14: rsi });

  const pt = (i: number): Point => {
    const px = b.close[i] || 1;
    const m = macd.line[i], s = macd.signal[i], h = macd.hist[i];
    return {
      rsi: Number.isFinite(rsi[i]) ? rsi[i] : null,
      macd: Number.isFinite(m) ? m : 0,
      macdPctPrice: Number.isFinite(m) ? (m / px) * 100 : 0,
      histPctPrice: Number.isFinite(h) ? (h / px) * 100 : 0,
      macdGtSignal: Number.isFinite(m) && Number.isFinite(s) ? m > s : false,
      macdGt0: Number.isFinite(m) ? m > 0 : false,
    };
  };

  const trips: Trip[] = [];
  let open: { bar: number } | null = null;
  const entryBars: number[] = [];
  for (let i = 0; i < b.close.length; i++) {
    const sig = bbtc.signals[i], side = bbtc.signalSides[i];
    if (!sig) continue;
    if (open && (sig === "STOP_HIT" || sig === "SELL" || sig === "REDUCE") && side === "LONG") {
      trips.push({ entry: pt(open.bar), exit: pt(i), holdDays: i - open.bar, gapToNextEntry: null });
      open = null;
    } else if (!open && (sig === "BUY" || sig === "ADD_LONG") && side === "LONG") {
      open = { bar: i }; entryBars.push(i);
    }
  }
  for (let k = 0; k < trips.length - 1 && k < entryBars.length - 1; k++) trips[k].gapToNextEntry = entryBars[k + 1] - entryBars[k];
  const years = (new Date(b.date[b.date.length - 1]).getTime() - new Date(b.date[0]).getTime()) / (365.25 * 864e5);
  return { trips, years };
}

const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const f1 = (x: number) => isNaN(x) ? "n/a" : x.toFixed(1);
const f3 = (x: number) => isNaN(x) ? "n/a" : (x >= 0 ? "+" : "") + x.toFixed(3);
const pct = (n: number, d: number) => d ? (n / d * 100).toFixed(0) + "%" : "n/a";

async function main() {
  console.log("=== BBTC ENTRY/EXIT MOMENTUM PROFILE (post-fix strategy) ===\n");
  const uni = await getHtfUniverse();
  const sampled = [...uni.tickers].sort((a, b) => (b.volume - a.volume) || a.symbol.localeCompare(b.symbol)).slice(0, 100).map(t => t.symbol);
  console.log(`Universe ${uni.tickers.length} → sampled top ${sampled.length} by volume.\n`);

  const BATCH = 12;
  const trips: Trip[] = [];
  let totalYears = 0, names = 0;
  for (let i = 0; i < sampled.length; i += BATCH) {
    const res = await Promise.allSettled(sampled.slice(i, i + BATCH).map(s => profileTicker(s)));
    for (const r of res) if (r.status === "fulfilled" && r.value) { trips.push(...r.value.trips); totalYears += r.value.years; names++; }
    if (i + BATCH < sampled.length) await new Promise(r => setTimeout(r, 150));
    process.stdout.write(`  fetched ${Math.min(i + BATCH, sampled.length)}/${sampled.length}\r`);
  }
  console.log(`\n${names} names, ${trips.length} round-trips.\n`);

  const eRSI = trips.map(t => t.entry.rsi).filter((v): v is number => v != null);
  const xRSI = trips.map(t => t.exit.rsi).filter((v): v is number => v != null);
  const eHist = trips.map(t => t.entry.histPctPrice);
  const xHist = trips.map(t => t.exit.histPctPrice);
  const eMacdPct = trips.map(t => t.entry.macdPctPrice);
  const xMacdPct = trips.map(t => t.exit.macdPctPrice);
  const eGtSig = trips.filter(t => t.entry.macdGtSignal).length;
  const eGt0 = trips.filter(t => t.entry.macdGt0).length;
  const xGtSig = trips.filter(t => t.exit.macdGtSignal).length;
  const holds = trips.map(t => t.holdDays);
  const gaps = trips.map(t => t.gapToNextEntry).filter((v): v is number => v != null);

  console.log("BUY (entry):");
  console.log(`  avg RSI ${f1(avg(eRSI))}   median RSI ${f1(median(eRSI))}`);
  console.log(`  MACD line  avg ${f3(avg(eMacdPct))}% of price   MACD histogram avg ${f3(avg(eHist))}% of price`);
  console.log(`  MACD > signal (positive momentum): ${pct(eGtSig, trips.length)} of entries`);
  console.log(`  MACD > 0 (above zero line):        ${pct(eGt0, trips.length)} of entries\n`);

  console.log("SELL/exit:");
  console.log(`  avg RSI ${f1(avg(xRSI))}   median RSI ${f1(median(xRSI))}`);
  console.log(`  MACD line  avg ${f3(avg(xMacdPct))}% of price   MACD histogram avg ${f3(avg(xHist))}% of price`);
  console.log(`  MACD > signal at exit: ${pct(xGtSig, trips.length)} of exits\n`);

  console.log("CHURN / frequency:");
  console.log(`  avg hold ${f1(avg(holds))} trading days   median hold ${f1(median(holds))} days`);
  console.log(`  trades per name per year: ${(trips.length / totalYears).toFixed(1)}`);
  console.log(`  median days between consecutive entries on a name: ${f1(median(gaps))}`);
}
main().catch(e => { console.error(e); process.exit(1); });
