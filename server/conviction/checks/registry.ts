/**
 * Trigger-Check registry — every check that contributes to the /conviction
 * verdict registers here. Adding a new check = add one line. The page
 * groups results by `category` for display order, so registry order is
 * primarily for tie-breaking when several checks land in the same category.
 */
import type { Check } from "./types";

import { trendStackCheck } from "./trend-stack";
import { rsiZoneCheck } from "./rsi-zone";
import { htfSetupCheck } from "./htf-setup";
import { insiderActivityCheck } from "./insider-activity";
import { dealerFlowCheck } from "./dealer-flow";
import { earningsProximityCheck } from "./earnings-proximity";
import { fundamentalsCheck } from "./fundamentals";
import { marketRegimeCheck } from "./market-regime";

export const TRIGGER_CHECKS: ReadonlyArray<Check> = [
  trendStackCheck,
  rsiZoneCheck,
  htfSetupCheck,
  insiderActivityCheck,
  dealerFlowCheck,
  earningsProximityCheck,
  fundamentalsCheck,
  marketRegimeCheck,
];
