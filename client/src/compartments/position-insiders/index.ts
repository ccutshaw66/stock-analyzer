/**
 * Position Insiders compartment — recent insider transactions on tickers
 * the user currently holds. Mirrors the Position News rule: situational
 * awareness on what you own, NOT a discovery scanner.
 *
 * 10b5-1 awareness is on the v2 backlog — current implementation surfaces
 * raw FMP transaction codes; planned sales need a footnote-parsing pass.
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { TILE_MD, TILE_MIN_MD } from "@/lib/layout-tokens";
import { PositionInsidersWidget } from "./PositionInsidersWidget";

const meta: CompartmentMeta = {
  id: "position-insiders",
  name: "Position Insiders",
  tier: "free",
  description: "Insider buy/sell transactions on tickers you currently hold. Situational awareness only.",
};

export const positionInsidersCompartment: ClientCompartmentEntry = {
  meta,
  WidgetView: PositionInsidersWidget,
  widgetDefaultSize: TILE_MD,
  widgetMinSize: TILE_MIN_MD,
};

export { meta, PositionInsidersWidget };
