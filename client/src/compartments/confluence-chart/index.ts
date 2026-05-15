/**
 * Confluence Chart compartment — client side.
 *
 * Composes existing canonical accessors (analyze + scanner-v2 quick) into
 * an at-a-glance per-ticker view. Reuses TickerContext.activeTicker to pick
 * up whatever ticker the user clicked anywhere else on the dashboard.
 *
 * No new server compartment — this is a pure client consumer.
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { ConfluenceChartWidget } from "./ConfluenceChartWidget";

const meta: CompartmentMeta = {
  id: "confluence-chart",
  name: "Confluence Chart",
  tier: "free",
  fullPageRoute: "/profile",
  description: "At-a-glance price chart + confluence verdict for the currently selected ticker. Per-widget timeframe.",
};

export const confluenceChartCompartment: ClientCompartmentEntry = {
  meta,
  WidgetView: ConfluenceChartWidget,
  widgetDefaultSize: { w: 6, h: 6 },
  widgetMinSize: { w: 4, h: 4 },
};

export { meta, ConfluenceChartWidget };
export { useConfluenceChartData } from "./useConfluenceChart";
