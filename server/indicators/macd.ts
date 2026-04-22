/**
 * MACD (12, 26, 9). Used by Gate 2 / momentum confirmation.
 */
import type { OHLCV } from "../data/types";

export interface MACDValue {
  macd: number;
  signal: number;
  histogram: number;
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function computeMACD(bars: OHLCV[], fast = 12, slow = 26, signal = 9): MACDValue | null {
  if (bars.length < slow + signal) return null;
  const closes = bars.map((b) => b.c);
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = ema(macdLine, signal);
  const i = macdLine.length - 1;
  return { macd: macdLine[i], signal: signalLine[i], histogram: macdLine[i] - signalLine[i] };
}
