/**
 * Scanner v2 compartment — client side. Manifest + Widget.
 *
 * Full-page consumers continue to use `client/src/pages/scanner.tsx` during
 * the strangler migration; that page is the future `FullView` once it
 * migrates from its sessionStorage + setQueryData dance to call
 * `useScannerV2` directly (follow-up task).
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { BestOppsWidget } from "./BestOppsWidget";

const meta: CompartmentMeta = {
  id: "scanner-v2",
  name: "Scanner v2 — Best Opps",
  tier: "free",
  fullPageRoute: "/scanner",
  description: "Confluence-based explosion detector. Top scoring tickers with per-signal breakdown.",
};

export const scannerCompartment: ClientCompartmentEntry = {
  meta,
  WidgetView: BestOppsWidget,
  widgetDefaultSize: { w: 3, h: 4 },
  widgetMinSize: { w: 2, h: 3 },
};

export { meta, BestOppsWidget };
export {
  useScannerV2,
  type ScannerV2Filters,
  type ScannerV2Response,
  type ScannerV2Row,
  type ScannerV2SignalResult,
} from "./useScannerV2";
