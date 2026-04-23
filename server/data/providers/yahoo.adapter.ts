/**
 * Yahoo adapter — BUFFER / LAST-RESORT FALLBACK (Phase 3.7).
 *
 * Role: safety net only. All production data paths are Polygon + FMP + EDGAR.
 * Yahoo is invoked only when the primary source fails or cannot cover the
 * requested range (e.g. Polygon Starter caps at ~5y so 10y/25y/max charts
 * fall through to Yahoo). Never use as a primary source.
 *
 * License warning: Yahoo data is not licensed for redistribution in a paid
 * SaaS. Acceptable for buffer use only; must be replaced with a licensed
 * long-range provider before GA.
 */
import type {
  DataProvider,
  Quote,
  OHLCV,
  InsiderTransaction,
  InstitutionalHolding,
  Symbol as Sym,
} from "../types";

// Simple, crumb-free endpoints. Rate limits are aggressive; this adapter is
// fallback-only and caller-side caching handles the bulk of load.
const QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";
const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Safari/605.1.15";

async function yget<T>(url: string): Promise<T> {
  const resp = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (resp.status === 429) throw new Error("yahoo:rate_limited");
  if (resp.status === 401 || resp.status === 403) throw new Error(`yahoo:unauthorized_${resp.status}`);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`yahoo:http_${resp.status}: ${body.slice(0, 200)}`);
  }
  return (await resp.json()) as T;
}

interface YQuoteResp {
  quoteResponse?: {
    result?: Array<{
      symbol?: string;
      regularMarketPrice?: number;
      regularMarketChange?: number;
      regularMarketChangePercent?: number;
      regularMarketVolume?: number;
      regularMarketTime?: number; // seconds
    }>;
  };
}

interface YChartResp {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
  };
}

function tsToInterval(timespan: "day" | "week" | "month"): string {
  if (timespan === "week") return "1wk";
  if (timespan === "month") return "1mo";
  return "1d";
}

export const yahooAdapter: DataProvider = {
  name: "yahoo",
  capabilities: ["quotes", "aggregates", "insider_transactions", "institutional_holdings"],

  async getQuote(symbol: Sym): Promise<Quote> {
    const T = symbol.toUpperCase();
    const url = `${QUOTE_URL}?symbols=${encodeURIComponent(T)}`;
    const json = await yget<YQuoteResp>(url);
    const r = json.quoteResponse?.result?.[0];
    if (!r) throw new Error(`yahoo:no_quote_for_${T}`);
    return {
      symbol: T,
      price: r.regularMarketPrice ?? 0,
      change: r.regularMarketChange ?? 0,
      changePct: r.regularMarketChangePercent ?? 0,
      volume: r.regularMarketVolume ?? 0,
      asOf: r.regularMarketTime ? new Date(r.regularMarketTime * 1000) : new Date(),
      source: "yahoo",
    };
  },

  async getAggregates(symbol: Sym, from: Date, to: Date, timespan): Promise<OHLCV[]> {
    const T = symbol.toUpperCase();
    const period1 = Math.floor(from.getTime() / 1000);
    const period2 = Math.floor(to.getTime() / 1000);
    const interval = tsToInterval(timespan);
    const url =
      `${CHART_URL}/${encodeURIComponent(T)}` +
      `?period1=${period1}&period2=${period2}&interval=${interval}`;
    const json = await yget<YChartResp>(url);
    const result = json.chart?.result?.[0];
    if (!result) throw new Error(`yahoo:no_chart_for_${T}`);
    const ts = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0];
    if (!q) return [];

    const out: OHLCV[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i];
      const h = q.high?.[i];
      const l = q.low?.[i];
      const c = q.close?.[i];
      const v = q.volume?.[i];
      if (o == null || h == null || l == null || c == null || v == null) continue;
      out.push({ t: new Date(ts[i] * 1000), o, h, l, c, v });
    }
    return out;
  },

  async getInsiderTransactions(_symbol: Sym): Promise<InsiderTransaction[]> {
    // Intentionally NotImplemented. FMP owns this capability in Phase 3.
    throw new Error("yahoo:not_implemented:insider_transactions");
  },

  async getInstitutionalHoldings(_symbol: Sym): Promise<InstitutionalHolding[]> {
    // Intentionally NotImplemented. FMP owns this capability in Phase 3.
    throw new Error("yahoo:not_implemented:institutional_holdings");
  },
};
