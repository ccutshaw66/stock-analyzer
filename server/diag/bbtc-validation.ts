/**
 * BBTC out-of-sample, SPY-relative validation — three variants.
 *
 * Read-only. No production changes. Run:
 *   npx tsx server/diag/bbtc-validation.ts
 *
 * What it does:
 *   - Pulls the live HTF universe ($5–75, vol≥750k, mktcap≥200M), samples
 *     ~100 names deterministically (by volume desc, then symbol).
 *   - Fetches ~7y daily bars per name from FMP (the SAME fetch + indicator
 *     stack the live system uses), runs the REAL computeBBTC (single source
 *     of truth), and pairs LONG round-trips (BUY → next SELL/STOP_HIT),
 *     mirroring strategy-pnl.ts pairing.
 *   - Records per round-trip: symbol, entryDate, entryPrice, entryRSI,
 *     exitDate, exitPrice, return%, holdDays.
 *   - Evaluates THREE variants over the SAME round-trips:
 *       A) AS-IS    — long round-trips as produced.
 *       B) INVERTED — same entries/exits traded SHORT (return = -long).
 *       C) FIXED    — AS-IS minus every round-trip with entryRSI > 65.
 *   - Splits by entryDate into IN-SAMPLE (older 65% of the date range) vs
 *     OUT-OF-SAMPLE (most recent 35%). Reports every metric for IS and OOS.
 *   - SPY-relative: SPY buy&hold over IS/OOS spans + per-trade SPY-excess
 *     (trade return − SPY return over the same hold window).
 *   - $1,000 fixed per trade for dollar P&L.
 *
 * Survivorship caveat: getHtfUniverse() screens on CURRENT price/volume/cap,
 * so the basket is biased toward names that survived into today's $5–75 band.
 * Treat absolute $ as optimistic; the SPY-relative + OOS comparison is the
 * load-bearing evidence.
 */

import "dotenv/config";
import { fmpGet } from "../data/providers/fmp.client";
import { computeBBTC } from "../signals/strategies/bbtc";
import { getHtfUniverse } from "../signals/universe/htf-universe";
import {
  RSI_PERIOD, ATR_PERIOD, EMA_FAST, EMA_MID, EMA_SLOW,
} from "@shared/indicators/constants";

// ─── Indicator helpers (verbatim from strategy-eval.ts) ─────────────────────

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

// ─── FMP fetcher (verbatim from strategy-eval.ts) ───────────────────────────

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

// ─── Round-trip extraction (mirrors strategy-pnl.ts pairing) ────────────────

interface RoundTrip {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  entryRSI: number | null;
  exitDate: string;
  exitPrice: number;
  returnPct: number;   // long return = (exit - entry) / entry
  holdDays: number;    // bars held
}

const POSITION_SIZE = 1000;
const DAYS = 2555; // ~7y

async function extractRoundTrips(symbol: string): Promise<RoundTrip[]> {
  const b = await fetchBars(symbol, DAYS);
  if (!b) return [];

  const rsi14 = computeRSI(b.close, RSI_PERIOD);
  const ema9 = computeEMA(b.close, EMA_FAST);
  const ema21 = computeEMA(b.close, EMA_MID);
  const ema50 = computeEMA(b.close, EMA_SLOW);
  const atr14 = computeATR(b.high, b.low, b.close, ATR_PERIOD);

  // Feed computeBBTC exactly as strategy-eval.ts does (no adx14/sma200 passed —
  // BBTC computes them inline, matching the live call path here).
  const bbtc = computeBBTC({
    closes: b.close, highs: b.high, lows: b.low,
    ema9, ema21, ema50, atr14, rsi14,
  });

  const trips: RoundTrip[] = [];
  let open: { entryDate: string; entryPrice: number; entryRSI: number | null; entryBar: number } | null = null;

  for (let i = 0; i < b.close.length; i++) {
    const sig = bbtc.signals[i];
    const side = bbtc.signalSides[i];
    if (!sig) continue;

    // Close first (mirrors strategy-pnl: exit then potential re-entry next bar)
    if (open && ((sig === "STOP_HIT" || sig === "SELL" || sig === "REDUCE") && side === "LONG")) {
      const exitPrice = b.close[i];
      trips.push({
        symbol,
        entryDate: open.entryDate,
        entryPrice: Number(open.entryPrice.toFixed(2)),
        entryRSI: open.entryRSI,
        exitDate: b.date[i],
        exitPrice: Number(exitPrice.toFixed(2)),
        returnPct: Number(((exitPrice - open.entryPrice) / open.entryPrice).toFixed(6)),
        holdDays: i - open.entryBar,
      });
      open = null;
    } else if (!open && ((sig === "BUY" || sig === "ADD_LONG") && side === "LONG")) {
      open = {
        entryDate: b.date[i],
        entryPrice: b.close[i],
        entryRSI: Number.isFinite(rsi14[i]) ? Number(rsi14[i].toFixed(1)) : null,
        entryBar: i,
      };
    }
  }
  // Open trade at end of window is dropped (no realized exit) — matches the
  // "closed trades only" $ P&L convention in strategy-pnl.ts.
  return trips;
}

// ─── SPY return over an arbitrary [entryDate, exitDate] window ───────────────

interface SpyIndex {
  dates: string[];
  closes: number[];
  byDate: Map<string, number>; // date -> index
}

async function loadSpy(): Promise<SpyIndex | null> {
  const b = await fetchBars("SPY", DAYS);
  if (!b) return null;
  const byDate = new Map<string, number>();
  b.date.forEach((d, i) => byDate.set(d, i));
  return { dates: b.date, closes: b.close, byDate };
}

// SPY return over the same hold window as a trade. Finds the SPY close on/after
// entryDate and on/before exitDate. Returns null if window can't be located.
function spyReturnOverWindow(spy: SpyIndex, entryDate: string, exitDate: string): number | null {
  // first SPY bar >= entryDate
  let ei = -1;
  for (let i = 0; i < spy.dates.length; i++) {
    if (spy.dates[i] >= entryDate) { ei = i; break; }
  }
  // last SPY bar <= exitDate
  let xi = -1;
  for (let i = spy.dates.length - 1; i >= 0; i--) {
    if (spy.dates[i] <= exitDate) { xi = i; break; }
  }
  if (ei < 0 || xi < 0 || xi <= ei) return null;
  return (spy.closes[xi] - spy.closes[ei]) / spy.closes[ei];
}

// SPY buy&hold total return over [fromDate, toDate]
function spyBuyHold(spy: SpyIndex, fromDate: string, toDate: string): number | null {
  let fi = -1;
  for (let i = 0; i < spy.dates.length; i++) {
    if (spy.dates[i] >= fromDate) { fi = i; break; }
  }
  let ti = -1;
  for (let i = spy.dates.length - 1; i >= 0; i--) {
    if (spy.dates[i] <= toDate) { ti = i; break; }
  }
  if (fi < 0 || ti < 0 || ti <= fi) return null;
  return (spy.closes[ti] - spy.closes[fi]) / spy.closes[fi];
}

// ─── Metrics ────────────────────────────────────────────────────────────────

interface VariantMetrics {
  trades: number;
  winRatePct: number | null;
  avgRetPct: number | null;
  medianRetPct: number | null;
  totalPnL$: number;
  maxDD$: number;
  avgSpyExcessPct: number | null; // avg of (trade return - spy return over same hold)
}

function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Compute metrics for a set of (return, spyExcess) trades already ordered by entryDate.
function metricsFor(returns: number[], spyExcess: (number | null)[]): VariantMetrics {
  const n = returns.length;
  if (n === 0) {
    return { trades: 0, winRatePct: null, avgRetPct: null, medianRetPct: null, totalPnL$: 0, maxDD$: 0, avgSpyExcessPct: null };
  }
  const wins = returns.filter(r => r > 0).length;
  const avg = returns.reduce((a, b) => a + b, 0) / n;
  const med = median(returns)!;
  // additive $ equity curve (fixed $1000 per trade, NOT compounded) — matches
  // the "sum of 1000×return" spec.
  let cum = 0, peak = 0, maxDD = 0;
  for (const r of returns) {
    cum += r * POSITION_SIZE;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
  }
  const totalPnL = cum;
  const excessVals = spyExcess.filter((v): v is number => v != null);
  const avgExcess = excessVals.length ? excessVals.reduce((a, b) => a + b, 0) / excessVals.length : null;
  return {
    trades: n,
    winRatePct: Number(((wins / n) * 100).toFixed(1)),
    avgRetPct: Number((avg * 100).toFixed(2)),
    medianRetPct: Number((med * 100).toFixed(2)),
    totalPnL$: Number(totalPnL.toFixed(0)),
    maxDD$: Number(maxDD.toFixed(0)),
    avgSpyExcessPct: avgExcess != null ? Number((avgExcess * 100).toFixed(2)) : null,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== BBTC OUT-OF-SAMPLE, SPY-RELATIVE VALIDATION ===\n");

  // 1. Universe — deterministic sample of ~100 names.
  const uni = await getHtfUniverse();
  const SAMPLE_N = 100;
  const sampled = [...uni.tickers]
    .sort((a, b) => (b.volume - a.volume) || a.symbol.localeCompare(b.symbol))
    .slice(0, SAMPLE_N)
    .map(t => t.symbol);
  console.log(`HTF universe: ${uni.tickers.length} names → sampled top ${sampled.length} by volume desc.`);
  console.log(`Survivorship caveat: universe is filtered on CURRENT $5–75 / vol≥750k / cap≥200M.`);
  console.log(`Position size: $${POSITION_SIZE}/trade (fixed, additive — NOT compounded). Window: ~7y daily.\n`);

  // 2. SPY for benchmarking.
  const spy = await loadSpy();
  if (!spy) { console.error("FATAL: could not load SPY."); process.exit(1); }

  // 3. Extract round-trips across the basket (batched 12 concurrent like strategy-eval).
  const BATCH = 12;
  const allTrips: RoundTrip[] = [];
  let withData = 0, failed = 0;
  for (let i = 0; i < sampled.length; i += BATCH) {
    const slice = sampled.slice(i, i + BATCH);
    const results = await Promise.allSettled(slice.map(s => extractRoundTrips(s)));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") {
        if (r.value.length > 0) withData++;
        allTrips.push(...r.value);
      } else {
        failed++;
      }
    }
    if (i + BATCH < sampled.length) await new Promise(res => setTimeout(res, 150));
    process.stdout.write(`  fetched ${Math.min(i + BATCH, sampled.length)}/${sampled.length}\r`);
  }
  console.log(`\nNames with >=1 round-trip: ${withData}.  Fetch failures: ${failed}.  Total round-trips: ${allTrips.length}.\n`);

  if (allTrips.length < 50) {
    console.error("UNDER-POWERED: fewer than 50 round-trips. Refusing to call this validated.");
  }

  // 4. Order by entryDate, attach SPY-excess per trade.
  allTrips.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  const dateMin = allTrips[0].entryDate;
  const dateMax = allTrips[allTrips.length - 1].entryDate;

  // 5. IS / OOS split on entryDate by calendar fraction (older 65% vs recent 35%).
  const t0 = new Date(dateMin).getTime();
  const t1 = new Date(dateMax).getTime();
  const splitTime = t0 + (t1 - t0) * 0.65;
  const splitDate = new Date(splitTime).toISOString().slice(0, 10);

  const isTrips = allTrips.filter(t => t.entryDate <= splitDate);
  const oosTrips = allTrips.filter(t => t.entryDate > splitDate);

  console.log(`Date span of entries: ${dateMin} → ${dateMax}`);
  console.log(`IS/OOS split date (65% of calendar range): ${splitDate}`);
  console.log(`  IN-SAMPLE round-trips:  ${isTrips.length}  (entry <= ${splitDate})`);
  console.log(`  OUT-OF-SAMPLE round-trips: ${oosTrips.length}  (entry >  ${splitDate})\n`);

  // SPY buy&hold over each span (use entry-date span; report as the index benchmark).
  const spyIS = spyBuyHold(spy, dateMin, splitDate);
  const spyOOS = spyBuyHold(spy, splitDate, dateMax);
  console.log(`SPY buy&hold over IS span (${dateMin}→${splitDate}):  ${spyIS != null ? (spyIS * 100).toFixed(1) + "%" : "n/a"}`);
  console.log(`SPY buy&hold over OOS span (${splitDate}→${dateMax}): ${spyOOS != null ? (spyOOS * 100).toFixed(1) + "%" : "n/a"}\n`);

  // 6. Build the three variants for a given trip set.
  //    AS-IS: long return + long spy-excess.
  //    INVERTED: short return = -long; spy-excess(short) = (-long return) - (-spyRet) = spyRet - longRet.
  //    FIXED: AS-IS minus entryRSI>65.
  function buildVariants(trips: RoundTrip[]) {
    const spyRetCache = trips.map(t => spyReturnOverWindow(spy!, t.entryDate, t.exitDate));

    // AS-IS
    const asisRet = trips.map(t => t.returnPct);
    const asisExcess = trips.map((t, i) => spyRetCache[i] == null ? null : t.returnPct - spyRetCache[i]!);

    // INVERTED (short the same entries/exits)
    const invRet = trips.map(t => -t.returnPct);
    const invExcess = trips.map((t, i) => spyRetCache[i] == null ? null : (-t.returnPct) - (spyRetCache[i]!));

    // FIXED (drop entryRSI > 65)
    const fixedIdx = trips.map((t, i) => i).filter(i => !(trips[i].entryRSI != null && trips[i].entryRSI! > 65));
    const fixedRet = fixedIdx.map(i => trips[i].returnPct);
    const fixedExcess = fixedIdx.map(i => spyRetCache[i] == null ? null : trips[i].returnPct - spyRetCache[i]!);

    return {
      ASIS: metricsFor(asisRet, asisExcess),
      INVERTED: metricsFor(invRet, invExcess),
      FIXED: metricsFor(fixedRet, fixedExcess),
      droppedByFixed: trips.length - fixedIdx.length,
    };
  }

  const isV = buildVariants(isTrips);
  const oosV = buildVariants(oosTrips);
  const allV = buildVariants(allTrips);

  // 7. Print the table.
  const pad = (s: any, w: number) => String(s).padStart(w);
  function row(label: string, m: VariantMetrics) {
    console.log(
      "  " + label.padEnd(18) +
      pad(m.trades, 7) +
      pad(m.winRatePct == null ? "-" : m.winRatePct + "%", 9) +
      pad(m.avgRetPct == null ? "-" : (m.avgRetPct > 0 ? "+" : "") + m.avgRetPct + "%", 10) +
      pad(m.medianRetPct == null ? "-" : (m.medianRetPct > 0 ? "+" : "") + m.medianRetPct + "%", 11) +
      pad("$" + m.totalPnL$.toLocaleString(), 12) +
      pad("$" + m.maxDD$.toLocaleString(), 11) +
      pad(m.avgSpyExcessPct == null ? "-" : (m.avgSpyExcessPct > 0 ? "+" : "") + m.avgSpyExcessPct + "%", 12),
    );
  }
  function header() {
    console.log(
      "  " + "variant×split".padEnd(18) +
      pad("trades", 7) + pad("winRate", 9) + pad("avgRet", 10) +
      pad("medRet", 11) + pad("totalPnL", 12) + pad("maxDD", 11) + pad("avgSPYexc", 12),
    );
    console.log("  " + "-".repeat(88));
  }

  console.log("=== RESULTS TABLE (totalPnL & maxDD in $ at $1,000/trade) ===\n");
  header();
  row("AS-IS · IS", isV.ASIS);
  row("AS-IS · OOS", oosV.ASIS);
  console.log("");
  row("INVERTED · IS", isV.INVERTED);
  row("INVERTED · OOS", oosV.INVERTED);
  console.log("");
  row("FIXED · IS", isV.FIXED);
  row("FIXED · OOS", oosV.FIXED);
  console.log("");
  console.log("  (reference — full sample, IS+OOS combined)");
  row("AS-IS · ALL", allV.ASIS);
  row("INVERTED · ALL", allV.INVERTED);
  row("FIXED · ALL", allV.FIXED);
  console.log("");
  console.log(`  FIXED dropped ${oosV.droppedByFixed} OOS / ${isV.droppedByFixed} IS round-trips for entryRSI>65.\n`);

  // 8. Verdict logic. "Beats SPY OOS" = OOS totalPnL > 0 AND OOS avgSPYexcess > 0.
  function beatsSpyOOS(m: VariantMetrics): boolean {
    return m.totalPnL$ > 0 && (m.avgSpyExcessPct ?? -1) > 0;
  }
  const asisGo = beatsSpyOOS(oosV.ASIS);
  const fixedGo = beatsSpyOOS(oosV.FIXED);
  const invGo = beatsSpyOOS(oosV.INVERTED);

  console.log("=== VERDICT (hinges on OOS) ===");
  console.log(`  AS-IS    beats SPY OOS?  ${asisGo ? "YES" : "NO"}   (OOS $${oosV.ASIS.totalPnL$.toLocaleString()}, avgSPYexc ${oosV.ASIS.avgSpyExcessPct}%)  → ${asisGo ? "GO" : "NO-GO"}`);
  console.log(`  FIXED    beats SPY OOS?  ${fixedGo ? "YES" : "NO"}   (OOS $${oosV.FIXED.totalPnL$.toLocaleString()}, avgSPYexc ${oosV.FIXED.avgSpyExcessPct}%)  → ${fixedGo ? "GO" : "NO-GO"}`);
  console.log(`  INVERTED beats SPY OOS?  ${invGo ? "YES" : "NO"}   (OOS $${oosV.INVERTED.totalPnL$.toLocaleString()}, avgSPYexc ${oosV.INVERTED.avgSpyExcessPct}%)  → ${invGo ? "GO" : "NO-GO"}`);
  console.log(`  FIXED better than AS-IS OOS (totalPnL)?  ${oosV.FIXED.totalPnL$ > oosV.ASIS.totalPnL$ ? "YES" : "NO"}\n`);

  // 9. Write artifact.
  const fs = await import("fs");
  const path = await import("path");
  const outDir = path.resolve("python", "validation");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "bbtc_oos_validation.json");
  const artifact = {
    generatedAt: new Date().toISOString(),
    design: {
      strategy: "computeBBTC (server/signals/strategies/bbtc.ts) — long-only trend follower",
      universe: `HTF $5–75 / vol>=750k / cap>=200M; ${uni.tickers.length} names, sampled top ${sampled.length} by volume desc`,
      positionSizeDollars: POSITION_SIZE,
      window: "~7y daily bars per name",
      pairing: "LONG BUY/ADD_LONG -> next SELL/STOP_HIT/REDUCE; open trades at end dropped",
      isOosSplit: `entryDate calendar 65/35; split=${splitDate}`,
      spyExcessDef: "trade return - SPY return over the same hold window",
      beatsSpyDef: "OOS totalPnL > 0 AND OOS avg SPY-excess > 0",
      survivorshipCaveat: "universe filtered on CURRENT price/vol/cap; absolute $ optimistic",
      noLookAhead: "computeBBTC uses only data up to bar i; exits priced at the exit bar close",
    },
    span: { entryDateMin: dateMin, entryDateMax: dateMax, splitDate },
    counts: { sampledNames: sampled.length, namesWithTrips: withData, fetchFailures: failed, totalTrips: allTrips.length, isTrips: isTrips.length, oosTrips: oosTrips.length },
    spyBuyHold: { isPct: spyIS != null ? Number((spyIS * 100).toFixed(1)) : null, oosPct: spyOOS != null ? Number((spyOOS * 100).toFixed(1)) : null },
    metrics: {
      IS: { ASIS: isV.ASIS, INVERTED: isV.INVERTED, FIXED: isV.FIXED },
      OOS: { ASIS: oosV.ASIS, INVERTED: oosV.INVERTED, FIXED: oosV.FIXED },
      ALL: { ASIS: allV.ASIS, INVERTED: allV.INVERTED, FIXED: allV.FIXED },
    },
    verdict: {
      ASIS: asisGo ? "GO" : "NO-GO",
      FIXED: fixedGo ? "GO" : "NO-GO",
      INVERTED: invGo ? "GO" : "NO-GO",
      fixedBeatsAsisOOS: oosV.FIXED.totalPnL$ > oosV.ASIS.totalPnL$,
    },
  };
  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));
  console.log(`Artifact written: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
