/**
 * Trade Tracker compartment — client side. Manifest + Widget view.
 *
 * Full-page consumers continue to use `client/src/pages/trade-tracker.tsx`
 * during the strangler migration. That page has its own client-side P/L
 * code (which predates `shared/pnl/`) — migration to consume `useTrades` +
 * `shared/pnl/` is a follow-up task that also retires the duplicated
 * `computeStockPL` / `computeOptionPL` / `aggregateOpenPositions` defined
 * in `trade-tracker.tsx:115-297`.
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { MyTradesWidget } from "./MyTradesWidget";

const meta: CompartmentMeta = {
  id: "trades",
  name: "Trade Tracker",
  tier: "free",
  fullPageRoute: "/trade-tracker",
  description: "Per-user trade ledger with realized P/L, open position aggregation, and MFE/MAE analytics.",
};

export const tradesCompartment: ClientCompartmentEntry = {
  meta,
  WidgetView: MyTradesWidget,
  widgetDefaultSize: { w: 4, h: 4 },
  widgetMinSize: { w: 3, h: 3 },
};

export { meta, MyTradesWidget };
export { useTrades, useTradesSummary, type TradesSummary } from "./useTrades";
