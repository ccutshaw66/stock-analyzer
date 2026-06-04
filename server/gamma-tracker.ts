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

// Sector-balanced liquid big-caps. All 11 GICS sectors + broad-market ETFs, with
// tech deliberately capped at 3 names so it doesn't dominate the basket. Every
// name here has deep, liquid options, which is what makes its GEX reading
// trustworthy.
export const GAMMA_UNIVERSE: ReadonlyArray<string> = [
  // Broad-market ETFs
  "SPY", "QQQ", "IWM",
  // Technology
  "NVDA", "AAPL", "MSFT",
  // Communication Services
  "GOOGL", "META", "NFLX",
  // Consumer Discretionary
  "AMZN", "TSLA", "HD",
  // Consumer Staples
  "WMT", "COST", "KO",
  // Financials
  "JPM", "BAC", "GS",
  // Health Care
  "UNH", "LLY", "JNJ",
  // Energy
  "XOM", "CVX",
  // Industrials
  "CAT", "BA",
  // Materials
  "FCX",
  // Utilities
  "NEE",
  // Real Estate
  "AMT",
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
      };
      fs.appendFileSync(FILE, JSON.stringify(row) + "\n");
      written++;
    } catch (e: any) {
      console.error(`[gamma-tracker] ${T}: ${String(e?.message || e).slice(0, 160)}`);
      errors++;
    }
    // Gentle on the Polygon options endpoint — one name at a time.
    await new Promise(r => setTimeout(r, 200));
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
