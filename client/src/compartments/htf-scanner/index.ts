/**
 * HTF Scanner compartment — client side. Manifest + Widget + canonical hook.
 *
 * Full-page consumers continue to use `client/src/pages/htf-setups.tsx`
 * during the strangler migration (same pattern as scanner v2). A future
 * round can migrate that page to use `useHtfScanner` end-to-end and move
 * its body into a `FullView` component owned by the compartment.
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { TILE_SM, TILE_MIN_SM } from "@/lib/layout-tokens";
import { HtfTeaser } from "./HtfTeaser";

const meta: CompartmentMeta = {
  id: "htf-scanner",
  name: "HTF Scanner — High Tight Flag",
  // owner 2026-06-09: HTF is UNPROVEN (never validated SPY-relative on $5-75). Owner-only until re-tested.
  tier: "owner",
  fullPageRoute: "/htf",
  description:
    "30%+ pole / tight flag breakouts firing right now. Entry, target, and stop per the HTF ruleset.",
};

export const htfScannerCompartment: ClientCompartmentEntry = {
  meta,
  WidgetView: HtfTeaser,
  widgetDefaultSize: TILE_SM,
  widgetMinSize: TILE_MIN_SM,
};

export { meta, HtfTeaser };
export {
  useHtfScanner,
  useHtfScannerRefresh,
  type HtfSetupRow,
  type HtfSetupsResponse,
  type UseHtfScannerOptions,
} from "./useHtfScanner";
