/**
 * Confluence Pulse route — the north-star "everything in one page" widget.
 *
 * Returns the 5-spoke radar data for ONE ticker, pulled from the latest
 * `compassSnapshots` row. The compass cron already populates this nightly
 * for the tracked universe (see `server/conviction/tracker.ts`).
 *
 * Spokes (0-100, higher = more aligned):
 *   1. Smart Money     — institutional flow + insider buying signals
 *   2. Dealer Positioning — GEX, gamma flip, max-pain proximity
 *   3. Technical       — EMA stack, MACD, RSI alignment
 *   4. Fundamental     — 8-factor scoring
 *   5. Market Regime   — top-of-page tier from Market Pulse (live, not snapshot)
 *
 * The first 4 come from `compassSnapshots`. The 5th comes from the live
 * Market Pulse cache so a regime shift since the nightly snapshot is
 * reflected.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import { db } from "../db";
import { compassSnapshots } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export interface ConfluenceSpoke {
  axis: string;
  value: number | null;        // 0-100; null if data unavailable
  rawScore: number | null;     // -100..+100 underlying score
  href: string;                // page the spoke drills into
}

export interface ConfluencePulse {
  ticker: string;
  spotPrice: number | null;
  takenAt: string | null;      // ISO; null if no snapshot
  verdict: string | null;      // ALL_ALIGNED_BULLISH, etc
  confidence: string | null;
  confluence: number | null;   // -100..+100 composite
  alignment: number | null;    // 0..1 — how many spokes agree
  spokes: ConfluenceSpoke[];
  axesAvailable: number;
  generatedAt: string;
}

function toRadar(raw: number | null): number | null {
  if (raw == null) return null;
  // Conviction spokes are -100..+100. Map to 0-100 where 50 = neutral.
  return Math.round((raw + 100) / 2);
}

async function fetchRegimeSpoke(): Promise<ConfluenceSpoke> {
  const TIER_SCORE: Record<string, number> = {
    "RISK-OFF": 10,
    "DEFENSIVE": 30,
    "NEUTRAL": 50,
    "RISK-ON": 75,
    "EUPHORIC": 90,
  };
  try {
    const { readIntraday, readBreadth } = await import("../market-pulse-cache");
    const { computeRegime } = await import("../data/providers/market-pulse.adapter");
    const intraday = readIntraday();
    if (!intraday) return { axis: "Market Regime", value: null, rawScore: null, href: "/market-pulse" };
    const breadth = readBreadth() ?? {
      pctAbove50d: null, pctAbove200d: null,
      newHighs: null, newLows: null, universeSize: null,
      asOf: 0,
    };
    const regime = computeRegime(intraday.volatility, breadth, intraday.riskAppetite);
    const v = regime?.tier ? TIER_SCORE[regime.tier] ?? 50 : null;
    return { axis: "Market Regime", value: v, rawScore: regime?.score ?? null, href: "/market-pulse" };
  } catch {
    return { axis: "Market Regime", value: null, rawScore: null, href: "/market-pulse" };
  }
}

export async function buildConfluencePulse(ticker: string): Promise<ConfluencePulse> {
  const T = ticker.toUpperCase();
  const rows = await db
    .select()
    .from(compassSnapshots)
    .where(eq(compassSnapshots.ticker, T))
    .orderBy(desc(compassSnapshots.takenAt))
    .limit(1);

  const regimeSpoke = await fetchRegimeSpoke();

  if (rows.length === 0) {
    // No compass snapshot for this ticker — return regime + empty spokes
    return {
      ticker: T,
      spotPrice: null,
      takenAt: null,
      verdict: null,
      confidence: null,
      confluence: null,
      alignment: null,
      spokes: [
        { axis: "Smart Money", value: null, rawScore: null, href: "/institutional" },
        { axis: "Dealer Positioning", value: null, rawScore: null, href: "/mm-exposure" },
        { axis: "Technical", value: null, rawScore: null, href: `/chart/confluence/${T}` },
        { axis: "Fundamental", value: null, rawScore: null, href: `/profile?ticker=${T}` },
        regimeSpoke,
      ],
      axesAvailable: 1,
      generatedAt: new Date().toISOString(),
    };
  }

  const r = rows[0];
  return {
    ticker: T,
    spotPrice: r.spotPrice,
    takenAt: r.takenAt.toISOString(),
    verdict: r.verdict,
    confidence: r.confidence,
    confluence: r.confluence,
    alignment: r.alignment,
    spokes: [
      { axis: "Smart Money", value: toRadar(r.smartMoneyFlow), rawScore: r.smartMoneyFlow, href: "/institutional" },
      { axis: "Dealer Positioning", value: toRadar(r.dealerPositioning), rawScore: r.dealerPositioning, href: "/mm-exposure" },
      { axis: "Technical", value: toRadar(r.technicalMomentum), rawScore: r.technicalMomentum, href: `/chart/confluence/${T}` },
      { axis: "Fundamental", value: toRadar(r.fundamentalQuality), rawScore: r.fundamentalQuality, href: `/profile?ticker=${T}` },
      regimeSpoke,
    ],
    axesAvailable: r.axesAvailable + (regimeSpoke.value != null ? 1 : 0),
    generatedAt: new Date().toISOString(),
  };
}

export function registerConfluencePulseRoute(app: Express): void {
  app.get(
    "/api/dashboard/confluence-pulse/:ticker",
    requireAuth,
    async (req: Request, res: Response) => {
      const ticker = String(req.params.ticker || "").trim();
      if (!ticker) return res.status(400).json({ error: "ticker_required" });
      try {
        const pulse = await buildConfluencePulse(ticker);
        res.json(pulse);
      } catch (err: any) {
        console.error("[dashboard] confluence-pulse failed:", err?.message || err);
        res.status(500).json({ error: "confluence_pulse_failed", message: String(err?.message || err) });
      }
    },
  );
}
