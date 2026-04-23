/**
 * 52-Week Breakout detector.
 *
 * Theory: stocks making new 52-week highs often continue higher (momentum),
 * and new 52-week lows often continue lower (breakdown). This is one of the
 * oldest, simplest, and most reliable trend signals.
 *
 * Fires when:
 *   - Today's close >= 99% of the 252-day high  → new high breakout (up)
 *   - Today's close <= 101% of the 252-day low  → new low breakdown (down)
 *
 * Strength boost if it's accompanied by >1.5x avg volume (conviction).
 */
import type { SignalDetector, SignalResult } from "../scanner-v2";

const PERIOD = 252;
const HIGH_THRESHOLD = 0.99; // within 1% of 52w high
const LOW_THRESHOLD = 1.01; // within 1% of 52w low
const VOL_PERIOD = 20;

export const breakout52wDetector: SignalDetector = (ctx): SignalResult | null => {
  const bars = ctx.bars;
  if (bars.length < PERIOD) return null;

  const slice = bars.slice(-PERIOD);
  const highs = slice.map((b) => b.h);
  const lows = slice.map((b) => b.l);
  const closes = slice.map((b) => b.c);

  const high52 = Math.max(...highs);
  const low52 = Math.min(...lows);
  const closeToday = closes[closes.length - 1];

  // Volume conviction
  let volRatio = 1;
  if (bars.length >= VOL_PERIOD + 1) {
    const volToday = bars[bars.length - 1].v;
    let sum = 0, count = 0;
    for (let i = bars.length - 1 - VOL_PERIOD; i < bars.length - 1; i++) {
      if (i < 0) continue;
      if (bars[i].v > 0) { sum += bars[i].v; count++; }
    }
    if (count > 0 && sum > 0) {
      volRatio = volToday / (sum / count);
    }
  }
  const volBonus = Math.min(1, Math.max(0.5, volRatio / 1.5));

  // High breakout?
  if (closeToday >= high52 * HIGH_THRESHOLD) {
    const proximity = closeToday / high52; // 0.99 → 1.0+
    const strength = Math.max(0, Math.min(1, ((proximity - HIGH_THRESHOLD) / (1 - HIGH_THRESHOLD)))) * volBonus;
    return {
      id: "breakout_52w",
      label: "52-Week Breakout",
      triggered: true,
      strength: Math.max(0.2, strength),
      direction: "up",
      detail: `at ${((proximity) * 100).toFixed(1)}% of 52w high, vol ${volRatio.toFixed(2)}x`,
    };
  }

  // Low breakdown?
  if (closeToday <= low52 * LOW_THRESHOLD) {
    const proximity = low52 / closeToday; // ~1.0 → 0.99
    const strength = Math.max(0, Math.min(1, ((proximity - (1 / LOW_THRESHOLD)) / (1 - (1 / LOW_THRESHOLD))))) * volBonus;
    return {
      id: "breakout_52w",
      label: "52-Week Breakdown",
      triggered: true,
      strength: Math.max(0.2, strength),
      direction: "down",
      detail: `at ${((closeToday / low52) * 100).toFixed(1)}% of 52w low, vol ${volRatio.toFixed(2)}x`,
    };
  }

  return {
    id: "breakout_52w",
    label: "52-Week Breakout",
    triggered: false,
    strength: 0,
    direction: "either",
    detail: `close $${closeToday.toFixed(2)} | 52w range $${low52.toFixed(2)}-$${high52.toFixed(2)}`,
  };
};
