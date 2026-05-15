/**
 * Trade Tracker compartment — per-user trade ledger.
 *
 * Canonical accessor wrapping `storage` trade methods. Pages, dashboard
 * widgets, alerts, and future consumers all import `tradesData` from here.
 *
 * P/L math lives in `shared/pnl/` (per Q-C3 lock-in) — both this compartment
 * and `/api/trades/summary` in legacy `server/routes.ts:5864+` consume those
 * pure functions. Future round migrates routes here behind `mountRoutes`.
 */
import { storage } from "../../storage";
import type { Trade } from "@shared/schema";
import type { ServerCompartmentEntry, CompartmentMeta } from "../types";

const meta: CompartmentMeta = {
  id: "trades",
  name: "Trade Tracker",
  tier: "free",
  fullPageRoute: "/trade-tracker",
  description: "Per-user trade ledger with realized P/L, open position aggregation, and MFE/MAE analytics.",
};

/**
 * Canonical data accessor — single source of truth for any consumer that
 * needs to read per-user trades. Mutations still flow through existing
 * `/api/trades` routes during strangler migration.
 */
export const tradesData = {
  list(userId: number): Promise<Trade[]> {
    return storage.getAllTrades(userId);
  },
  get(userId: number, id: number) {
    return storage.getTrade(userId, id);
  },
};

export const tradesCompartment: ServerCompartmentEntry = {
  meta,
};

export { meta };
