/**
 * Markov compartment manifest.
 *
 * Stub awaiting Python service deployment — the hook contract is in place
 * so consumers (page, widget, alert preview) all read from one source the
 * day the backend goes live.
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { TILE_SM, TILE_MIN_SM } from "@/lib/layout-tokens";
import { MarkovFullView } from "./MarkovFullView";
import { MarkovWidget } from "./MarkovWidget";

const meta: CompartmentMeta = {
  id: "markov",
  name: "Markov Strategy",
  tier: "free",
  fullPageRoute: "/markov",
  description:
    "Gaussian-HMM regime detection with vol-targeted sizing. Pending Python " +
    "service deployment; source archived at python/markov_trading_v2.py.",
};

export const markovCompartment: ClientCompartmentEntry = {
  meta,
  FullView: MarkovFullView,
  WidgetView: MarkovWidget,
  widgetDefaultSize: TILE_SM,
  widgetMinSize: TILE_MIN_SM,
};

export { meta, MarkovFullView, MarkovWidget };
export {
  useMarkov, MARKOV_API, DEFAULT_PARAMS,
  type MarkovParams, type MarkovBacktestResult, type MarkovPerformance,
} from "./useMarkov";
