/**
 * Action Queue compartment — the centerpiece of the rebuilt dashboard.
 *
 * Vertical list of decisions needing attention TODAY, aggregated server-side
 * from trade lifecycle alerts, fired cron alerts, fresh HTF setups, and
 * positions reporting earnings soon. Per the no-action-no-show rule:
 * if nothing's actionable, it doesn't render. Empty state = "all clear."
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { TILE_LG, TILE_MIN_MD } from "@/lib/layout-tokens";
import { ActionQueueWidget } from "./ActionQueueWidget";

const meta: CompartmentMeta = {
  id: "action-queue",
  name: "Action Queue",
  tier: "free",
  description: "Today's prioritized list of decisions across your open positions, fired alerts, and fresh setups.",
};

export const actionQueueCompartment: ClientCompartmentEntry = {
  meta,
  WidgetView: ActionQueueWidget,
  widgetDefaultSize: TILE_LG,
  widgetMinSize: TILE_MIN_MD,
};

export { meta, ActionQueueWidget };
