/**
 * Morning Brief compartment — the top-banner one-paragraph dashboard intro.
 *
 * Renders a computed (not LLM) sentence summarizing regime + book P&L +
 * action-queue size + fresh setup count + loss-budget usage. All numbers
 * pulled from existing source-of-truth APIs via the morning-brief server
 * route.
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { TILE_FULL, TILE_MIN_MD } from "@/lib/layout-tokens";
import { MorningBriefWidget } from "./MorningBriefWidget";

const meta: CompartmentMeta = {
  id: "morning-brief",
  name: "Morning Brief",
  tier: "free",
  description: "One-paragraph computed summary of regime, book P&L, attention items, fresh setups, and loss budget.",
};

export const morningBriefCompartment: ClientCompartmentEntry = {
  meta,
  WidgetView: MorningBriefWidget,
  widgetDefaultSize: TILE_FULL,
  widgetMinSize: TILE_MIN_MD,
};

export { meta, MorningBriefWidget };
