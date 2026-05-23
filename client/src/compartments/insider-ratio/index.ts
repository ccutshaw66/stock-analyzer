/**
 * Insider Buy/Sell Ratio compartment — market-wide sentiment tile.
 *
 * Big number + month-over-month delta + click-through to the dedicated
 * /insiders page for ranked tables + history.
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { TILE_MD, TILE_MIN_SM } from "@/lib/layout-tokens";
import { InsiderRatioWidget } from "./InsiderRatioWidget";

const meta: CompartmentMeta = {
  id: "insider-ratio",
  name: "Insider B/S Ratio",
  tier: "free",
  fullPageRoute: "/insiders",
  description: "Market-wide insider buy-vs-sell sentiment over the last 30 days, with month-over-month delta.",
};

export const insiderRatioCompartment: ClientCompartmentEntry = {
  meta,
  WidgetView: InsiderRatioWidget,
  widgetDefaultSize: TILE_MD,
  widgetMinSize: TILE_MIN_SM,
};

export { meta, InsiderRatioWidget };
