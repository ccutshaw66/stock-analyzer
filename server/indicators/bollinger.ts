/**
 * Bollinger Bands. Defaults from shared/indicators/constants (BB_PERIOD 20, BB_STDDEV 2).
 * Used by Gate 1 (BB touch / re-entry).
 */
import type { OHLCV } from "../data/types";
import { BB_PERIOD, BB_STDDEV } from "@shared/indicators/constants";

export interface BBand {
  upper: number;
  middle: number;
  lower: number;
}

export function computeBollinger(bars: OHLCV[], period = BB_PERIOD, k = BB_STDDEV): BBand | null {
  if (bars.length < period) return null;
  const slice = bars.slice(-period).map((b) => b.c);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mean + k * sd, middle: mean, lower: mean - k * sd };
}
