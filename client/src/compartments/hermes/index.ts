/**
 * HERMES compartment manifest.
 *
 * Per the universal compartment contract (Phase 1B):
 *   - One canonical data hook (`useHermes`)
 *   - Full view (HermesFullView, used by `pages/hermes.tsx`)
 *   - Widget view (HermesWidget, mounted on the dashboard)
 *   - This single registry entry
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { TILE_MD, TILE_MIN_SM } from "@/lib/layout-tokens";
import { HermesWidget } from "./HermesWidget";
import { HermesFullView } from "./HermesFullView";

const meta: CompartmentMeta = {
  id: "hermes",
  name: "HERMES Auto Trader",
  tier: "free",
  fullPageRoute: "/hermes",
  description:
    "Self-improving multi-asset trading agent. Live status / stats / trades " +
    "from the Railway service, with per-asset threshold and goal controls.",
};

export const hermesCompartment: ClientCompartmentEntry = {
  meta,
  FullView: HermesFullView,
  WidgetView: HermesWidget,
  widgetDefaultSize: TILE_MD,
  widgetMinSize: TILE_MIN_SM,
};

export { meta, HermesFullView, HermesWidget };
export {
  useHermes, HERMES_API, equityTotalPct,
  type HermesStatus, type HermesStats, type HermesTrade,
  type HermesEquity, type HermesGoal, type AssetParams,
} from "./useHermes";
