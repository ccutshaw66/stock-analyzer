/**
 * Shared contract for the unified scanner — used by the server engine/routes
 * and the client page/widget so filters and results stay in sync.
 *
 * The market-cap tiers are a REQUIRED choice (no "All") and each tier carries
 * its own adaptive price bands. The score gate is locked to green (80+).
 */

/** One scored setup returned by the unified scanner. Provider-independent. */
export interface ScanHit {
  symbol: string;
  companyName: string;
  strategyId: string;       // matches a StrategyManifest.id
  strategyLabel: string;    // manifest.shortName for the badge
  score: number;            // 0–100 (only ≥ MIN_GREEN ever surfaced)
  direction: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  price: number;            // last close at scan time
  marketCap: number;
  sector: string;
  asOf: string;             // ISO date (YYYY-MM-DD) of the bar the hit fired on
}

export const MIN_GREEN = 80;            // hard floor — never show below this
export const DEFAULT_TOP_N = 25;

export type MarketCapTierId = "micro" | "small" | "mid" | "large" | "mega";

export interface PriceBand {
  id: string;
  label: string;
  min: number;
  max: number | null;       // null = no upper bound
}

export interface MarketCapTier {
  id: MarketCapTierId;
  label: string;
  min: number;              // USD
  max: number | null;       // null = no upper bound
  priceBands: PriceBand[];  // adaptive price ranges shown for this tier
}

const LOW_PRICE_BANDS: PriceBand[] = [
  { id: "p1", label: "$1–5", min: 1, max: 5 },
  { id: "p2", label: "$5–15", min: 5, max: 15 },
  { id: "p3", label: "$15–50", min: 15, max: 50 },
];

const MID_PRICE_BANDS: PriceBand[] = [
  { id: "p1", label: "$10–30", min: 10, max: 30 },
  { id: "p2", label: "$30–75", min: 30, max: 75 },
  { id: "p3", label: "$75–150", min: 75, max: 150 },
];

const HIGH_PRICE_BANDS: PriceBand[] = [
  { id: "p1", label: "$20–100", min: 20, max: 100 },
  { id: "p2", label: "$100–300", min: 100, max: 300 },
  { id: "p3", label: "$300+", min: 300, max: null },
];

export const MARKET_CAP_TIERS: MarketCapTier[] = [
  { id: "micro", label: "Micro (<$300M)", min: 0, max: 300_000_000, priceBands: LOW_PRICE_BANDS },
  { id: "small", label: "Small ($300M–$2B)", min: 300_000_000, max: 2_000_000_000, priceBands: LOW_PRICE_BANDS },
  { id: "mid", label: "Mid ($2B–$10B)", min: 2_000_000_000, max: 10_000_000_000, priceBands: MID_PRICE_BANDS },
  { id: "large", label: "Large ($10B–$200B)", min: 10_000_000_000, max: 200_000_000_000, priceBands: HIGH_PRICE_BANDS },
  { id: "mega", label: "Mega ($200B+)", min: 200_000_000_000, max: null, priceBands: HIGH_PRICE_BANDS },
];

export function getMarketCapTier(id: string | undefined | null): MarketCapTier | undefined {
  return MARKET_CAP_TIERS.find(t => t.id === id);
}

export function getPriceBand(tierId: string | undefined | null, bandId: string | undefined | null): PriceBand | undefined {
  return getMarketCapTier(tierId)?.priceBands.find(b => b.id === bandId);
}

export interface ScanFilters {
  marketCapTier: MarketCapTierId;   // REQUIRED (no "all")
  priceBandId: string;              // REQUIRED, must belong to the tier
  sector: string | "all";           // optional
  strategyIds: string[];            // which strategies to run
  minScore: number;                 // ≥ MIN_GREEN, defaults to MIN_GREEN
  topN: number;                     // default DEFAULT_TOP_N
}
