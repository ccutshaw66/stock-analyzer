/**
 * Chart adapter for the snapshot pipeline.
 *
 * Provider chain: Polygon → FMP → Yahoo.
 *
 * Returns Yahoo-shaped chart data: { timestamp: number[], indicators: { quote: [{ close, open, high, low, volume }] } }.
 * This is the shape the rest of the codebase already consumes (computeAnalysisCore,
 * scanner-v2 indicators, stress test). All three providers translate INTO this shape
 * so consumers don't need to know which one answered.
 */

import type { FieldHealth } from "./types";
import { tryProviders } from "./fallback";
import { getPolygonChart } from "../polygon";
import { fmpGet } from "../data/providers/fmp.client";

export interface YahooChart {
  meta?: { symbol?: string; currency?: string; regularMarketPrice?: number | null; range?: string; dataGranularity?: string };
  timestamp: number[];
  indicators: { quote: Array<{ close: number[]; open?: number[]; high?: number[]; low?: number[]; volume?: number[] }> };
}

export type ChartRange = "1y" | "3y" | "5y" | "10y" | "25y";
export type ChartInterval = "1d" | "1wk" | "1mo";

const CHART_TTL_MS = {
  "1y": 30 * 60 * 1000,    // 30 min
  "3y": 60 * 60 * 1000,    // 1 hr
  "5y": 60 * 60 * 1000,    // 1 hr
  "10y": 6 * 60 * 60 * 1000, // 6 hr
  "25y": 24 * 60 * 60 * 1000, // 24 hr (stress test data is monthly bars)
} as const;

function rangeToFromDate(range: ChartRange): Date {
  const now = new Date();
  const years = parseInt(range);
  return new Date(now.getFullYear() - years, now.getMonth(), now.getDate());
}

function fmpRowsToYahooShape(rows: any[]): YahooChart | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  // FMP can return either { historical: [...] } or a flat array depending on endpoint.
  const asc = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return {
    meta: {
      regularMarketPrice: asc[asc.length - 1]?.close ?? null,
    },
    timestamp: asc.map(r => Math.floor(new Date(r.date).getTime() / 1000)),
    indicators: {
      quote: [{
        close: asc.map(r => Number(r.close)),
        open: asc.map(r => Number(r.open)),
        high: asc.map(r => Number(r.high)),
        low: asc.map(r => Number(r.low)),
        volume: asc.map(r => Number(r.volume)),
      }],
    },
  };
}

const YF_QUERY_BASE = "https://query1.finance.yahoo.com";

async function yahooChart(
  ticker: string,
  range: ChartRange,
  interval: ChartInterval,
  yahooFetch: (url: string, retries?: number) => Promise<any>,
): Promise<YahooChart | null> {
  const url =
    `${YF_QUERY_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?range=${range}&interval=${interval}&includePrePost=false`;
  const json = await yahooFetch(url, 2);
  const result = json?.chart?.result?.[0];
  if (!result?.timestamp?.length) return null;
  return result as YahooChart;
}

function isEmptyChart(c: YahooChart): boolean {
  const closes = c?.indicators?.quote?.[0]?.close;
  return !closes || closes.filter(v => Number.isFinite(v)).length === 0;
}

export async function getChartSnapshot(
  ticker: string,
  range: ChartRange,
  interval: ChartInterval,
  yahooFetch: (url: string, retries?: number) => Promise<any>,
): Promise<FieldHealth<YahooChart>> {
  const T = ticker.toUpperCase();
  return tryProviders<YahooChart>(
    [
      {
        source: "polygon",
        fetch: async () => {
          // Polygon adapter already returns Yahoo-shape.
          return getPolygonChart(T, range as any, interval as any);
        },
      },
      {
        source: "fmp",
        fetch: async () => {
          const from = rangeToFromDate(range).toISOString().slice(0, 10);
          const to = new Date().toISOString().slice(0, 10);
          // FMP intraday has a different endpoint; we stick to EOD for this fallback.
          // Daily granularity is supported on /historical-price-eod/full.
          const rows: any = await fmpGet(`/historical-price-eod/full`, { symbol: T, from, to });
          const arr = Array.isArray(rows) ? rows : (rows?.historical || []);
          return fmpRowsToYahooShape(arr);
        },
      },
      {
        source: "yahoo",
        fetch: () => yahooChart(T, range, interval, yahooFetch),
      },
    ],
    {
      ttlMs: CHART_TTL_MS[range],
      isEmpty: isEmptyChart,
    },
  );
}

/**
 * Compute 1y / 3y / 5y returns from a single longest chart (5y weekly is enough).
 * Returns percent (e.g. 23.5 for +23.5%).
 */
export function computeReturns(chart: YahooChart | null): { oneYear: number | null; threeYear: number | null; fiveYear: number | null } {
  if (!chart?.timestamp?.length) return { oneYear: null, threeYear: null, fiveYear: null };
  const timestamps = chart.timestamp;
  const closes = chart.indicators?.quote?.[0]?.close ?? [];
  if (!closes.length) return { oneYear: null, threeYear: null, fiveYear: null };

  const lastIdx = closes.length - 1;
  const last = closes[lastIdx];
  if (!Number.isFinite(last)) return { oneYear: null, threeYear: null, fiveYear: null };
  const nowSec = timestamps[lastIdx];

  function returnFromSecondsAgo(secondsAgo: number): number | null {
    const targetSec = nowSec - secondsAgo;
    let bestIdx = -1;
    for (let i = 0; i < timestamps.length; i++) {
      if (timestamps[i] >= targetSec) { bestIdx = i; break; }
    }
    if (bestIdx < 0) return null;
    const ref = closes[bestIdx];
    if (!Number.isFinite(ref) || ref === 0) return null;
    return ((last - ref) / ref) * 100;
  }

  const ONE_YEAR = 365 * 24 * 3600;
  return {
    oneYear: returnFromSecondsAgo(ONE_YEAR),
    threeYear: returnFromSecondsAgo(3 * ONE_YEAR),
    fiveYear: returnFromSecondsAgo(5 * ONE_YEAR),
  };
}
