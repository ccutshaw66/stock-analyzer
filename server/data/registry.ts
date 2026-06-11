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

// Provider status (2026-06-10): legacy free-scrape provider fully removed — no fallback, no kill
// switch. Polygon is retired EXCEPT for options (FMP has no options data).
// Institutional ownership is served by FMP Ultimate via fmp-institutional.ts
// (the request path calls getFmpInstitutional directly; this registry entry is
// the facade fallback). Quotes/aggregates/splits migrated to FMP Ultimate
// (2026-06-10) after parity verification: daily OHLCV closes matched Polygon
// to 0.000%, splits matched exactly, latest-quote price matched the true
// session close (Polygon snapshot lagged one session at the day boundary).
export const providerChain: Record<Capability, DataProvider[]> = {
  quotes:                  [fmpAdapter],                   // FMP (migrated 2026-06-10; parity verified)
  aggregates:              [fmpAdapter],                   // FMP (migrated 2026-06-10; daily OHLCV matched Polygon 0.000%)
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
  // (migrated 2026-05-31). Splits are served FMP-direct via fmp.splits.ts
  // (getReverseSplitSummary). The data facade exposes no dividends/splits
  // method, so these entries are vestigial — they just reflect the true owner.
  dividends:               [polygonAdapter],               // vestigial; served FMP-direct via fmp.dividends.ts
  splits:                  [fmpAdapter],                   // served FMP-direct via fmp.splits.ts (migrated 2026-06-10)
};

export function providersFor(cap: Capability): DataProvider[] {
  return providerChain[cap] ?? [];
}
