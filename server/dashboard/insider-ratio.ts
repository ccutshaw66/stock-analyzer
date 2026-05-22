/**
 * Monthly Insider Buy/Sell Ratio aggregator.
 *
 * Reads FMP `/insider-trading/latest` paginated, sums open-market buys
 * (`P-Purchase`) vs open-market sales (`S-Sale`) in dollars over the
 * last 30 days, and also computes the prior 30-day window for a
 * month-over-month delta.
 *
 * Two views:
 *   - Market-wide: aggregate buy$ vs sell$ across the whole insider
 *     universe. Single sentiment number.
 *   - Per-symbol: same aggregation per ticker. Powers the Position
 *     Insiders B/S column + the ranked tables on the /insiders page.
 *
 * 10b5-1 awareness pending — S-Sale codes include planned (10b5-1) sales
 * which dilute the sentiment signal. Buy-side is clean. Until EDGAR
 * Form 4 footnote parsing lands, sell ratios over-count discretionary
 * selling.
 *
 * Cache: 1h TTL (insider filings don't move intraday). Single in-flight
 * promise prevents thundering-herd.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import { fmpGet } from "../data/providers/fmp.client";

const WINDOW_DAYS = 30;
const PAGES_PER_WINDOW = 25;        // ~30d at ~1K rows/page; raise if FMP density grows
const TOTAL_PAGES = PAGES_PER_WINDOW * 2; // current + prior month
const CACHE_TTL_MS = 60 * 60 * 1000;

export interface PerSymbolRatio {
  symbol: string;
  buyDollar: number;
  sellDollar: number;
  buyCount: number;             // # distinct insiders buying
  sellCount: number;            // # distinct insiders selling
  /** sell$ / (buy$ + sell$); 0 = pure buying, 1 = pure selling, 0.5 = balanced. */
  sellShare: number;
  /** buy$ / sell$ ratio. >1 = buying skew, <1 = selling skew, Infinity if no sells. */
  buySellRatio: number;
}

export interface MarketRatio {
  windowDays: number;
  windowStart: string;          // YYYY-MM-DD
  windowEnd: string;            // YYYY-MM-DD
  buyDollar: number;
  sellDollar: number;
  buyCount: number;
  sellCount: number;
  /** buy$ / sell$. Capped display number on the UI side. */
  buySellRatio: number;
  /** sell$ / (buy$ + sell$). 0..1, easier to color-tone. */
  sellShare: number;
}

export interface InsiderRatioResponse {
  market: {
    current: MarketRatio;
    prior: MarketRatio;
    /** current.buySellRatio - prior.buySellRatio. Positive = month-over-month bullish shift. */
    momDelta: number;
  };
  perSymbol: PerSymbolRatio[]; // sorted by absolute buy+sell $ activity, current window only
  scannedAt: string;
}

interface RawTxn {
  symbol: string;
  insiderKey: string;
  insiderName: string;
  dir: "buy" | "sell";
  shares: number;
  dollar: number;
  timestamp: number;
}

interface CacheEntry {
  scannedAt: number;
  payload: InsiderRatioResponse;
}
let cache: CacheEntry | null = null;
let inFlight: Promise<InsiderRatioResponse> | null = null;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

async function fetchRawTxns(): Promise<RawTxn[]> {
  const now = Date.now();
  const cutoff = now - 2 * WINDOW_DAYS * 24 * 60 * 60 * 1000; // 60-day window total
  const out: RawTxn[] = [];

  for (let page = 0; page < TOTAL_PAGES; page++) {
    const rows = await fmpGet<any[]>("/insider-trading/latest", { limit: 1000, page });
    if (!Array.isArray(rows) || rows.length === 0) break;

    let anyInWindow = false;
    for (const r of rows) {
      const dateStr = r?.filingDate || r?.transactionDate;
      if (!dateStr) continue;
      const t = new Date(dateStr).getTime();
      if (isNaN(t)) continue;
      if (t >= cutoff) anyInWindow = true;
      if (t < cutoff) continue;

      const txType = String(r?.transactionType || "");
      let dir: "buy" | "sell" | null = null;
      if (txType === "P-Purchase") dir = "buy";
      else if (txType === "S-Sale") dir = "sell";
      else continue;

      const sym = String(r?.symbol || "").toUpperCase();
      if (!sym) continue;
      const insiderKey = String(r?.reportingCik || r?.reportingName || "");
      const insiderName = String(r?.reportingName || "Unknown");
      const shares = Number(r?.securitiesTransacted) || 0;
      const price = Number(r?.price) || 0;
      const dollar = shares * price;
      if (dollar <= 0) continue;

      out.push({
        symbol: sym,
        insiderKey,
        insiderName,
        dir,
        shares,
        dollar,
        timestamp: t,
      });
    }
    if (!anyInWindow) break;
  }
  return out;
}

function aggregateWindow(txns: RawTxn[], startMs: number, endMs: number): MarketRatio {
  let buyDollar = 0;
  let sellDollar = 0;
  const buyInsiders = new Set<string>();
  const sellInsiders = new Set<string>();
  for (const t of txns) {
    if (t.timestamp < startMs || t.timestamp >= endMs) continue;
    if (t.dir === "buy") {
      buyDollar += t.dollar;
      buyInsiders.add(`${t.symbol}|${t.insiderKey}`);
    } else {
      sellDollar += t.dollar;
      sellInsiders.add(`${t.symbol}|${t.insiderKey}`);
    }
  }
  const total = buyDollar + sellDollar;
  return {
    windowDays: WINDOW_DAYS,
    windowStart: isoDate(startMs),
    windowEnd: isoDate(endMs),
    buyDollar: Math.round(buyDollar),
    sellDollar: Math.round(sellDollar),
    buyCount: buyInsiders.size,
    sellCount: sellInsiders.size,
    buySellRatio: sellDollar > 0 ? buyDollar / sellDollar : (buyDollar > 0 ? Infinity : 0),
    sellShare: total > 0 ? sellDollar / total : 0,
  };
}

function aggregatePerSymbol(txns: RawTxn[], startMs: number, endMs: number): PerSymbolRatio[] {
  const map = new Map<string, {
    buyDollar: number; sellDollar: number;
    buyInsiders: Set<string>; sellInsiders: Set<string>;
  }>();
  for (const t of txns) {
    if (t.timestamp < startMs || t.timestamp >= endMs) continue;
    let entry = map.get(t.symbol);
    if (!entry) {
      entry = { buyDollar: 0, sellDollar: 0, buyInsiders: new Set(), sellInsiders: new Set() };
      map.set(t.symbol, entry);
    }
    if (t.dir === "buy") {
      entry.buyDollar += t.dollar;
      entry.buyInsiders.add(t.insiderKey);
    } else {
      entry.sellDollar += t.dollar;
      entry.sellInsiders.add(t.insiderKey);
    }
  }
  const out: PerSymbolRatio[] = [];
  map.forEach((v, symbol) => {
    const total = v.buyDollar + v.sellDollar;
    out.push({
      symbol,
      buyDollar: Math.round(v.buyDollar),
      sellDollar: Math.round(v.sellDollar),
      buyCount: v.buyInsiders.size,
      sellCount: v.sellInsiders.size,
      sellShare: total > 0 ? v.sellDollar / total : 0,
      buySellRatio: v.sellDollar > 0 ? v.buyDollar / v.sellDollar : (v.buyDollar > 0 ? Infinity : 0),
    });
  });
  // Sort by total activity desc — most-noisy tickers first.
  out.sort((a, b) => (b.buyDollar + b.sellDollar) - (a.buyDollar + a.sellDollar));
  return out;
}

async function buildRatio(): Promise<InsiderRatioResponse> {
  const now = Date.now();
  const oneWindow = WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const currentStart = now - oneWindow;
  const priorStart = now - 2 * oneWindow;
  const priorEnd = currentStart;

  const txns = await fetchRawTxns();

  const current = aggregateWindow(txns, currentStart, now);
  const prior = aggregateWindow(txns, priorStart, priorEnd);
  const perSymbol = aggregatePerSymbol(txns, currentStart, now);

  // momDelta caps at +/-10 so an Infinity ratio doesn't dominate.
  const currentR = Number.isFinite(current.buySellRatio) ? current.buySellRatio : 10;
  const priorR = Number.isFinite(prior.buySellRatio) ? prior.buySellRatio : 10;

  return {
    market: {
      current,
      prior,
      momDelta: Number((currentR - priorR).toFixed(3)),
    },
    perSymbol,
    scannedAt: new Date().toISOString(),
  };
}

export async function getInsiderRatio(): Promise<InsiderRatioResponse> {
  const now = Date.now();
  if (cache && now - cache.scannedAt < CACHE_TTL_MS) {
    return cache.payload;
  }
  if (inFlight) return inFlight;
  inFlight = buildRatio()
    .then(payload => {
      cache = { scannedAt: Date.now(), payload };
      return payload;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function registerInsiderRatioRoute(app: Express): void {
  app.get(
    "/api/dashboard/insiders/ratio",
    requireAuth,
    async (_req: Request, res: Response) => {
      try {
        const payload = await getInsiderRatio();
        res.json(payload);
      } catch (err: any) {
        console.error("[dashboard] insiders/ratio failed:", err?.message || err);
        res.status(500).json({ error: "insider_ratio_failed", message: String(err?.message || err) });
      }
    },
  );
}
