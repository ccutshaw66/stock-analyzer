/**
 * Fundamentals check — is the underlying business growing? For swing
 * entries, fundamentals are a tiebreaker, not a primary driver, but a
 * shrinking business with declining margins is a yellow/red flag worth
 * surfacing before pulling the trigger.
 */
import type { Check, CheckResult } from "./types";

export const fundamentalsCheck: Check = (ctx) => {
  const f = ctx.snapshot.fundamentals?.value;
  if (!f) return null;
  const rg = f.revenueGrowth; // PERCENT: 5 = +5% (null when not meaningful)
  const eg = f.earningsGrowth;

  const base: Omit<CheckResult, "status" | "reason"> = {
    id: "fundamentals",
    category: "Fundamentals",
    label: "Revenue & earnings growth",
    weight: 1,
  };

  const rgPct = rg != null ? Math.round(rg) : null;
  const egPct = eg != null ? Math.round(eg) : null;

  if (rg == null && eg == null) return null; // no data — skip

  const rgPositive = rg != null && rg > 3;
  const rgNegative = rg != null && rg < -3;
  const egPositive = eg != null && eg > 5;
  const egNegative = eg != null && eg < -10;

  if (rgPositive && egPositive) {
    return {
      ...base,
      status: "pass",
      reason: `Both revenue (${rgPct! > 0 ? "+" : ""}${rgPct}%) and earnings (${egPct! > 0 ? "+" : ""}${egPct}%) are growing year-over-year.`,
    };
  }
  if (rgNegative || egNegative) {
    const parts: string[] = [];
    if (rgNegative) parts.push(`revenue ${rgPct}%`);
    if (egNegative) parts.push(`earnings ${egPct}%`);
    return {
      ...base,
      status: "fail",
      reason: `Fundamentals weakening — ${parts.join(" and ")} year-over-year. The business is shrinking.`,
    };
  }
  return {
    ...base,
    status: "warn",
    reason: `Fundamentals are flat — revenue ${rgPct != null ? `${rgPct! > 0 ? "+" : ""}${rgPct}%` : "n/a"}, earnings ${egPct != null ? `${egPct! > 0 ? "+" : ""}${egPct}%` : "n/a"}. Not broken, but no tailwind.`,
  };
};
