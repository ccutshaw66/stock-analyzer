/**
 * Fibonacci Pullback detector.
 *
 * Theory: After a strong impulse move, price often pulls back to a Fibonacci
 * retracement level (38.2%, 50%, 61.8%) before resuming in the impulse
 * direction. Traders watch these zones as high-probability continuation
 * entries. 38.2% is a shallow pullback in a strong trend; 61.8% is the
 * deepest "still-valid" retrace before the move is invalidated.
 *
 * Algorithm:
 *   1. Look back LOOKBACK bars (default 60) and find the swing high and
 *      swing low within that window.
 *   2. Determine impulse direction by which extreme came LAST in the window
 *      (high later than low → uptrend impulse; low later → downtrend).
 *   3. Require the impulse magnitude >= MIN_IMPULSE_PCT to filter chop.
 *   4. Measure today's close as a fraction of the swing range.
 *      - Uptrend: retracement = (high - close) / (high - low)
 *      - Downtrend: retracement = (close - low) / (high - low)
 *   5. Fire if retracement lands in any fib zone (±tolerance). Strength is
 *      highest at 61.8% (deepest valid pullback = best R:R), lower at 50%,
 *      lowest at 38.2%.
 *
 * Direction: opposite of the pullback → continuation of impulse.
 *   - Uptrend impulse + pullback down → direction "up" (expecting bounce)
 *   - Downtrend impulse + pullback up → direction "down" (expecting rejection)
 */
import type { SignalDetector, SignalResult } from "../scanner-v2";

const LOOKBACK = 60;
const MIN_IMPULSE_PCT = 0.15; // 15% move required to be a real impulse
const TOLERANCE = 0.05; // ±5% window around each fib level

const FIB_LEVELS = [
  { level: 0.382, label: "38.2%", strength: 0.5 },
  { level: 0.5, label: "50%", strength: 0.75 },
  { level: 0.618, label: "61.8%", strength: 1.0 },
];

export const fibPullbackDetector: SignalDetector = (ctx): SignalResult | null => {
  const bars = ctx.bars;
  if (bars.length < LOOKBACK) return null;

  const slice = bars.slice(-LOOKBACK);
  const closeToday = slice[slice.length - 1].c;

  // Find swing extremes and their indices within the window
  let highIdx = 0, lowIdx = 0;
  let high = slice[0].h;
  let low = slice[0].l;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i].h > high) { high = slice[i].h; highIdx = i; }
    if (slice[i].l < low) { low = slice[i].l; lowIdx = i; }
  }

  const range = high - low;
  if (range <= 0 || low <= 0) return null;

  const impulsePct = range / low;
  if (impulsePct < MIN_IMPULSE_PCT) {
    return {
      id: "fib_pullback",
      label: "Fib Pullback",
      triggered: false,
      strength: 0,
      direction: "either",
      detail: `no impulse (swing ${(impulsePct * 100).toFixed(1)}% < ${MIN_IMPULSE_PCT * 100}%)`,
    };
  }

  // Impulse direction: whichever extreme came later
  const isUptrend = highIdx > lowIdx;
  const isDowntrend = lowIdx > highIdx;
  if (!isUptrend && !isDowntrend) return null;

  // Retracement as fraction of range
  let retracement: number;
  let direction: "up" | "down";
  if (isUptrend) {
    // Pulling back from the high
    retracement = (high - closeToday) / range;
    direction = "up"; // expect bounce = continuation up
  } else {
    // Bouncing up from the low
    retracement = (closeToday - low) / range;
    direction = "down"; // expect rejection = continuation down
  }

  // Must be within the valid pullback zone (not yet broken structure)
  if (retracement < 0.25 || retracement > 0.8) {
    return {
      id: "fib_pullback",
      label: "Fib Pullback",
      triggered: false,
      strength: 0,
      direction: "either",
      detail: `retrace ${(retracement * 100).toFixed(1)}% outside fib zone`,
    };
  }

  // Find closest fib level
  let best: (typeof FIB_LEVELS)[number] | null = null;
  let bestDist = Infinity;
  for (const f of FIB_LEVELS) {
    const dist = Math.abs(retracement - f.level);
    if (dist < bestDist) { bestDist = dist; best = f; }
  }
  if (!best || bestDist > TOLERANCE) {
    return {
      id: "fib_pullback",
      label: "Fib Pullback",
      triggered: false,
      strength: 0,
      direction: "either",
      detail: `retrace ${(retracement * 100).toFixed(1)}% between fib levels`,
    };
  }

  // Strength: base from fib level (deeper = higher), discounted by distance
  const proximity = 1 - bestDist / TOLERANCE;
  const strength = Math.max(0.2, best.strength * proximity);

  return {
    id: "fib_pullback",
    label: "Fib Pullback",
    triggered: true,
    strength,
    direction,
    detail: `${isUptrend ? "uptrend" : "downtrend"} impulse ${(impulsePct * 100).toFixed(1)}%, retrace at ${best.label} (${(retracement * 100).toFixed(1)}%)`,
  };
};
