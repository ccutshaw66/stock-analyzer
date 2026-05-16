/**
 * TV-style chart primitives — public surface.
 *
 * Pages building TV-style charts import from `@/components/chart`. Per
 * the universal-structure rule (2026-05-15), no page should reach into
 * Lightweight Charts directly anymore.
 */
export { CandlePane, type CandlePaneProps } from "./CandlePane";
export { confluenceEMAOverlays, tradeAnalysisEMAOverlays } from "./overlays";
export type { ChartBar, LineOverlay, ChartMarker } from "./types";
