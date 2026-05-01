/**
 * Company profile adapter.
 *
 * Provider chain: FMP (primary) → Polygon (fallback) → EDGAR (last resort).
 *
 * FMP /profile is the cleanest source — single call returns CIK, CUSIP,
 * sector, industry, exchange, IPO date, employees, description, website.
 * Polygon's /v3/reference/tickers/{T} is a decent fallback. EDGAR only
 * gives us CIK + company title (no sector / industry), so it's a last resort.
 */

import type { CompanyProfile, FieldHealth } from "./types";
import { tryProviders } from "./fallback";
import { fmpGet } from "../data/providers/fmp.client";
import { tickerToCik } from "../data/providers/edgar.adapter";
import { pget } from "../polygon";

const PROFILE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — profile data rarely changes

function num(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function getProfileSnapshot(ticker: string): Promise<FieldHealth<CompanyProfile>> {
  const T = ticker.toUpperCase();
  return tryProviders<CompanyProfile>(
    [
      {
        source: "fmp",
        fetch: async () => {
          const rows: any = await fmpGet<any[]>(`/profile`, { symbol: T });
          const r = Array.isArray(rows) ? rows[0] : rows;
          if (!r) return null;
          return {
            cik: r.cik ? String(r.cik).padStart(10, "0") : null,
            cusip: r.cusip ?? null,
            sector: r.sector ?? null,
            industry: r.industry ?? null,
            exchange: r.exchangeShortName ?? r.exchange ?? null,
            description: r.description ?? null,
            ipoDate: r.ipoDate ?? null,
            employees: num(r.fullTimeEmployees),
            website: r.website ?? null,
          };
        },
      },
      {
        source: "polygon",
        fetch: async () => {
          const data = await pget(`/v3/reference/tickers/${encodeURIComponent(T)}`);
          const r = data?.results;
          if (!r) return null;
          return {
            cik: r.cik ? String(r.cik).padStart(10, "0") : null,
            cusip: r.cusip ?? null,
            sector: r.sic_description ?? null,    // Polygon uses SIC; close enough for fallback
            industry: null,
            exchange: r.primary_exchange ?? null,
            description: r.description ?? null,
            ipoDate: r.list_date ?? null,
            employees: num(r.total_employees),
            website: r.homepage_url ?? null,
          };
        },
      },
      {
        source: "edgar",
        fetch: async () => {
          const lookup = await tickerToCik(T);
          if (!lookup) return null;
          return {
            cik: lookup.cik,
            cusip: null,
            sector: null,
            industry: null,
            exchange: null,
            description: lookup.title,
            ipoDate: null,
            employees: null,
            website: null,
          };
        },
      },
    ],
    {
      ttlMs: PROFILE_TTL_MS,
      isEmpty: (p) => !p.cik && !p.sector && !p.exchange && !p.description,
    },
  );
}
