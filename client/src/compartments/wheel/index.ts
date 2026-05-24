/**
 * Wheel compartment manifest.
 *
 * Pure calculator — no remote data. The four-guarantee contract is
 * satisfied by: useWheel (canonical hook), wheelLogic (pure logic),
 * Full + Widget views, this registry entry.
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { TILE_SM, TILE_MIN_SM } from "@/lib/layout-tokens";
import { WheelFullView } from "./WheelFullView";
import { WheelWidget } from "./WheelWidget";

const meta: CompartmentMeta = {
  id: "wheel",
  name: "Wheel Strategy",
  tier: "free",
  fullPageRoute: "/wheel",
  description:
    "Cash-secured-put → covered-call calculator with payoff chart and " +
    "setup-quality heuristics.",
};

export const wheelCompartment: ClientCompartmentEntry = {
  meta,
  FullView: WheelFullView,
  WidgetView: WheelWidget,
  widgetDefaultSize: TILE_SM,
  widgetMinSize: TILE_MIN_SM,
};

export { meta, WheelFullView, WheelWidget };
export {
  useWheel, useWheelState, type WheelOutputs,
} from "./useWheel";
export {
  calcWheelMetrics, calcWheelChart, calcWheelHealth, DEFAULT_WHEEL_INPUTS,
  type WheelInputs, type WheelMetrics, type WheelChartPoint,
  type WheelHealth, type WheelHealthFlag,
} from "./wheelLogic";
