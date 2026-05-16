/**
 * Confluence Chart compartment — client side.
 *
 * Manifest points the FullView to the new /chart/confluence/:ticker? page.
 * The dashboard widget is the teaser tile that links to the full page.
 *
 * The failed Round-8 ConfluenceChartWidget has been removed.
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { TILE_SM, TILE_MIN_SM } from "@/lib/layout-tokens";
import { ConfluenceTeaser } from "./ConfluenceTeaser";

const meta: CompartmentMeta = {
  id: "confluence-chart",
  name: "Confluence Chart",
  tier: "free",
  fullPageRoute: "/chart/confluence",
  description: "Stock Otter-branded full-page chart with candles, signal pulse, MACD/RSI, and the confluence dashboard.",
};

export const confluenceChartCompartment: ClientCompartmentEntry = {
  meta,
  WidgetView: ConfluenceTeaser,
  widgetDefaultSize: TILE_SM,
  widgetMinSize: TILE_MIN_SM,
};

export { meta, ConfluenceTeaser };
export { useConfluenceChart } from "./useConfluenceChart";
