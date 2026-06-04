/**
 * Gamma-vol PAPER trader — a DETERMINISTIC rules engine (paper only, no broker).
 *
 * "No emotion, no hesitation, just play by the rules." Replays the accumulated
 * EOD gamma snapshots and simulates the two regime trades the quant proposed:
 *   - SHORT vol (Combo B): positive GEX (dealers long gamma, vol-suppressed) +
 *       HIGH IV-rank (vol is rich) -> SELL vol.
 *   - LONG vol  (Combo A): negative GEX (dealers short gamma, vol-amplified) +
 *       LOW IV-rank (vol is cheap / compressed)      -> BUY vol.
 *   - anything else -> no trade.
 *
 * P&L is a variance / vol-points proxy: a short-vol trade WINS iff realized vol
 * over the holding window comes in BELOW the implied vol sold at entry (reverse
 * for long vol). That is the honest core of the edge — realized vs implied,
 * conditioned on the dealer-gamma regime. It is NOT exact option fills (no
 * bid/ask, no specific strike/structure); a pulse here justifies a real,
 * paid-data options backtest, not live capital.
 *
 * Point-in-time / no look-ahead: IV-rank uses ONLY the ticker's past snapshots;
 * trade P&L uses ONLY the forward price window. Stateless — recomputes the whole
 * paper track record from history every run, so it's fully reproducible.
 *
 *   Run:  npx tsx server/gamma-paper-trader.ts
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { readAllGammaSnapshots, GammaSnapshotRow } from "./gamma-tracker";
import { getHtfBars } from "./data/htf-ohlcv-cache";

const HOLD_DAYS = 10;            // holding window (trading days)
const IV_RANK_MIN_HISTORY = 8;  // need this many past IV obs to rank
const SHORT_IVR = 0.55;         // sell vol only when IV-rank >= this (vol is rich)
const LONG_IVR = 0.45;          // buy vol only when IV-rank <= this (vol is cheap)
const MIN_TRADES = 40;          // closed trades needed before a verdict
const DOLLAR_PER_VOLPT = 100;   // notional scale: $100 per 1 vol-point of edge

function realizedVol(closes: number[]): number | null {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++)
    if (closes[i] > 0 && closes[i - 1] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  if (r.length < 2) return null;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) * (b - m), 0) / (r.length - 1);
  return Math.sqrt(v) * Math.sqrt(252);
}

interface Trade { date: string; ticker: string; side: "SHORT" | "LONG"; entryIV: number; rv: number; pnlVolPts: number; pnl$: number; }

(async () => {
  const snaps = readAllGammaSnapshots().filter(s => s.atmIV && s.atmIV > 0);
  console.log(`[paper] ${snaps.length} snapshots with IV`);
  if (snaps.length === 0) { console.log("No IV-bearing snapshots yet — collector needs to run after the atmIV change ships."); return; }

  const byTicker = new Map<string, GammaSnapshotRow[]>();
  for (const s of snaps) (byTicker.get(s.ticker.toUpperCase()) ?? byTicker.set(s.ticker.toUpperCase(), []).get(s.ticker.toUpperCase())!).push(s);

  const trades: Trade[] = [];
  for (const [ticker, list] of byTicker) {
    list.sort((a, b) => a.takenDate.localeCompare(b.takenDate));
    let bars;
    try { bars = await getHtfBars(ticker, { lookbackDays: 1200 }); } catch { continue; }
    if (!bars || bars.length < 30) continue;
    const idxByDate = new Map<string, number>();
    bars.forEach((b, i) => idxByDate.set(b.t.toISOString().slice(0, 10), i));

    const ivHist: number[] = []; // past IVs for this ticker (point-in-time)
    for (const s of list) {
      const iv = s.atmIV as number;
      // rank uses ONLY prior history (before adding today's)
      if (ivHist.length >= IV_RANK_MIN_HISTORY) {
        const ivRank = ivHist.filter(x => x <= iv).length / ivHist.length;
        let side: "SHORT" | "LONG" | null = null;
        if (s.totalGEX > 0 && ivRank >= SHORT_IVR) side = "SHORT";
        else if (s.totalGEX < 0 && ivRank <= LONG_IVR) side = "LONG";
        if (side) {
          const idx = idxByDate.get(s.takenDate);
          if (idx !== undefined && idx + HOLD_DAYS < bars.length) {
            const rv = realizedVol(bars.slice(idx, idx + HOLD_DAYS + 1).map(b => b.c));
            if (rv !== null) {
              const pnlVolPts = side === "SHORT" ? (iv - rv) : (rv - iv);
              trades.push({ date: s.takenDate, ticker, side, entryIV: iv, rv, pnlVolPts, pnl$: pnlVolPts * 100 * DOLLAR_PER_VOLPT });
            }
          }
        }
      }
      ivHist.push(iv);
    }
  }

  trades.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`[paper] ${trades.length} closed paper trades (need >= ${MIN_TRADES} for a verdict)`);
  if (trades.length < MIN_TRADES) {
    console.log(">>> INSUFFICIENT TRADES — keep collecting. IV-rank needs history per name, and each trade needs its forward window to close.");
    return;
  }

  const stat = (ts: Trade[]) => {
    const n = ts.length;
    const wins = ts.filter(t => t.pnlVolPts > 0).length;
    const mean = ts.reduce((a, b) => a + b.pnlVolPts, 0) / n;
    const sd = Math.sqrt(ts.reduce((a, b) => a + (b.pnlVolPts - mean) ** 2, 0) / Math.max(n - 1, 1)) || 1e-9;
    const total$ = ts.reduce((a, b) => a + b.pnl$, 0);
    return { n, winRate: wins / n, meanVolPts: mean, sharpe: mean / sd, total$ };
  };
  // equity curve + max drawdown ($), trades in date order
  let eq = 0, peak = 0, maxDD = 0;
  for (const t of trades) { eq += t.pnl$; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq - peak); }

  const all = stat(trades), shorts = stat(trades.filter(t => t.side === "SHORT")), longs = stat(trades.filter(t => t.side === "LONG"));
  const consistent = all.winRate >= 0.55 && all.sharpe > 0.15 && all.total$ > 0;
  const verdict = {
    nTrades: all.n, nShort: shorts.n, nLong: longs.n,
    winRate_all: +all.winRate.toFixed(3), winRate_short: +shorts.winRate.toFixed(3), winRate_long: +longs.winRate.toFixed(3),
    meanEdge_volPts_all: +all.meanVolPts.toFixed(4), perTradeSharpe: +all.sharpe.toFixed(3),
    total_$: Math.round(all.total$), maxDrawdown_$: Math.round(maxDD),
    rules: `HOLD ${HOLD_DAYS}d | SHORT vol if GEX>0 & IVrank>=${SHORT_IVR} | LONG vol if GEX<0 & IVrank<=${LONG_IVR}`,
    consistent,
    note: "Variance/vol-points P&L proxy, paper only, no broker, no bid/ask. Honest core of the edge, not a tradeable backtest. Pulse here -> real paid-data options backtest; no pulse -> drop it.",
  };
  console.log("\n=== PAPER-TRADER TRACK RECORD (deterministic, rules-only) ===");
  console.log(JSON.stringify(verdict, null, 2));
  console.log(consistent
    ? "\n>>> CONSISTENT so far — the rules are net-positive with a positive edge. Justifies a real options backtest."
    : "\n>>> NOT consistent (yet) — rules not clearing the bar on this sample. Keep collecting / do not advance.");

  try {
    const outDir = path.resolve(process.cwd(), "data", "gamma-snapshots");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "gamma_paper_trades.json"), JSON.stringify({ verdict, trades }, null, 2));
    console.log("\nwrote data/gamma-snapshots/gamma_paper_trades.json");
  } catch { /* ignore */ }
})();
