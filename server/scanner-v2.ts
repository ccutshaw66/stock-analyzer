/**
 * Scanner 2.0 — "Explosion Detector"
 *
 * Finds stocks that are about to make outsized moves (up or down) by combining:
 *   - Technical signals (squeeze, relative volume, breakouts, gaps)
 *   - Catalysts (earnings, insider clusters, analyst actions, options activity, 13F)
 *   - Context (float, direction bias, sector rotation)
 *
 * Each ticker receives:
 *   - Per-signal result (triggered? direction? strength 0-1?)
 *   - Aggregate score (0-100)
 *   - Direction bias ("up" | "down" | "either")
 *   - Top contributing signals (for UI explanation)
 *
 * This file is the SCAFFOLD. Individual signal detectors live in
 * server/scanner-v2-signals/*.ts and are wired in incrementally (3.5.2+).
 */
import { fmpScreener, type FmpScreenerRow } from "./data/providers/fmp.adapter";
import { getPolygonChart } from "./polygon";
import { getCached, setCache } from "./cache";

// ─── Types ──────────────────────────────────────────────────────────────────

export type SignalDirection = "up" | "down" | "either";

export interface SignalResult {
  /** Stable id, e.g. "bb_squeeze", "rel_volume", "earnings_soon" */
  id: string;
  /** Human-readable name for UI */
  label: string;
  /** Did this signal trigger for the ticker? */
  triggered: boolean;
  /** How strongly, 0-1. 0 = just over threshold, 1 = textbook setup. */
  strength: number;
  /** Direction this signal implies */
  direction: SignalDirection;
  /** Short human explanation — "vol 4.2x 20d avg", "BB width at 18-mo low" */
  detail?: string;
}

export type SignalCategory = "technical" | "catalyst" | "context";

export interface ScannerV2Row {
  symbol: string;
  companyName: string;
  sector: string;
  industry: string;
  price: number;
  marketCap: number;
  volume: number;
  /** Aggregate 0-100 score across all signals */
  score: number;
  /** Net direction bias */
  direction: SignalDirection;
  /** Every signal evaluated (triggered or not) so UI can show full matrix */
  signals: SignalResult[];
  /** Ordered list of signal ids that actually fired */
  topSignals: string[];
}

export interface ScannerV2Response {
  scannedAt: string;
  universeSize: number;
  scanDurationMs: number;
  filters: ScannerV2Filters;
  results: ScannerV2Row[];
}

export interface ScannerV2Filters {
  minPrice?: number;
  maxPrice?: number;
  sector?: string;
  minMarketCap?: number;
  maxMarketCap?: number;
  minVolume?: number;
  direction?: SignalDirection;
  minScore?: number;
  count?: number;       // max rows returned
  universeSize?: number; // how many tickers to scan (default 2000)
}

// ─── Signal Registry ────────────────────────────────────────────────────────
/**
 * A signal detector takes a ticker's market data and returns a SignalResult.
 * Each detector is pure and independent — they're evaluated in parallel per
 * ticker. Detectors that need data beyond OHLCV (earnings, insider, options)
 * receive context via the ScanContext object.
 */
export interface ScanContext {
  /** Daily bars, oldest first, at least 252 days for 52w breakouts */
  bars: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>;
  /** Symbol basics from FMP screener row */
  basics: {
    symbol: string;
    price: number;
    marketCap: number;
    volume: number;
    sector: string;
  };
  /** Lazy-loaded extras — populated only for candidates that pass technical gate */
  extras?: {
    nextEarningsDate?: Date;
    insiderCluster?: { buys: number; windowDays: number };
    analystActions?: Array<{ date: Date; direction: "up" | "down" }>;
    shortInterestPct?: number;
    floatShares?: number;
    iv30?: number;
    iv30RankPct?: number;
  };
}

export type SignalDetector = (ctx: ScanContext) => SignalResult | null;

/**
 * Registered detectors. Each 3.5.x PR appends here.
 */
import { bbSqueezeDetector } from "./scanner-v2-signals/bb-squeeze";
import { atrExpansionDetector } from "./scanner-v2-signals/atr-expansion";

const SIGNAL_DETECTORS: SignalDetector[] = [
  bbSqueezeDetector,
  atrExpansionDetector,
];

export function registerDetector(det: SignalDetector): void {
  SIGNAL_DETECTORS.push(det);
}

// ─── Scoring ────────────────────────────────────────────────────────────────
/**
 * Weights are per-signal-id. Unknown ids default to 5 (neutral mid-weight).
 * Tuned later as signals ship. Total weight is normalized to 100.
 */
const SIGNAL_WEIGHTS: Record<string, number> = {
  // technical
  bb_squeeze: 12,
  atr_expansion: 10,
  rel_volume: 10,
  gap_hold: 8,
  breakout_52w: 10,
  // catalysts
  earnings_soon: 10,
  insider_cluster: 10,
  analyst_action: 6,
  unusual_options: 12,
  short_squeeze: 10,
  thirteen_f_cluster: 6,
  // context (these modulate, don't add)
  small_float: 6,
};

function scoreRow(signals: SignalResult[]): { score: number; direction: SignalDirection } {
  let totalWeight = 0;
  let weightedSum = 0;
  let upWeight = 0;
  let downWeight = 0;

  for (const s of signals) {
    if (!s.triggered) continue;
    const w = SIGNAL_WEIGHTS[s.id] ?? 5;
    totalWeight += w;
    weightedSum += w * s.strength;
    if (s.direction === "up") upWeight += w * s.strength;
    else if (s.direction === "down") downWeight += w * s.strength;
  }

  if (totalWeight === 0) return { score: 0, direction: "either" };

  // Normalize to 0-100 assuming max plausible total weight is ~80 (not all fire)
  const rawScore = (weightedSum / 80) * 100;
  const score = Math.min(100, Math.round(rawScore));

  let direction: SignalDirection = "either";
  if (upWeight > 1.5 * downWeight) direction = "up";
  else if (downWeight > 1.5 * upWeight) direction = "down";

  return { score, direction };
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Fetch the scan universe. Uses FMP screener with liquid, US-listed common
 * stocks. Ordered by dollar volume (liquidity) so the first N are the most
 * tradeable names.
 */
async function fetchUniverse(filters: ScannerV2Filters): Promise<FmpScreenerRow[]> {
  const universeSize = Math.min(filters.universeSize ?? 2000, 3000);
  return fmpScreener({
    minPrice: filters.minPrice ?? 3,
    maxPrice: filters.maxPrice ?? 10000,
    sector: filters.sector && filters.sector !== "all" ? filters.sector : undefined,
    minMarketCap: filters.minMarketCap ?? 300_000_000,
    maxMarketCap: filters.maxMarketCap,
    minVolume: filters.minVolume ?? 100_000,
    count: universeSize,
  });
}

/**
 * Load ~180 days of daily bars for a ticker. Cached 30 min (re-use across scans).
 * Returns null if Polygon fails or returns insufficient data.
 */
async function loadBars(symbol: string): Promise<ScanContext["bars"] | null> {
  const cacheKey = `scanner-v2:bars:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const chart = await getPolygonChart(symbol, "1y", "1d");
    const ts: number[] = chart?.timestamp || [];
    const q = chart?.indicators?.quote?.[0] || {};
    const closes = q.close || [];
    const opens = q.open || [];
    const highs = q.high || [];
    const lows = q.low || [];
    const vols = q.volume || [];
    if (ts.length < 150) return null;

    const bars: ScanContext["bars"] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      const o = opens[i];
      const h = highs[i];
      const l = lows[i];
      const v = vols[i];
      if (c == null || o == null || h == null || l == null) continue;
      bars.push({ t: ts[i], o, h, l, c, v: v ?? 0 });
    }
    if (bars.length < 150) return null;
    setCache(cacheKey, bars, 30 * 60 * 1000); // 30 min
    return bars;
  } catch {
    return null;
  }
}

/**
 * Evaluate all registered detectors against a ScanContext. Detectors that
 * return null (insufficient data) are skipped silently. Detectors that throw
 * are logged and treated as "did not fire".
 */
function evaluateSignals(ctx: ScanContext): SignalResult[] {
  const out: SignalResult[] = [];
  for (const det of SIGNAL_DETECTORS) {
    try {
      const r = det(ctx);
      if (r) out.push(r);
    } catch (e: any) {
      // Silently skip — bad data on one ticker shouldn't kill the scan
    }
  }
  return out;
}

/**
 * Run Scanner 2.0 end-to-end. Returns ranked ScannerV2Row[].
 */
export async function runScannerV2(filters: ScannerV2Filters): Promise<ScannerV2Response> {
  const startedAt = Date.now();
  const universe = await fetchUniverse(filters);
  console.log(`[scanner-v2] universe=${universe.length} (requested ${filters.universeSize ?? 2000})`);

  // Load bars in parallel batches so we don't melt Polygon or the event loop.
  // Polygon Starter has no per-second cap but we still throttle to 50 concurrent.
  const BATCH = 50;
  const rows: ScannerV2Row[] = [];
  let processed = 0;
  let withSignals = 0;

  for (let i = 0; i < universe.length; i += BATCH) {
    const slice = universe.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map(async (u) => {
        const bars = await loadBars(u.symbol);
        if (!bars) {
          // Can't evaluate without bars — return row with empty signals/score 0
          return {
            symbol: u.symbol,
            companyName: u.companyName,
            sector: u.sector,
            industry: u.industry,
            price: u.price,
            marketCap: u.marketCap,
            volume: u.volume,
            score: 0,
            direction: "either" as SignalDirection,
            signals: [],
            topSignals: [],
          };
        }

        const ctx: ScanContext = {
          bars,
          basics: {
            symbol: u.symbol,
            price: u.price,
            marketCap: u.marketCap,
            volume: u.volume,
            sector: u.sector,
          },
        };
        const signals = evaluateSignals(ctx);
        const { score, direction } = scoreRow(signals);
        if (signals.some((s) => s.triggered)) withSignals++;

        return {
          symbol: u.symbol,
          companyName: u.companyName,
          sector: u.sector,
          industry: u.industry,
          price: u.price,
          marketCap: u.marketCap,
          volume: u.volume,
          score,
          direction,
          signals,
          topSignals: signals.filter((s) => s.triggered).map((s) => s.id),
        };
      }),
    );
    rows.push(...results);
    processed += slice.length;
    if (processed % 500 === 0 || processed === universe.length) {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      console.log(`[scanner-v2] processed ${processed}/${universe.length} (${withSignals} with triggered signals) [${elapsed}s]`);
    }
  }

  // Apply post-scan filters
  let filtered = rows;
  if (filters.direction && filters.direction !== "either") {
    filtered = filtered.filter((r) => r.direction === filters.direction || r.direction === "either");
  }
  if (filters.minScore != null) {
    filtered = filtered.filter((r) => r.score >= filters.minScore!);
  }

  // Sort: highest score first, tiebreak on dollar volume
  filtered.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.price * b.volume - a.price * a.volume;
  });

  const count = Math.min(filters.count ?? 100, 500);
  const results = filtered.slice(0, count);

  return {
    scannedAt: new Date().toISOString(),
    universeSize: universe.length,
    scanDurationMs: Date.now() - startedAt,
    filters,
    results,
  };
}

// Export internals for testing
export const _internal = { scoreRow, SIGNAL_WEIGHTS, SIGNAL_DETECTORS };
