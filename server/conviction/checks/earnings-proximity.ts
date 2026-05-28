/**
 * Earnings Proximity check — is an earnings event so close that it'll
 * dominate the trade? IV crush, surprise moves either direction, and
 * post-earnings drift make positions held into the print a different
 * trade than a clean swing setup.
 */
import type { Check, CheckResult } from "./types";

export const earningsProximityCheck: Check = (ctx) => {
  const earn = ctx.snapshot.earnings?.value;
  const nextDate = earn?.nextReportDate;
  const base: Omit<CheckResult, "status" | "reason"> = {
    id: "earnings-proximity",
    category: "Catalysts",
    label: "Earnings proximity",
    weight: 3,
  };

  if (!nextDate) {
    // No known upcoming earnings — usually means we're between reports.
    return {
      ...base,
      status: "pass",
      reason: "No earnings event on the calendar — safe from event-driven gaps.",
    };
  }

  const now = Date.now();
  const nextMs = new Date(nextDate + "T16:00:00Z").getTime();
  const days = Math.round((nextMs - now) / (24 * 60 * 60 * 1000));

  if (!Number.isFinite(days)) {
    return {
      ...base,
      status: "warn",
      reason: "Couldn't parse next earnings date — verify on the Earnings Calendar before entering.",
    };
  }

  if (days < 0) {
    // Stale next-report date — probably reported and feed hasn't refreshed.
    return {
      ...base,
      status: "pass",
      reason: "Most recent earnings have passed — no event risk this trade.",
    };
  }
  if (days <= 4) {
    return {
      ...base,
      status: "fail",
      reason: `Earnings in ${days} day${days === 1 ? "" : "s"} — too close. Sit out until after the print.`,
    };
  }
  if (days <= 14) {
    return {
      ...base,
      status: "warn",
      reason: `Earnings in ${days} days — event is coming. Either size down or wait for the print to pass.`,
    };
  }
  return {
    ...base,
    status: "pass",
    reason: `Earnings ${days}+ days out — no event risk this trade.`,
  };
};
