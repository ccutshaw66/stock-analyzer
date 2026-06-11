/**
 * Expectancy compartment — the dashboard north-star tile.
 *
 * Compact mirror of the /analytics Expectancy Scorecard: headline Win:Loss
 * size ratio, expectancy per trade, and a one-line green/red verdict. Reuses
 * the existing /api/trades/analytics payload (one source of truth — no extra
 * endpoint, no parallel calculation). Click-through opens /analytics.
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { TILE_MD, TILE_MIN_SM } from "@/lib/layout-tokens";
import { ExpectancyWidget } from "./ExpectancyWidget";

const meta: CompartmentMeta = {
  id: "expectancy",
  name: "Expectancy",
  tier: "free",
  fullPageRoute: "/analytics",
  description: "Are your winners bigger than your losers? Headline win:loss size ratio + expectancy per trade, mirrored from the Expectancy Scorecard.",
};

export const expectancyCompartment: ClientCompartmentEntry = {
  meta,
  WidgetView: ExpectancyWidget,
  widgetDefaultSize: TILE_MD,
  widgetMinSize: TILE_MIN_SM,
};

export { meta, ExpectancyWidget };
