/**
 * Earnings adapter.
 *
 * Provider chain: FMP /earnings (primary) → Polygon (fallback). FMP has the
 * cleanest per-symbol earnings history. Polygon's earnings come bundled with
 * its financials; we prefer FMP for the dedicated endpoint.
 */

import type { CompanyEarnings, EarningsHistoryRow, FieldHealth } from "./types";
import { tryProviders } from "./fallback";
import { fmpGet } from "../data/providers/fmp.client";
import { getPolygonEarningsRow } from "../polygon";

const EARNINGS_TTL_MS = 6 * 60 * 60 * 1000; // 6h

function num(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function getEarningsSnapshot(ticker: string): Promise<FieldHealth<CompanyEarnings>> {
  const T = ticker.toUpperCase();
  return tryProviders<CompanyEarnings>(
    [
      {
        source: "fmp",
        fetch: async () => {
          const rows: any[] = await fmpGet<any[]>(`/earnings`, { symbol: T, limit: 12 });
          if (!Array.isArray(rows) || rows.length === 0) return null;

          const sorted = [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)));
          const next = sorted.find(r => num(r.epsActual) === null) ?? null;

          const history: EarningsHistoryRow[] = sorted
            .filter(r => num(r.epsActual) !== null)
            .slice(0, 8)
            .map(r => ({
              date: r.date,
              fiscalPeriod: r.fiscalPeriod ?? null,
              epsEstimate: num(r.epsEstimated),
              epsActual: num(r.epsActual),
              surprisePct: num(r.surprisePercentage),
            }));

          return {
            nextReportDate: next?.date ?? null,
            isEstimated: !!next,
            history,
          };
        },
      },
      {
        source: "polygon",
        fetch: async () => {
          const row = await getPolygonEarningsRow(T);
          if (!row) return null;
          // Polygon's per-ticker earnings is sparser; map what we can.
          return {
            nextReportDate: (row as any).reportDate ?? null,
            isEstimated: false,
            history: [],
          };
        },
      },
    ],
    {
      ttlMs: EARNINGS_TTL_MS,
      isEmpty: (e) => e.nextReportDate === null && e.history.length === 0,
    },
  );
}
