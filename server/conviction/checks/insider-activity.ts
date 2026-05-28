/**
 * Insider Activity check — are insiders (officers, directors, 10% owners)
 * buying or selling their own company recently? Open-market buys (Form 4
 * type P) are the strongest "smart money" signal; sells are noisier (10b5-1
 * plans, tax events) but still worth flagging when they cluster.
 */
import type { Check, CheckResult } from "./types";

export const insiderActivityCheck: Check = (ctx) => {
  const activity = ctx.snapshot.insiderActivity?.value;
  if (!activity) return null;

  const { buyCount, sellCount, windowDays } = activity;
  const base: Omit<CheckResult, "status" | "reason"> = {
    id: "insider-activity",
    category: "Smart Money",
    label: "Insider activity",
    weight: 2,
  };

  const windowTxt = windowDays ? `last ${windowDays} days` : "recently";

  if (buyCount === 0 && sellCount === 0) {
    return {
      ...base,
      status: "warn",
      reason: `No meaningful insider activity in the ${windowTxt} — no smart-money signal either way.`,
    };
  }
  if (buyCount > sellCount && buyCount >= 2) {
    return {
      ...base,
      status: "pass",
      reason: `Insiders are net buyers — ${buyCount} open-market buys vs ${sellCount} sells in the ${windowTxt}.`,
    };
  }
  if (sellCount > buyCount && sellCount >= 3) {
    return {
      ...base,
      status: "fail",
      reason: `Insiders are net sellers — ${sellCount} sells vs ${buyCount} buys in the ${windowTxt}.`,
    };
  }
  return {
    ...base,
    status: "warn",
    reason: `Insider activity is mixed — ${buyCount} buys vs ${sellCount} sells in the ${windowTxt}.`,
  };
};
