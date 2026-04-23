/**
 * Insider-Cluster detector.
 *
 * Fires when multiple insiders buy (or sell) a ticker within a short window.
 * Cluster activity — 3+ insiders transacting in the same direction within
 * 14 days — is a classic signal because individual insiders can have
 * idiosyncratic reasons, but multiple insiders converging is hard to ignore.
 *
 * Buy clusters (direction=up): only open-market purchases ("P-Purchase")
 * count. Award grants, exercises, and gifts are excluded — they don't
 * reflect conviction.
 *
 * Sell clusters (direction=down): only open-market sales ("S-Sale") count.
 * We exclude "F-InKind" (tax-withholding), "D-Return", "G-Gift", etc.
 *
 * Strength: scales with cluster size. 3 insiders = 0.3, 5 = 0.6, 8+ = 1.0.
 * A buy cluster trumps a sell cluster if both exist (insider buying is
 * rarer and more informative than selling).
 *
 * Data source: FMP /stable/insider-trading/latest, paginated across the
 * last ~14 days and batch-loaded once per scan by the orchestrator.
 */
import type { SignalDetector, SignalResult } from "../scanner-v2";

const MIN_CLUSTER = 3;

export const insiderClusterDetector: SignalDetector = (ctx): SignalResult | null => {
  const cluster = ctx.extras?.insiderCluster;
  if (!cluster) return null; // no insider data loaded for this ticker

  const { buys, sells, windowDays } = cluster;

  if (buys < MIN_CLUSTER && sells < MIN_CLUSTER) {
    return {
      id: "insider_cluster",
      label: "Insider Cluster",
      triggered: false,
      strength: 0,
      direction: "either",
      detail: `${buys}B/${sells}S in ${windowDays}d (need ≥${MIN_CLUSTER})`,
    };
  }

  // Buy cluster wins ties — open-market insider buying is the rarer, more
  // conviction-laden signal. A ticker with 4 buys and 5 sells reads as
  // "insiders buying AND selling" → we prefer highlighting the buying side.
  const useBuy = buys >= MIN_CLUSTER && buys >= sells;
  const count = useBuy ? buys : sells;
  const direction: "up" | "down" = useBuy ? "up" : "down";

  // Strength curve: 3 → 0.3, 5 → 0.6, 8+ → 1.0. Linear between these.
  let strength: number;
  if (count >= 8) strength = 1.0;
  else if (count >= 5) strength = 0.6 + ((count - 5) / 3) * 0.4;
  else strength = 0.3 + ((count - 3) / 2) * 0.3;
  strength = Math.max(0.2, Math.min(1, strength));

  const noun = useBuy ? "buying" : "selling";
  const extra = buys >= MIN_CLUSTER && sells >= MIN_CLUSTER ? ` (${buys}B/${sells}S)` : "";
  return {
    id: "insider_cluster",
    label: "Insider Cluster",
    triggered: true,
    strength,
    direction,
    detail: `${count} insiders ${noun} in ${windowDays}d${extra}`,
  };
};
