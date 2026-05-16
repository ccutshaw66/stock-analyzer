/**
 * Standard line-overlay presets for the canonical TV-style chart panes.
 *
 * Per the universal-structure rule (2026-05-15): pages don't hand-roll
 * their EMA setup. They import a preset from here and pass it to
 * `<CandlePane overlays={...} />`. If you find yourself defining the same
 * overlay set in two places, add a preset here instead.
 *
 * Visibility toggles: the presets take a `visibility` object so a page
 * can independently flip each line on/off without copying the whole
 * preset definition.
 */
import {
  CHART_EMA_21_CANDLE,
  CHART_EMA_50_CANDLE,
  CHART_EMA_200_CANDLE,
  CHART_EMA_50,
  CHART_EMA_200,
  SIGNAL_BULL,
  SIGNAL_WATCH_SHORT,
} from "@/lib/design-tokens";
import type { LineOverlay } from "./types";

/**
 * Confluence Chart's standard 3-line EMA stack — the muted-pastel palette
 * (yellow / violet / near-white) tuned for the dark candle pane.
 *
 * Bars must emit `ema21`, `ema50`, and `sma200` fields.
 */
export function confluenceEMAOverlays({
  showEma21 = true,
  showEma50 = true,
  showEma200 = false,
}: {
  showEma21?: boolean;
  showEma50?: boolean;
  showEma200?: boolean;
} = {}): LineOverlay[] {
  return [
    { dataKey: "ema21", label: "EMA 21", color: CHART_EMA_21_CANDLE, visible: showEma21 },
    { dataKey: "ema50", label: "EMA 50", color: CHART_EMA_50_CANDLE, visible: showEma50 },
    { dataKey: "sma200", label: "SMA 200", color: CHART_EMA_200_CANDLE, visible: showEma200 },
  ];
}

/**
 * Trade Analysis EMA stack — the bolder palette (green / orange / cyan /
 * purple) the legacy Recharts version used. Used by the Trade Analysis
 * page when it migrates to the TV-style chart.
 *
 * Bars must emit `ema9`, `ema21`, `ema50`, and `sma200` fields.
 */
export function tradeAnalysisEMAOverlays({
  showEma9 = true,
  showEma21 = true,
  showEma50 = true,
  showEma200 = false,
}: {
  showEma9?: boolean;
  showEma21?: boolean;
  showEma50?: boolean;
  showEma200?: boolean;
} = {}): LineOverlay[] {
  return [
    { dataKey: "ema9", label: "EMA 9", color: SIGNAL_BULL, visible: showEma9 },
    { dataKey: "ema21", label: "EMA 21", color: SIGNAL_WATCH_SHORT, visible: showEma21 },
    { dataKey: "ema50", label: "EMA 50", color: CHART_EMA_50, visible: showEma50 },
    { dataKey: "sma200", label: "SMA 200", color: CHART_EMA_200, visible: showEma200 },
  ];
}
