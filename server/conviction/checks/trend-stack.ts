/**
 * Trend Stack check — are the moving averages aligned in our favor?
 *
 * Stockotter convention: 9/21/50 EMAs. Up-stack (9 > 21 > 50 and price > 9)
 * is the classic uptrend; inverted is downtrend; mixed is the chop zone.
 */
import type { Check, CheckResult } from "./types";

const EMA_FAST = 9;
const EMA_MID = 21;
const EMA_SLOW = 50;

function ema(closes: number[], length: number): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  const k = 2 / (length + 1);
  if (closes.length < length) return out;
  let sum = 0;
  for (let i = 0; i < length; i++) sum += closes[i];
  out[length - 1] = sum / length;
  for (let i = length; i < closes.length; i++) {
    out[i] = closes[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

export const trendStackCheck: Check = (ctx) => {
  if (ctx.bars.length < EMA_SLOW + 5) return null;
  const closes = ctx.bars.map((b) => b.c);
  const e9 = ema(closes, EMA_FAST);
  const e21 = ema(closes, EMA_MID);
  const e50 = ema(closes, EMA_SLOW);
  const i = closes.length - 1;
  const last = { c: closes[i], e9: e9[i], e21: e21[i], e50: e50[i] };

  const upStack = last.e9 > last.e21 && last.e21 > last.e50 && last.c > last.e9;
  const downStack = last.e9 < last.e21 && last.e21 < last.e50 && last.c < last.e9;

  const base: Omit<CheckResult, "status" | "reason"> = {
    id: "trend-stack",
    category: "Trend",
    label: "Trend stack",
    weight: 2,
  };

  if (upStack) {
    return {
      ...base,
      status: "pass",
      reason:
        "Uptrend confirmed — short-term, mid-term, and long-term averages all stacked in your favor.",
    };
  }
  if (downStack) {
    return {
      ...base,
      status: "fail",
      reason:
        "Downtrend — all moving averages stacked against the buy. Buying into a falling chart.",
    };
  }
  return {
    ...base,
    status: "warn",
    reason: "Trend isn't clearly up — wait for the moving averages to line up before entering.",
  };
};
