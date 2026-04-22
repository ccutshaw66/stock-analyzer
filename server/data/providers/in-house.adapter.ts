/**
 * In-house computed data.
 *
 * Implements capabilities we compute from other providers rather than buying.
 * Currently: beta (vs SPY, computed from Polygon aggregates).
 */
import type { DataProvider, BetaValue, Symbol } from "../types";
// import { data } from "../index"; // can compose other providers

export const inHouseAdapter: DataProvider = {
  name: "in_house",
  capabilities: ["beta"],

  async getBeta(symbol: Symbol): Promise<BetaValue> {
    // TODO:
    //   1. fetch 5y weekly aggregates for symbol and SPY
    //   2. compute weekly returns
    //   3. beta = cov(sym, spy) / var(spy)
    //   4. return { symbol, beta, lookbackYears: 5, benchmark: "SPY", ... }
    throw new Error("NotImplemented: inHouse.getBeta");
  },
} as DataProvider & { getBeta(symbol: Symbol): Promise<BetaValue> };
