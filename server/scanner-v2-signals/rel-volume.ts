/**
 * Relative Volume detector.
 *
 * Theory: unusual volume precedes or confirms unusual moves. A 3x+ volume
 * surge on a day usually means something's happening — catalyst, smart
 * money, breakout, or capitulation.
 *
 * Fires when:
 *   - Today's volume >= 2.0x the 20-day average volume (excluding today)
 *
 * Direction:
 *   - Up if today's close is above today's open by more than 0.5%
 *   - Down if today's close is below today's open by more than 0.5%
 *   - Either if close is near open (indecision on heavy volume — still noteworthy)
 *
 * Strength: 2x=0.0 ramps to 5x=1.0, capped.
 */
import type { SignalDetector, SignalResult } from "../scanner-v2";

const AVG_PERIOD = 20;
const MIN_RATIO = 2.0;
const MAX_RATIO = 5.0;

export const relVolumeDetector: SignalDetector = (ctx): SignalResult | null => {
  const bars = ctx.bars;
  if (bars.length < AVG_PERIOD + 1) return null;

  const last = bars[bars.length - 1];
  const volToday = last.v;
  if (!volToday || volToday <= 0) return null;

  // 20-day avg volume excluding today
  let sum = 0;
  let count = 0;
  for (let i = bars.length - 1 - AVG_PERIOD; i < bars.length - 1; i++) {
    if (i < 0) continue;
    const v = bars[i].v;
    if (v > 0) {
      sum += v;
      count++;
    }
  }
  if (count < AVG_PERIOD * 0.75) return null;
  const avg = sum / count;
  if (avg === 0) return null;

  const ratio = volToday / avg;

  if (ratio < MIN_RATIO) {
    return {
      id: "rel_volume",
      label: "Relative Volume",
      triggered: false,
      strength: 0,
      direction: "either",
      detail: `${ratio.toFixed(2)}x 20d avg (need ≥2x)`,
    };
  }

  // Direction from today's candle
  const pctMove = (last.c - last.o) / last.o;
  let direction: "up" | "down" | "either" = "either";
  if (pctMove > 0.005) direction = "up";
  else if (pctMove < -0.005) direction = "down";

  // Strength: 2x → 0.0, 5x → 1.0
  const strength = Math.max(0, Math.min(1, (ratio - MIN_RATIO) / (MAX_RATIO - MIN_RATIO)));

  return {
    id: "rel_volume",
    label: "Relative Volume",
    triggered: true,
    strength,
    direction,
    detail: `${ratio.toFixed(1)}x 20d avg, candle ${(pctMove * 100).toFixed(1)}%`,
  };
};
