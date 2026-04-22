/**
 * Volume analytics. Gate 1 needs 1.8x average volume spike detection.
 */
import type { OHLCV } from "../data/types";

export function averageVolume(bars: OHLCV[], period = 20): number | null {
  if (bars.length < period) return null;
  const slice = bars.slice(-period);
  return slice.reduce((a, b) => a + b.v, 0) / period;
}

export function volumeSpikeRatio(bars: OHLCV[], period = 20): number | null {
  const avg = averageVolume(bars, period);
  if (avg == null || avg === 0) return null;
  return bars[bars.length - 1].v / avg;
}
