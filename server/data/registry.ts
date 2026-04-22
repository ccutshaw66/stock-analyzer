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
import { yahooAdapter } from "./providers/yahoo.adapter";
import { inHouseAdapter } from "./providers/in-house.adapter";
// import { secEdgarAdapter } from "./providers/sec-edgar.adapter"; // future
// import { finnhubAdapter } from "./providers/finnhub.adapter";    // future

export const providerChain: Record<Capability, DataProvider[]> = {
  quotes:                  [polygonAdapter, yahooAdapter],
  aggregates:              [polygonAdapter, yahooAdapter],
  options:                 [polygonAdapter],
  financials:              [polygonAdapter, fmpAdapter],
  analyst_ratings:         [fmpAdapter /*, finnhubAdapter */],
  earnings:                [fmpAdapter, polygonAdapter],
  insider_transactions:    [fmpAdapter /*, secEdgarAdapter */, yahooAdapter],
  // NOTE: FMP 13F endpoints are Ultimate-tier only (our Premium plan gets 402).
  // fmpAdapter is removed here until we upgrade, or swap in SEC EDGAR.
  // Yahoo is the current source; the existing screenshot bug (e.g. CAR 147.2%)
  // is handled as part of Phase 3.4 — likely via SEC EDGAR direct rather than
  // an FMP upgrade.
  institutional_holdings:  [yahooAdapter /*, secEdgarAdapter */],
  beta:                    [inHouseAdapter],
  search:                  [polygonAdapter],
  dividends:               [polygonAdapter],
  splits:                  [polygonAdapter],
};

export function providersFor(cap: Capability): DataProvider[] {
  return providerChain[cap] ?? [];
}
