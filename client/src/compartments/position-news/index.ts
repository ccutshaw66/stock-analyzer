/**
 * Position News compartment — headlines + press releases for owned tickers.
 *
 * Per Chris's rule: news is for situational awareness on tickers the user
 * already holds, NOT a discovery scanner. Server endpoint enforces the
 * position-scoping; widget just renders.
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { TILE_MD, TILE_MIN_MD } from "@/lib/layout-tokens";
import { PositionNewsWidget } from "./PositionNewsWidget";

const meta: CompartmentMeta = {
  id: "position-news",
  name: "Position News",
  tier: "free",
  description: "Recent headlines + press releases on tickers you currently hold. Situational awareness only.",
};

export const positionNewsCompartment: ClientCompartmentEntry = {
  meta,
  WidgetView: PositionNewsWidget,
  widgetDefaultSize: TILE_MD,
  widgetMinSize: TILE_MIN_MD,
};

export { meta, PositionNewsWidget };
