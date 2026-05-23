/**
 * Diagnostic scanner for the Wyckoff Spring detector.
 *
 * Fetches N years of daily bars for a single symbol from FMP, runs
 * `scanWyckoffSpring`, and returns the hits as JSON. Lets Chris eyeball
 * the dates / pierce depths / TR boundaries on /htf/:symbol-style charts
 * before we invest in the full backtest harness.
 *
 * Used by `/api/diag/wyckoff-spring-scan`.
 */

import { fmpGet } from "../data/providers/fmp.client";
import { scanWyckoffSpring, type WyckoffSpringHit } from "../signals/strategies/wyckoff-spring";
import type { OHLCV } from "../data/types";

async function fetchOHLCV(symbol: string, days: number): Promise<OHLCV[] | null> {
  try {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - (days + 250) * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const data: any = await fmpGet("/historical-price-eod/full", { symbol, from, to });
    const arr: any[] = Array.isArray(data) ? data : data?.historical || [];
    if (arr.length < 100) return null;
    const sorted = [...arr].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const bars: OHLCV[] = [];
    for (const r of sorted) {
      const o = Number(r.open),
        h = Number(r.high),
        l = Number(r.low),
        c = Number(r.close),
        v = Number(r.volume);
      if (!Number.isFinite(c)) continue;
      bars.push({
        t: new Date(String(r.date)),
        o,
        h,
        l,
        c,
        v: Number.isFinite(v) ? v : 0,
      });
    }
    return bars;
  } catch {
    return null;
  }
}

export interface WyckoffSpringScanResult {
  symbol: string;
  days: number;
  minScore: number;
  barCount: number;
  rangeFrom: string | null;
  rangeTo: string | null;
  hitCount: number;
  hits: Array<{
    breakoutDate: string;
    breakoutPrice: number;
    targetPrice: number;
    stopPrice: number;
    qualityScore: number;
    patternStart: string;
    patternEnd: string;
    extras: Omit<WyckoffSpringHit["extras"], "springDate" | "testDate"> & {
      springDate: string;
      testDate: string | null;
    };
  }>;
  notes: string[];
}

export async function runWyckoffSpringScan(
  symbol: string,
  days: number,
  minScore: number,
): Promise<WyckoffSpringScanResult> {
  const bars = await fetchOHLCV(symbol, days);
  if (!bars || bars.length === 0) {
    return {
      symbol,
      days,
      minScore,
      barCount: 0,
      rangeFrom: null,
      rangeTo: null,
      hitCount: 0,
      hits: [],
      notes: [`No bar data returned from FMP for ${symbol}.`],
    };
  }

  const hits = scanWyckoffSpring(bars, symbol, { lookbackDays: days, minScore });

  const serialized = hits.map(h => ({
    breakoutDate: h.breakoutDate.toISOString().slice(0, 10),
    breakoutPrice: Number(h.breakoutPrice.toFixed(2)),
    targetPrice: Number(h.targetPrice.toFixed(2)),
    stopPrice: Number(h.stopPrice.toFixed(2)),
    qualityScore: h.qualityScore,
    patternStart: h.patternStart.toISOString().slice(0, 10),
    patternEnd: h.patternEnd.toISOString().slice(0, 10),
    extras: {
      ...h.extras,
      springDate: h.extras.springDate.toISOString().slice(0, 10),
      testDate: h.extras.testDate ? h.extras.testDate.toISOString().slice(0, 10) : null,
    },
  }));

  return {
    symbol,
    days,
    minScore,
    barCount: bars.length,
    rangeFrom: bars[0].t.toISOString().slice(0, 10),
    rangeTo: bars[bars.length - 1].t.toISOString().slice(0, 10),
    hitCount: hits.length,
    hits: serialized,
    notes: [
      "Wyckoff Spring detector — SOS-fired hits only (no Forming variant yet).",
      "Each hit: breakoutDate is the SOS bar; entry would be next bar's open.",
      "Stop = spring_low × 0.98. Target = SOS_close + (TR_high − TR_low).",
      "Quality scoring: base 50, max 50 bonus across pierce depth, spring vol, test presence, SOS vol, TR tightness, TR duration.",
      "minScore=0 returns every detected hit; 70 = production threshold.",
    ],
  };
}
