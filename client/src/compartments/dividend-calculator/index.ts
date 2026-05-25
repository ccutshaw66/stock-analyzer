/**
 * Dividend Calculator compartment manifest.
 *
 * The four-guarantee contract:
 *   - canonical hook    → useDividendCalculator (useDividendLookup)
 *   - pure logic        → dividendCalcLogic (computeNumbers + color helpers)
 *   - Full view         → DividendCalculatorFullView (mounted on /dividend-portfolio)
 *   - registry entry    → this file, imported by compartments/registry.ts
 *
 * No Widget view yet — the calculator only makes sense with editable
 * ticker + share inputs, which doesn't shrink cleanly to a dashboard
 * tile. Easy to add later if the use case appears (e.g. a fixed-config
 * "next dividend on KO" tile).
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { DividendCalculatorFullView } from "./DividendCalculatorFullView";

const meta: CompartmentMeta = {
  id: "dividend-calculator",
  name: "Dividend Calculator",
  tier: "free",
  // Embedded on /dividend-portfolio; no standalone route today.
  description:
    "Look up one ticker or compare two side-by-side for per-distribution and yearly dividend income at a chosen share count.",
};

export const dividendCalculatorCompartment: ClientCompartmentEntry = {
  meta,
  FullView: DividendCalculatorFullView,
};

export { meta, DividendCalculatorFullView };
export { useDividendLookup } from "./useDividendCalculator";
export {
  computeNumbers, payoutsPerYear, yieldColor, scoreColor, payoutColor,
  type DividendData, type ComputedNumbers,
} from "./dividendCalcLogic";
