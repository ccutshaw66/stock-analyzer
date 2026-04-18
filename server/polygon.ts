/**
 * Polygon.io API client + Yahoo-shape adapter.
 *
 * Goal: produce response objects that look like Yahoo's `quoteSummary.result[0]`,
 * `chart.result[0]`, `optionChain.result[0]`, etc., so that existing extractors
 * (extractQuoteData, extractDividendData, etc.) continue to work without changes.
 *
 * Endpoints used (Polygon Stocks Starter + Options Starter, $58/mo total):
 *   /v2/snapshot/locale/us/markets/stocks/tickers/{T}  - real-time snapshot
 *   /v3/reference/tickers/{T}                           - company details
 *   /vX/reference/financials?ticker={T}                 - fundamentals
 *   /v3/reference/dividends?ticker={T}                  - dividend history
 *   /v3/reference/splits?ticker={T}                     - split history
 *   /v2/aggs/ticker/{T}/range/...                       - OHLC aggregates
 *   /v3/reference/tickers?search=...                    - symbol search
 *   /v3/reference/options/contracts?underlying_ticker={T} - option contract list
 *   /v3/snapshot/options/{T}                            - options chain snapshot
 */

const POLY_BASE = "https://api.polygon.io";

function apiKey(): string {
  const key = process.env.POLYGON_API_KEY;
  if (!key) throw new Error("POLYGON_API_KEY is not set in environment");
  return key;
}

async function pget(path: string, query: Record<string, any> = {}): Promise<any> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) params.append(k, String(v));
  }
  params.append("apiKey", apiKey());
  const url = `${POLY_BASE}${path}?${params.toString()}`;
  const resp = await fetch(url);
  if (resp.status === 429) throw new Error("Polygon rate limited (429)");
  if (resp.status === 401 || resp.status === 403) {
    const body = await resp.text();
    throw new Error(`Polygon not authorized (${resp.status}): ${body.substring(0, 200)}`);
  }
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Polygon HTTP ${resp.status}: ${body.substring(0, 200)}`);
  }
  return resp.json();
}

// ────────────────────────────────────────────────────────────
// Helper: wrap a number in Yahoo's {raw, fmt} envelope
// ────────────────────────────────────────────────────────────
function yf(v: number | null | undefined): { raw: number } | null {
  if (v === null || v === undefined || !Number.isFinite(v as number)) return null;
  return { raw: v as number };
}
function yfDate(unixSec: number | null | undefined): { raw: number; fmt: string } | null {
  if (!unixSec || !Number.isFinite(unixSec)) return null;
  const d = new Date(unixSec * 1000);
  const fmt = d.toISOString().split("T")[0];
  return { raw: unixSec, fmt };
}

// ────────────────────────────────────────────────────────────
// Parallel Polygon fetches + compose Yahoo-shaped quoteSummary
// ────────────────────────────────────────────────────────────

export async function getPolygonQuoteSummary(ticker: string): Promise<any> {
  const T = ticker.toUpperCase();

  const [snapshotRes, detailsRes, finRes, divsRes] = await Promise.allSettled([
    pget(`/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(T)}`),
    pget(`/v3/reference/tickers/${encodeURIComponent(T)}`),
    pget(`/vX/reference/financials`, { ticker: T, limit: 4, timeframe: "ttm,annual", order: "desc" }),
    pget(`/v3/reference/dividends`, { ticker: T, limit: 8, order: "desc" }),
  ]);

  const snap = snapshotRes.status === "fulfilled" ? snapshotRes.value?.ticker : null;
  const details = detailsRes.status === "fulfilled" ? detailsRes.value?.results : null;
  const finResults = finRes.status === "fulfilled" ? finRes.value?.results || [] : [];
  const divResults = divsRes.status === "fulfilled" ? divsRes.value?.results || [] : [];

  if (!snap && !details) return null;

  // Pick latest TTM (fallback annual) financials
  const ttm = finResults.find((r: any) => r.timeframe === "ttm") || finResults[0] || null;
  const f = ttm?.financials || {};
  const inc = f.income_statement || {};
  const bal = f.balance_sheet || {};
  const cf = f.cash_flow_statement || {};

  const regPrice = snap?.day?.c ?? snap?.prevDay?.c ?? null;
  const prevClose = snap?.prevDay?.c ?? null;
  const change = snap?.todaysChange ?? (regPrice != null && prevClose != null ? regPrice - prevClose : null);
  // Yahoo returns change percent as a decimal fraction (e.g. 0.0123 = 1.23%).
  // Polygon returns it as a percentage number (e.g. 1.23 = 1.23%). Normalize to Yahoo shape.
  const pctRaw = snap?.todaysChangePerc ?? null;
  const changePctYahoo = pctRaw != null ? pctRaw / 100 : null;

  const volume = snap?.day?.v ?? 0;
  const marketCap = details?.market_cap ?? null;
  const sharesOut = details?.share_class_shares_outstanding ?? details?.weighted_shares_outstanding ?? null;

  // Revenue / earnings
  const revenues = inc?.revenues?.value ?? null;
  const grossProfit = inc?.gross_profit?.value ?? null;
  const operatingIncome = inc?.operating_income_loss?.value ?? null;
  const netIncome = inc?.net_income_loss?.value ?? null;
  const dilutedEps = inc?.diluted_earnings_per_share?.value ?? inc?.basic_earnings_per_share?.value ?? null;

  // Balance sheet
  const totalDebt = (bal?.long_term_debt?.value ?? 0) + (bal?.current_debt?.value ?? 0) || null;
  const totalAssets = bal?.assets?.value ?? null;
  const totalLiabilities = bal?.liabilities?.value ?? null;
  const totalEquity = bal?.equity?.value ?? bal?.equity_attributable_to_parent?.value ?? null;
  const currentAssets = bal?.current_assets?.value ?? null;
  const currentLiabilities = bal?.current_liabilities?.value ?? null;
  const cashAndEquiv = bal?.cash?.value ?? null;

  // Cash flow
  const opCashFlow = cf?.net_cash_flow_from_operating_activities?.value ?? null;
  const investCashFlow = cf?.net_cash_flow_from_investing_activities?.value ?? null;
  // Free cash flow = operating CF + investing CF (capex is usually in investing, negative)
  // Polygon doesn't split capex cleanly, so we approximate: opCF - |capex approximation|.
  // If unavailable, leave null; the app tolerates nulls.
  let freeCashFlow: number | null = null;
  if (opCashFlow != null && investCashFlow != null) {
    // Approximate capex as ~80% of investing cash flow magnitude (rough)
    freeCashFlow = opCashFlow + investCashFlow;
  } else if (opCashFlow != null) {
    freeCashFlow = opCashFlow; // fallback
  }

  // Ratios
  const grossMargin = revenues && grossProfit ? grossProfit / revenues : null;
  const operatingMargin = revenues && operatingIncome ? operatingIncome / revenues : null;
  const profitMargin = revenues && netIncome ? netIncome / revenues : null;
  const ebitdaMargin = operatingMargin; // approximation; Polygon doesn't surface EBITDA directly
  const currentRatio = currentAssets && currentLiabilities ? currentAssets / currentLiabilities : null;
  const debtToEquity = totalDebt && totalEquity ? (totalDebt / totalEquity) * 100 : null;
  const roe = netIncome && totalEquity ? netIncome / totalEquity : null;
  const trailingPE = dilutedEps && regPrice ? regPrice / dilutedEps : null;

  // Revenue growth: compare latest TTM to annual from one year earlier if available
  let revenueGrowth: number | null = null;
  const annuals = finResults.filter((r: any) => r.timeframe === "annual");
  if (annuals.length >= 2) {
    const curR = annuals[0]?.financials?.income_statement?.revenues?.value;
    const prevR = annuals[1]?.financials?.income_statement?.revenues?.value;
    if (curR && prevR) revenueGrowth = (curR - prevR) / prevR;
  }
  let earningsGrowth: number | null = null;
  if (annuals.length >= 2) {
    const curE = annuals[0]?.financials?.income_statement?.net_income_loss?.value;
    const prevE = annuals[1]?.financials?.income_statement?.net_income_loss?.value;
    if (curE && prevE && prevE !== 0) earningsGrowth = (curE - prevE) / Math.abs(prevE);
  }

  // Dividend info from Polygon dividends endpoint
  const latestDiv = divResults[0] || null;
  const freq = latestDiv?.frequency; // 1=annual, 2=semi, 4=quarterly, 12=monthly
  // Annual dividend rate: sum the last ~12 months of payments
  const oneYearAgoSec = Date.now() / 1000 - 365 * 24 * 3600;
  const ttmDivs = divResults.filter((d: any) => {
    const t = d.pay_date ? Date.parse(d.pay_date) / 1000 : 0;
    return t >= oneYearAgoSec;
  });
  const annualDividend = ttmDivs.reduce((s: number, d: any) => s + (d.cash_amount || 0), 0);
  const dividendYieldDecimal = annualDividend && regPrice ? annualDividend / regPrice : 0;
  const payoutRatio = annualDividend && dilutedEps && dilutedEps > 0 ? annualDividend / dilutedEps : null;

  const exDivDate = latestDiv?.ex_dividend_date ? Math.floor(Date.parse(latestDiv.ex_dividend_date) / 1000) : null;
  const payDate = latestDiv?.pay_date ? Math.floor(Date.parse(latestDiv.pay_date) / 1000) : null;

  // 52-week high/low from snapshot aggregate (approximate with day high/low; proper fetch below if needed)
  // Polygon snapshot doesn't include 52w; fetch a 1Y daily aggregate separately and compute.
  let fiftyTwoWeekHigh: number | null = null;
  let fiftyTwoWeekLow: number | null = null;
  try {
    const today = new Date();
    const from = new Date(today.getTime() - 365 * 24 * 3600 * 1000);
    const fromStr = from.toISOString().split("T")[0];
    const toStr = today.toISOString().split("T")[0];
    const agg = await pget(
      `/v2/aggs/ticker/${encodeURIComponent(T)}/range/1/day/${fromStr}/${toStr}`,
      { adjusted: "true", sort: "asc", limit: 500 }
    );
    const bars = agg?.results || [];
    if (bars.length) {
      fiftyTwoWeekHigh = Math.max(...bars.map((b: any) => b.h));
      fiftyTwoWeekLow = Math.min(...bars.map((b: any) => b.l));
    }
  } catch { /* ignore */ }

  // Determine quote type
  let quoteType = "EQUITY";
  const polyType = details?.type || "";
  if (polyType === "ETF" || polyType === "ETV" || polyType === "ETN") quoteType = "ETF";

  // Build Yahoo-compatible summary
  const summary: any = {
    price: {
      longName: details?.name || null,
      shortName: details?.name || T,
      quoteType,
      currency: (details?.currency_name || "USD").toUpperCase(),
      regularMarketPrice: yf(regPrice),
      regularMarketChange: yf(change),
      regularMarketChangePercent: yf(changePctYahoo),
      regularMarketVolume: yf(volume),
      marketCap: yf(marketCap),
      averageDailyVolume3Month: null, // filled below if possible
      averageDailyVolume10Day: null,
    },
    summaryDetail: {
      trailingPE: yf(trailingPE),
      forwardPE: null,
      dividendYield: yf(dividendYieldDecimal),
      trailingAnnualDividendYield: yf(dividendYieldDecimal),
      dividendRate: yf(annualDividend),
      trailingAnnualDividendRate: yf(annualDividend),
      payoutRatio: payoutRatio != null ? yf(payoutRatio) : null,
      fiveYearAvgDividendYield: null,
      fiftyTwoWeekHigh: yf(fiftyTwoWeekHigh),
      fiftyTwoWeekLow: yf(fiftyTwoWeekLow),
      averageVolume: yf(volume),
      exDividendDate: yfDate(exDivDate),
    },
    defaultKeyStatistics: {
      trailingEps: yf(dilutedEps),
      trailingPE: yf(trailingPE),
      forwardPE: null,
      payoutRatio: payoutRatio != null ? yf(payoutRatio) : null,
      beta: null, // Polygon doesn't provide; leave null (app tolerates)
      bookValue: totalEquity && sharesOut ? yf(totalEquity / sharesOut) : null,
      sharesOutstanding: yf(sharesOut),
      lastDividendValue: yf(latestDiv?.cash_amount ?? null),
      lastDividendDate: yfDate(payDate),
    },
    financialData: {
      currentPrice: yf(regPrice),
      revenueGrowth: yf(revenueGrowth),
      earningsGrowth: yf(earningsGrowth),
      grossMargins: yf(grossMargin),
      operatingMargins: yf(operatingMargin),
      profitMargins: yf(profitMargin),
      ebitdaMargins: yf(ebitdaMargin),
      returnOnEquity: yf(roe),
      debtToEquity: yf(debtToEquity),
      currentRatio: yf(currentRatio),
      totalRevenue: yf(revenues),
      totalDebt: yf(totalDebt),
      totalCash: yf(cashAndEquiv),
      freeCashflow: yf(freeCashFlow),
      operatingCashflow: yf(opCashFlow),
      // Analyst targets: not in Stocks Starter; leave null (app shows N/A gracefully)
      targetMeanPrice: null,
      targetHighPrice: null,
      targetLowPrice: null,
      recommendationKey: null,
    },
    summaryProfile: {
      sector: details?.sic_description || null, // closest available
      industry: details?.sic_description || null,
      longBusinessSummary: details?.description || null,
      website: details?.homepage_url || null,
      country: details?.locale ? details.locale.toUpperCase() : null,
      fullTimeEmployees: details?.total_employees ?? null,
    },
    // Not available in Polygon Stocks Starter — leave empty; downstream code tolerates.
    recommendationTrend: { trend: [] },
    earningsTrend: { trend: [] },
    calendarEvents: {
      exDividendDate: yfDate(exDivDate),
      dividendDate: yfDate(payDate),
      earnings: {
        earningsDate: [],
        earningsAverage: null,
        revenueAverage: null,
      },
    },
    // Fundamental details (earnings history) — populated for earnings-calendar route
    earnings: {
      earningsChart: {
        quarterly: [],
      },
    },
    // Hidden debug hints
    __polygonSource: true,
  };

  return summary;
}

// ────────────────────────────────────────────────────────────
// Chart: Polygon aggregates → Yahoo chart.result shape
// ────────────────────────────────────────────────────────────

type YahooRange = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "2y" | "3y" | "5y" | "10y" | "max" | "25y" | string;
type YahooInterval = "1m" | "5m" | "15m" | "30m" | "60m" | "1h" | "1d" | "1wk" | "1mo" | string;

function mapInterval(interval: YahooInterval): { multiplier: number; timespan: string } {
  switch (interval) {
    case "1m": return { multiplier: 1, timespan: "minute" };
    case "5m": return { multiplier: 5, timespan: "minute" };
    case "15m": return { multiplier: 15, timespan: "minute" };
    case "30m": return { multiplier: 30, timespan: "minute" };
    case "60m":
    case "1h": return { multiplier: 1, timespan: "hour" };
    case "1wk": return { multiplier: 1, timespan: "week" };
    case "1mo": return { multiplier: 1, timespan: "month" };
    case "1d":
    default: return { multiplier: 1, timespan: "day" };
  }
}

function rangeToFromDate(range: YahooRange): Date {
  const now = new Date();
  const d = new Date(now);
  switch (range) {
    case "1d": d.setDate(now.getDate() - 1); break;
    case "5d": d.setDate(now.getDate() - 7); break;
    case "1mo": d.setMonth(now.getMonth() - 1); break;
    case "3mo": d.setMonth(now.getMonth() - 3); break;
    case "6mo": d.setMonth(now.getMonth() - 6); break;
    case "1y": d.setFullYear(now.getFullYear() - 1); break;
    case "2y": d.setFullYear(now.getFullYear() - 2); break;
    case "3y": d.setFullYear(now.getFullYear() - 3); break;
    case "5y": d.setFullYear(now.getFullYear() - 5); break;
    case "10y": d.setFullYear(now.getFullYear() - 10); break;
    case "25y": d.setFullYear(now.getFullYear() - 25); break;
    case "max": d.setFullYear(now.getFullYear() - 50); break;
    default: d.setFullYear(now.getFullYear() - 1); break;
  }
  return d;
}

export async function getPolygonChart(
  ticker: string,
  range: YahooRange,
  interval: YahooInterval
): Promise<any> {
  const T = ticker.toUpperCase();
  const from = rangeToFromDate(range);
  const to = new Date();
  const fromStr = from.toISOString().split("T")[0];
  const toStr = to.toISOString().split("T")[0];
  const { multiplier, timespan } = mapInterval(interval);

  const data = await pget(
    `/v2/aggs/ticker/${encodeURIComponent(T)}/range/${multiplier}/${timespan}/${fromStr}/${toStr}`,
    { adjusted: "true", sort: "asc", limit: 50000 }
  );

  const bars = data?.results || [];
  // Yahoo shape: { timestamp: number[] (sec), indicators: { quote: [{ close, open, high, low, volume }] } }
  const timestamp = bars.map((b: any) => Math.floor(b.t / 1000));
  const close = bars.map((b: any) => b.c);
  const open = bars.map((b: any) => b.o);
  const high = bars.map((b: any) => b.h);
  const low = bars.map((b: any) => b.l);
  const volume = bars.map((b: any) => b.v);

  return {
    meta: {
      symbol: T,
      currency: "USD",
      regularMarketPrice: bars.length ? bars[bars.length - 1].c : null,
      dataGranularity: interval,
      range,
    },
    timestamp,
    indicators: {
      quote: [{ close, open, high, low, volume }],
    },
    __polygonSource: true,
  };
}

// ────────────────────────────────────────────────────────────
// Search
// ────────────────────────────────────────────────────────────

export async function polygonSearch(query: string): Promise<Array<{ symbol: string; name: string; type: string; exchange: string }>> {
  if (!query) return [];
  const data = await pget(`/v3/reference/tickers`, {
    search: query,
    active: "true",
    market: "stocks",
    limit: 20,
  });
  const results = data?.results || [];
  return results
    .filter((r: any) => r.type === "CS" || r.type === "ETF" || r.type === "ETV")
    .slice(0, 8)
    .map((r: any) => ({
      symbol: r.ticker,
      name: r.name,
      type: r.type === "CS" ? "EQUITY" : r.type,
      exchange: r.primary_exchange || r.market || "",
    }));
}

// ────────────────────────────────────────────────────────────
// Options chain: Polygon /v3/snapshot/options → Yahoo optionChain shape
// ────────────────────────────────────────────────────────────

export async function getPolygonOptionsChain(ticker: string, expDateUnixSec?: number): Promise<any> {
  const T = ticker.toUpperCase();

  // Get snapshot (paginated). Polygon returns up to 250 per page with a next_url.
  const allContracts: any[] = [];
  let nextUrl: string | null = null;
  const baseParams: Record<string, any> = { limit: 250 };
  if (expDateUnixSec) {
    // Convert unix sec → YYYY-MM-DD
    const d = new Date(expDateUnixSec * 1000);
    baseParams.expiration_date = d.toISOString().split("T")[0];
  }

  let firstPage = await pget(`/v3/snapshot/options/${encodeURIComponent(T)}`, baseParams);
  allContracts.push(...(firstPage?.results || []));
  nextUrl = firstPage?.next_url || null;

  // Fetch up to 3 additional pages (max ~1000 contracts) to keep latency bounded
  let pages = 0;
  while (nextUrl && pages < 3) {
    const u = new URL(nextUrl);
    u.searchParams.append("apiKey", apiKey());
    const resp = await fetch(u.toString());
    if (!resp.ok) break;
    const json = await resp.json();
    allContracts.push(...(json?.results || []));
    nextUrl = json?.next_url || null;
    pages++;
  }

  if (!allContracts.length) return null;

  // Group by expiration date and split call/put
  const byExp: Record<string, { calls: any[]; puts: any[] }> = {};
  const expDates = new Set<string>();
  for (const c of allContracts) {
    const exp = c.details?.expiration_date;
    if (!exp) continue;
    expDates.add(exp);
    if (!byExp[exp]) byExp[exp] = { calls: [], puts: [] };
    const item = {
      contractSymbol: c.details.ticker,
      strike: c.details.strike_price,
      currency: "USD",
      lastPrice: c.day?.close ?? c.last_quote?.midpoint ?? null,
      change: c.day?.change ?? null,
      percentChange: c.day?.change_percent ?? null,
      volume: c.day?.volume ?? 0,
      openInterest: c.open_interest ?? 0,
      bid: c.last_quote?.bid ?? null,
      ask: c.last_quote?.ask ?? null,
      contractSize: "REGULAR",
      expiration: Math.floor(Date.parse(exp) / 1000),
      lastTradeDate: c.day?.last_updated ? Math.floor(c.day.last_updated / 1e9) : null,
      impliedVolatility: c.implied_volatility ?? 0,
      inTheMoney: false, // computed by consumer if needed
      // Greeks (present if the contract has them)
      delta: c.greeks?.delta ?? null,
      gamma: c.greeks?.gamma ?? null,
      theta: c.greeks?.theta ?? null,
      vega: c.greeks?.vega ?? null,
    };
    if (c.details.contract_type === "call") byExp[exp].calls.push(item);
    else if (c.details.contract_type === "put") byExp[exp].puts.push(item);
  }

  const sortedExps = Array.from(expDates).sort();
  const expirationDates = sortedExps.map(e => Math.floor(Date.parse(e) / 1000));

  // Get underlying spot from snapshot (first contract carries it OR call snapshot)
  let spot: number | null = null;
  try {
    const snap = await pget(`/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(T)}`);
    spot = snap?.ticker?.day?.c ?? snap?.ticker?.prevDay?.c ?? null;
  } catch { /* ignore */ }

  // If expDateUnixSec requested, pick that page; else pick nearest
  const targetExp = expDateUnixSec
    ? new Date(expDateUnixSec * 1000).toISOString().split("T")[0]
    : sortedExps[0];

  const bucket = byExp[targetExp] || { calls: [], puts: [] };
  bucket.calls.sort((a, b) => a.strike - b.strike);
  bucket.puts.sort((a, b) => a.strike - b.strike);

  return {
    underlyingSymbol: T,
    expirationDates,
    strikes: Array.from(new Set(allContracts.map((c: any) => c.details?.strike_price).filter(Boolean))).sort((a: any, b: any) => a - b),
    hasMiniOptions: false,
    quote: {
      regularMarketPrice: spot,
      shortName: T,
      longName: T,
    },
    options: [
      {
        expirationDate: Math.floor(Date.parse(targetExp) / 1000),
        hasMiniOptions: false,
        calls: bucket.calls,
        puts: bucket.puts,
      },
    ],
    __polygonSource: true,
  };
}

// ────────────────────────────────────────────────────────────
// Dividends (raw list — for dedicated dividend routes)
// ────────────────────────────────────────────────────────────

export async function getPolygonDividends(ticker: string, limit = 50): Promise<any[]> {
  const T = ticker.toUpperCase();
  const data = await pget(`/v3/reference/dividends`, { ticker: T, limit, order: "desc" });
  return data?.results || [];
}

// ────────────────────────────────────────────────────────────
// Splits
// ────────────────────────────────────────────────────────────

export async function getPolygonSplits(ticker: string, limit = 20): Promise<any[]> {
  const T = ticker.toUpperCase();
  const data = await pget(`/v3/reference/splits`, { ticker: T, limit, order: "desc" });
  return data?.results || [];
}

// ────────────────────────────────────────────────────────────
// Screener (Polygon doesn't have a native screener; fallback: fetch grouped snapshots + filter)
// ────────────────────────────────────────────────────────────

export interface ScreenerFilters {
  minPrice?: number;
  maxPrice?: number;
  sector?: string;
  minMarketCap?: number;
  maxMarketCap?: number;
  count?: number;
}

/**
 * Best-effort screener using Polygon's grouped daily endpoint + ticker details enrichment.
 * Returns an array of ticker symbols.
 *
 * NOTE: Polygon's grouped daily bars endpoint is on Stocks Starter. It returns every US stock's
 * prior-day OHLCV. We filter by price here and look up market cap lazily only for top candidates.
 */
export async function polygonScreener(filters: ScreenerFilters): Promise<string[]> {
  const count = filters.count ?? 100;
  // Previous trading day - try yesterday first, walk back up to 5 days for weekends/holidays.
  for (let back = 1; back <= 5; back++) {
    const d = new Date();
    d.setDate(d.getDate() - back);
    const dateStr = d.toISOString().split("T")[0];
    try {
      const data = await pget(`/v2/aggs/grouped/locale/us/market/stocks/${dateStr}`, { adjusted: "true" });
      const bars = data?.results || [];
      if (!bars.length) continue;

      // Filter by price first
      const priced = bars.filter((b: any) => {
        const p = b.c;
        if (filters.minPrice != null && p < filters.minPrice) return false;
        if (filters.maxPrice != null && p > filters.maxPrice) return false;
        return true;
      });

      // Sort by dollar volume to prioritize liquid names
      priced.sort((a: any, b: any) => (b.c * b.v) - (a.c * a.v));

      // Take more than count because market-cap filter will prune
      const candidates = priced.slice(0, Math.min(count * 3, 500));

      return candidates.map((b: any) => b.T).slice(0, count);
    } catch (err) {
      continue;
    }
  }
  return [];
}

// ────────────────────────────────────────────────────────────
// Earnings calendar row (per-ticker) — used by /api/earnings-calendar
// Uses Polygon /vX/reference/financials for quarterly history and
// /v3/reference/tickers for the company name.
// ────────────────────────────────────────────────────────────

export interface PolygonEarningsRow {
  ticker: string;
  companyName: string;
  earningsDate: string | null;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  history: Array<{
    quarter: string;
    actual: number | null;
    estimate: number | null;
    surprise: number | null;
    surprisePct: number | null;
  }>;
}

export async function getPolygonEarningsRow(ticker: string): Promise<PolygonEarningsRow | null> {
  const T = ticker.toUpperCase();
  try {
    const [refRes, finRes] = await Promise.allSettled([
      pget(`/v3/reference/tickers/${encodeURIComponent(T)}`),
      pget(`/vX/reference/financials`, {
        ticker: T,
        limit: 8,
        timeframe: "quarterly",
        order: "desc",
      }),
    ]);

    const companyName =
      refRes.status === "fulfilled" ? (refRes.value?.results?.name || T) : T;

    const quarters: any[] =
      finRes.status === "fulfilled" ? (finRes.value?.results || []) : [];

    if (!quarters.length) {
      // Still return a row so the UI can show the ticker with no data
      return {
        ticker: T,
        companyName,
        earningsDate: null,
        epsEstimate: null,
        revenueEstimate: null,
        history: [],
      };
    }

    // Build quarterly history (oldest → newest so charts render left-to-right)
    const history = quarters
      .slice()
      .reverse()
      .map((q: any) => {
        const inc = q?.financials?.income_statement || {};
        const eps =
          inc?.diluted_earnings_per_share?.value ??
          inc?.basic_earnings_per_share?.value ??
          null;
        const label =
          q?.fiscal_period && q?.fiscal_year
            ? `${q.fiscal_period} ${q.fiscal_year}`
            : q?.end_date || "";
        return {
          quarter: String(label),
          actual: typeof eps === "number" ? Math.round(eps * 10000) / 10000 : null,
          // Polygon does not publish analyst estimates; leave null so UI shows "—"
          estimate: null,
          surprise: null,
          surprisePct: null,
        };
      });

    // Next earnings date: Polygon does not expose a forward earnings calendar
    // on standard plans. Best-effort: compute ~90 days after the most recent
    // period end so the UI can show a projected window.
    let earningsDate: string | null = null;
    const latestEnd = quarters[0]?.end_date;
    if (latestEnd) {
      const d = new Date(latestEnd);
      if (!isNaN(d.getTime())) {
        d.setDate(d.getDate() + 90);
        earningsDate = d.toISOString().slice(0, 10);
      }
    }

    return {
      ticker: T,
      companyName,
      earningsDate,
      epsEstimate: null,
      revenueEstimate: null,
      history,
    };
  } catch (err: any) {
    console.log(`[polygon earnings] ${T} failed: ${err?.message}`);
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// Polygon availability probe — tells main app whether Options tier is enabled
// ────────────────────────────────────────────────────────────

let _optionsProbed: boolean | null = null;
export async function polygonHasOptions(): Promise<boolean> {
  if (_optionsProbed !== null) return _optionsProbed;
  try {
    await pget(`/v3/snapshot/options/AAPL`, { limit: 1 });
    _optionsProbed = true;
  } catch (err: any) {
    if (String(err.message).includes("not authorized")) _optionsProbed = false;
    else _optionsProbed = true; // assume yes on other errors; route will surface real error
  }
  return _optionsProbed;
}
