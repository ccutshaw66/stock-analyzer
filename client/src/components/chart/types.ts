/**
 * Shared types for the TV-style chart primitives.
 *
 * Per the universal-structure rule (2026-05-15): every chart on the site
 * speaks this language. Each bar carries OHLC + volume in fixed fields,
 * and any indicator value (ema21, sma200, rsi, etc.) sits beside them as
 * an optional numeric field that overlays can read by name.
 *
 * Charts that consume these types: Confluence Chart, Trade Analysis,
 * Strategy Chart, MM Exposure (price overlay), and any future TV-style
 * chart pane.
 */

/**
 * Generic chart bar. Required: date + OHLC + volume. Optional indicator
 * fields can sit beside them — overlays read by `dataKey` string.
 *
 * The index signature `[key: string]: number | string | undefined` allows
 * arbitrary indicator fields (ema21, ema50, sma200, rsi14, macdHist, etc.)
 * without forcing a fixed schema. Producers should still document which
 * fields they emit (see useConfluenceChart's CandleBar for the canonical
 * example).
 */
export interface ChartBar {
  /** ISO date string (YYYY-MM-DD) or millisecond timestamp string. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  /** Arbitrary indicator fields. Read by line-overlay `dataKey`. */
  [indicator: string]: number | string | undefined;
}

/**
 * Configuration for a line overlay drawn on the candle pane.
 *
 * Example: { dataKey: "ema21", color: CHART_EMA_21_CANDLE, visible: true }
 * tells the chart to plot a line connecting `bar.ema21` values across bars,
 * in the given color, currently visible.
 *
 * To hide/show a line without recreating the chart, change `visible` —
 * the component honors prop changes via `applyOptions({ visible })`.
 */
export interface LineOverlay {
  /** Field name on the bar to read for this line's values. */
  dataKey: string;
  /** Display label (e.g. "EMA 21") — surfaced in tooltips / legends. */
  label?: string;
  /** Line color in hex/rgb. Use design-tokens (CHART_EMA_*, SIGNAL_*). */
  color: string;
  /** Line width in pixels. Default 1. */
  width?: number;
  /** Show the line? Default true. Used for indicator toggles. */
  visible?: boolean;
  /** Show this series' last value as a price-axis label? Default false. */
  showLastValueLabel?: boolean;
  /** Show a horizontal price line at the current value? Default false. */
  showPriceLine?: boolean;
}

/**
 * A signal marker placed on a bar (entry, exit, alert, etc.).
 * Mapped 1:1 to Lightweight Charts' marker API at render time.
 */
export interface ChartMarker {
  /** ISO date of the bar to mark. Must match a bar.date in the series. */
  date: string;
  /** Where the marker sits relative to the bar. */
  position: "aboveBar" | "belowBar" | "inBar";
  /** Marker shape. */
  shape: "circle" | "square" | "arrowUp" | "arrowDown";
  /** Marker color in hex/rgb. */
  color: string;
  /** Optional short text label on the marker. */
  text?: string;
  /** Optional richer label (tooltip on hover). Lightweight Charts ignores
   * this directly; consumers can surface it via custom tooltip. */
  description?: string;
}
