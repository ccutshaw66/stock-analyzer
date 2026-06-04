/**
 * Dealer-gamma forward tracker.
 *
 * WHY this exists: dealer gamma positioning (GEX) can only be read from the
 * LIVE options snapshot — Polygon gives us no historical option chains, so
 * there is NO way to backtest whether dealer gamma *leads* price. The only
 * honest path is to start recording it now and measure forward returns later.
 *
 * This collector takes a daily post-close snapshot of GEX / squeeze bias for a
 * sector-balanced basket of liquid big-caps (the names where options depth makes
 * gamma meaningful). After a few weeks we can join each day's reading against
 * forward price moves and validate whether the inferred gamma actually predicts
 * direction/volatility — teed up for the options pivot.
 *
 * Persistence: append-only JSONL under data/gamma-snapshots/ (gitignored, so it
 * survives the deploy's `git reset --hard`, exactly like the long-range disk
 * cache). Forward returns are NOT stored here — they're computed later from
 * price history (getHtfBars), which keeps the daily job dead simple and means
 * the same price source feeds every analysis (one source of truth).
 */
import fs from "fs";
import path from "path";
import { computeMMExposure } from "./mm-exposure";

// Sector-balanced liquid big-caps — ~95 names, deliberately widened from the
// original 28 to ~3.5x the daily name-count so the forward dataset reaches
// statistical power faster (the gamma→forward-vol test needs thousands of
// name-days). All 11 GICS sectors + broad ETFs; tech held to ~16% so it doesn't
// dominate. Every name here has deep, liquid options — that's what makes its GEX
// reading trustworthy.
export const GAMMA_UNIVERSE: ReadonlyArray<string> = [
  // Broad-market ETFs
  "SPY", "QQQ", "IWM", "DIA",
  // Technology
  "AAPL", "MSFT", "NVDA", "AVGO", "AMD", "ORCL", "CRM", "ADBE", "CSCO", "QCOM", "TXN", "MU", "AMAT", "PLTR", "SMCI",
  // Communication Services
  "GOOGL", "META", "NFLX", "DIS", "CMCSA", "T", "VZ", "TMUS",
  // Consumer Discretionary
  "AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "BKNG", "ABNB",
  // Consumer Staples
  "WMT", "COST", "PG", "KO", "PEP", "MO", "PM", "MDLZ",
  // Financials
  "JPM", "BAC", "WFC", "GS", "MS", "C", "SCHW", "AXP", "BLK", "V", "MA", "PYPL", "COIN",
  // Health Care
  "UNH", "LLY", "JNJ", "ABBV", "MRK", "PFE", "TMO", "ABT", "BMY", "AMGN", "GILD", "CVS",
  // Energy
  "XOM", "CVX", "COP", "SLB", "OXY", "MPC",
  // Industrials
  "CAT", "BA", "GE", "HON", "UPS", "RTX", "LMT", "DE", "UBER",
  // Materials
  "LIN", "FCX", "NEM", "NUE",
  // Utilities
  "NEE", "DUK", "SO",
  // Real Estate
  "AMT", "PLD",
  // High options-volume / momentum
  "F", "GM", "BABA", "SOFI",
];

const DIR = path.resolve(process.cwd(), "data", "gamma-snapshots");
const FILE = path.join(DIR, "snapshots.jsonl");

function ensureDir(): void {
  try {
    fs.mkdirSync(DIR, { recursive: true });
  } catch {
    // ignore
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface GammaSnapshotRow {
  takenDate: string; // YYYY-MM-DD (UTC) for easy date filtering
  takenAt: string;   // ISO timestamp
  ticker: string;
  spot: number | null;
  totalGEX: number;       // dealer dollar-gamma per 1% move
  totalDEX: number;       // dealer net delta (shares)
  putCallOI: number;
  putCallVolume: number;
  squeezeBias: "up" | "down" | "neutral";
  squeezeStrength: number; // 0..1
  gammaWall: number | null;
  atmIV: number | null;    // nearest-the-money implied vol (the price of vol)
}

/** Tickers already recorded for `dateStr` — used to avoid double-snapshotting
 *  the same name twice in one day if the job re-fires. */
function seenForDate(dateStr: string): Set<string> {
  const seen = new Set<string>();
  try {
    if (!fs.existsSync(FILE)) return seen;
    const raw = fs.readFileSync(FILE, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as GammaSnapshotRow;
        if (row.takenDate === dateStr) seen.add(row.ticker.toUpperCase());
      } catch {
        // skip a corrupt line
      }
    }
  } catch {
    // ignore
  }
  return seen;
}

/** Daily post-close snapshot of dealer gamma for the tracked big-cap universe.
 *  Appends one JSONL row per ticker. Idempotent within a calendar day. */
export async function snapshotGammaForUniverse(): Promise<{
  written: number;
  skipped: number;
  errors: number;
}> {
  ensureDir();
  const now = new Date();
  const dateStr = ymd(now);
  const seen = seenForDate(dateStr);
  let written = 0, skipped = 0, errors = 0;

  for (const t of GAMMA_UNIVERSE) {
    const T = t.toUpperCase();
    if (seen.has(T)) { skipped++; continue; }
    try {
      const mm = await computeMMExposure(T);
      if (!mm) { errors++; continue; }
      const row: GammaSnapshotRow = {
        takenDate: dateStr,
        takenAt: now.toISOString(),
        ticker: T,
        spot: mm.spot,
        totalGEX: mm.totalGEX,
        totalDEX: mm.totalDEX,
        putCallOI: mm.putCallOI,
        putCallVolume: mm.putCallVolume,
        squeezeBias: mm.squeezeBias,
        squeezeStrength: mm.squeezeStrength,
        gammaWall: mm.gammaWall,
        atmIV: mm.atmIV,
      };
      fs.appendFileSync(FILE, JSON.stringify(row) + "\n");
      written++;
    } catch (e: any) {
      console.error(`[gamma-tracker] ${T}: ${String(e?.message || e).slice(0, 160)}`);
      errors++;
    }
    // Gentle on the Polygon options endpoint — one name at a time. With ~95
    // names this paces the run to a few minutes (well within the 30-min cron).
    await new Promise(r => setTimeout(r, 250));
  }

  return { written, skipped, errors };
}

/** Read every recorded snapshot (for later forward-return analysis). */
export function readAllGammaSnapshots(): GammaSnapshotRow[] {
  const out: GammaSnapshotRow[] = [];
  try {
    if (!fs.existsSync(FILE)) return out;
    const raw = fs.readFileSync(FILE, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line) as GammaSnapshotRow); } catch { /* skip */ }
    }
  } catch {
    // ignore
  }
  return out;
}
