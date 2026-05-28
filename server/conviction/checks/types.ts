/**
 * Trigger-Check types — the building blocks of the rebuilt /conviction page.
 *
 * Each "check" is a small pure function that answers ONE question about a
 * ticker ("is the trend up?", "are insiders buying?", "is earnings too close?")
 * and returns a single `CheckResult` row the UI renders verbatim.
 *
 * The brief: plain English, no naked symbols, no internal plumbing in the
 * `reason` copy. See `~/.claude/projects/C--dev/memory/brief_trigger_check.md`.
 */
import type { CompanySnapshot } from "../../snapshot/types";
import type { MMExposure } from "../../mm-exposure";
import type { OHLCV } from "../../data/types";

export type CheckStatus =
  | "pass"   // green — bullish-aligned, supports the buy decision
  | "warn"   // amber — neutral or mild risk, not disqualifying
  | "fail"   // red — bearish or risk signal that argues against entering
  | "skip";  // gray — data unavailable for this ticker. Hidden by default.

/** Categories used to group the checklist on the page. Order matters — this
 *  is the order rows render. Keep it ordered the way Chris would read it:
 *  what the chart says first, then setup, then who else is buying, then
 *  what could blow it up, then the broader environment. */
export const CHECK_CATEGORIES = [
  "Trend",
  "Momentum",
  "Setup",
  "Smart Money",
  "Dealer Flow",
  "Catalysts",
  "Fundamentals",
  "Market Regime",
] as const;

export type CheckCategory = (typeof CHECK_CATEGORIES)[number];

export interface CheckResult {
  /** Stable id (e.g. `trend-stack`). Used for testing + telemetry. */
  id: string;
  category: CheckCategory;
  /** Short plain-English title (~30 chars): "Trend stack", "Earnings proximity". */
  label: string;
  status: CheckStatus;
  /** One short sentence, plain English, no jargon, no plumbing notes. ~80–120 chars.
   *  Example: "Earnings in 3 days — too close, sit out until after the print." */
  reason: string;
  /** Verdict weight, 1–3. 3 = single-check can downgrade the verdict to NO. */
  weight?: number;
}

/** Pre-fetched data shared by every check. Built ONCE per request in the
 *  pipeline, passed to every registered check. Checks read; they never
 *  trigger their own data fetches. */
export interface CheckContext {
  ticker: string;
  snapshot: CompanySnapshot;
  /** 1-year daily OHLCV bars. Empty array if chart unavailable. */
  bars: OHLCV[];
  /** Dealer/MM exposure. `null` if not computable (illiquid options, etc.). */
  mm: MMExposure | null;
  /** Market regime tier ("RISK-OFF" / "DEFENSIVE" / "NEUTRAL" / "RISK-ON" / "EUPHORIC") + score. */
  marketRegime: { tier: string; score: number | null } | null;
}

export type Check = (ctx: CheckContext) => CheckResult | null;

/** Final shape the API returns. */
export type Verdict = "GO" | "CAUTION" | "NO" | "INSUFFICIENT_DATA";

export interface TriggerCheckResponse {
  ticker: string;
  verdict: Verdict;
  /** One-sentence headline reason that explains the verdict in plain English. */
  reason: string;
  /** Counts for the verdict summary card. */
  summary: { pass: number; warn: number; fail: number; skip: number };
  /** All check results in registry order. UI groups by `category`. */
  checks: CheckResult[];
  generatedAt: string;
}
