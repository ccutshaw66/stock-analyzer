/**
 * KAIROS compartment manifest.
 *
 * Second experimental auto-trader after HERMES. Runs HTF + BBTC strategies
 * natively in Python on superotter; this client compartment talks to it via
 * Stockotter's Express proxy at `/api/kairos/*`.
 *
 * Four-guarantee contract:
 *   - canonical hook    → useKairos
 *   - Full view         → KairosFullView (mounted on /kairos)
 *   - Widget view       → KairosWidget (dashboard tile)
 *   - registry entry    → this file, imported by compartments/registry.ts
 *
 * No pure-logic file like wheelLogic.ts because KAIROS has no client-side
 * computation — all math runs in the Python bot.
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { TILE_SM, TILE_MIN_SM } from "@/lib/layout-tokens";
import { KairosFullView } from "./KairosFullView";
import { KairosWidget } from "./KairosWidget";

const meta: CompartmentMeta = {
  id: "kairos",
  name: "KAIROS Auto Trader",
  // owner 2026-06-09: trades the unvalidated HTF/BBTC combo. Owner-only until validated.
  tier: "owner",
  fullPageRoute: "/kairos",
  description:
    "Experimental paper-trader powered by HTF (High Tight Flag) and BBTC (trend follower) signals. Opens on either strategy with a conviction tag (HTF / BBTC / BOTH).",
};

export const kairosCompartment: ClientCompartmentEntry = {
  meta,
  FullView: KairosFullView,
  WidgetView: KairosWidget,
  widgetDefaultSize: TILE_SM,
  widgetMinSize: TILE_MIN_SM,
};

export { meta, KairosFullView, KairosWidget };
export {
  useKairos, equityTotalPct, winRatePct,
  type KairosStatus, type KairosPosition, type KairosTrade,
  type KairosEquity, type KairosGoal, type KairosWatchlistRow,
} from "./useKairos";
