/**
 * Provider registry.
 * Declares which provider is primary/fallback for each capability.
 *
 * The facade walks this list in order; first adapter that doesn't throw wins.
 * Swap FMP -> Finnhub by editing one array.
 */
import type { Capability, DataProvider } from "./types";

import { polygonAdapter } from "./providers/polygon.adapter";
import { fmpAdapter } from "./providers/fmp.adapter";
import { inHouseAdapter } from "./providers/in-house.adapter";
// import { secEdgarAdapter } from "./providers/sec-edgar.adapter"; // future
// import { finnhubAdapter } from "./providers/finnhub.adapter";    // future

// Provider status (2026-06-10): Yahoo fully removed — no fallback, no kill
// switch. Polygon is retired EXCEPT for options (FMP has no options data).
// Institutional ownership is served by FMP Ultimate via fmp-institutional.ts
// (the request path calls getFmpInstitutional directly; this registry entry is
// the facade fallback). The core quotes/aggregates migration to FMP is deferred
// to its own dedicated job, so Polygon stays primary there.
export const providerChain: Record<Capability, DataProvider[]> = {
  quotes:                  [polygonAdapter],               // DEFERRED: core quote migration to FMP is its own job
  aggregates:              [polygonAdapter],               // DEFERRED: core chart migration to FMP is its own job
  options:                 [polygonAdapter],               // RETAINED on Polygon — FMP has no options data
  financials:              [fmpAdapter],                   // FMP-only (Polygon fallback dropped 2026-05-31)
  analyst_ratings:         [fmpAdapter /*, finnhubAdapter */],
  earnings:                [fmpAdapter],                   // FMP-only (Polygon fallback dropped 2026-05-31)
  insider_transactions:    [fmpAdapter /*, secEdgarAdapter */],
  // FMP Ultimate serves 13F institutional ownership (see fmp-institutional.ts).
  institutional_holdings:  [fmpAdapter /*, secEdgarAdapter */],
  beta:                    [inHouseAdapter],
  // FMP owns search (kill-Polygon directive 2026-05-27). `/search-symbol` +
  // `/search-name` get fanned out by fmp.adapter; the /api/search route
  // applies local symbol/name ranking on top.
  search:                  [fmpAdapter],
  // Dividends are served FMP-direct via server/data/providers/fmp.dividends.ts
  // (migrated 2026-05-31). The data facade exposes no dividends/splits method,
  // so these entries are vestigial; left pointing at Polygon for reference only.
  dividends:               [polygonAdapter],
  splits:                  [polygonAdapter],
};

export function providersFor(cap: Capability): DataProvider[] {
  return providerChain[cap] ?? [];
}
