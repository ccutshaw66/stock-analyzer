/**
 * RSI Diff Script — Phase 1.8
 *
 * Compares our canonical Wilder's RSI (server/indicators/rsi.ts) against
 * Polygon's own /v1/indicators/rsi endpoint on a list of liquid tickers.
 *
 * Uses Polygon as the reference because:
 *   1. We already pay for it (no new dependency)
 *   2. Same bars go into both calcs, so any drift is pure RSI-math difference
 *   3. Polygon's RSI is documented Wilder's — matches TradingView default
 *
 * Exit codes:
 *   0 — all tickers within tolerance
 *   1 — one or more tickers exceeded tolerance, or script error
 *
 * Usage:
 *   npx tsx scripts/rsi-diff.ts
 *   npx tsx scripts/rsi-diff.ts AAPL MSFT TSLA        # custom list
 *   RSI_DIFF_TOLERANCE=0.5 npx tsx scripts/rsi-diff.ts  # looser tolerance
 */
import "dotenv/config";
import { computeRSISeries } from "../server/indicators/rsi";

const DEFAULT_TICKERS = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN",
  "META", "TSLA", "SPY", "QQQ", "JPM",
  "XOM", "KO", "JNJ", "UNH", "WMT",
  "HD", "V", "MA", "PG", "AVGO",
];
const TOLERANCE = parseFloat(process.env.RSI_DIFF_TOLERANCE ?? "0.1"); // RSI points
const PERIOD = 14;
const BARS = 120; // enough daily bars for Wilder smoothing to fully converge
const POLY_BASE = "https://api.polygon.io";

function apiKey(): string {
  const k = process.env.POLYGON_API_KEY;
  if (!k) {
    console.error("FATAL: POLYGON_API_KEY not set in environment / .env");
    process.exit(1);
  }
  return k;
}

interface PolygonAgg { c: number; t: number; }

async function fetchDailyCloses(ticker: string): Promise<PolygonAgg[]> {
  // Pull enough bars for RSI(14) to fully converge, plus headroom for weekends/holidays.
  const to = new Date();
  const from = new Date(to.getTime() - 260 * 24 * 60 * 60 * 1000); // ~260 calendar days
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);
  const url = `${POLY_BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=50000&apiKey=${apiKey()}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`aggs ${ticker}: HTTP ${resp.status}`);
  const data = await resp.json();
  const results: PolygonAgg[] = Array.isArray(data?.results) ? data.results : [];
  return results;
}

async function fetchPolygonRSI(ticker: string): Promise<number | null> {
  // Polygon computes RSI on the same aggregate bars — request their latest value.
  const url = `${POLY_BASE}/v1/indicators/rsi/${encodeURIComponent(ticker)}?timespan=day&adjusted=true&window=${PERIOD}&series_type=close&order=desc&limit=1&apiKey=${apiKey()}`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = await resp.json();
  const v = data?.results?.values?.[0]?.value;
  return typeof v === "number" ? v : null;
}

interface Row {
  ticker: string;
  bars: number;
  ours: number | null;
  polygon: number | null;
  diff: number | null;
  status: "OK" | "DRIFT" | "ERROR";
  note?: string;
}

async function checkOne(ticker: string): Promise<Row> {
  try {
    const [aggs, polyRsi] = await Promise.all([
      fetchDailyCloses(ticker),
      fetchPolygonRSI(ticker),
    ]);
    if (!aggs.length) return { ticker, bars: 0, ours: null, polygon: polyRsi, diff: null, status: "ERROR", note: "no aggs" };

    // Use the last BARS closes so our RSI has the same anchor as Polygon's latest.
    const closes = aggs.slice(-BARS).map(a => a.c);
    const series = computeRSISeries(closes, { period: PERIOD });
    const ours = series[series.length - 1];

    if (!Number.isFinite(ours)) return { ticker, bars: closes.length, ours: null, polygon: polyRsi, diff: null, status: "ERROR", note: "NaN ours" };
    if (polyRsi === null) return { ticker, bars: closes.length, ours, polygon: null, diff: null, status: "ERROR", note: "polygon null" };

    const diff = Math.abs(ours - polyRsi);
    return {
      ticker,
      bars: closes.length,
      ours,
      polygon: polyRsi,
      diff,
      status: diff <= TOLERANCE ? "OK" : "DRIFT",
    };
  } catch (e: any) {
    return { ticker, bars: 0, ours: null, polygon: null, diff: null, status: "ERROR", note: e?.message ?? String(e) };
  }
}

function fmt(v: number | null, width = 8): string {
  if (v === null || !Number.isFinite(v)) return "n/a".padStart(width);
  return v.toFixed(3).padStart(width);
}

async function main() {
  const cliTickers = process.argv.slice(2).filter(Boolean);
  const tickers = cliTickers.length ? cliTickers.map(t => t.toUpperCase()) : DEFAULT_TICKERS;

  console.log(`RSI Diff — ${tickers.length} tickers, period=${PERIOD}, tolerance=±${TOLERANCE}`);
  console.log(`Canonical: server/indicators/rsi.ts (Wilder's)`);
  console.log(`Reference: Polygon /v1/indicators/rsi (Wilder's)`);
  console.log("");

  const header = `${"ticker".padEnd(6)}  ${"bars".padStart(4)}  ${"ours".padStart(8)}  ${"polygon".padStart(8)}  ${"diff".padStart(8)}  status`;
  console.log(header);
  console.log("-".repeat(header.length));

  // Sequential — we're only doing 20 tickers, keeps output deterministic.
  const rows: Row[] = [];
  for (const t of tickers) {
    const row = await checkOne(t);
    rows.push(row);
    const statusCell = row.status === "OK" ? "OK"
      : row.status === "DRIFT" ? `DRIFT  (>${TOLERANCE})`
      : `ERROR  ${row.note ?? ""}`;
    console.log(`${row.ticker.padEnd(6)}  ${String(row.bars).padStart(4)}  ${fmt(row.ours)}  ${fmt(row.polygon)}  ${fmt(row.diff)}  ${statusCell}`);
  }

  const ok = rows.filter(r => r.status === "OK").length;
  const drift = rows.filter(r => r.status === "DRIFT").length;
  const err = rows.filter(r => r.status === "ERROR").length;

  console.log("");
  console.log(`Summary: ${ok} OK · ${drift} DRIFT · ${err} ERROR`);

  if (drift > 0) {
    console.error(`\nFAIL: ${drift} ticker(s) exceeded tolerance of ±${TOLERANCE}`);
    process.exit(1);
  }
  if (err > 0 && ok === 0) {
    console.error(`\nFAIL: all tickers errored`);
    process.exit(1);
  }
  console.log(`\nPASS`);
}

main().catch(e => {
  console.error("Script error:", e);
  process.exit(1);
});
