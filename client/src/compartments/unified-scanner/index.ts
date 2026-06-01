/**
 * Unified Scanner client compartment — full page at /scanner + a compact
 * dashboard widget showing the top green-grade setups.
 */
import { TILE_MD, TILE_MIN_MD } from "@shared/dashboard/layout-tokens";
import type { ClientCompartmentEntry } from "../types";
import type { CompartmentMeta } from "@shared/compartments/types";
import { UnifiedScannerWidget } from "./UnifiedScannerWidget";

const meta: CompartmentMeta = {
  id: "unified-scanner",
  name: "Scanner",
  tier: "free",
  fullPageRoute: "/scanner",
  description: "One scanner across every strategy; green-grade (80+) setups only.",
};

export const unifiedScannerCompartment: ClientCompartmentEntry = {
  meta,
  WidgetView: UnifiedScannerWidget,
  widgetDefaultSize: TILE_MD,
  widgetMinSize: TILE_MIN_MD,
};

export { meta, UnifiedScannerWidget };
