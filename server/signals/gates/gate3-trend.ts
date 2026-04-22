/**
 * Gate 3 - GO (trend + MME alignment).
 * TODO: wire MME alignment check from features/mm-exposure.
 *       Starting spec: price above 50 EMA and prior Gate 2 pass.
 */
import type { OHLCV } from "../../data/types";

export interface Gate3Result {
  passed: boolean;
  reasons: string[];
}

export function evaluateGate3(bars: OHLCV[], gate2Passed: boolean): Gate3Result {
  const reasons: string[] = [];
  if (!gate2Passed) reasons.push("Gate 2 not passed");
  // TODO: trend check (EMA stack), MME alignment
  return {
    passed: gate2Passed, // placeholder
    reasons,
  };
}
