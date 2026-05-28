/**
 * RSI Zone check — is momentum healthy without being overstretched?
 *
 * Stockotter uses Wilder RSI(14) everywhere — same as the rest of the app
 * (Scanner, VER, TradingView), so this number matches what Chris sees on
 * other pages.
 */
import { computeRSISeries } from "../../indicators";
import type { Check, CheckResult } from "./types";

const HEALTHY_LOW = 40;
const HEALTHY_HIGH = 65;
const OVERBOUGHT = 75;
const WEAK = 30;

export const rsiZoneCheck: Check = (ctx) => {
  if (ctx.bars.length < 30) return null;
  const closes = ctx.bars.map((b) => b.c);
  const rsi = computeRSISeries(closes, { period: 14 });
  const last = rsi[rsi.length - 1];
  if (!Number.isFinite(last)) return null;
  const r = Math.round(last);

  const base: Omit<CheckResult, "status" | "reason"> = {
    id: "rsi-zone",
    category: "Momentum",
    label: "RSI momentum",
    weight: 1,
  };

  if (r >= HEALTHY_LOW && r <= HEALTHY_HIGH) {
    return {
      ...base,
      status: "pass",
      reason: `RSI is ${r} — healthy momentum, not overstretched.`,
    };
  }
  if (r > OVERBOUGHT) {
    return {
      ...base,
      status: "warn",
      reason: `RSI is ${r} — overbought. Risk of a pullback before the next leg up.`,
    };
  }
  if (r < WEAK) {
    return {
      ...base,
      status: "fail",
      reason: `RSI is ${r} — momentum is weak. Wait for a turn higher before buying.`,
    };
  }
  if (r > HEALTHY_HIGH) {
    return {
      ...base,
      status: "warn",
      reason: `RSI is ${r} — getting hot but not yet overbought. Watch for exhaustion.`,
    };
  }
  return {
    ...base,
    status: "warn",
    reason: `RSI is ${r} — below the healthy zone. Momentum hasn't turned yet.`,
  };
};
