/**
 * Insider Clusters compartment — market-wide tickers where 3+ insiders
 * bought or sold in the last 14 days. Classic "smart money converging"
 * signal. Discovery widget — surfaces names you may NOT yet hold.
 *
 * 10b5-1 awareness pending — current scan counts S-Sale codes which can
 * include planned (10b5-1) sales. Buy clusters are unaffected since
 * planned buys are rare.
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { TILE_MD, TILE_MIN_MD } from "@/lib/layout-tokens";
import { InsiderClustersWidget } from "./InsiderClustersWidget";

const meta: CompartmentMeta = {
  id: "insider-clusters",
  name: "Insider Clusters",
  tier: "free",
  description: "Tickers across the market with 3+ insiders buying (or selling) in the last 14 days.",
};

export const insiderClustersCompartment: ClientCompartmentEntry = {
  meta,
  WidgetView: InsiderClustersWidget,
  widgetDefaultSize: TILE_MD,
  widgetMinSize: TILE_MIN_MD,
};

export { meta, InsiderClustersWidget };
