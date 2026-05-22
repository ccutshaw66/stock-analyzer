/**
 * Confluence Pulse compartment — north-star "everything in one page" widget.
 *
 * 5-spoke radar chart for the active ticker: Smart Money, Dealer Positioning,
 * Technical, Fundamental, Market Regime. Per project_north_star memory:
 * "unified inputs across all pages → premium everything-in-one-page feature
 * at 67% accuracy. THE lens for every decision."
 *
 * Data comes from the latest compass snapshot per ticker (compass cron is
 * already nightly). Click a spoke → drills into that page.
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { TILE_LG, TILE_MIN_MD } from "@/lib/layout-tokens";
import { ConfluencePulseWidget } from "./ConfluencePulseWidget";

const meta: CompartmentMeta = {
  id: "confluence-pulse",
  name: "Confluence Pulse",
  tier: "free",
  description: "Five signal layers (Smart Money + Dealer + Technical + Fundamental + Regime) for the active ticker, one radar.",
};

export const confluencePulseCompartment: ClientCompartmentEntry = {
  meta,
  WidgetView: ConfluencePulseWidget,
  widgetDefaultSize: TILE_LG,
  widgetMinSize: TILE_MIN_MD,
};

export { meta, ConfluencePulseWidget };
