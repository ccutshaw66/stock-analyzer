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
  const avg = averageVolume(bars, period);
  if (avg == null || avg === 0) return null;
  return bars[bars.length - 1].v / avg;
}
