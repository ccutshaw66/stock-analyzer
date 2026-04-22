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
  institutional_holdings:  [fmpAdapter /*, secEdgarAdapter */, yahooAdapter],
  beta:                    [inHouseAdapter],
  search:                  [polygonAdapter],
  dividends:               [polygonAdapter],
  splits:                  [polygonAdapter],
};

export function providersFor(cap: Capability): DataProvider[] {
  return providerChain[cap] ?? [];
}
