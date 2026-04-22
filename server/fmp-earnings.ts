/**
 * Phase 3.3: FMP-sourced earnings rows for the /api/earnings-calendar route.
 *
 * Returns the same shape as getPolygonEarningsRow so the UI is unchanged,
 * but uses FMP's /earnings endpoint which provides:
 *   - Real upcoming earnings date (not a +90 day guess)
 *   - Both epsActual AND epsEstimated (Polygon only has actuals)
 *   - Both revenueActual AND revenueEstimated
 *   - Computed surprise % per quarter
 *
 * Yahoo was previously used here (removed in Phase 1/2) — this is the final
 * migration of the earnings calendar away from dual-source.
 */
import { fmpGet } from "./data/providers/fmp.client";

export interface FmpEarningsRow {
  ticker: string;
  companyName: string;
  earningsDate: string | null;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  history: Array<{
    quarter: string;
    actual: number | null;
    estimate: number | null;
    surprise: number | null;
    surprisePct: number | null;
  }>;
}

/**
 * Build an earnings calendar row for a single ticker from FMP data.
 * Returns null if FMP has no coverage for this ticker (micro-caps etc.);
 * caller should fall back to Polygon in that case.
 */
export async function getFmpEarningsRow(ticker: string): Promise<FmpEarningsRow | null> {
  const T = ticker.toUpperCase();
  try {
    // Pull ~12 rows so we have upcoming + historical quarters
    const [earnings, profile] = await Promise.all([
      fmpGet<any[]>(`/earnings`, { symbol: T, limit: 12 }),
      // profile is cheap and gives us company name without needing Polygon
      fmpGet<any[]>(`/profile`, { symbol: T }).catch(() => []),
    ]);

    if (!Array.isArray(earnings) || earnings.length === 0) return null;

    const companyName =
      (Array.isArray(profile) && profile[0]?.companyName) || T;

    // Sort ascending by date so we can find the next upcoming
    const sorted = earnings
      .slice()
      .filter((r) => r.date)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const now = Date.now();
    const upcoming = sorted.find((r) => {
      const t = Date.parse(r.date);
      if (!Number.isFinite(t)) return false;
      // Upcoming = future date, or today/past date with no actual yet
      return t >= now || (r.epsActual == null && r.revenueActual == null);
    });

    const earningsDate = upcoming ? String(upcoming.date).slice(0, 10) : null;
    const epsEstimate =
      upcoming?.epsEstimated != null ? Number(upcoming.epsEstimated) : null;
    const revenueEstimate =
      upcoming?.revenueEstimated != null ? Number(upcoming.revenueEstimated) : null;

    // History: most recent 8 REPORTED quarters (actual != null), oldest→newest
    const reported = sorted.filter(
      (r) => r.epsActual != null || r.revenueActual != null,
    );
    const recent8 = reported.slice(-8);
    const history = recent8.map((r) => {
      const actual = r.epsActual != null ? Number(r.epsActual) : null;
      const estimate = r.epsEstimated != null ? Number(r.epsEstimated) : null;
      let surprise: number | null = null;
      let surprisePct: number | null = null;
      if (actual != null && estimate != null) {
        surprise = Math.round((actual - estimate) * 10000) / 10000;
        if (estimate !== 0) {
          surprisePct =
            Math.round(((actual - estimate) / Math.abs(estimate)) * 10000) / 100;
        }
      }
      // Quarter label — FMP doesn't always include fiscalDateEnding, use date
      const quarter = labelFromDate(r.date);
      return { quarter, actual, estimate, surprise, surprisePct };
    });

    return {
      ticker: T,
      companyName: String(companyName),
      earningsDate,
      epsEstimate,
      revenueEstimate,
      history,
    };
  } catch (_e) {
    return null;
  }
}

function labelFromDate(d: string): string {
  const date = new Date(d);
  if (isNaN(date.getTime())) return String(d);
  const m = date.getUTCMonth() + 1;
  const y = date.getUTCFullYear();
  // Convert calendar month -> fiscal quarter label
  const q = Math.ceil(m / 3);
  return `Q${q} ${y}`;
}
