/**
 * Polygon.io adapter — translates Polygon responses into our normalized
 * domain types. No vendor-specific shapes leak out of this file.
 *
 * Plans assumed: Stocks Starter + Options Starter ($58/mo).
 *
 * Strangler-safe: does NOT replace server/polygon.ts. Callers migrate
 * from that file to data/ through the facade over Phase 1.6–1.11.
 */

import { config } from "@platform/config";
import type {
  DataProvider,
  Capability,
  Quote,
  OHLCV,
  OptionsChain,
  OptionsContract,
  FinancialSnapshot,
  Symbol as Sym,
} from "../types";

// ─── HTTP plumbing ──────────────────────────────────────────────────────────

async function pget<T = unknown>(
  path: string,
  query: Record<string, string | number | boolean | undefined> = {}
): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) params.append(k, String(v));
  }
  params.append("apiKey", config.polygon.apiKey);
  const url = `${config.polygon.baseUrl}${path}?${params.toString()}`;

  const resp = await fetch(url);
  if (resp.status === 429) {
    throw new Error("polygon:rate_limited");
  }
  if (resp.status === 401 || resp.status === 403) {
    const body = await resp.text();
    throw new Error(`polygon:unauthorized (${resp.status}): ${body.slice(0, 200)}`);
  }
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`polygon:http_${resp.status}: ${body.slice(0, 200)}`);
  }
  return (await resp.json()) as T;
}

// ─── Type-safe response shapes (local; never exported) ──────────────────────

interface PolySnapshotResp {
  ticker?: {
    day?: { v?: number };
    lastTrade?: { p?: number; t?: number };
    prevDay?: { c?: number };
    todaysChange?: number;
    todaysChangePerc?: number;
    updated?: number;
  };
}

interface PolyAggResp {
  results?: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>;
}

interface PolyOptionsSnapshotResp {
  results?: Array<{
    details?: {
      strike_price?: number;
      expiration_date?: string;
      contract_type?: "call" | "put";
    };
    open_interest?: number;
    day?: { volume?: number; last_updated?: number };
    implied_volatility?: number;
    greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number };
    last_quote?: { bid?: number; ask?: number; last_updated?: number };
    last_trade?: { price?: number; sip_timestamp?: number };
    underlying_asset?: { price?: number };
  }>;
}

interface PolyFinancialsResp {
  results?: Array<{
    end_date?: string;
    fiscal_period?: string;
    fiscal_year?: string;
    financials?: {
      income_statement?: {
        revenues?: { value?: number };
        net_income_loss?: { value?: number };
        basic_earnings_per_share?: { value?: number };
      };
      balance_sheet?: {
        equity?: { value?: number };
        liabilities?: { value?: number };
      };
    };
  }>;
}

interface PolyTickerSearchResp {
  results?: Array<{ ticker?: string; name?: string }>;
}

// ─── Translators ────────────────────────────────────────────────────────────

async function getQuote(symbol: Sym): Promise<Quote> {
  const T = symbol.toUpperCase();
  const json = await pget<PolySnapshotResp>(
    `/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(T)}`
  );
  const t = json.ticker;
  if (!t) throw new Error(`polygon:no_snapshot_for_${T}`);

  const price = t.lastTrade?.p ?? t.prevDay?.c ?? 0;
  const change = t.todaysChange ?? 0;
  const changePct = t.todaysChangePerc ?? 0;
  const volume = t.day?.v ?? 0;
  const asOfNs = t.lastTrade?.t ?? t.updated;
  const asOf = asOfNs ? new Date(Math.floor(asOfNs / 1_000_000)) : new Date();

  return { symbol: T, price, change, changePct, volume, asOf, source: "polygon" };
}

async function getAggregates(
  symbol: Sym,
  from: Date,
  to: Date,
  timespan: "day" | "week" | "month"
): Promise<OHLCV[]> {
  const T = symbol.toUpperCase();
  const f = from.toISOString().slice(0, 10);
  const tt = to.toISOString().slice(0, 10);
  const json = await pget<PolyAggResp>(
    `/v2/aggs/ticker/${encodeURIComponent(T)}/range/1/${timespan}/${f}/${tt}`,
    { adjusted: "true", sort: "asc", limit: 50_000 }
  );
  const rows = json.results ?? [];
  return rows.map((r) => ({
    t: new Date(r.t),
    o: r.o,
    h: r.h,
    l: r.l,
    c: r.c,
    v: r.v,
  }));
}

async function getOptionsChain(symbol: Sym, expiry?: Date): Promise<OptionsChain> {
  const T = symbol.toUpperCase();
  const q: Record<string, string | number> = { limit: 250 };
  if (expiry) q["expiration_date"] = expiry.toISOString().slice(0, 10);

  const json = await pget<PolyOptionsSnapshotResp>(
    `/v3/snapshot/options/${encodeURIComponent(T)}`,
    q
  );
  const rows = json.results ?? [];

  let underlyingPrice = 0;
  const contracts: OptionsContract[] = rows
    .filter((r) => r.details?.strike_price != null && r.details?.expiration_date)
    .map((r) => {
      if (r.underlying_asset?.price) underlyingPrice = r.underlying_asset.price;
      return {
        strike: r.details?.strike_price ?? 0,
        expiry: new Date(`${r.details?.expiration_date}T00:00:00Z`),
        type: (r.details?.contract_type ?? "call") as "call" | "put",
        openInterest: r.open_interest ?? 0,
        volume: r.day?.volume ?? 0,
        iv: r.implied_volatility ?? 0,
        delta: r.greeks?.delta ?? 0,
        gamma: r.greeks?.gamma ?? 0,
        theta: r.greeks?.theta ?? 0,
        vega: r.greeks?.vega ?? 0,
        bid: r.last_quote?.bid ?? 0,
        ask: r.last_quote?.ask ?? 0,
        last: r.last_trade?.price ?? 0,
      };
    });

  return {
    symbol: T,
    asOf: new Date(),
    underlyingPrice,
    contracts,
    source: "polygon",
  };
}

async function getFinancials(symbol: Sym, limit = 8): Promise<FinancialSnapshot[]> {
  const T = symbol.toUpperCase();
  const json = await pget<PolyFinancialsResp>(`/vX/reference/financials`, {
    ticker: T,
    limit,
    order: "desc",
    sort: "filing_date",
  });
  const rows = json.results ?? [];
  return rows.map((r) => {
    const inc = r.financials?.income_statement ?? {};
    const bal = r.financials?.balance_sheet ?? {};
    const revenue = inc.revenues?.value ?? 0;
    const netIncome = inc.net_income_loss?.value ?? 0;
    const eps = inc.basic_earnings_per_share?.value ?? 0;
    const equity = bal.equity?.value;
    const liabilities = bal.liabilities?.value;

    const debtToEquity =
      equity && equity !== 0 && liabilities != null ? liabilities / equity : undefined;
    const roe = equity && equity !== 0 ? netIncome / equity : undefined;

    return {
      symbol: T,
      asOf: r.end_date ? new Date(r.end_date) : new Date(),
      revenue,
      netIncome,
      eps,
      peRatio: undefined, // needs current price — computed upstream
      pbRatio: undefined, // needs current price — computed upstream
      debtToEquity,
      roe,
      source: "polygon",
    };
  });
}

async function searchTickers(
  query: string,
  limit = 10
): Promise<Array<{ symbol: Sym; name: string }>> {
  const json = await pget<PolyTickerSearchResp>(`/v3/reference/tickers`, {
    search: query,
    active: "true",
    market: "stocks",
    limit,
  });
  const rows = json.results ?? [];
  return rows
    .filter((r) => r.ticker && r.name)
    .map((r) => ({ symbol: r.ticker as string, name: r.name as string }));
}

// ─── Provider export ────────────────────────────────────────────────────────

const CAPABILITIES: Capability[] = [
  "quotes",
  "aggregates",
  "options",
  "financials",
  "search",
  "dividends",
  "splits",
];

export const polygonAdapter: DataProvider = {
  name: "polygon",
  capabilities: CAPABILITIES,
  getQuote,
  getAggregates,
  getOptionsChain,
  getFinancials,
  searchTickers,
};
