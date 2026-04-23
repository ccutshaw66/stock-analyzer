/**
 * Small-Float context signal.
 *
 * Fires when a ticker's free float is small enough that a catalyst or volume
 * spike can move it disproportionately. Small-float names are over-represented
 * in outsized moves because a given dollar flow consumes a larger fraction of
 * the tradeable share pool.
 *
 * Tiers:
 *   <  25M float  → ultra-low (strength 1.0, direction "either")
 *   <  50M float  → very low   (strength 0.8)
 *   < 100M float  → low        (strength 0.5)
 *   < 250M float  → modest     (strength 0.2)
 *   ≥ 250M float  → not small  (not triggered)
 *
 * Direction is "either" — small float amplifies moves in both directions. The
 * purpose of this signal is to be a multiplier/context marker, not a standalone
 * thesis. In the score aggregator we treat it as context and bump the weight
 * only when another signal already fires.
 *
 * Data source: FMP /stable/shares-float-all (bulk), batch-loaded once per scan.
 */
import type { SignalDetector, SignalResult } from "../scanner-v2";

export const smallFloatDetector: SignalDetector = (ctx): SignalResult | null => {
  const floatShares = ctx.extras?.floatShares;
  if (!floatShares || floatShares <= 0) return null; // no float data

  const fmt = (n: number) => {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
    return `${n.toLocaleString()}`;
  };

  let strength = 0;
  let tier = "";
  if (floatShares < 25_000_000) {
    strength = 1.0;
    tier = "ultra-low";
  } else if (floatShares < 50_000_000) {
    strength = 0.8;
    tier = "very low";
  } else if (floatShares < 100_000_000) {
    strength = 0.5;
    tier = "low";
  } else if (floatShares < 250_000_000) {
    strength = 0.2;
    tier = "modest";
  } else {
    return {
      id: "small_float",
      label: "Small Float",
      triggered: false,
      strength: 0,
      direction: "either",
      detail: `float ${fmt(floatShares)} (not small)`,
    };
  }

  return {
    id: "small_float",
    label: "Small Float",
    triggered: true,
    strength,
    direction: "either",
    detail: `${tier} float ${fmt(floatShares)}`,
  };
};
