/**
 * Gap-and-Hold detector.
 *
 * Theory: a stock that gaps up at open and doesn't fade (holds the gap) is
 * showing conviction. Same for gap-down + stays down. Gaps that fill are
 * noise; gaps that hold are tradable.
 *
 * Fires when:
 *   - Today's open gapped >= 2% away from yesterday's close
 *   - AND today's close is on the same side as the gap (no fade)
 *   - AND today's close is within 50% of the open-to-high/low extreme
 *     (didn't give most of it back)
 *
 * Direction: up for gap up + hold, down for gap down + hold
 * Strength: bigger gap + less fade = higher. 2%=0.0 → 8%=1.0
 */
import type { SignalDetector, SignalResult } from "../scanner-v2";

const MIN_GAP_PCT = 0.02;
const MAX_GAP_PCT = 0.08;

export const gapHoldDetector: SignalDetector = (ctx): SignalResult | null => {
  const bars = ctx.bars;
  if (bars.length < 2) return null;

  const yday = bars[bars.length - 2];
  const today = bars[bars.length - 1];

  const gapPct = (today.o - yday.c) / yday.c;

  if (Math.abs(gapPct) < MIN_GAP_PCT) {
    return {
      id: "gap_hold",
      label: "Gap & Hold",
      triggered: false,
      strength: 0,
      direction: "either",
      detail: `gap ${(gapPct * 100).toFixed(1)}% (need ≥2%)`,
    };
  }

  // Gap direction
  const isGapUp = gapPct > 0;
  const direction: "up" | "down" = isGapUp ? "up" : "down";

  // Did it hold? Close must be on same side as open relative to yesterday's close.
  const holding = isGapUp ? today.c > yday.c : today.c < yday.c;
  if (!holding) {
    return {
      id: "gap_hold",
      label: "Gap & Hold",
      triggered: false,
      strength: 0,
      direction: "either",
      detail: `gap ${(gapPct * 100).toFixed(1)}% faded back`,
    };
  }

  // Did it give most back? For gap-up: close should be in upper half of (open, high).
  // For gap-down: close should be in lower half of (open, low).
  let fadeRatio = 0;
  if (isGapUp) {
    const range = today.h - today.o;
    if (range > 0) {
      // fadeRatio=0 means closed at high (no fade), 1 means closed at open (full fade)
      fadeRatio = (today.h - today.c) / range;
    }
  } else {
    const range = today.o - today.l;
    if (range > 0) {
      fadeRatio = (today.c - today.l) / range;
    }
  }

  // Allow up to 50% fade; above that, consider it a fade not a hold.
  if (fadeRatio > 0.5) {
    return {
      id: "gap_hold",
      label: "Gap & Hold",
      triggered: false,
      strength: 0,
      direction: "either",
      detail: `gap ${(gapPct * 100).toFixed(1)}% but gave ${(fadeRatio * 100).toFixed(0)}% back`,
    };
  }

  // Strength: gap size + low fade
  const gapStrength = Math.max(0, Math.min(1, (Math.abs(gapPct) - MIN_GAP_PCT) / (MAX_GAP_PCT - MIN_GAP_PCT)));
  const holdStrength = 1 - fadeRatio * 2; // 0 fade = 1.0, 0.5 fade = 0.0
  const strength = Math.max(0.2, Math.min(1, gapStrength * 0.6 + holdStrength * 0.4));

  return {
    id: "gap_hold",
    label: "Gap & Hold",
    triggered: true,
    strength,
    direction,
    detail: `${(gapPct * 100).toFixed(1)}% gap ${isGapUp ? "up" : "down"}, ${(fadeRatio * 100).toFixed(0)}% fade`,
  };
};
