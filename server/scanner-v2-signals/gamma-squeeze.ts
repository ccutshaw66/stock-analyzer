/**
 * Gamma-Squeeze detector.
 *
 * Fires when dealer positioning in options is likely to amplify spot moves.
 * Classic short-gamma regime: dealers are net SHORT calls / LONG puts, and
 * the bulk of gamma sits either above spot (upside squeeze risk) or below
 * (downside squeeze risk).
 *
 * When dealers are short gamma and spot moves toward a heavy-gamma strike,
 * they must hedge in the direction of the move — buying into rallies or
 * selling into drops — which feeds the move (the squeeze).
 *
 * Data source: computeMMExposure() in ../mm-exposure.
 *
 * Uses the precomputed squeezeBias / squeezeStrength which already accounts
 * for total GEX sign, the spread of GEX above vs below spot, and the
 * magnitude of short-gamma dollar exposure.
 */
import type { SignalDetector, SignalResult } from "../scanner-v2";

const MIN_STRENGTH = 0.15;

export const gammaSqueezeDetector: SignalDetector = (ctx): SignalResult | null => {
  const mm = ctx.extras?.mmExposure;
  if (!mm) return null;

  if (mm.squeezeBias === "neutral" || mm.squeezeStrength < MIN_STRENGTH) {
    return {
      id: "gamma_squeeze",
      label: "Gamma Squeeze",
      triggered: false,
      strength: mm.squeezeStrength,
      direction: "either",
      detail: `GEX=${(mm.totalGEX / 1e9).toFixed(2)}B neutral`,
    };
  }

  const wall = mm.gammaWall != null ? ` wall=$${mm.gammaWall}` : "";
  const gexStr = `${(mm.totalGEX / 1e9).toFixed(2)}B`;
  return {
    id: "gamma_squeeze",
    label: "Gamma Squeeze",
    triggered: true,
    strength: mm.squeezeStrength,
    direction: mm.squeezeBias,
    detail: `dealer short-γ, GEX=${gexStr}${wall}`,
  };
};
