/**
 * FMP stock-split data → reverse-split summary.
 *
 * Why this exists: the app charts and compares SPLIT-ADJUSTED prices. For a
 * stock that has done large reverse splits, the adjusted history can show an
 * absurd figure (e.g. WATT "$1,680 five years ago" when it actually traded
 * around $2.80 — the gap is two reverse splits: 1-for-20 in 2023 and 1-for-30
 * in 2025 = a cumulative 600-to-1). Surfacing the cumulative reverse-split
 * factor lets the UI badge these names so a split-adjusted number isn't
 * mistaken for a former blue-chip that collapsed.
 *
 * Splits change at most once or twice a year, so the underlying /splits fetch
 * is cached 7d in fmp.client (see TTL_BY_PREFIX).
 */
import { fmpGet } from "./fmp.client";

/** One split event as returned by FMP's stable /splits endpoint. */
interface FmpSplit {
  symbol: string;
  date: string;        // YYYY-MM-DD
  numerator: number;   // e.g. 1-for-20 reverse split → numerator 1, denominator 20
  denominator: number;
}

export interface ReverseSplitSummary {
  ticker: string;
  /** Human label, e.g. "600:1" — cumulative shares-consolidated ratio. */
  ratio: string;
  /** Cumulative reverse factor (product of denominator/numerator for reverse splits). */
  cumulativeFactor: number;
  /** Earliest reverse-split date in the considered window (YYYY-MM-DD). */
  sinceDate: string;
  /** Number of reverse splits counted. */
  splitCount: number;
  /** The individual reverse splits, newest first, each as a label + date. */
  splits: Array<{ date: string; ratio: string }>;
}

interface Options {
  /** Only count reverse splits on/after this many years ago. Default 6 (covers 5y views). */
  lookbackYears?: number;
  /** Minimum cumulative factor before a summary is returned. Default 2 (i.e. ≥2:1). */
  minFactor?: number;
  /** "today" as YYYY-MM-DD — injected so this stays pure/testable. Defaults to now. */
  asOf?: string;
}

/** Round a cumulative factor to a clean "N:1" label (e.g. 600:1, 19.5:1). */
function ratioLabel(factor: number): string {
  const rounded = factor >= 10 ? Math.round(factor) : Math.round(factor * 10) / 10;
  return `${rounded}:1`;
}

/**
 * Returns the cumulative reverse-split summary for a ticker, or null when the
 * ticker has no qualifying reverse splits (forward splits like AAPL's 4-for-1
 * are intentionally ignored — they're normal and not a warning).
 */
export async function getReverseSplitSummary(
  symbol: string,
  opts: Options = {},
): Promise<ReverseSplitSummary | null> {
  const ticker = symbol.trim().toUpperCase();
  if (!ticker) return null;

  const lookbackYears = opts.lookbackYears ?? 6;
  const minFactor = opts.minFactor ?? 2;

  let rows: FmpSplit[];
  try {
    rows = await fmpGet<FmpSplit[]>("/splits", { symbol: ticker, limit: 50 });
  } catch {
    // Splits are a nice-to-have signal — never let a fetch failure break the
    // caller (the badge just won't render).
    return null;
  }
  if (!Array.isArray(rows) || rows.length === 0) return null;

  // Cutoff date for the lookback window. asOf defaults to today; we only need
  // the year math, so subtract lookbackYears from the year component.
  const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10);
  const cutoffYear = parseInt(asOf.slice(0, 4), 10) - lookbackYears;
  const cutoff = `${cutoffYear}${asOf.slice(4)}`; // same MM-DD, N years back

  // A reverse split consolidates shares: denominator > numerator
  // (1-for-20 → num 1, den 20). Its price-comparison factor is den/num.
  const reverse = rows
    .filter((r) => r && r.numerator > 0 && r.denominator > r.numerator)
    .filter((r) => r.date >= cutoff)
    .sort((a, b) => b.date.localeCompare(a.date)); // newest first

  if (reverse.length === 0) return null;

  const cumulativeFactor = reverse.reduce((acc, r) => acc * (r.denominator / r.numerator), 1);
  if (cumulativeFactor < minFactor) return null;

  const sinceDate = reverse[reverse.length - 1].date; // earliest in window

  return {
    ticker,
    ratio: ratioLabel(cumulativeFactor),
    cumulativeFactor,
    sinceDate,
    splitCount: reverse.length,
    splits: reverse.map((r) => ({
      date: r.date,
      ratio: `${r.denominator}:${r.numerator}`,
    })),
  };
}
