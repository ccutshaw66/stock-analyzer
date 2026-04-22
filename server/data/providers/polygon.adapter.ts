/**
 * Polygon adapter.
 *
 * Endpoints used (from coverage matrix):
 *   /v3/snapshot/locale/us/markets/stocks/tickers/{sym}   -> getQuote
 *   /v2/aggs/ticker/{sym}/range/{m}/{ts}/{from}/{to}       -> getAggregates
 *   /v2/aggs/grouped/locale/us/market/stocks/{date}        -> scanner (via features)
 *   /v3/snapshot/options/{sym}                             -> getOptionsChain (requires Options Starter - ACTIVE)
 *   /v3/reference/tickers                                  -> searchTickers
 *   /vX/reference/financials                               -> getFinancials + earnings fundamentals
 *
 * Auth: config.polygonApiKey loaded from env. Never hardcode the key.
 */
import type {
  DataProvider,
  Quote,
  OHLCV,
  OptionsChain,
  FinancialSnapshot,
  Symbol,
} from "../types";
// import { config } from "../../platform/config";

export const polygonAdapter: DataProvider = {
  name: "polygon",
  capabilities: ["quotes", "aggregates", "options", "financials", "search", "dividends", "splits"],

  async getQuote(symbol: Symbol): Promise<Quote> {
    // TODO: call /v3/snapshot/locale/us/markets/stocks/tickers/{symbol}
    throw new Error("NotImplemented: polygon.getQuote");
  },

  async getAggregates(symbol: Symbol, from: Date, to: Date, timespan): Promise<OHLCV[]> {
    // TODO: call /v2/aggs/ticker/{symbol}/range/1/{timespan}/{from}/{to}
    throw new Error("NotImplemented: polygon.getAggregates");
  },

  async getOptionsChain(symbol: Symbol): Promise<OptionsChain> {
    // TODO: call /v3/snapshot/options/{symbol}
    // Options Starter ACTIVE as of 2026-04-21 -> no NOT_AUTHORIZED
    throw new Error("NotImplemented: polygon.getOptionsChain");
  },

  async getFinancials(symbol: Symbol, limit = 8): Promise<FinancialSnapshot[]> {
    // TODO: call /vX/reference/financials?ticker={symbol}&limit={limit}
    throw new Error("NotImplemented: polygon.getFinancials");
  },

  async searchTickers(query: string, limit = 10) {
    // TODO: call /v3/reference/tickers?search={query}&limit={limit}
    throw new Error("NotImplemented: polygon.searchTickers");
  },
};
