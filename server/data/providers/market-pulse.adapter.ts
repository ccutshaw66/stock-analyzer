/**
 * Market Pulse adapter — FMP-only.
 *
 * Computes the macro-snapshot the Market Pulse page renders:
 *   - Volatility:   VIX level, 20-day percentile, term structure (VIX9D / VIX3M)
 *   - Breadth:      % of S&P 500 above 50d/200d MA, new 52w highs/lows
 *   - Risk appetite: HYG/LQD ratio + 5d direction, SPY/TLT ratio + 5d direction
 *   - Indices:      SPY, QQQ, IWM, DIA cards (price, day-pct, above 50/200d)
 *   - Safe haven:   Gold, Silver, Gold/Silver ratio with regime tag
 *   - Headline:     5-tier label (RISK-OFF / DEFENSIVE / NEUTRAL / RISK-ON / EUPHORIC)
 *                   + dynamic explainer
 *
 * All sources are FMP stable endpoints. No Polygon. Field names
 * verified in docs/FMP_REFERENCE.md.
 */

import { fmpGet } from "./fmp.client";
import { logger as rootLogger } from "../../lib/logger";

const log = rootLogger.child({ module: "market-pulse" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IndexCard {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
  above50d: boolean | null;
  above200d: boolean | null;
}

export interface MetalCard {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
}

export type RegimeTier = "RISK-OFF" | "DEFENSIVE" | "NEUTRAL" | "RISK-ON" | "EUPHORIC";

export interface MarketPulseSnapshot {
  asOf: number;                  // unix ms
  marketStatus: "open" | "closed";
  volatility: {
    vix: number | null;
    vixPercentile20d: number | null;  // 0..100
    vix9d: number | null;
    vix3m: number | null;
    termRatio: number | null;         // vix9d / vix3m; >1 = backwardation = stress
  };
  breadth: {
    pctAbove50d: number | null;       // 0..100
    pctAbove200d: number | null;
    newHighs: number | null;
    newLows: number | null;
    universeSize: number | null;
  };
  riskAppetite: {
    junkInvestmentRatio: number | null;     // HYG / LQD
    junkRising5d: boolean | null;
    stocksBondsRatio: number | null;        // SPY / TLT
    stocksRising5d: boolean | null;
  };
  indices: IndexCard[];
  safeHaven: {
    gold: MetalCard;
    silver: MetalCard;
    goldSilverRatio: number | null;
    ratioRegime: "GOLD CHEAP" | "FAIR" | "SILVER CHEAP" | null;
  };
  regime: {
    score: number;                  // 0..100
    tier: RegimeTier;
    explainer: string;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const num = (v: any): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function fmpQuote(symbol: string): Promise<{ price: number | null; changePct: number | null } | null> {
  try {
    const rows = await fmpGet<any[]>("/quote", { symbol });
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;
    return {
      price: num(row.price),
      changePct: num(row.changePercentage) ?? num(row.changesPercentage),
    };
  } catch (e: any) {
    log.debug({ symbol, err: String(e?.message || e) }, "fmp quote failed");
    return null;
  }
}

async function fmpHistoricalCloses(symbol: string, days: number): Promise<number[]> {
  // Pull a generous window so we have enough closes for the longest MA we
  // compute (200) plus the percentile lookback. 380 trading days ≈ 18 months.
  try {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const data: any = await fmpGet("/historical-price-eod/full", { symbol, from, to });
    const arr = Array.isArray(data) ? data : (data?.historical || []);
    if (!arr.length) return [];
    // FMP returns most-recent-first by default; ensure we're chronologically asc.
    const sorted = [...arr].sort((a: any, b: any) =>
      String(a.date).localeCompare(String(b.date)),
    );
    return sorted.map((r: any) => Number(r.close)).filter((n: number) => Number.isFinite(n));
  } catch (e: any) {
    log.debug({ symbol, err: String(e?.message || e) }, "fmp historical fetch failed");
    return [];
  }
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

function percentileRank(arr: number[], target: number): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  let countAtOrBelow = 0;
  for (const v of sorted) if (v <= target) countAtOrBelow++; else break;
  return Math.round((countAtOrBelow / sorted.length) * 100);
}

// ─── Volatility ─────────────────────────────────────────────────────────────

export async function getVolatility(): Promise<MarketPulseSnapshot["volatility"]> {
  // VIX9D and VIX3M may not always be available on FMP; tolerate null.
  const [vixQ, vix9dQ, vix3mQ, vixHist] = await Promise.all([
    fmpQuote("^VIX"),
    fmpQuote("^VIX9D"),
    fmpQuote("^VIX3M"),
    fmpHistoricalCloses("^VIX", 30),
  ]);

  const vix = vixQ?.price ?? null;
  const vix9d = vix9dQ?.price ?? null;
  const vix3m = vix3mQ?.price ?? null;
  const termRatio = vix9d != null && vix3m != null && vix3m > 0 ? vix9d / vix3m : null;

  // 20-day percentile of VIX closes. Higher percentile = relatively elevated fear.
  let vixPercentile20d: number | null = null;
  if (vix != null && vixHist.length >= 5) {
    const recent = vixHist.slice(-20);
    vixPercentile20d = percentileRank(recent, vix);
  }

  return { vix, vixPercentile20d, vix9d, vix3m, termRatio };
}

// ─── Breadth ────────────────────────────────────────────────────────────────

export async function getBreadth(): Promise<MarketPulseSnapshot["breadth"]> {
  // Fetch S&P 500 constituents directly from FMP (no scraping, no hardcoded lists).
  let constituents: string[] = [];
  try {
    const rows: any = await fmpGet("/sp500-constituent", {});
    if (Array.isArray(rows)) {
      constituents = rows.map((r: any) => String(r.symbol || "")).filter(Boolean);
    }
  } catch (e: any) {
    log.warn({ err: String(e?.message || e) }, "sp500-constituent fetch failed");
  }

  if (!constituents.length) {
    return {
      pctAbove50d: null, pctAbove200d: null,
      newHighs: null, newLows: null, universeSize: null,
    };
  }

  // For each ticker, pull ~252 trading days of closes. To stay polite to FMP
  // (3000 req/min on Ultimate is generous but not infinite), batch 25 at a
  // time with a small inter-batch delay. ~500 tickers / 25 = 20 batches at
  // ~250ms each ≈ 5s total. Runs in cron, not on the request path.
  let above50 = 0, above200 = 0, newHighs = 0, newLows = 0, scored = 0;

  const BATCH_SIZE = 25;
  for (let i = 0; i < constituents.length; i += BATCH_SIZE) {
    const batch = constituents.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((sym) => fmpHistoricalCloses(sym, 380)),
    );
    for (let j = 0; j < results.length; j++) {
      const res = results[j];
      if (res.status !== "fulfilled") continue;
      const closes = res.value;
      if (closes.length < 50) continue;
      const last = closes[closes.length - 1];
      const sma50 = sma(closes, 50);
      const sma200 = sma(closes, 200);
      const lookback252 = closes.slice(-252);
      const max252 = Math.max(...lookback252);
      const min252 = Math.min(...lookback252);
      scored++;
      if (sma50 != null && last > sma50) above50++;
      if (sma200 != null && last > sma200) above200++;
      // Allow tiny float slop on the high/low equality check.
      if (last >= max252 - 1e-9) newHighs++;
      if (last <= min252 + 1e-9) newLows++;
    }
    // 250ms inter-batch breather to keep the FMP rate gauge calm.
    if (i + BATCH_SIZE < constituents.length) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  if (scored === 0) {
    return {
      pctAbove50d: null, pctAbove200d: null,
      newHighs: null, newLows: null, universeSize: null,
    };
  }

  return {
    pctAbove50d: Math.round((above50 / scored) * 100),
    pctAbove200d: Math.round((above200 / scored) * 100),
    newHighs,
    newLows,
    universeSize: scored,
  };
}

// ─── Risk appetite ──────────────────────────────────────────────────────────

async function ratio5dDirection(symA: string, symB: string): Promise<{ ratio: number | null; rising: boolean | null }> {
  const [a, b] = await Promise.all([
    fmpHistoricalCloses(symA, 15),
    fmpHistoricalCloses(symB, 15),
  ]);
  if (a.length < 6 || b.length < 6) return { ratio: null, rising: null };
  const todayA = a[a.length - 1];
  const todayB = b[b.length - 1];
  const fiveDaysAgoA = a[a.length - 6];
  const fiveDaysAgoB = b[b.length - 6];
  const todayRatio = todayB > 0 ? todayA / todayB : null;
  const priorRatio = fiveDaysAgoB > 0 ? fiveDaysAgoA / fiveDaysAgoB : null;
  if (todayRatio == null || priorRatio == null) return { ratio: null, rising: null };
  return { ratio: todayRatio, rising: todayRatio > priorRatio };
}

export async function getRiskAppetite(): Promise<MarketPulseSnapshot["riskAppetite"]> {
  const [junk, stocks] = await Promise.all([
    ratio5dDirection("HYG", "LQD"),
    ratio5dDirection("SPY", "TLT"),
  ]);
  return {
    junkInvestmentRatio: junk.ratio,
    junkRising5d: junk.rising,
    stocksBondsRatio: stocks.ratio,
    stocksRising5d: stocks.rising,
  };
}

// ─── Index cards ────────────────────────────────────────────────────────────

const INDEX_LIST: Array<{ symbol: string; name: string }> = [
  { symbol: "SPY", name: "S&P 500" },
  { symbol: "QQQ", name: "Nasdaq 100" },
  { symbol: "IWM", name: "Russell 2000" },
  { symbol: "DIA", name: "Dow Jones" },
];

async function buildIndexCard(symbol: string, name: string): Promise<IndexCard> {
  const [quote, closes] = await Promise.all([
    fmpQuote(symbol),
    fmpHistoricalCloses(symbol, 380),
  ]);
  const price = quote?.price ?? null;
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  return {
    symbol, name, price,
    changePct: quote?.changePct ?? null,
    above50d: price != null && sma50 != null ? price > sma50 : null,
    above200d: price != null && sma200 != null ? price > sma200 : null,
  };
}

export async function getIndexCards(): Promise<IndexCard[]> {
  return Promise.all(INDEX_LIST.map((i) => buildIndexCard(i.symbol, i.name)));
}

// ─── Safe Haven ─────────────────────────────────────────────────────────────

export async function getSafeHaven(): Promise<MarketPulseSnapshot["safeHaven"]> {
  const [g, s] = await Promise.all([
    fmpQuote("GCUSD"),
    fmpQuote("SIUSD"),
  ]);
  const gold: MetalCard = { symbol: "GCUSD", name: "Gold", price: g?.price ?? null, changePct: g?.changePct ?? null };
  const silver: MetalCard = { symbol: "SIUSD", name: "Silver", price: s?.price ?? null, changePct: s?.changePct ?? null };
  const ratio = gold.price != null && silver.price != null && silver.price > 0
    ? gold.price / silver.price
    : null;
  // Historical regime ranges: >80 silver looks cheap, 60-80 fair, <60 gold looks cheap.
  let ratioRegime: MarketPulseSnapshot["safeHaven"]["ratioRegime"] = null;
  if (ratio != null) {
    if (ratio > 80) ratioRegime = "SILVER CHEAP";
    else if (ratio < 60) ratioRegime = "GOLD CHEAP";
    else ratioRegime = "FAIR";
  }
  return { gold, silver, goldSilverRatio: ratio, ratioRegime };
}

// ─── Regime classification ──────────────────────────────────────────────────

export function computeRegime(
  vol: MarketPulseSnapshot["volatility"],
  breadth: MarketPulseSnapshot["breadth"],
  risk: MarketPulseSnapshot["riskAppetite"],
): { score: number; tier: RegimeTier; explainer: string } {
  let score = 0;

  // Volatility: low VIX % rank → calm market, more risk-on points
  if (vol.vixPercentile20d != null) {
    if (vol.vixPercentile20d < 50) score += 25;
    else if (vol.vixPercentile20d < 70) score += 15;
  }
  // Breadth: broad participation
  if (breadth.pctAbove50d != null) {
    if (breadth.pctAbove50d > 60) score += 25;
    else if (breadth.pctAbove50d > 45) score += 15;
  }
  // New highs > new lows: bullish momentum
  if (breadth.newHighs != null && breadth.newLows != null) {
    if (breadth.newHighs > breadth.newLows) score += 15;
  }
  // Risk-on rotations
  if (risk.junkRising5d === true) score += 15;
  if (risk.stocksRising5d === true) score += 10;
  // VIX term structure in contango (>1 means front > back, INVERTED = stress).
  // Original spec rewards contango; with vix9d/vix3m, ratio < 1 = contango = calm.
  if (vol.termRatio != null && vol.termRatio < 1.0) score += 10;

  let tier: RegimeTier;
  if (score >= 80) tier = "EUPHORIC";
  else if (score >= 60) tier = "RISK-ON";
  else if (score >= 40) tier = "NEUTRAL";
  else if (score >= 20) tier = "DEFENSIVE";
  else tier = "RISK-OFF";

  // Explainer: list dragging factors when in defensive/neutral, otherwise a
  // canonical one-liner.
  const drags: string[] = [];
  if (vol.vixPercentile20d != null && vol.vixPercentile20d > 70) drags.push("elevated volatility");
  if (breadth.pctAbove50d != null && breadth.pctAbove50d < 45) drags.push("weak breadth");
  if (risk.junkRising5d === false) drags.push("credit weakness");
  if (vol.termRatio != null && vol.termRatio > 1.0) drags.push("VIX term inverted");
  if (breadth.newLows != null && breadth.newHighs != null && breadth.newLows > breadth.newHighs) {
    drags.push("more new lows than highs");
  }

  const baseExplainer: Record<RegimeTier, string> = {
    "EUPHORIC": "Conditions extremely favorable — watch for complacency",
    "RISK-ON": "Healthy environment for new long setups",
    "NEUTRAL": "Mixed signals — be selective, smaller size",
    "DEFENSIVE": "Conditions deteriorating — tighten stops, prefer cash",
    "RISK-OFF": "Hostile environment — most setups will fail",
  };

  const explainer = drags.length && (tier === "DEFENSIVE" || tier === "NEUTRAL" || tier === "RISK-OFF")
    ? drags.join(", ")
    : baseExplainer[tier];

  return { score, tier, explainer };
}

// ─── Market hours helper ────────────────────────────────────────────────────

export function isMarketHours(): boolean {
  const now = new Date();
  const etOffset = isDST(now) ? -4 : -5;
  const etHour = (now.getUTCHours() + etOffset + 24) % 24;
  const etMinute = now.getUTCMinutes();
  const dayOfWeek = now.getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  const minutesSinceMidnight = etHour * 60 + etMinute;
  return minutesSinceMidnight >= 9 * 60 + 30 && minutesSinceMidnight <= 16 * 60;
}

function isDST(date: Date): boolean {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return date.getTimezoneOffset() < Math.max(jan, jul);
}

// ─── Top-level builders ─────────────────────────────────────────────────────

/**
 * Fast intraday snapshot (no breadth — that's the daily warmup's job).
 * Reuses cached breadth from the snapshot store; caller stitches them together.
 */
export async function buildIntradaySnapshot(): Promise<Omit<MarketPulseSnapshot, "breadth" | "regime"> & { asOf: number }> {
  const [vol, risk, indices, safeHaven] = await Promise.all([
    getVolatility(),
    getRiskAppetite(),
    getIndexCards(),
    getSafeHaven(),
  ]);
  return {
    asOf: Date.now(),
    marketStatus: isMarketHours() ? "open" : "closed",
    volatility: vol,
    riskAppetite: risk,
    indices,
    safeHaven,
  };
}
