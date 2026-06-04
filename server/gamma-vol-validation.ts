/**
 * Gamma → forward-volatility validation harness (STAGED — runs when data accrues).
 *
 * Tests the load-bearing hypothesis under the whole dealer-gamma options program:
 *   Does NEGATIVE dealer gamma (GEX) predict HIGHER forward realized volatility
 *   on big-caps?  (Literature says yes — dealers short gamma hedge pro-cyclically
 *   and amplify realized vol; positive gamma dampens it.)
 *
 * Reads the EOD GEX snapshots accumulated by gamma-tracker.ts and joins each
 * against forward realized vol computed from FMP price history (getHtfBars).
 * Strictly point-in-time: the signal at day t is paired only with the FORWARD
 * window t+1..t+N, so there's no look-ahead.
 *
 *   Run:  npx tsx server/gamma-vol-validation.ts
 *
 * Self-guards: prints "INSUFFICIENT DATA" until enough complete observations
 * accrue (the collector needs ~weeks). This is the cheap, $0, leakage-free test
 * that decides whether the program has a foundation before anyone buys data or
 * risks size.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { readAllGammaSnapshots } from "./gamma-tracker";
import { getHtfBars } from "./data/htf-ohlcv-cache";

const FWD_DAYS = 10;    // forward realized-vol window (trading days)
const PRIOR_DAYS = 10;  // prior window, for the scale-free vol-expansion ratio
const MIN_OBS = 150;    // need this many complete obs before a verdict

function realizedVol(closes: number[]): number | null {
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++)
    if (closes[i] > 0 && closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  if (rets.length < 2) return null;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) * (b - m), 0) / (rets.length - 1);
  return Math.sqrt(v) * Math.sqrt(252); // annualized
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 4) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx <= 0 || syy <= 0 ? null : sxy / Math.sqrt(sxx * syy);
}
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

(async () => {
  const snaps = readAllGammaSnapshots();
  console.log(`[gamma-vol] ${snaps.length} raw snapshots on disk`);
  if (snaps.length === 0) { console.log("No snapshots yet — the collector cron needs to run a few sessions."); return; }

  const byTicker = new Map<string, typeof snaps>();
  for (const s of snaps) {
    const k = s.ticker.toUpperCase();
    (byTicker.get(k) ?? byTicker.set(k, []).get(k)!).push(s);
  }

  type Obs = { ticker: string; gex: number; fwdRV: number; priorRV: number };
  const obs: Obs[] = [];
  for (const [ticker, list] of byTicker) {
    let bars;
    try { bars = await getHtfBars(ticker, { lookbackDays: 1200 }); } catch { continue; }
    if (!bars || bars.length < 30) continue;
    const idxByDate = new Map<string, number>();
    bars.forEach((b, i) => idxByDate.set(b.t.toISOString().slice(0, 10), i));
    for (const s of list) {
      const idx = idxByDate.get(s.takenDate);
      if (idx === undefined || idx + FWD_DAYS >= bars.length || idx - PRIOR_DAYS < 0) continue;
      const fwdRV = realizedVol(bars.slice(idx, idx + FWD_DAYS + 1).map(b => b.c));
      const priorRV = realizedVol(bars.slice(idx - PRIOR_DAYS, idx + 1).map(b => b.c));
      if (fwdRV === null || priorRV === null || priorRV <= 0) continue;
      obs.push({ ticker, gex: s.totalGEX, fwdRV, priorRV });
    }
  }

  console.log(`[gamma-vol] ${obs.length} complete observations (need >= ${MIN_OBS} for a verdict)`);
  if (obs.length < MIN_OBS) {
    console.log(`>>> INSUFFICIENT DATA — keep collecting. The forward window only completes ${FWD_DAYS} trading days after each snapshot.`);
    return;
  }

  // within-ticker z-scores so per-name scale (SPY GEX >> small name) doesn't dominate
  const zGex: number[] = [], zFwd: number[] = [];
  for (const [ticker] of byTicker) {
    const g = obs.filter(o => o.ticker === ticker);
    if (g.length < 5) continue;
    const mg = mean(g.map(o => o.gex)), mf = mean(g.map(o => o.fwdRV));
    const sg = Math.sqrt(mean(g.map(o => (o.gex - mg) ** 2))) || 1;
    const sf = Math.sqrt(mean(g.map(o => (o.fwdRV - mf) ** 2))) || 1;
    for (const o of g) { zGex.push((o.gex - mg) / sg); zFwd.push((o.fwdRV - mf) / sf); }
  }
  const corr = pearson(zGex, zFwd);

  // sign cut: vol-expansion ratio (fwdRV/priorRV) for negative vs positive GEX
  const negExp = obs.filter(o => o.gex < 0).map(o => o.fwdRV / o.priorRV);
  const posExp = obs.filter(o => o.gex >= 0).map(o => o.fwdRV / o.priorRV);

  // hypothesis: more-negative GEX -> higher fwd RV  =>  corr(GEX, fwdRV) < 0,
  // and neg-GEX days expand vol more than pos-GEX days.
  const supported = corr !== null && corr < -0.05 && mean(negExp) > mean(posExp);
  const verdict = {
    nObs: obs.length, nTickers: byTicker.size,
    corr_GEX_fwdRV: corr,
    meanFwdExpansion_negGEX: mean(negExp), nNeg: negExp.length,
    meanFwdExpansion_posGEX: mean(posExp), nPos: posExp.length,
    hypothesis: "negative GEX -> higher forward realized vol",
    supported,
    note: "Cheap point-in-time pulse check. NOT a full validation — no straddle P&L, no decay, no deflated-Sharpe yet. A pulse here justifies the paid-data backtest; no pulse means stop.",
  };
  console.log("\n=== GAMMA -> FORWARD-VOL VERDICT ===");
  console.log(JSON.stringify(verdict, null, 2));
  console.log(supported
    ? "\n>>> PULSE DETECTED — negative gamma is tracking higher forward vol. Justifies the next step (paid-data straddle backtest)."
    : "\n>>> NO PULSE (yet) — signal not separating forward vol on this sample. Do not advance to paid data.");

  try {
    const outDir = path.resolve(process.cwd(), "data", "gamma-snapshots");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "gamma_vol_validation.json"), JSON.stringify(verdict, null, 2));
    console.log("\nwrote data/gamma-snapshots/gamma_vol_validation.json");
  } catch { /* ignore */ }
})();
