/**
 * Gate 1 - READY (reversal).
 * Spec from threads: RSI < 40 AND volume spike >= 1.8x AND BB lower touch/re-entry.
 */
import type { OHLCV } from "../../data/types";
import { computeRSI, computeBollinger, volumeSpikeRatio } from "../../indicators";

export interface Gate1Result {
  passed: boolean;
  rsi: number | null;
  volumeSpike: number | null;
  bbLowerTouched: boolean;
  reasons: string[];
}

export function evaluateGate1(bars: OHLCV[]): Gate1Result {
  const reasons: string[] = [];
  const rsi = computeRSI(bars);
  const bb = computeBollinger(bars);
  const volSpike = volumeSpikeRatio(bars);
  const last = bars[bars.length - 1];

  const rsiOk = rsi !== null && rsi < 40;
  const volOk = volSpike !== null && volSpike >= 1.8;
  const bbOk = bb !== null && last.l <= bb.lower;

  if (!rsiOk) reasons.push(`RSI ${rsi?.toFixed(1) ?? "n/a"} not < 40`);
  if (!volOk) reasons.push(`Volume spike ${volSpike?.toFixed(2) ?? "n/a"}x not >= 1.8x`);
  if (!bbOk) reasons.push(`No BB lower band touch`);

  return {
    passed: rsiOk && volOk && bbOk,
    rsi,
    volumeSpike: volSpike,
    bbLowerTouched: bbOk,
    reasons,
  };
}
