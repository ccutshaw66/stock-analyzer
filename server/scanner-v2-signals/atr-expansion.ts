/**
 * ATR Expansion detector.
 *
 * Theory: when average true range starts rising after a contraction phase,
 * a trending move is beginning. This signal complements BB squeeze — squeeze
 * says "compressed", ATR expansion says "now expanding".
 *
 * Fires when:
 *   - ATR(14) today > 1.3x the 60-day average ATR
 *   - AND the last 5-day ATR slope is positive (trending up, not a one-day spike)
 *
 * Direction = today's close direction vs 5-day ago close
 * Strength  = how far above the ratio threshold, capped at 1.0 when 2x avg
 */
import type { SignalDetector, SignalResult } from "../scanner-v2";

const ATR_PERIOD = 14;
const LOOKBACK = 60;
const EXPANSION_THRESHOLD = 1.3; // current ATR must be 30%+ above 60d avg
const MAX_RATIO = 2.0; // strength cap

/** Wilder's ATR. */
function atrSeries(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
): number[] {
  const trs: number[] = new Array(closes.length).fill(NaN);
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    trs[i] = tr;
  }
  const atr: number[] = new Array(closes.length).fill(NaN);
  // Seed with simple average of first `period` TRs
  if (closes.length < period + 1) return atr;
  let seed = 0;
  for (let i = 1; i <= period; i++) seed += trs[i];
  atr[period] = seed / period;
  // Wilder smoothing
  for (let i = period + 1; i < closes.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + trs[i]) / period;
  }
  return atr;
}

export const atrExpansionDetector: SignalDetector = (ctx): SignalResult | null => {
  const bars = ctx.bars;
  if (bars.length < ATR_PERIOD + LOOKBACK + 5) return null;

  const highs = bars.map((b) => b.h);
  const lows = bars.map((b) => b.l);
  const closes = bars.map((b) => b.c);

  const atr = atrSeries(highs, lows, closes, ATR_PERIOD);
  const lastIdx = closes.length - 1;
  const atrToday = atr[lastIdx];

  if (!isFinite(atrToday)) return null;

  // 60-day avg ATR excluding today
  let sum = 0;
  let count = 0;
  for (let i = lastIdx - LOOKBACK; i < lastIdx; i++) {
    if (isFinite(atr[i])) {
      sum += atr[i];
      count++;
    }
  }
  if (count < LOOKBACK * 0.75) return null;
  const avgAtr = sum / count;
  if (avgAtr === 0) return null;

  const ratio = atrToday / avgAtr;

  // 5-day slope — ATR today vs ATR 5 days ago, must be positive
  const atr5Ago = atr[lastIdx - 5];
  const slopePositive = isFinite(atr5Ago) && atrToday > atr5Ago;

  if (ratio < EXPANSION_THRESHOLD || !slopePositive) {
    return {
      id: "atr_expansion",
      label: "ATR Expansion",
      triggered: false,
      strength: 0,
      direction: "either",
      detail: `ATR ratio ${ratio.toFixed(2)}x (need ≥1.3x + rising)`,
    };
  }

  // Direction: price vs 5-day ago
  const close5Ago = closes[lastIdx - 5];
  const closeToday = closes[lastIdx];
  let direction: "up" | "down" | "either" = "either";
  const pctChange = (closeToday - close5Ago) / close5Ago;
  if (pctChange > 0.02) direction = "up";
  else if (pctChange < -0.02) direction = "down";

  // Strength: 1.3x → 0.2, 2.0x → 1.0
  const strength = Math.max(0, Math.min(1, (ratio - EXPANSION_THRESHOLD) / (MAX_RATIO - EXPANSION_THRESHOLD)));

  return {
    id: "atr_expansion",
    label: "ATR Expansion",
    triggered: true,
    strength,
    direction,
    detail: `ATR ${ratio.toFixed(2)}x 60d avg, ${(pctChange * 100).toFixed(1)}% 5-day move`,
  };
};
