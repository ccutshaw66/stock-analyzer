/**
 * Standard line-overlay presets for TV-style chart panes.
 *
 * Per the universal-structure rule (2026-05-15): pages don't hand-roll
 * their EMA setup. Import `emaOverlays(...)` and pass to
 * `<CandlePane overlays={...} />`. ONE palette for every chart on the
 * site — green / orange / cyan / purple — picked per Chris 2026-05-15.
 *
 * Visibility toggles: the preset takes a `visibility` object so a page
 * can independently flip each line on/off without copying the whole
 * preset definition.
 *
 * Bars must emit `ema9`, `ema21`, `ema50`, and `sma200` numeric fields.
 * If your endpoint doesn't emit all four, the corresponding line just
 * has no data points — the overlay still renders cleanly.
 */
import {
  CHART_EMA_9,
  CHART_EMA_21,
  CHART_EMA_50,
  CHART_EMA_200,
} from "@/lib/design-tokens";
import type { LineOverlay } from "./types";

/**
 * The canonical 4-EMA stack — used by Confluence Chart, Trade Analysis,
 * and Strategy Chart. Pass any combination of `showEma*` props to drive
 * the toggle buttons; defaults are EMA 9/21/50 on, EMA 200 off.
 */
export function emaOverlays({
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
    { dataKey: "ema9", label: "EMA 9", color: CHART_EMA_9, visible: showEma9 },
    { dataKey: "ema21", label: "EMA 21", color: CHART_EMA_21, visible: showEma21 },
    { dataKey: "ema50", label: "EMA 50", color: CHART_EMA_50, visible: showEma50 },
    { dataKey: "sma200", label: "SMA 200", color: CHART_EMA_200, visible: showEma200 },
  ];
}

/** @deprecated Use `emaOverlays()` — confluence + trade now share one palette. */
export const confluenceEMAOverlays = emaOverlays;
/** @deprecated Use `emaOverlays()` — confluence + trade now share one palette. */
export const tradeAnalysisEMAOverlays = emaOverlays;

/**
 * Configuration for the EMA toggle button strip used by chart pages.
 * Drives the colored toggle buttons (one per EMA) so the button color
 * matches the line color on the chart.
 */
export const EMA_TOGGLES: ReadonlyArray<{
  key: "ema9" | "ema21" | "ema50" | "ema200";
  label: string;
  color: string;
}> = [
  { key: "ema9", label: "EMA 9", color: CHART_EMA_9 },
  { key: "ema21", label: "EMA 21", color: CHART_EMA_21 },
  { key: "ema50", label: "EMA 50", color: CHART_EMA_50 },
  { key: "ema200", label: "SMA 200", color: CHART_EMA_200 },
];
