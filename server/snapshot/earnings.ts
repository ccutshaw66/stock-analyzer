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

/**
 * Per-position earnings aggregator for the dashboard Action Queue.
 *
 * Takes a list of held tickers, fans out to `getEarningsSnapshot` in parallel,
 * and returns the subset whose next report falls within `withinDays`. Reuses
 * the per-ticker 6h cache so a 20-ticker fan-out costs ~0 wall time on a
 * warm cache.
 *
 * The Bennet vol-crush rule (memory/reference_trading_library_findings.md
 * §Bennet) blocks debit option entries within 14 days of earnings; the
 * Morning Brief surfaces upcoming earnings in the next 2 trading days as
 * action items. Caller decides the window.
 */
export async function getEarningsForPositions(
  tickers: string[],
  withinDays: number,
): Promise<Array<{ symbol: string; nextReportDate: string; daysUntil: number }>> {
  if (tickers.length === 0) return [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + withinDays);

  const results = await Promise.all(
    tickers.map(async (t) => {
      try {
        const snap = await getEarningsSnapshot(t);
        const dateStr = snap.value?.nextReportDate;
        if (!dateStr) return null;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        if (d < today || d > cutoff) return null;
        const daysUntil = Math.ceil((d.getTime() - today.getTime()) / 86400000);
        return { symbol: t.toUpperCase(), nextReportDate: dateStr, daysUntil };
      } catch {
        return null;
      }
    }),
  );
  return results.filter((r): r is { symbol: string; nextReportDate: string; daysUntil: number } => r !== null);
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
