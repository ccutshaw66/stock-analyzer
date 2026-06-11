/**
 * Canonical risk-free rate source for the greeks engine.
 *
 * ONE fetch path, cached on a long TTL (owner's rule). The 3-month T-bill is the
 * standard short-rate proxy for equity-option pricing. We pull it once from FMP's
 * /treasury-rates endpoint and cache it for the day; treasury yields barely move
 * intraday and our greeks are computed at EOD snapshot time anyway.
 *
 * Falls back to DEFAULT_RISK_FREE_RATE if FMP is unavailable or the shape is
 * unexpected — the math must never block on a network hiccup.
 */
import { fmpGet } from "../data/providers/fmp.client";
import { DEFAULT_RISK_FREE_RATE } from "./greeks";

interface TreasuryRow {
  date: string;
  month1?: number;
  month2?: number;
  month3?: number;
  month6?: number;
  year1?: number;
  [k: string]: unknown;
}

const TTL_MS = 12 * 60 * 60 * 1000; // 12h — yields are slow-moving
let cached: { rate: number; at: number } | null = null;

/**
 * Current risk-free rate as a decimal (e.g. 0.038 = 3.8%), from the 3-month
 * T-bill. Cached for 12h. Always resolves (never throws) — returns the constant
 * fallback on any failure.
 */
export async function getRiskFreeRate(): Promise<number> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.rate;
  try {
    // FMP returns most-recent-first; month3 is the 3-month T-bill yield in %.
    const rows = await fmpGet<TreasuryRow[]>("/treasury-rates");
    const latest = Array.isArray(rows) ? rows[0] : null;
    const pct = latest?.month3 ?? latest?.month6 ?? latest?.month1 ?? null;
    if (typeof pct === "number" && pct > 0 && pct < 25) {
      const rate = pct / 100;
      cached = { rate, at: Date.now() };
      return rate;
    }
  } catch {
    // fall through to constant
  }
  cached = { rate: DEFAULT_RISK_FREE_RATE, at: Date.now() };
  return DEFAULT_RISK_FREE_RATE;
}
