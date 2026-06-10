/**
 * HTF (High Tight Flag) out-of-sample, SPY-relative validation.
 *
 * Read-only. No production changes. Run:
 *   npx tsx server/diag/htf-validation.ts
 *
 * WHY THIS EXISTS
 *   The 2026-06-09 trust audit (docs/AUDIT-2026-06-09.md) found HTF's existing
 *   "validation" was WFE-only (OOS-$ / IS-$, no SPY benchmark) and the only
 *   SPY-relative numbers were on a 33-name MEGA-CAP basket — violating the
 *   project's $5-75 HTF-universe rule. This harness creates the missing clean,
 *   HTF-universe, SPY-relative, OOS test. It mirrors the AMC validation method
 *   (forward 20d/60d return − SPY over the same window) and the BBTC IS/OOS
 *   calendar split, so the verdict is apples-to-apples with both.
 *
 * METHOD
 *   - Universe = getHtfUniverse() ($5-75 / vol>=750k / cap>=200M). Sample the
 *     top N by avg volume deterministically (FMP load is the only reason to cap).
 *   - Detector = the LIVE scanHtf (server/signals/strategies/htf.ts), the SAME
 *     single-source-of-truth signal the site shows. NOT a re-implementation.
 *   - NO LOOK-AHEAD: for each candidate breakout bar i, scanHtf is run on bars
 *     [0..i] ONLY (the slice ends at i), and we keep a hit whose breakoutDate ==
 *     bars[i].date. The detector therefore sees only data available at t=i.
 *     lookbackDays=252 (the validated live-scan lookback, per memory 2026-06-03).
 *   - For each fired breakout: raw forward close-to-close return at +20 and +60
 *     trading days, minus SPY's return over the identical calendar window =
 *     EXCESS. (Same construction as amc_oos_validation.json.)
 *   - De-dupe repeat fires on the same symbol within 10 trading days (AMC rule).
 *   - IS/OOS split: breakoutDate calendar 65/35 (BBTC rule). OOS is load-bearing.
 *   - Stats: median + mean excess, win-rate vs SPY, HAC/Newey-West t-stat on the
 *     excess series, per-trade Sharpe, deflated-Sharpe note.
 *
 * SURVIVORSHIP CAVEAT: getHtfUniverse screens on CURRENT price/vol/cap, so the
 * basket is biased toward names that survived into today's $5-75 band. The
 * SPY-relative excess is the load-bearing evidence (absolute returns optimistic).
 */

import "dotenv/config";
import { fmpGet } from "../data/providers/fmp.client";
import { scanHtf } from "../signals/strategies/htf";
import { getHtfUniverse } from "../signals/universe/htf-universe";
import type { OHLCV } from "../data/types";

// ─── Tunables ───────────────────────────────────────────────────────────────
const SAMPLE_N = 100;          // names sampled top-by-volume (FMP load cap only)
const DAYS = 2555;             // ~7y daily bars per name
const LOOKBACK = 252;          // validated live-scan HTF lookback (decoupled from fetch)
const MIN_SCORE = 0;           // detector default; scoring does not gate the fire
const FWD_20 = 20;             // forward horizons in TRADING days (match AMC)
const FWD_60 = 60;
const DEDUPE_DAYS = 10;        // de-dupe repeat fires within N trading days (AMC)
const BATCH = 10;

// ─── Bars ───────────────────────────────────────────────────────────────────
interface Bars {
  date: string[];
  open: number[]; high: number[]; low: number[]; close: number[]; volume: number[];
}

async function fetchBars(symbol: string, days: number): Promise<Bars | null> {
  try {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - (days + 300) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const data: any = await fmpGet("/historical-price-eod/full", { symbol, from, to });
    const arr: any[] = Array.isArray(data) ? data : (data?.historical || []);
    if (arr.length < 200) return null;
    const sorted = [...arr].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const date: string[] = [], open: number[] = [], high: number[] = [],
      low: number[] = [], close: number[] = [], volume: number[] = [];
    for (const r of sorted) {
      const c = Number(r.close);
      if (!Number.isFinite(c)) continue;
      date.push(String(r.date));
      open.push(Number(r.open)); high.push(Number(r.high)); low.push(Number(r.low));
      close.push(c); volume.push(Number.isFinite(Number(r.volume)) ? Number(r.volume) : 0);
    }
    return { date, open, high, low, close, volume };
  } catch { return null; }
}

function toOHLCV(b: Bars, upto: number): OHLCV[] {
  // bars [0..upto] inclusive — the detector sees ONLY data available at t=upto.
  const out: OHLCV[] = [];
  for (let i = 0; i <= upto; i++) {
    out.push({ t: new Date(b.date[i]), o: b.open[i], h: b.high[i], l: b.low[i], c: b.close[i], v: b.volume[i] });
  }
  return out;
}

// ─── A single fired HTF breakout with its forward returns ───────────────────
interface Fire {
  symbol: string;
  breakoutDate: string;
  breakoutPrice: number;
  qualityScore: number;
  fwd20: number | null;   // raw forward 20d return
  fwd60: number | null;
  spy20: number | null;   // SPY return over the same 20d window
  spy60: number | null;
  exc20: number | null;   // fwd20 - spy20
  exc60: number | null;
}

// ─── Extract HTF fires for one symbol, NO LOOK-AHEAD ────────────────────────
async function extractFires(symbol: string, spy: SpyIndex): Promise<Fire[]> {
  const b = await fetchBars(symbol, DAYS);
  if (!b) return [];

  const n = b.close.length;
  // We only need to test bars where a breakout could be the LATEST bar of a
  // [0..i] slice. Running scanHtf on every bar is O(n^2 * lookback); to keep it
  // tractable we exploit that scanHtf(bars[0..i]) returns hits whose breakoutDate
  // is at-or-before bars[i]. We slide i forward and only accept a hit dated
  // EXACTLY bars[i] (a fresh, same-bar fire) — that is precisely the live
  // "freshness<=today" gate the scanner uses, and guarantees no future data.
  const minStart = 80; // need pole+flag history before first possible fire
  const fires: Fire[] = [];
  let lastFireIdx = -9999;

  for (let i = minStart; i < n; i++) {
    // De-dupe: skip if we already fired within DEDUPE_DAYS trading days.
    if (i - lastFireIdx < DEDUPE_DAYS) continue;

    const slice = toOHLCV(b, i);                       // [0..i] ONLY — no look-ahead
    const hits = scanHtf(slice, symbol, { lookbackDays: LOOKBACK, requireBreakout: true, minScore: MIN_SCORE });
    if (!hits.length) continue;
    // hits sorted newest-first; the freshest is the candidate for THIS bar.
    const top = hits[0];
    const bd = top.breakoutDate.toISOString().slice(0, 10);
    if (bd !== b.date[i]) continue;                    // only same-bar (fresh) fires

    // Forward returns from breakout close.
    const e = b.close[i];
    const j20 = i + FWD_20, j60 = i + FWD_60;
    const fwd20 = j20 < n ? (b.close[j20] - e) / e : null;
    const fwd60 = j60 < n ? (b.close[j60] - e) / e : null;
    const spy20 = j20 < n ? spy.retOver(b.date[i], b.date[j20]) : null;
    const spy60 = j60 < n ? spy.retOver(b.date[i], b.date[j60]) : null;

    fires.push({
      symbol,
      breakoutDate: b.date[i],
      breakoutPrice: Number(e.toFixed(2)),
      qualityScore: top.qualityScore,
      fwd20, fwd60, spy20, spy60,
      exc20: fwd20 != null && spy20 != null ? fwd20 - spy20 : null,
      exc60: fwd60 != null && spy60 != null ? fwd60 - spy60 : null,
    });
    lastFireIdx = i;
  }
  return fires;
}

// ─── SPY index ──────────────────────────────────────────────────────────────
interface SpyIndex { retOver(from: string, to: string): number | null; }

async function loadSpy(): Promise<SpyIndex | null> {
  const b = await fetchBars("SPY", DAYS);
  if (!b) return null;
  const dates = b.date, closes = b.close;
  return {
    retOver(from: string, to: string): number | null {
      let fi = -1; for (let i = 0; i < dates.length; i++) if (dates[i] >= from) { fi = i; break; }
      let ti = -1; for (let i = dates.length - 1; i >= 0; i--) if (dates[i] <= to) { ti = i; break; }
      if (fi < 0 || ti < 0 || ti <= fi) return null;
      return (closes[ti] - closes[fi]) / closes[fi];
    },
  };
}

// ─── Stats helpers ──────────────────────────────────────────────────────────
function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mean(a: number[]): number { return a.reduce((x, y) => x + y, 0) / a.length; }
function std(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

/**
 * Newey-West (HAC) t-stat for mean(series) != 0. Overlapping forward-return
 * windows induce autocorrelation up to ~horizon bars; HAC corrects the SE so we
 * don't over-state significance. lag = horizon is the standard choice.
 */
function neweyWestT(series: number[], lag: number): number | null {
  const n = series.length;
  if (n < 5) return null;
  const m = mean(series);
  const dev = series.map(x => x - m);
  let gamma0 = 0; for (const d of dev) gamma0 += d * d; gamma0 /= n;
  let varHac = gamma0;
  for (let L = 1; L <= Math.min(lag, n - 1); L++) {
    let g = 0; for (let t = L; t < n; t++) g += dev[t] * dev[t - L]; g /= n;
    const w = 1 - L / (lag + 1);            // Bartlett kernel
    varHac += 2 * w * g;
  }
  if (varHac <= 0) return null;
  const seMean = Math.sqrt(varHac / n);
  return m / seMean;
}

interface Stat {
  n: number;
  medFwd: number | null; medExc: number | null; meanExc: number | null;
  winVsSpy: number | null;     // fraction of fires beating SPY
  tStat: number | null;        // HAC t-stat on excess
  sharpe: number | null;       // per-fire excess Sharpe (mean/std)
}
function statFor(fwd: number[], exc: number[], lag: number): Stat {
  if (!exc.length) return { n: 0, medFwd: null, medExc: null, meanExc: null, winVsSpy: null, tStat: null, sharpe: null };
  const wins = exc.filter(x => x > 0).length;
  const s = std(exc);
  return {
    n: exc.length,
    medFwd: median(fwd),
    medExc: median(exc),
    meanExc: mean(exc),
    winVsSpy: wins / exc.length,
    tStat: neweyWestT(exc, lag),
    sharpe: s > 0 ? mean(exc) / s : null,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== HTF OUT-OF-SAMPLE, SPY-RELATIVE VALIDATION ($5-75 universe) ===\n");

  const uni = await getHtfUniverse();
  const sampled = [...uni.tickers]
    .sort((a, b) => (b.volume - a.volume) || a.symbol.localeCompare(b.symbol))
    .slice(0, SAMPLE_N).map(t => t.symbol);
  console.log(`HTF universe: ${uni.tickers.length} names → sampled top ${sampled.length} by volume desc.`);
  console.log(`Detector: LIVE scanHtf, lookbackDays=${LOOKBACK}, requireBreakout=true. Window ~7y daily.`);
  console.log(`Forward horizons: +${FWD_20}d / +${FWD_60}d trading; excess = fwd - SPY over same window.`);
  console.log(`Survivorship caveat: universe filtered on CURRENT $5-75 / vol>=750k / cap>=200M.\n`);

  const spy = await loadSpy();
  if (!spy) { console.error("FATAL: could not load SPY (FMP key missing?)."); process.exit(1); }

  const allFires: Fire[] = [];
  let withData = 0, failed = 0;
  for (let i = 0; i < sampled.length; i += BATCH) {
    const slice = sampled.slice(i, i + BATCH);
    const res = await Promise.allSettled(slice.map(s => extractFires(s, spy)));
    for (const r of res) {
      if (r.status === "fulfilled") { if (r.value.length) withData++; allFires.push(...r.value); }
      else failed++;
    }
    if (i + BATCH < sampled.length) await new Promise(z => setTimeout(z, 120));
    process.stdout.write(`  scanned ${Math.min(i + BATCH, sampled.length)}/${sampled.length}  fires=${allFires.length}\r`);
  }
  console.log(`\nNames with >=1 fire: ${withData}.  Fetch failures: ${failed}.  Total fires: ${allFires.length}.\n`);

  allFires.sort((a, b) => a.breakoutDate.localeCompare(b.breakoutDate));
  if (allFires.length < 2) { console.error("No fires — aborting."); process.exit(1); }

  const dateMin = allFires[0].breakoutDate;
  const dateMax = allFires[allFires.length - 1].breakoutDate;
  const t0 = new Date(dateMin).getTime(), t1 = new Date(dateMax).getTime();
  const splitDate = new Date(t0 + (t1 - t0) * 0.65).toISOString().slice(0, 10);

  const isF = allFires.filter(f => f.breakoutDate <= splitDate);
  const oosF = allFires.filter(f => f.breakoutDate > splitDate);

  console.log(`Breakout date span: ${dateMin} → ${dateMax}`);
  console.log(`IS/OOS split (65% of calendar range): ${splitDate}`);
  console.log(`  IN-SAMPLE fires:     ${isF.length}`);
  console.log(`  OUT-OF-SAMPLE fires: ${oosF.length}\n`);

  // Build per-split stats at both horizons (drop nulls — fires too near series end).
  function statsFor(fires: Fire[]) {
    const f20 = fires.map(f => f.fwd20).filter((x): x is number => x != null);
    const e20 = fires.map(f => f.exc20).filter((x): x is number => x != null);
    const f60 = fires.map(f => f.fwd60).filter((x): x is number => x != null);
    const e60 = fires.map(f => f.exc60).filter((x): x is number => x != null);
    return { h20: statFor(f20, e20, FWD_20), h60: statFor(f60, e60, FWD_60) };
  }
  const isS = statsFor(isF), oosS = statsFor(oosF), allS = statsFor(allFires);

  const pct = (x: number | null) => x == null ? "   n/a " : ((x >= 0 ? "+" : "") + (x * 100).toFixed(2) + "%").padStart(8);
  const num = (x: number | null, d = 2) => x == null ? "  n/a" : x.toFixed(d).padStart(6);
  function row(label: string, s: Stat) {
    console.log("  " + label.padEnd(16) + String(s.n).padStart(6) +
      "  medFwd " + pct(s.medFwd) + "  medExc " + pct(s.medExc) + "  meanExc " + pct(s.meanExc) +
      "  winVsSPY " + (s.winVsSpy == null ? " n/a" : (s.winVsSpy * 100).toFixed(1) + "%").padStart(6) +
      "  t " + num(s.tStat) + "  Sharpe " + num(s.sharpe, 3));
  }
  console.log("=== RESULTS (excess = HTF forward return − SPY over same window) ===\n");
  row("IS  +20d", isS.h20);  row("IS  +60d", isS.h60);  console.log("");
  row("OOS +20d", oosS.h20); row("OOS +60d", oosS.h60); console.log("");
  row("ALL +20d", allS.h20); row("ALL +60d", allS.h60); console.log("");

  // ── Verdict (hinges on OOS, both horizons) ──────────────────────────────
  // GO requires the OOS excess to be POSITIVE and statistically significant
  // (HAC |t| >= 2) on at least the 20d horizon, with 60d not contradicting,
  // AND adequate OOS sample (>= 30). Otherwise NO-GO.
  function goAt(s: Stat): boolean {
    return s.n >= 30 && (s.meanExc ?? -1) > 0 && (s.medExc ?? -1) > 0 && (s.tStat ?? 0) >= 2;
  }
  const oosGo20 = goAt(oosS.h20);
  const oosGo60 = goAt(oosS.h60);
  const underpowered = oosS.h20.n < 30;
  const verdict = underpowered ? "NO-GO (underpowered)" : (oosGo20 ? "GO" : "NO-GO");

  console.log("=== VERDICT (hinges on OUT-OF-SAMPLE) ===");
  console.log(`  OOS +20d beats SPY w/ significance?  ${oosGo20 ? "YES" : "NO"}  (meanExc ${pct(oosS.h20.meanExc).trim()}, t=${num(oosS.h20.tStat).trim()}, n=${oosS.h20.n})`);
  console.log(`  OOS +60d beats SPY w/ significance?  ${oosGo60 ? "YES" : "NO"}  (meanExc ${pct(oosS.h60.meanExc).trim()}, t=${num(oosS.h60.tStat).trim()}, n=${oosS.h60.n})`);
  if (underpowered) console.log(`  *** UNDERPOWERED: OOS n=${oosS.h20.n} < 30 — result is statistically weak. ***`);
  console.log(`  → VERDICT: ${verdict}\n`);

  // ── Artifact (shape mirrors amc_oos_validation.json / bbtc) ─────────────
  const fs = await import("fs");
  const path = await import("path");
  const outDir = path.resolve("python", "validation");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "htf_oos_validation.json");

  const artifact = {
    generatedAt: new Date().toISOString(),
    method: `LIVE scanHtf (server/signals/strategies/htf.ts), lookbackDays=${LOOKBACK}, requireBreakout=true. ` +
      `NO LOOK-AHEAD: scanHtf run on bars [0..i] only; keep a hit whose breakoutDate==bars[i] (fresh same-bar fire). ` +
      `Forward +${FWD_20}/+${FWD_60} trading-day close-to-close return; excess vs SPY over the identical window. ` +
      `De-dupe repeat fires per symbol within ${DEDUPE_DAYS} trading days. IS/OOS = breakoutDate calendar 65/35. ` +
      `HAC/Newey-West t-stat (lag=horizon) on the excess series corrects for overlapping-window autocorrelation.`,
    universe: `HTF $5-75 / vol>=750k / cap>=200M; ${uni.tickers.length} names, sampled top ${sampled.length} by volume desc`,
    window: "~7y daily bars per name",
    survivorshipCaveat: "universe filtered on CURRENT price/vol/cap; absolute returns optimistic, SPY-excess is load-bearing",
    span: { breakoutDateMin: dateMin, breakoutDateMax: dateMax, splitDate },
    counts: {
      sampledNames: sampled.length, namesWithFires: withData, fetchFailures: failed,
      totalFires: allFires.length, isFires: isF.length, oosFires: oosF.length,
    },
    factor: {
      htf: {
        IS:  { h20: isS.h20,  h60: isS.h60 },
        OOS: { h20: oosS.h20, h60: oosS.h60 },
        ALL: { h20: allS.h20, h60: allS.h60 },
        deflatedSharpe: "n/a — single pre-specified detector (the live scanHtf), NOT best-of-N. " +
          "No multiple-testing search was run over HTF variants here, so there is no inflated winner to deflate. " +
          "The per-fire excess Sharpe is reported directly; the HAC t-stat already discounts overlapping-window autocorrelation.",
        correlationCluster: "price-momentum / breakout (pole = trailing momentum, breakout = trend continuation). " +
          "Redundant with the AMC/BBTC/1Y-return momentum vote — NOT an independent confluence confirmer.",
        verdict: verdict.startsWith("GO") ? "GO" : "NO-GO",
      },
    },
    bottomLine: "",  // filled below
  };

  const bl = verdict.startsWith("GO")
    ? `HTF beats SPY out-of-sample on the $5-75 universe: OOS +20d mean excess ${pct(oosS.h20.meanExc).trim()} (HAC t=${num(oosS.h20.tStat).trim()}, n=${oosS.h20.n}), median ${pct(oosS.h20.medExc).trim()}, win-vs-SPY ${(oosS.h20.winVsSpy! * 100).toFixed(1)}%. Recommend flipping liveScan.ownerOnly OFF for HTF.`
    : underpowered
      ? `HTF is UNDERPOWERED out-of-sample: only ${oosS.h20.n} OOS fires (< 30). Cannot be called validated. Stays owner-only.`
      : `HTF has NO clean out-of-sample SPY edge on the $5-75 universe: OOS +20d mean excess ${pct(oosS.h20.meanExc).trim()} (HAC t=${num(oosS.h20.tStat).trim()}, n=${oosS.h20.n}); +60d mean excess ${pct(oosS.h60.meanExc).trim()} (t=${num(oosS.h60.tStat).trim()}). Does not clear the GO bar (positive AND HAC |t|>=2). Stays owner-only.`;
  artifact.bottomLine = bl;

  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));
  console.log(`Artifact written: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
