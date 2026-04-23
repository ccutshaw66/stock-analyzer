/**
 * Earnings-Soon detector.
 *
 * Fires when the ticker has a scheduled earnings release within the next 7
 * calendar days. Earnings are binary-outcome events that routinely move stocks
 * 5-20% in either direction, so proximity alone is a reason to watch.
 *
 * Direction: "either" (earnings cut both ways).
 * Strength: 1.0 at 0 days out, linearly decays to 0.2 at 7 days out.
 *
 * Data source: FMP /stable/earnings-calendar, batch-loaded once per scan
 * and attached to ctx.extras.nextEarningsDate by the orchestrator.
 */
import type { SignalDetector, SignalResult } from "../scanner-v2";

const WINDOW_DAYS = 7;

export const earningsSoonDetector: SignalDetector = (ctx): SignalResult | null => {
  const d = ctx.extras?.nextEarningsDate;
  if (!d) return null; // no earnings data for this ticker — skip silently

  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysOut = (d.getTime() - now) / msPerDay;

  if (daysOut < 0 || daysOut > WINDOW_DAYS) {
    return {
      id: "earnings_soon",
      label: "Earnings Soon",
      triggered: false,
      strength: 0,
      direction: "either",
      detail: daysOut < 0 ? "earnings in past" : `earnings in ${Math.round(daysOut)}d (need ≤${WINDOW_DAYS})`,
    };
  }

  // Strength: closer = stronger. 0 days → 1.0, 7 days → 0.2
  const strength = Math.max(0.2, 1 - (daysOut / WINDOW_DAYS) * 0.8);

  const dayLabel = daysOut < 1 ? "<1d" : `${Math.round(daysOut)}d`;
  return {
    id: "earnings_soon",
    label: "Earnings Soon",
    triggered: true,
    strength,
    direction: "either",
    detail: `earnings in ${dayLabel}`,
  };
};
