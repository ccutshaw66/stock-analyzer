/**
 * Market Pulse v0.1 — quantitative market regime classifier.
 *
 * Answers: "Is the market environment hostile, neutral, or favorable for
 * trading right now?" — derived from price/volume only, no narrative.
 *
 * Three groups of inputs:
 *   1. Volatility:  VIX level + 20-day percentile + VIX9D/VIX3M term structure
 *   2. Breadth:     % of S&P 500 above 50/200d MA + new 52w highs vs lows
 *   3. Risk appetite: HYG/LQD ratio (junk vs investment grade) +
 *                     SPY/TLT ratio (stocks vs long bonds), with 5-day direction
 *
 * Scoring (0-100, higher = more risk-on) maps to a tier label:
 *   80-100 EUPHORIC    — favorable but watch for complacency
 *   60-79  RISK-ON     — healthy environment for new long setups
 *   40-59  NEUTRAL     — mixed signals; selective, smaller size
 *   20-39  DEFENSIVE   — deteriorating; tighten stops, prefer cash
 *   0-19   RISK-OFF    — hostile; most setups will fail
 *
 * Architectural rules respected:
 *   - Polygon = primary for prices (already paid for).
 *   - FMP = VIX-family quotes (Polygon Stocks Starter doesn't include indices).
 *   - Yahoo = NOT on the request path. Fallback only for cron warmup if needed.
 *   - All heavy computation (S&P 500 breadth) cached 24h via warmup cron.
 *   - Intraday snapshots cached 5min via warmup cron.
 */

import { fmpGet } from "./fmp.client";
import { getPolygonChart, pget } from "../../polygon";

// ─── Types ────────────────────────────────────────────────────────────────

export interface VolatilityMetrics {
  vix: number | null;
  vixPercentile20d: number | null; // 0..100, today's rank within last 20 closes
  vix9d: number | null;
  vix3m: number | null;
  vixTermRatio: number | null; // VIX9D / VIX3M; > 1.0 = backwardation = stress
}

export interface BreadthMetrics {
  pctAbove50dma: number | null;  // 0..100
  pctAbove200dma: number | null; // 0..100
  newHighs: number | null;        // count of 52w-high stocks
  newLows: number | null;         // count of 52w-low stocks
  universeSize: number | null;    // how many tickers we successfully scored
}

export interface RiskAppetiteMetrics {
  hygLqdRatio: number | null;
  hygLqdDirection: "rising" | "falling" | "flat" | null; // vs 5d ago
  spyTltRatio: number | null;
  spyTltDirection: "rising" | "falling" | "flat" | null;
}

export interface IndexCard {
  symbol: string;
  price: number | null;
  changePct: number | null;
  above50dma: boolean | null;
  above200dma: boolean | null;
}

export type RegimeTier = "EUPHORIC" | "RISK_ON" | "NEUTRAL" | "DEFENSIVE" | "RISK_OFF";

export interface RegimeVerdict {
  score: number;                  // 0..100
  tier: RegimeTier;
  headline: string;               // one-line user-facing summary
  contributors: string[];         // factors lifting OR dragging the score
}

export interface MarketPulse {
  asOf: number;                   // epoch ms when assembled
  marketOpen: boolean;
  volatility: VolatilityMetrics;
  breadth: BreadthMetrics;
  riskAppetite: RiskAppetiteMetrics;
  indices: IndexCard[];
  regime: RegimeVerdict;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function num(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

function rankPercentile(today: number, series: number[]): number {
  // % of values in `series` that are <= today. 1.0 if today is the max.
  if (!series.length) return 50;
  const cnt = series.filter(v => v <= today).length;
  return (cnt / series.length) * 100;
}

/** Pull a daily-bar series for a single ticker via Polygon. Returns just
 *  the closes; failures resolve to []. Caller decides how strict to be. */
async function polygonDailyCloses(symbol: string, range: "1y" | "3mo" | "1mo" = "1y"): Promise<number[]> {
  try {
    const chart: any = await getPolygonChart(symbol, range as any, "1d" as any);
    const closes: number[] = chart?.indicators?.quote?.[0]?.close ?? [];
    return closes.filter((c) => Number.isFinite(c));
  } catch {
    return [];
  }
}

/** FMP /quote returns an array; we want the .price scalar. */
async function fmpQuotePrice(symbol: string): Promise<number | null> {
  try {
    const rows: any = await fmpGet(`/quote`, { symbol });
    const row = Array.isArray(rows) ? rows[0] : rows;
    return num(row?.price);
  } catch {
    return null;
  }
}

/** Yahoo chart endpoint, latest regular-market price. Used as a fallback
 *  for tickers FMP/Polygon don't carry on our tier — notably the VIX9D
 *  and VIX3M cash indices. Cron-only path, not on user requests.
 *  Verbose logging so cron diagnostics show every step. */
async function yahooLatestClose(symbol: string): Promise<number | null> {
  console.log(`[mp-yahoo] CALLED ${symbol}`);
  const rawSymbol = symbol.startsWith("^") ? symbol : encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${rawSymbol}?range=5d&interval=1d`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    console.log(`[mp-yahoo] ${symbol} HTTP ${res.status}`);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.log(`[mp-yahoo] ${symbol} body: ${body.substring(0, 160)}`);
      return null;
    }
    const json: any = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    const price = num(meta?.regularMarketPrice);
    console.log(`[mp-yahoo] ${symbol} price=${price} (meta.regularMarketPrice=${meta?.regularMarketPrice})`);
    return price;
  } catch (err: any) {
    console.log(`[mp-yahoo] ${symbol} threw: ${String(err?.message || err).substring(0, 200)}`);
    return null;
  }
}

// ─── Group 1: Volatility ──────────────────────────────────────────────────

export async function getVolatility(): Promise<VolatilityMetrics> {
  // Provider chain: FMP /quote → Yahoo /chart for the cash-index tickers.
  // Polygon Stocks Starter doesn't include cash indices at all. FMP's
  // /quote covers ^VIX reliably but is hit-or-miss on ^VIX9D / ^VIX3M
  // depending on the trading session and tier; Yahoo's chart endpoint
  // covers all three. Cron-only path so the Yahoo call is fine.
  let [vix, vix9d, vix3m, vixHistory] = await Promise.all([
    fmpQuotePrice("^VIX"),
    fmpQuotePrice("^VIX9D"),
    fmpQuotePrice("^VIX3M"),
    fmpHistoricalCloses("^VIX", 25),
  ]);
  console.log(`[mp-vol] FMP returned vix=${vix} vix9d=${vix9d} vix3m=${vix3m} histLen=${vixHistory.length}`);

  if (vix === null)   vix   = await yahooLatestClose("^VIX");
  if (vix9d === null) vix9d = await yahooLatestClose("^VIX9D");
  if (vix3m === null) vix3m = await yahooLatestClose("^VIX3M");
  console.log(`[mp-vol] AFTER yahoo: vix=${vix} vix9d=${vix9d} vix3m=${vix3m}`);

  const vixPercentile20d = vix !== null && vixHistory.length > 0
    ? rankPercentile(vix, vixHistory.slice(-20))
    : null;

  const vixTermRatio = vix9d !== null && vix3m !== null && vix3m !== 0
    ? vix9d / vix3m
    : null;

  return {
    vix,
    vixPercentile20d,
    vix9d,
    vix3m,
    vixTermRatio,
  };
}

async function fmpHistoricalCloses(symbol: string, count: number): Promise<number[]> {
  try {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const rows: any = await fmpGet(`/historical-price-eod/full`, { symbol, from, to });
    const arr = Array.isArray(rows) ? rows : (rows?.historical || []);
    if (!arr.length) return [];
    const asc = [...arr].sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
    return asc.slice(-count).map((r: any) => Number(r.close)).filter(Number.isFinite);
  } catch {
    return [];
  }
}

// ─── Group 2: Breadth (S&P 500) ───────────────────────────────────────────

const SP500_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
let _sp500Cache: { tickers: string[]; expiresAt: number } | null = null;

export async function getSP500Tickers(): Promise<string[]> {
  if (_sp500Cache && Date.now() < _sp500Cache.expiresAt) return _sp500Cache.tickers;
  try {
    const rows: any = await fmpGet(`/sp500-constituent`, {});
    const arr = Array.isArray(rows) ? rows : [];
    const tickers = arr
      .map((r: any) => String(r.symbol || "").toUpperCase().trim())
      .filter((t: string) => t.length > 0 && /^[A-Z.\-]+$/.test(t));
    if (tickers.length > 100) {
      _sp500Cache = { tickers, expiresAt: Date.now() + SP500_CACHE_TTL_MS };
      return tickers;
    }
  } catch {
    // fall through
  }
  // Fallback: a small hardcoded large-cap set so breadth at least returns
  // SOMETHING when FMP is unavailable. Not a real S&P 500 sample but
  // representative enough to show a plausible reading instead of crashing.
  return [
    "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "AVGO", "ORCL", "ADBE",
    "JPM", "BAC", "WFC", "GS", "MS", "BLK", "V", "MA", "BRK.B", "UNH",
    "JNJ", "LLY", "PFE", "ABBV", "MRK", "WMT", "COST", "HD", "MCD", "PG",
    "KO", "PEP", "NKE", "DIS", "NFLX", "XOM", "CVX", "CAT", "BA", "GE",
  ];
}

interface BreadthLot { closes: number[]; lastClose: number; high52w: number; low52w: number; }

async function scoreBreadthForTicker(symbol: string): Promise<BreadthLot | null> {
  const closes = await polygonDailyCloses(symbol, "1y");
  if (closes.length < 200) return null; // need at least 200 bars for the 200d MA
  const lastClose = closes[closes.length - 1];
  if (!Number.isFinite(lastClose)) return null;
  const high52w = Math.max(...closes);
  const low52w = Math.min(...closes);
  return { closes, lastClose, high52w, low52w };
}

export async function getBreadth(): Promise<BreadthMetrics> {
  const tickers = await getSP500Tickers();
  // Process in parallel batches of 8 to respect Polygon rate limits.
  const BATCH_SIZE = 8;
  const lots: BreadthLot[] = [];
  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const slice = tickers.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(slice.map(scoreBreadthForTicker));
    for (const r of results) if (r) lots.push(r);
  }

  if (lots.length === 0) {
    return { pctAbove50dma: null, pctAbove200dma: null, newHighs: null, newLows: null, universeSize: 0 };
  }

  let above50 = 0, above200 = 0, newHighs = 0, newLows = 0;
  for (const lot of lots) {
    const ma50 = sma(lot.closes, 50);
    const ma200 = sma(lot.closes, 200);
    if (ma50 !== null && lot.lastClose > ma50) above50++;
    if (ma200 !== null && lot.lastClose > ma200) above200++;
    if (lot.lastClose >= lot.high52w * 0.999) newHighs++;
    if (lot.lastClose <= lot.low52w * 1.001) newLows++;
  }

  return {
    pctAbove50dma: (above50 / lots.length) * 100,
    pctAbove200dma: (above200 / lots.length) * 100,
    newHighs,
    newLows,
    universeSize: lots.length,
  };
}

// ─── Group 3: Risk Appetite ───────────────────────────────────────────────

async function getRatioWithDirection(numTicker: string, denTicker: string):
  Promise<{ ratio: number | null; direction: "rising" | "falling" | "flat" | null }>
{
  const [numCloses, denCloses] = await Promise.all([
    polygonDailyCloses(numTicker, "1mo"),
    polygonDailyCloses(denTicker, "1mo"),
  ]);
  if (!numCloses.length || !denCloses.length) {
    return { ratio: null, direction: null };
  }
  const todayN = numCloses[numCloses.length - 1];
  const todayD = denCloses[denCloses.length - 1];
  if (!todayN || !todayD) return { ratio: null, direction: null };
  const todayRatio = todayN / todayD;

  // 5-day direction
  const idx5 = Math.max(0, numCloses.length - 6);
  const idx5d = Math.max(0, denCloses.length - 6);
  const fiveAgoN = numCloses[idx5];
  const fiveAgoD = denCloses[idx5d];
  if (!fiveAgoN || !fiveAgoD) return { ratio: todayRatio, direction: null };
  const fiveAgoRatio = fiveAgoN / fiveAgoD;
  const change = (todayRatio - fiveAgoRatio) / fiveAgoRatio;
  const direction = Math.abs(change) < 0.005
    ? "flat" as const
    : change > 0 ? "rising" as const : "falling" as const;
  return { ratio: todayRatio, direction };
}

export async function getRiskAppetite(): Promise<RiskAppetiteMetrics> {
  const [{ ratio: hygLqdRatio, direction: hygLqdDirection }, { ratio: spyTltRatio, direction: spyTltDirection }] =
    await Promise.all([
      getRatioWithDirection("HYG", "LQD"),
      getRatioWithDirection("SPY", "TLT"),
    ]);
  return { hygLqdRatio, hygLqdDirection, spyTltRatio, spyTltDirection };
}

// ─── Group 4: Index Cards ─────────────────────────────────────────────────

const TRACKED_INDICES: ReadonlyArray<string> = ["SPY", "QQQ", "IWM", "DIA"];

async function buildIndexCard(symbol: string): Promise<IndexCard> {
  try {
    // Snapshot for current price + change pct
    const snap: any = await pget(`/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(symbol)}`);
    const t = snap?.ticker;
    const price =
      (t?.day?.c && t.day.c > 0 ? t.day.c : null) ??
      (t?.min?.c && t.min.c > 0 ? t.min.c : null) ??
      (t?.prevDay?.c && t.prevDay.c > 0 ? t.prevDay.c : null);
    const pctRaw = num(t?.todaysChangePerc);

    // 50/200d MAs from a 1y daily bar pull
    const closes = await polygonDailyCloses(symbol, "1y");
    const ma50 = sma(closes, 50);
    const ma200 = sma(closes, 200);
    const lastClose = closes.length ? closes[closes.length - 1] : null;
    const refPrice = price ?? lastClose;

    return {
      symbol,
      price: price ?? lastClose,
      changePct: pctRaw,
      above50dma: ma50 !== null && refPrice !== null ? refPrice > ma50 : null,
      above200dma: ma200 !== null && refPrice !== null ? refPrice > ma200 : null,
    };
  } catch {
    return { symbol, price: null, changePct: null, above50dma: null, above200dma: null };
  }
}

export async function getIndexCards(): Promise<IndexCard[]> {
  return Promise.all(TRACKED_INDICES.map(buildIndexCard));
}

// ─── Regime score + tier ──────────────────────────────────────────────────

export function computeRegime(
  vol: VolatilityMetrics,
  breadth: BreadthMetrics,
  risk: RiskAppetiteMetrics,
): RegimeVerdict {
  let score = 0;
  const lifting: string[] = [];
  const dragging: string[] = [];

  // Volatility (max 25 + 15 = 40 pts; we cap to 25 from this group via tiers)
  if (vol.vixPercentile20d !== null) {
    if (vol.vixPercentile20d < 50)      { score += 25; lifting.push("low volatility"); }
    else if (vol.vixPercentile20d < 70) { score += 15; }
    else                                { dragging.push("elevated volatility"); }
  }

  // Breadth (max 25 pts via tiers)
  if (breadth.pctAbove50dma !== null) {
    if (breadth.pctAbove50dma > 60)      { score += 25; lifting.push("broad participation"); }
    else if (breadth.pctAbove50dma > 45) { score += 15; }
    else                                  { dragging.push("weak breadth"); }
  }

  // New highs vs new lows (15 pts)
  if (breadth.newHighs !== null && breadth.newLows !== null) {
    if (breadth.newHighs > breadth.newLows) { score += 15; lifting.push("new highs leading"); }
    else if (breadth.newLows > breadth.newHighs) { dragging.push("new lows leading"); }
  }

  // Junk/IG (15 pts) — rising = risk-on
  if (risk.hygLqdDirection === "rising") { score += 15; lifting.push("credit risk-on"); }
  else if (risk.hygLqdDirection === "falling") { dragging.push("credit weakness"); }

  // Stocks/Bonds (10 pts) — rising = risk-on
  if (risk.spyTltDirection === "rising") { score += 10; lifting.push("equities outpacing bonds"); }
  else if (risk.spyTltDirection === "falling") { dragging.push("bonds outpacing equities"); }

  // VIX term structure (10 pts) — contango (VIX9D/VIX3M < 1.0) = calm
  if (vol.vixTermRatio !== null) {
    if (vol.vixTermRatio < 1.0) { score += 10; }
    else                         { dragging.push("vol curve in backwardation"); }
  }

  score = Math.max(0, Math.min(100, score));

  const tier: RegimeTier =
    score >= 80 ? "EUPHORIC" :
    score >= 60 ? "RISK_ON"  :
    score >= 40 ? "NEUTRAL"  :
    score >= 20 ? "DEFENSIVE" : "RISK_OFF";

  const tierExplainer: Record<RegimeTier, string> = {
    EUPHORIC:  "conditions extremely favorable — watch for complacency",
    RISK_ON:   "healthy environment for new long setups",
    NEUTRAL:   "mixed signals — be selective, smaller size",
    DEFENSIVE: "conditions deteriorating — tighten stops, prefer cash",
    RISK_OFF:  "hostile environment — most setups will fail",
  };

  // Headline: prefer dragging factors when score is mid/low (what's hurting),
  // lifting factors when it's high (what's helping). Fall back to the
  // generic explainer if nothing notable to say.
  const reasons = (score >= 60 ? lifting : dragging).slice(0, 2);
  const headline = reasons.length
    ? `${reasons.join(", ")}`
    : tierExplainer[tier];

  const contributors = [...lifting.map(s => `+ ${s}`), ...dragging.map(s => `− ${s}`)];

  return { score, tier, headline, contributors };
}

// ─── Main entry ───────────────────────────────────────────────────────────
// The page route reads from the cache (via the warmup cron). This function
// exists for cron handlers and on-demand refresh — runs everything live.

export async function buildMarketPulseLive(opts: { withBreadth?: boolean } = {}): Promise<MarketPulse> {
  const [vol, risk, indices] = await Promise.all([
    getVolatility(),
    getRiskAppetite(),
    getIndexCards(),
  ]);
  // Breadth is expensive (~500 ticker fetches) — only compute when asked.
  // The daily warmup runs once with withBreadth=true; intraday refreshes
  // rely on the cached breadth.
  const breadth: BreadthMetrics = opts.withBreadth
    ? await getBreadth()
    : { pctAbove50dma: null, pctAbove200dma: null, newHighs: null, newLows: null, universeSize: null };

  const regime = computeRegime(vol, breadth, risk);

  return {
    asOf: Date.now(),
    marketOpen: isUSMarketOpen(new Date()),
    volatility: vol,
    breadth,
    riskAppetite: risk,
    indices,
    regime,
  };
}

function isUSMarketOpen(d: Date): boolean {
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  // Approximate market hours: 13:30–20:00 UTC during EDT, 14:30–21:00 UTC during EST.
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  // Rough union of both DST states; close enough for the page label.
  return minutes >= 13 * 60 + 30 && minutes <= 21 * 60;
}
