/**
 * Confluence engine: runs all gates against a symbol's bars and returns a
 * single verdict object. This is what pages render.
 *
 * CRITICAL: scanner, watchlist, verdict, and trade analysis all call THIS.
 * No direct indicator calls from page code. This is how SOFI/TAL/RSI
 * mismatches stop happening.
 */
import type { OHLCV } from "../data/types";
import { evaluateGate1 } from "./gates/gate1-reversal";
import { evaluateGate2 } from "./gates/gate2-momentum";
import { evaluateGate3 } from "./gates/gate3-trend";

export interface ConfluenceResult {
  symbol: string;
  gate1: ReturnType<typeof evaluateGate1>;
  gate2: ReturnType<typeof evaluateGate2>;
  gate3: ReturnType<typeof evaluateGate3>;
  gatesPassed: number;
  verdict: "no-setup" | "ready" | "set" | "go";
  computedAt: Date;
}

export function evaluateConfluence(symbol: string, bars: OHLCV[]): ConfluenceResult {
  const g1 = evaluateGate1(bars);
  const g2 = evaluateGate2(bars, g1.passed);
  const g3 = evaluateGate3(bars, g2.passed);
  const passed = [g1.passed, g2.passed, g3.passed].filter(Boolean).length;
  const verdict: ConfluenceResult["verdict"] =
    passed === 0 ? "no-setup" : passed === 1 ? "ready" : passed === 2 ? "set" : "go";

  return { symbol, gate1: g1, gate2: g2, gate3: g3, gatesPassed: passed, verdict, computedAt: new Date() };
}
