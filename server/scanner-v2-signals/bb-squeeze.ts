/**
 * Bollinger Band Squeeze + ATR Expansion detector.
 *
 * Theory: compressed volatility precedes expansion. When BB width contracts
 * to a multi-month low and ATR starts expanding, a move is imminent.
 *
 * Fires when:
 *   - Current BB width (upper - lower) / middle is in the bottom 20% of the
 *     last 120 trading days → "squeeze"
 *   - Today's close is outside the bands → "expansion confirming"
 *     - close > upper band → direction=up
 *     - close < lower band → direction=down
 *     - close inside bands → still fires as "pre-expansion" with direction=either,
 *       lower strength
 *
 * Strength = 1 - (current width percentile) × (expansion bonus if closing outside)
 */
import type { SignalDetector, SignalResult } from "../scanner-v2";

const PERIOD = 20;
const K = 2;
const LOOKBACK = 120; // days to compute percentile
const SQUEEZE_PERCENTILE = 0.20; // bottom 20%

/** SMA over a sliding window. Returns NaN until enough history. */
function smaArray(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Rolling std-dev population over a window. */
function stddevArray(values: number[], period: number, sma: number[]): number[] {
  const out = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    const mean = sma[i];
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) {
      v += (values[j] - mean) ** 2;
    }
    out[i] = Math.sqrt(v / period);
  }
  return out;
}

export const bbSqueezeDetector: SignalDetector = (ctx): SignalResult | null => {
  const bars = ctx.bars;
  // Need enough history for a meaningful percentile
  if (bars.length < PERIOD + LOOKBACK) return null;

  const closes = bars.map((b) => b.c);
  const sma = smaArray(closes, PERIOD);
  const sd = stddevArray(closes, PERIOD, sma);

  // Compute BB width for last LOOKBACK+1 bars
  const widths: number[] = [];
  const lastIdx = closes.length - 1;
  for (let i = lastIdx - LOOKBACK; i <= lastIdx; i++) {
    const m = sma[i];
    if (!isFinite(m) || m === 0 || !isFinite(sd[i])) return null;
    const upper = m + K * sd[i];
    const lower = m - K * sd[i];
    widths.push((upper - lower) / m);
  }

  const currentWidth = widths[widths.length - 1];

  // Percentile rank: what fraction of historical widths are >= current?
  // Low percentile = tight band = squeeze.
  const sorted = [...widths].sort((a, b) => a - b);
  const rank = sorted.indexOf(currentWidth);
  const percentile = rank / (sorted.length - 1);

  // Squeeze threshold
  if (percentile > SQUEEZE_PERCENTILE) {
    return {
      id: "bb_squeeze",
      label: "Bollinger Squeeze",
      triggered: false,
      strength: 0,
      direction: "either",
      detail: `BB width at ${(percentile * 100).toFixed(0)}th pct (need <=20)`,
    };
  }

  // Squeeze confirmed. Check close vs bands for direction.
  const closeToday = closes[lastIdx];
  const upperToday = sma[lastIdx] + K * sd[lastIdx];
  const lowerToday = sma[lastIdx] - K * sd[lastIdx];

  let direction: "up" | "down" | "either" = "either";
  let expansionBonus = 0.5; // no expansion yet
  if (closeToday > upperToday) {
    direction = "up";
    expansionBonus = 1.0;
  } else if (closeToday < lowerToday) {
    direction = "down";
    expansionBonus = 1.0;
  }

  // Strength combines squeeze tightness (lower percentile = stronger) and
  // expansion confirmation.
  const squeezeScore = 1 - percentile / SQUEEZE_PERCENTILE; // 0..1 within the <=20% bucket
  const strength = Math.max(0, Math.min(1, squeezeScore * expansionBonus));

  return {
    id: "bb_squeeze",
    label: "Bollinger Squeeze",
    triggered: true,
    strength,
    direction,
    detail:
      direction === "either"
        ? `width ${(currentWidth * 100).toFixed(1)}% at ${(percentile * 100).toFixed(0)}th pct (pre-expansion)`
        : `width ${(currentWidth * 100).toFixed(1)}% at ${(percentile * 100).toFixed(0)}th pct, closed ${
            direction === "up" ? "above upper" : "below lower"
          } band`,
  };
};
