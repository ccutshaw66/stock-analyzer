/**
 * Pure math + helpers for the Dividend Calculator compartment.
 *
 * No React, no fetch, no I/O — every value here is derivable from inputs.
 * Mirrors the `wheelLogic` shape: logic file separate from the hook so
 * tests can run on pure functions and future surfaces (e.g. an alert
 * preview, a dashboard widget) can reuse the math without pulling the
 * UI tree.
 */

export interface DividendData {
  // The dividend endpoint returns `ticker` (not `symbol`). Both are kept
  // optional so a future provider migration that flips the field name
  // doesn't break this type at the seam.
  ticker?: string;
  symbol?: string;
  companyName?: string;
  dividendYield: number;
  dividendRate: number;
  frequency: string;
  exDividendDate?: string | null;
  distributionDate?: string | null;
  payoutRatio?: number;
  fiveYearAvgYield?: number | null;
  lastDividendValue?: number | null;
  lastDividendDate?: string | null;
  score?: number;
}

export interface ComputedNumbers {
  perYear: number;
  perSharePerDistribution: number;
  perDistribution: number;
  yearly: number;
}

export function payoutsPerYear(frequency: string): number {
  switch (frequency) {
    case "Monthly":     return 12;
    case "Quarterly":   return 4;
    case "Semi-Annual": return 2;
    case "Annual":      return 1;
    default:            return 4;
  }
}

export function computeNumbers(data: DividendData | undefined, shares: number): ComputedNumbers | null {
  if (!data || data.dividendRate <= 0 || shares <= 0) return null;
  const perYear = payoutsPerYear(data.frequency);
  const perSharePerDistribution = data.dividendRate / perYear;
  const perDistribution = perSharePerDistribution * shares;
  const yearly = data.dividendRate * shares;
  return { perYear, perSharePerDistribution, perDistribution, yearly };
}

// ─── Token-aligned color helpers ──────────────────────────────────────────────

export function yieldColor(y: number): string {
  return y > 3 ? "text-bull-light" : y >= 1 ? "text-watch-light" : "text-bear-light";
}
export function scoreColor(s: number): string {
  return s >= 60 ? "text-bull-light" : s >= 35 ? "text-watch-light" : "text-bear-light";
}
export function payoutColor(p: number): string {
  return p >= 20 && p <= 60 ? "text-bull-light" : p > 60 && p <= 80 ? "text-watch-light" : "text-bear-light";
}
