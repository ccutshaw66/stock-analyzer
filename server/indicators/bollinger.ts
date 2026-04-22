/**
 * Bollinger Bands. Period 20, k=2 by default.
 * Used by Gate 1 (BB touch / re-entry).
 */
import type { OHLCV } from "../data/types";

export interface BBand {
  upper: number;
  middle: number;
  lower: number;
}

export function computeBollinger(bars: OHLCV[], period = 20, k = 2): BBand | null {
  if (bars.length < period) return null;
  const slice = bars.slice(-period).map((b) => b.c);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mean + k * sd, middle: mean, lower: mean - k * sd };
}
