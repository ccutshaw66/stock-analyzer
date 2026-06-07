/**
 * BBTC trend-exit EMA SWEEP — find the SWEET-SPOT exit EMA for a BBTC trend-ride.
 *
 * Read-only. No production changes. Run: npx tsx server/diag/bbtc-ema-sweep.ts
 *
 * Question: the live BBTC exit (EMA9<EMA21 & close<EMA50, plus ATR trail) clips
 * trends. The "ride100" variant (quality entry, exit on a single close < EMA100,
 * 2.5xATR catastrophe stop, NO ATR trail) rides longer. The owner wants the
 * ROBUST PLATEAU exit-EMA, not the single overfit peak — and a "significant"
 * break (not one poke below).
 *
 * METHOD (entry held CONSTANT across the whole sweep):
 *   1. For each name, fetch ONCE (~7y daily).
 *   2. Get BBTC's validated long entries via computeBBTC (BUY/LONG bars) — these
 *      are entry-eligible bars. Holding entry constant means any entry-replica
 *      nuance hits every EMA period equally and CANNOT bias which EMA wins.
 *   3. Sweep exit-EMA period P = 100..200 step 1 IN MEMORY (no refetch).
 *   4. Catastrophe stop = entryClose - 2.5 x entryATR14 (entry-bar ATR). No trail.
 *   5. Significance variants (the owner's "not just one poke"):
 *        - "2-consec"  : exit when >=2 CONSECUTIVE closes below the EMA.
 *        - "atr-margin": exit when a single close is below the EMA by >=1.0xATR.
 *   6. Candle variants: {regular, Heikin-Ashi}. HA: trend line = EMA(haClose,P),
 *      break tested on haClose. So 4 sweep curves = {reg,HA} x {2-consec,atr-margin}.
 *
 * METRICS per (variant,P), split IS / OOS (65/35 calendar split on entry date):
 *   OOS total $ P&L ($1000/trade additive), OOS avg SPY-excess/trade, trades per
 *   name per year, avg hold days, win rate. Same for IS for IS/OOS agreement.
 *
 * CAVEATS (loud, on purpose):
 *   - SURVIVORSHIP: universe is screened on TODAY'S $5-75 band → today's winners.
 *     Absolute $ are optimistic; SPY-excess + IS/OOS agreement are the real signal.
 *   - MULTIPLE TESTING: sweeping 100 periods x 4 variants inflates the best IS
 *     number. The argmax is overfit by construction. The PLATEAU (a contiguous
 *     band where OOS stays near max AND IS/OOS agree in sign) is the evidence.
 */
import "dotenv/config";
import { fmpGet } from "../data/providers/fmp.client";
import { computeBBTC } from "../signals/strategies/bbtc";
import { getHtfUniverse } from "../signals/universe/htf-universe";
import { RSI_PERIOD, ATR_PERIOD, EMA_FAST, EMA_MID, EMA_SLOW } from "@shared/indicators/constants";

// ─── Indicator helpers (copied from bbtc-exit-variants.ts) ────────────────
function computeEMA(d: number[], p: number): number[] { const o = new Array(d.length).fill(NaN); if (d.length < p) return o; let s = 0; for (let i = 0; i < p; i++) s += d[i]; o[p - 1] = s / p; const k = 2 / (p + 1); for (let i = p; i < d.length; i++) o[i] = d[i] * k + o[i - 1] * (1 - k); return o; }
function computeATR(h: number[], l: number[], c: number[], p: number): number[] { const tr = new Array(c.length).fill(NaN); for (let i = 1; i < c.length; i++) tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])); const a = new Array(c.length).fill(NaN); if (c.length <= p) return a; let s = 0; for (let i = 1; i <= p; i++) s += tr[i]; a[p] = s / p; for (let i = p + 1; i < c.length; i++) a[i] = (a[i - 1] * (p - 1) + tr[i]) / p; return a; }
function computeRSI(c: number[], p: number): number[] { const r = new Array(c.length).fill(NaN); if (c.length <= p) return r; let g = 0, l = 0; for (let i = 1; i <= p; i++) { const ch = c[i] - c[i - 1]; if (ch > 0) g += ch; else l -= ch; } let ag = g / p, al = l / p; r[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); for (let i = p + 1; i < c.length; i++) { const ch = c[i] - c[i - 1]; ag = (ag * (p - 1) + (ch > 0 ? ch : 0)) / p; al = (al * (p - 1) + (ch < 0 ? -ch : 0)) / p; r[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } return r; }

interface Bars { date: string[]; open: number[]; high: number[]; low: number[]; close: number[]; }
async function fetchBars(symbol: string, days: number): Promise<Bars | null> {
  try {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - (days + 250) * 864e5).toISOString().slice(0, 10);
    const data: any = await fmpGet("/historical-price-eod/full", { symbol, from, to });
    const arr: any[] = Array.isArray(data) ? data : (data?.historical || []);
    if (arr.length < 120) return null;
    const s = [...arr].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const o: Bars = { date: [], open: [], high: [], low: [], close: [] };
    for (const r of s) { const c = Number(r.close); if (!Number.isFinite(c)) continue; o.date.push(String(r.date)); o.open.push(Number(r.open)); o.high.push(Number(r.high)); o.low.push(Number(r.low)); o.close.push(c); }
    return o;
  } catch { return null; }
}

// ─── Heikin-Ashi candles ──────────────────────────────────────────────────
// haClose = (o+h+l+c)/4 ; haOpen = prev(haOpen+haClose)/2 (seed = (o+c)/2) ;
// haHigh = max(h, haOpen, haClose) ; haLow = min(l, haOpen, haClose).
function heikinAshi(b: Bars): Bars {
  const n = b.close.length;
  const haO = new Array(n), haH = new Array(n), haL = new Array(n), haC = new Array(n);
  for (let i = 0; i < n; i++) {
    haC[i] = (b.open[i] + b.high[i] + b.low[i] + b.close[i]) / 4;
    haO[i] = i === 0 ? (b.open[i] + b.close[i]) / 2 : (haO[i - 1] + haC[i - 1]) / 2;
    haH[i] = Math.max(b.high[i], haO[i], haC[i]);
    haL[i] = Math.min(b.low[i], haO[i], haC[i]);
  }
  return { date: b.date, open: haO, high: haH, low: haL, close: haC };
}

const DAYS = 2555; // ~7y
const POS = 1000;
const P_MIN = 100, P_MAX = 200;

interface Trip { entryDate: string; exitDate: string; ret: number; holdDays: number; }

// Per-name precomputed inputs so the sweep runs purely in memory.
interface NameData {
  symbol: string;
  bars: Bars;          // regular candles (real prices — entry/exit/PnL use REAL closes)
  ha: Bars;            // heikin-ashi candles
  atr: number[];       // real-candle ATR14 (used for catastrophe stop + atr-margin)
  haAtr: number[];     // ha-candle ATR14 (atr-margin in HA space uses HA ATR)
  entryBars: number[]; // bar indices where BBTC fires a fresh LONG entry
  years: number;
}

type Sig = "2-consec" | "atr-margin";
type Candle = "reg" | "ha";

async function prepName(symbol: string): Promise<NameData | null> {
  const bars = await fetchBars(symbol, DAYS);
  if (!bars) return null;
  const years = (new Date(bars.date[bars.date.length - 1]).getTime() - new Date(bars.date[0]).getTime()) / (365.25 * 864e5);
  const rsi = computeRSI(bars.close, RSI_PERIOD);
  const ema9 = computeEMA(bars.close, EMA_FAST), ema21 = computeEMA(bars.close, EMA_MID), ema50 = computeEMA(bars.close, EMA_SLOW);
  const atr = computeATR(bars.high, bars.low, bars.close, ATR_PERIOD);
  // BBTC validated long entries (held CONSTANT for the whole sweep).
  const bbtc = computeBBTC({ closes: bars.close, highs: bars.high, lows: bars.low, ema9, ema21, ema50, atr14: atr, rsi14: rsi });
  const entryBars: number[] = [];
  for (let i = 0; i < bars.close.length; i++) {
    if (bbtc.signals[i] === "BUY" && bbtc.signalSides[i] === "LONG") entryBars.push(i);
  }
  const ha = heikinAshi(bars);
  const haAtr = computeATR(ha.high, ha.low, ha.close, ATR_PERIOD);
  return { symbol, bars, ha, atr, haAtr, entryBars, years };
}

/**
 * Simulate one (candle, sig, P) for one name, given precomputed EMA(trend-source,P).
 * Entry-eligible bars = BBTC fresh-LONG bars. We open at the FIRST entry bar that
 * is currently flat, ride to a "significant" break of the trend line or the
 * catastrophe stop, then become eligible to re-enter on the next entry bar.
 *
 * Entry/exit FILLS + PnL always use REAL closes (b.close). The trend line + the
 * break test live in the chosen candle space (regular price, or HA price).
 */
function simulate(nd: NameData, candle: Candle, sig: Sig, trendEma: number[]): Trip[] {
  const b = nd.bars;                               // real prices for fills/PnL
  const space = candle === "ha" ? nd.ha : nd.bars; // candle space for break test
  const spaceClose = space.close;
  const breakAtr = candle === "ha" ? nd.haAtr : nd.atr; // ATR in the break-test space
  const realAtr = nd.atr;                          // catastrophe stop uses REAL ATR
  const n = b.close.length;
  const entrySet = new Set(nd.entryBars);
  const trips: Trip[] = [];
  let open: { px: number; bar: number; date: string; hardStop: number } | null = null;
  let consec = 0; // consecutive closes below the trend line (for 2-consec rule)

  for (let i = 0; i < n; i++) {
    if (open) {
      // Catastrophe stop on REAL low vs entry-based hard stop.
      const stopped = b.low[i] <= open.hardStop;
      // Trend-line break test in the candle space.
      let broke = false;
      const e = trendEma[i];
      if (!isNaN(e)) {
        if (sig === "2-consec") {
          if (spaceClose[i] < e) { consec++; } else { consec = 0; }
          broke = consec >= 2;
        } else { // atr-margin: single close below the EMA by >= 1.0 x ATR
          const a = breakAtr[i];
          broke = !isNaN(a) && spaceClose[i] < e - 1.0 * a;
        }
      }
      if (stopped || broke) {
        const px = stopped ? Math.min(b.close[i], open.hardStop) : b.close[i];
        trips.push({ entryDate: open.date, exitDate: b.date[i], ret: (px - open.px) / open.px, holdDays: i - open.bar });
        open = null; consec = 0;
      }
    }
    if (!open && entrySet.has(i)) {
      const a = realAtr[i];
      open = { px: b.close[i], bar: i, date: b.date[i], hardStop: b.close[i] - 2.5 * (isNaN(a) ? 0 : a) };
      consec = 0; // reset the consecutive-below counter at every fresh entry
    }
  }
  return trips;
}

// ─── SPY ──────────────────────────────────────────────────────────────────
interface Spy { dates: string[]; closes: number[]; }
async function loadSpy(): Promise<Spy | null> { const b = await fetchBars("SPY", DAYS); return b ? { dates: b.date, closes: b.close } : null; }
function spyRet(spy: Spy, from: string, to: string): number | null { const ei = spy.dates.findIndex(d => d >= from); let xi = -1; for (let i = spy.dates.length - 1; i >= 0; i--) if (spy.dates[i] <= to) { xi = i; break; } if (ei < 0 || xi < 0 || xi <= ei) return null; return (spy.closes[xi] - spy.closes[ei]) / spy.closes[ei]; }

const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

interface Stat { trades: number; totalPnL: number; avgExc: number; avgHold: number; winPct: number; }
function stat(trips: Trip[], spy: Spy): Stat {
  if (!trips.length) return { trades: 0, totalPnL: 0, avgExc: NaN, avgHold: NaN, winPct: NaN };
  const rets = trips.map(t => t.ret);
  const wins = rets.filter(r => r > 0).length;
  const totalPnL = sum(rets) * POS;
  const exc = trips.map(t => { const sr = spyRet(spy, t.entryDate, t.exitDate); return sr == null ? null : t.ret - sr; }).filter((v): v is number => v != null);
  return { trades: trips.length, totalPnL, avgExc: avg(exc) * 100, avgHold: avg(trips.map(t => t.holdDays)), winPct: wins / rets.length * 100 };
}

async function main() {
  console.log("=== BBTC TREND-EXIT EMA SWEEP (P=100..200) — OOS, SPY-relative ===\n");
  console.log("CAVEATS: (1) SURVIVORSHIP — universe screened on TODAY'S $5-75 band, so");
  console.log("absolute $ skew optimistic; trust SPY-excess + IS/OOS agreement, not the $.");
  console.log("(2) MULTIPLE TESTING — 100 periods x 4 variants inflates the best IS number;");
  console.log("the argmax is overfit by construction. The PLATEAU is the real evidence.\n");

  const uni = await getHtfUniverse();
  const sampled = [...uni.tickers].sort((a, b) => (b.volume - a.volume) || a.symbol.localeCompare(b.symbol)).slice(0, 100).map(t => t.symbol);
  const spy = await loadSpy(); if (!spy) { console.error("no SPY"); process.exit(1); }
  console.log(`Universe ${uni.tickers.length} → top ${sampled.length} by volume. $${POS}/trade additive. ~7y daily.\n`);

  // Fetch + prep every name ONCE.
  const names: NameData[] = [];
  const BATCH = 12;
  for (let i = 0; i < sampled.length; i += BATCH) {
    const slice = sampled.slice(i, i + BATCH);
    const res = await Promise.allSettled(slice.map(s => prepName(s)));
    for (const r of res) if (r.status === "fulfilled" && r.value) names.push(r.value);
    if (i + BATCH < sampled.length) await new Promise(r => setTimeout(r, 150));
    process.stdout.write(`  prepped ${Math.min(i + BATCH, sampled.length)}/${sampled.length}\r`);
  }
  console.log("");
  const totalYears = sum(names.map(n => n.years));
  console.log(`Prepped ${names.length} names with data. Total name-years: ${totalYears.toFixed(0)}.\n`);

  // Date span + 65/35 calendar split (computed from ALL entry dates, candle-agnostic).
  const allEntryDates: string[] = [];
  for (const nd of names) for (const i of nd.entryBars) allEntryDates.push(nd.bars.date[i]);
  allEntryDates.sort();
  const dMin = allEntryDates[0], dMax = allEntryDates[allEntryDates.length - 1];
  const splitDate = new Date(new Date(dMin).getTime() + (new Date(dMax).getTime() - new Date(dMin).getTime()) * 0.65).toISOString().slice(0, 10);
  const spyOOS = spyRet(spy, splitDate, dMax);
  console.log(`Entry span ${dMin} -> ${dMax}. OOS split ${splitDate} (65/35 calendar).`);
  console.log(`SPY buy&hold over OOS window: ${spyOOS != null ? (spyOOS * 100).toFixed(1) + "%" : "n/a"}\n`);

  // Precompute the trend-line EMA(source, P) for every name x candle x P ONCE,
  // so the 4 variants reuse them. Keyed cache per name.
  // For each name: emaReg[P] = EMA(close,P), emaHA[P] = EMA(haClose,P).
  const variants: { candle: Candle; sig: Sig; label: string }[] = [
    { candle: "reg", sig: "2-consec", label: "regular x 2-consecutive" },
    { candle: "reg", sig: "atr-margin", label: "regular x ATR-margin" },
    { candle: "ha", sig: "2-consec", label: "Heikin-Ashi x 2-consecutive" },
    { candle: "ha", sig: "atr-margin", label: "Heikin-Ashi x ATR-margin" },
  ];

  // Run the sweep. For each name we compute EMA(source,P) once per P and feed it
  // to whichever variants share that candle source.
  // Results keyed by variant index → P → {IS Trip[], OOS Trip[]}.
  type Bucket = { is: Trip[]; oos: Trip[] };
  const out: Bucket[][] = variants.map(() => { const arr: Bucket[] = []; for (let p = P_MIN; p <= P_MAX; p++) arr[p - P_MIN] = { is: [], oos: [] }; return arr; });

  for (const nd of names) {
    for (let P = P_MIN; P <= P_MAX; P++) {
      const emaReg = computeEMA(nd.bars.close, P);
      const emaHA = computeEMA(nd.ha.close, P);
      for (let v = 0; v < variants.length; v++) {
        const { candle, sig } = variants[v];
        const trendEma = candle === "ha" ? emaHA : emaReg;
        const trips = simulate(nd, candle, sig, trendEma);
        const bucket = out[v][P - P_MIN];
        for (const t of trips) (t.entryDate <= splitDate ? bucket.is : bucket.oos).push(t);
      }
    }
  }

  // ─── Report each variant's curve + argmax + plateau ─────────────────────
  const fmt$ = (x: number) => "$" + Math.round(x).toLocaleString();
  const fmtPct = (x: number) => (Number.isFinite(x) ? (x >= 0 ? "+" : "") + x.toFixed(1) + "%" : "n/a");
  const pad = (s: any, w: number) => String(s).padStart(w);

  interface VarSummary { label: string; argmaxP: number; argmaxOOS: number; plateauLo: number; plateauHi: number; plateauCenter: number; oosAtMax: Stat; oosAtCenter: Stat; climbsAt200: boolean; }
  const summaries: VarSummary[] = [];

  for (let v = 0; v < variants.length; v++) {
    const label = variants[v].label;
    console.log("\n" + "=".repeat(78));
    console.log(`VARIANT: ${label}`);
    console.log("=".repeat(78));
    console.log("  " + "P".padStart(4) + pad("OOS_total$", 13) + pad("OOS_SPYexc", 11) + pad("OOS_trd", 8) + pad("trd/nm/yr", 11) + pad("avgHold", 9) + pad("win%", 7) + pad("IS_total$", 13) + pad("IS_SPYexc", 11) + "  agree");
    console.log("  " + "-".repeat(98));

    // Compute per-P stats.
    const perP: { P: number; oos: Stat; is: Stat }[] = [];
    for (let P = P_MIN; P <= P_MAX; P++) {
      const bk = out[v][P - P_MIN];
      perP.push({ P, oos: stat(bk.oos, spy), is: stat(bk.is, spy) });
    }
    // argmax by OOS total $.
    let argmax = perP[0];
    for (const r of perP) if (r.oos.totalPnL > argmax.oos.totalPnL) argmax = r;
    const maxOOS = argmax.oos.totalPnL;

    // Print every ~5 periods + the exact argmax.
    const tnYr = totalYears;
    const printRow = (r: { P: number; oos: Stat; is: Stat }, mark: string) => {
      const agree = (Number.isFinite(r.is.avgExc) && Number.isFinite(r.oos.avgExc) && Math.sign(r.is.avgExc) === Math.sign(r.oos.avgExc) && r.oos.totalPnL > 0 && r.is.totalPnL > 0) ? "yes" : "no";
      console.log("  " + pad(r.P + mark, 4) + pad(fmt$(r.oos.totalPnL), 13) + pad(fmtPct(r.oos.avgExc), 11) + pad(r.oos.trades, 8) + pad((r.oos.trades / (tnYr * 0.35)).toFixed(1), 11) + pad(Number.isFinite(r.oos.avgHold) ? r.oos.avgHold.toFixed(0) : "n/a", 9) + pad(Number.isFinite(r.oos.winPct) ? r.oos.winPct.toFixed(0) + "%" : "n/a", 7) + pad(fmt$(r.is.totalPnL), 13) + pad(fmtPct(r.is.avgExc), 11) + "  " + agree);
    };
    for (const r of perP) {
      if ((r.P - P_MIN) % 5 === 0) printRow(r, "");
    }
    if ((argmax.P - P_MIN) % 5 !== 0) printRow(argmax, "*");
    console.log(`  (* = exact OOS argmax; trd/nm/yr uses OOS window = 35% of ${totalYears.toFixed(0)} name-years)`);

    // Plateau: contiguous band around argmax where OOS total$ >= 90% of max AND
    // IS & OOS agree (both totalPnL>0 and same-sign SPYexc).
    const near = (r: { oos: Stat; is: Stat }) => r.oos.totalPnL >= 0.90 * maxOOS && r.oos.totalPnL > 0 && r.is.totalPnL > 0 && Number.isFinite(r.oos.avgExc) && Number.isFinite(r.is.avgExc) && Math.sign(r.oos.avgExc) === Math.sign(r.is.avgExc) && r.oos.avgExc > 0;
    const ai = argmax.P - P_MIN;
    let lo = ai, hi = ai;
    if (near(perP[ai])) {
      while (lo - 1 >= 0 && near(perP[lo - 1])) lo--;
      while (hi + 1 < perP.length && near(perP[hi + 1])) hi++;
    } else {
      // argmax itself fails the agreement filter → find the longest qualifying run.
      let bestLo = -1, bestHi = -1, curLo = -1;
      for (let k = 0; k < perP.length; k++) {
        if (near(perP[k])) { if (curLo < 0) curLo = k; if (k - curLo > bestHi - bestLo) { bestLo = curLo; bestHi = k; } }
        else curLo = -1;
      }
      lo = bestLo; hi = bestHi;
    }
    const plateauLo = lo >= 0 ? perP[lo].P : NaN;
    const plateauHi = hi >= 0 ? perP[hi].P : NaN;
    const plateauCenter = lo >= 0 ? Math.round((perP[lo].P + perP[hi].P) / 2) : NaN;
    const centerRow = Number.isFinite(plateauCenter) ? perP[plateauCenter - P_MIN] : argmax;

    console.log(`\n  ARGMAX P = ${argmax.P}  (OOS ${fmt$(argmax.oos.totalPnL)}, SPYexc ${fmtPct(argmax.oos.avgExc)}) — OVERFIT, do not trust alone.`);
    if (Number.isFinite(plateauLo)) {
      console.log(`  ROBUST PLATEAU P = ${plateauLo}..${plateauHi}  (OOS within 10% of max AND IS/OOS agree, both SPYexc>0).`);
      console.log(`  PLATEAU CENTER (sweet spot) P = ${plateauCenter}:  OOS ${fmt$(centerRow.oos.totalPnL)}, SPYexc ${fmtPct(centerRow.oos.avgExc)}, ${(centerRow.oos.trades / (totalYears * 0.35)).toFixed(1)} trd/nm/yr, ${centerRow.oos.avgHold.toFixed(0)}d hold, win ${centerRow.oos.winPct.toFixed(0)}%.`);
    } else {
      console.log(`  ROBUST PLATEAU: NONE — no contiguous band clears both the 10%-of-max and IS/OOS-agreement filters. NO-GO for this variant.`);
    }
    const climbsAt200 = perP[perP.length - 1].oos.totalPnL >= 0.95 * maxOOS;
    console.log(`  Still climbing at P=200? ${climbsAt200 ? "YES — optimum near the boundary; extend the sweep beyond 200." : "no — curve peaks/rolls over before 200."}`);

    summaries.push({ label, argmaxP: argmax.P, argmaxOOS: argmax.oos.totalPnL, plateauLo, plateauHi, plateauCenter, oosAtMax: argmax.oos, oosAtCenter: centerRow.oos, climbsAt200 });
  }

  // ─── Cross-variant verdict ──────────────────────────────────────────────
  console.log("\n" + "=".repeat(78));
  console.log("CROSS-VARIANT SUMMARY");
  console.log("=".repeat(78));
  console.log("  " + "variant".padEnd(30) + pad("argmaxP", 9) + pad("plateau", 12) + pad("center", 8) + pad("centerOOS$", 13) + pad("SPYexc", 9) + pad("@200?", 7));
  console.log("  " + "-".repeat(96));
  for (const s of summaries) {
    console.log("  " + s.label.padEnd(30) + pad(s.argmaxP, 9) + pad(Number.isFinite(s.plateauLo) ? `${s.plateauLo}-${s.plateauHi}` : "none", 12) + pad(Number.isFinite(s.plateauCenter) ? s.plateauCenter : "n/a", 8) + pad(fmt$(s.oosAtCenter.totalPnL), 13) + pad(fmtPct(s.oosAtCenter.avgExc), 9) + pad(s.climbsAt200 ? "yes" : "no", 7));
  }

  // HA vs regular, 2-consec vs atr-margin (compare plateau-center OOS $).
  const reg2 = summaries[0], regA = summaries[1], ha2 = summaries[2], haA = summaries[3];
  const haBeatsReg = (ha2.oosAtCenter.totalPnL + haA.oosAtCenter.totalPnL) > (reg2.oosAtCenter.totalPnL + regA.oosAtCenter.totalPnL);
  const consecBeatsAtr = (reg2.oosAtCenter.totalPnL + ha2.oosAtCenter.totalPnL) > (regA.oosAtCenter.totalPnL + haA.oosAtCenter.totalPnL);
  console.log("");
  console.log(`  HA vs regular (sum of plateau-center OOS$): ${haBeatsReg ? "HA wins" : "regular wins"}.`);
  console.log(`  2-consecutive vs ATR-margin (sum of plateau-center OOS$): ${consecBeatsAtr ? "2-consecutive wins" : "ATR-margin wins"}.`);

  // Best variant = highest plateau-center OOS $ among those WITH a plateau.
  const withPlateau = summaries.filter(s => Number.isFinite(s.plateauCenter));
  const best = (withPlateau.length ? withPlateau : summaries).reduce((a, b) => b.oosAtCenter.totalPnL > a.oosAtCenter.totalPnL ? b : a);
  console.log("\n  RECOMMENDED SWEET SPOT:");
  console.log(`    ${best.label}, EMA period = ${Number.isFinite(best.plateauCenter) ? best.plateauCenter : best.argmaxP} (plateau center).`);
  console.log(`    OOS ${fmt$(best.oosAtCenter.totalPnL)}, SPYexc ${fmtPct(best.oosAtCenter.avgExc)}, ${(best.oosAtCenter.trades / (totalYears * 0.35)).toFixed(1)} trd/nm/yr, ${best.oosAtCenter.avgHold.toFixed(0)}d avg hold, win ${best.oosAtCenter.winPct.toFixed(0)}%.`);
  console.log(`    Reference — current live BBTC OOS ~ +$41,322, +2.6% SPYexc, 4.1 trd/nm/yr, 14d holds.`);
  console.log(`    Reference — simple ride100 OOS ~ +$39,285, +4.7% SPYexc, 2.2 trd/nm/yr, 32d holds.`);
  console.log("\n  NOTE: argmax alone is overfit; trust the plateau center + IS/OOS agreement.\n");
}
main().catch(e => { console.error(e); process.exit(1); });
