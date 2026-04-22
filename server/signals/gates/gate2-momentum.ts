/**
 * Gate 2 - SET (momentum confirmation).
 * TODO: formalize thresholds. Starting spec: MACD histogram crossing up + prior Gate 1 pass.
 */
import type { OHLCV } from "../../data/types";
import { computeMACD } from "../../indicators";

export interface Gate2Result {
  passed: boolean;
  macdHistogram: number | null;
  reasons: string[];
}

export function evaluateGate2(bars: OHLCV[], gate1Passed: boolean): Gate2Result {
  const reasons: string[] = [];
  const macd = computeMACD(bars);
  const momentumOk = macd !== null && macd.histogram > 0;
  if (!gate1Passed) reasons.push("Gate 1 not passed");
  if (!momentumOk) reasons.push("MACD histogram not positive");

  return {
    passed: gate1Passed && momentumOk,
    macdHistogram: macd?.histogram ?? null,
    reasons,
  };
}
