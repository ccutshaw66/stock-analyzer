/**
 * Volume analytics. Default lookback from shared/indicators/constants
 * (VOLUME_MA_PERIOD = 20). Gate 1 uses 1.8x average volume spike detection.
 */
import type { OHLCV } from "../data/types";
import { VOLUME_MA_PERIOD } from "@shared/indicators/constants";

export function averageVolume(bars: OHLCV[], period = VOLUME_MA_PERIOD): number | null {
  if (bars.length < period) return null;
  const slice = bars.slice(-period);
  return slice.reduce((a, b) => a + b.v, 0) / period;
}

export function volumeSpikeRatio(bars: OHLCV[], period = VOLUME_MA_PERIOD): number | null {
  // The baseline must EXCLUDE the bar being tested. Including it lets a genuine
  // spike inflate its own denominator, suppressing the ratio (~2× understated:
  // a true 20× day on a 20-bar window reads ~10.5×). Compare the latest bar
  // against the average of the `period` bars immediately BEFORE it.
  if (bars.length < period + 1) return null;
  const baseline = bars.slice(-(period + 1), -1);
  const avg = baseline.reduce((a, b) => a + b.v, 0) / period;
  if (avg === 0) return null;
  return bars[bars.length - 1].v / avg;
}
