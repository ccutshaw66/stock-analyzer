/**
 * CandlePane — the canonical TradingView Lightweight Charts candle pane
 * for every TV-style chart on the site.
 *
 * Per the universal-structure rule (2026-05-15): no new page renders its
 * own candle chart. Use this. Configure indicators / volume / markers via
 * props — the component handles the rest.
 *
 * Renders OHLC candles + zero or more configurable line overlays (EMAs,
 * Bollinger middle, custom indicators) + optional volume histogram +
 * optional signal markers. Brand-tuned colors (Stock Otter indigo
 * crosshair, semantic bull/bear/wick tokens). Dark theme. Otter watermark.
 *
 * Example — Confluence Chart's three EMAs:
 *
 *   <CandlePane
 *     bars={bars}
 *     overlays={[
 *       { dataKey: "ema21", label: "EMA 21", color: CHART_EMA_21_CANDLE, visible: showEma21 },
 *       { dataKey: "ema50", label: "EMA 50", color: CHART_EMA_50_CANDLE, visible: showEma50 },
 *       { dataKey: "sma200", label: "SMA 200", color: CHART_EMA_200_CANDLE, visible: showEma200 },
 *     ]}
 *   />
 *
 * Example — Trade Analysis with entry/exit markers (TBD migration):
 *
 *   <CandlePane
 *     bars={bars}
 *     overlays={[ ...EMA overlays... ]}
 *     markers={[
 *       { date: "2025-04-12", position: "belowBar", shape: "arrowUp", color: SIGNAL_BULL, text: "BUY" },
 *       { date: "2025-04-28", position: "aboveBar", shape: "arrowDown", color: SIGNAL_BEAR, text: "STOP" },
 *     ]}
 *   />
 */
import { useEffect, useRef } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  CrosshairMode,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
  type SeriesMarker,
} from "lightweight-charts";
import {
  SIGNAL_BULL,
  SIGNAL_BEAR,
  CHART_WICK,
  CHART_TEXT,
  CHART_CROSSHAIR,
  OVERLAY_BULL_40,
  OVERLAY_BEAR_40,
  OVERLAY_NEUTRAL_8,
} from "@/lib/design-tokens";
import otterMascot from "@/assets/icon.png";
import type { ChartBar, LineOverlay, ChartMarker } from "./types";

export interface CandlePaneProps {
  /** Bars to render. */
  bars: ChartBar[];
  /** Line overlays to plot on top of candles (EMAs, SMAs, custom indicators). */
  overlays?: LineOverlay[];
  /** Signal markers (entry/exit arrows, alerts). */
  markers?: ChartMarker[];
  /** Show the volume histogram in the bottom 20% of the pane. Default true. */
  showVolume?: boolean;
  /** Show the otter watermark in the corner. Default true. */
  showWatermark?: boolean;
  /** Test ID — defaults to "candle-pane". Override for multi-pane pages. */
  testId?: string;
}

function dateToTime(dateStr: string): UTCTimestamp {
  // Bars from /api/analyze come as ISO date strings (YYYY-MM-DD or similar).
  // Lightweight Charts wants seconds-since-epoch as a UTCTimestamp.
  const t = Math.floor(new Date(dateStr).getTime() / 1000);
  return t as UTCTimestamp;
}

export function CandlePane({
  bars,
  overlays = [],
  markers = [],
  showVolume = true,
  showWatermark = true,
  testId = "candle-pane",
}: CandlePaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  /** Per-overlay series refs, keyed by dataKey so we can update individually. */
  const overlaySeriesRef = useRef<Record<string, ISeriesApi<"Line">>>({});
  /** Markers plugin — v5 API attaches markers via a separate plugin instance,
   * not via `series.setMarkers`. Created once at chart init and reused. */
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  // Initialize chart once. All data updates flow through refs.
  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: CHART_TEXT,
        fontFamily: "Inter, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: OVERLAY_NEUTRAL_8 },
        horzLines: { color: OVERLAY_NEUTRAL_8 },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: CHART_CROSSHAIR, width: 1, style: 3 },
        horzLine: { color: CHART_CROSSHAIR, width: 1, style: 3 },
      },
      rightPriceScale: {
        borderColor: OVERLAY_NEUTRAL_8,
        scaleMargins: { top: 0.05, bottom: showVolume ? 0.25 : 0.05 },
      },
      timeScale: {
        borderColor: OVERLAY_NEUTRAL_8,
        timeVisible: false,
        secondsVisible: false,
      },
      autoSize: true,
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    // Candles
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: SIGNAL_BULL,
      downColor: SIGNAL_BEAR,
      borderUpColor: SIGNAL_BULL,
      borderDownColor: SIGNAL_BEAR,
      wickUpColor: CHART_WICK,
      wickDownColor: CHART_WICK,
    });
    candleSeriesRef.current = candles;

    // Markers plugin — attaches to the candle series. v5 moved markers out
    // of the series API into a standalone plugin function.
    markersPluginRef.current = createSeriesMarkers(candles, []);

    // Volume histogram, scaled to bottom 20% of pane via overlay price scale.
    if (showVolume) {
      const volume = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "vol",
        color: OVERLAY_BULL_40,
      });
      chart.priceScale("vol").applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volumeSeriesRef.current = volume;
    }

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      overlaySeriesRef.current = {};
      markersPluginRef.current = null;
    };
  }, [showVolume]);

  // Push candle + volume bar data whenever the bars array changes.
  // fitContent() lives HERE so it only runs on real data loads, not on
  // every overlay or marker toggle (which would reset the user's pan/zoom).
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    if (bars.length === 0) return;

    const seen = new Set<number>();
    const candleData: Array<{ time: Time; open: number; high: number; low: number; close: number }> = [];
    const volumeData: Array<{ time: Time; value: number; color: string }> = [];

    for (const b of bars) {
      const t = dateToTime(b.date);
      if (seen.has(t as unknown as number)) continue;
      seen.add(t as unknown as number);
      candleData.push({ time: t, open: b.open, high: b.high, low: b.low, close: b.close });
      if (showVolume && typeof b.volume === "number" && !isNaN(b.volume)) {
        volumeData.push({
          time: t,
          value: b.volume,
          color: b.close >= b.open ? OVERLAY_BULL_40 : OVERLAY_BEAR_40,
        });
      }
    }

    const byTime = (a: { time: Time }, b: { time: Time }) => (a.time as number) - (b.time as number);
    candleData.sort(byTime);
    volumeData.sort(byTime);

    candleSeriesRef.current.setData(candleData);
    if (showVolume) volumeSeriesRef.current?.setData(volumeData);

    chartRef.current?.timeScale().fitContent();
  }, [bars, showVolume]);

  // Sync overlay line series — add/remove series based on the visible flag
  // and push their data. Toggling visibility = add/remove the series on the
  // chart (rather than relying on `visible: false`, which had v5 quirks).
  //
  // Three concerns in one effect because they share the same dep set and
  // splitting them was causing race conditions (data pushed before series
  // existed, or option flips not seeing the new series).
  //
  // Dep `JSON.stringify(overlays)` — fires whenever ANY field of any
  // overlay changes; stays stable when the overlay set is unchanged.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const existing = overlaySeriesRef.current;

    // Set of overlays that should be ON the chart right now (visible=true
    // AND in the overlay list).
    const visibleKeys = new Set(
      overlays.filter((o) => o.visible ?? true).map((o) => o.dataKey),
    );

    // Remove any series that's no longer needed — either toggled off OR
    // dropped from the overlay list entirely.
    for (const key of Object.keys(existing)) {
      if (!visibleKeys.has(key)) {
        chart.removeSeries(existing[key]);
        delete existing[key];
      }
    }

    // Create + populate each visible overlay series.
    for (const overlay of overlays) {
      if (!(overlay.visible ?? true)) continue;

      const lineWidth = (overlay.width ?? 1) as 1 | 2 | 3 | 4;
      const opts = {
        color: overlay.color,
        lineWidth,
        priceLineVisible: overlay.showPriceLine ?? false,
        lastValueVisible: overlay.showLastValueLabel ?? false,
        title: overlay.label,
      };

      if (!existing[overlay.dataKey]) {
        existing[overlay.dataKey] = chart.addSeries(LineSeries, opts);
      } else {
        existing[overlay.dataKey].applyOptions(opts);
      }

      // Push data for this overlay. Filters NaN/null cleanly.
      if (bars.length === 0) continue;
      const seen = new Set<number>();
      const data: Array<{ time: Time; value: number }> = [];
      for (const b of bars) {
        const t = dateToTime(b.date);
        if (seen.has(t as unknown as number)) continue;
        seen.add(t as unknown as number);
        const v = b[overlay.dataKey];
        if (typeof v === "number" && !isNaN(v)) {
          data.push({ time: t, value: v });
        }
      }
      data.sort((a, b) => (a.time as number) - (b.time as number));
      existing[overlay.dataKey].setData(data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(overlays), bars]);

  // Push markers whenever they change. Does NOT call fitContent.
  useEffect(() => {
    if (!markersPluginRef.current) return;
    const seriesMarkers: SeriesMarker<Time>[] = markers
      .map((m) => ({
        time: dateToTime(m.date),
        position: m.position,
        shape: m.shape,
        color: m.color,
        text: m.text,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    markersPluginRef.current.setMarkers(seriesMarkers);
  }, [markers]);

  return (
    <div className="relative w-full h-full" data-testid={testId}>
      <div ref={containerRef} className="w-full h-full" />
      {showWatermark && (
        <img
          src={otterMascot}
          alt=""
          className="absolute bottom-3 right-3 h-12 w-12 opacity-[0.07] pointer-events-none select-none"
          aria-hidden
        />
      )}
    </div>
  );
}
