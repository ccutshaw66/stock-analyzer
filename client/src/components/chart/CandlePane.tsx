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
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  CrosshairMode,
  ColorType,
  type IChartApi,
  type ISeriesApi,
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
    };
  }, [showVolume]);

  // Manage overlay line series — create new ones when an overlay appears,
  // remove ones that vanish from the config.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const existing = overlaySeriesRef.current;
    const desiredKeys = new Set(overlays.map((o) => o.dataKey));

    // Remove series whose dataKey is no longer in the overlay list.
    for (const key of Object.keys(existing)) {
      if (!desiredKeys.has(key)) {
        chart.removeSeries(existing[key]);
        delete existing[key];
      }
    }

    // Create or update each overlay's series.
    for (const overlay of overlays) {
      const s = existing[overlay.dataKey] ?? chart.addSeries(LineSeries, {
        color: overlay.color,
        lineWidth: (overlay.width ?? 1) as 1 | 2 | 3 | 4,
        priceLineVisible: overlay.showPriceLine ?? false,
        lastValueVisible: overlay.showLastValueLabel ?? false,
        title: overlay.label,
      });
      existing[overlay.dataKey] = s;
      s.applyOptions({
        color: overlay.color,
        lineWidth: (overlay.width ?? 1) as 1 | 2 | 3 | 4,
        priceLineVisible: overlay.showPriceLine ?? false,
        lastValueVisible: overlay.showLastValueLabel ?? false,
        visible: overlay.visible ?? true,
        title: overlay.label,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlays.map((o) => `${o.dataKey}:${o.color}:${o.visible}:${o.width}`).join("|")]);

  // Push bar data whenever it (or overlays) changes.
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    if (bars.length === 0) return;

    const seen = new Set<number>();
    const candleData: Array<{ time: Time; open: number; high: number; low: number; close: number }> = [];
    const volumeData: Array<{ time: Time; value: number; color: string }> = [];
    const overlayData: Record<string, Array<{ time: Time; value: number }>> = {};

    for (const overlay of overlays) overlayData[overlay.dataKey] = [];

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
      for (const overlay of overlays) {
        const v = b[overlay.dataKey];
        if (typeof v === "number" && !isNaN(v)) {
          overlayData[overlay.dataKey].push({ time: t, value: v });
        }
      }
    }

    const byTime = (a: { time: Time }, b: { time: Time }) => (a.time as number) - (b.time as number);
    candleData.sort(byTime);
    volumeData.sort(byTime);
    for (const key of Object.keys(overlayData)) overlayData[key].sort(byTime);

    candleSeriesRef.current.setData(candleData);
    if (showVolume) volumeSeriesRef.current?.setData(volumeData);
    for (const overlay of overlays) {
      overlaySeriesRef.current[overlay.dataKey]?.setData(overlayData[overlay.dataKey]);
    }

    // Markers attach to the candle series.
    if (markers.length > 0 && candleSeriesRef.current) {
      const seriesMarkers: SeriesMarker<Time>[] = markers.map((m) => ({
        time: dateToTime(m.date),
        position: m.position,
        shape: m.shape,
        color: m.color,
        text: m.text,
      }));
      // Lightweight Charts v5 API — setMarkers may have moved; guard for both.
      const seriesAny = candleSeriesRef.current as unknown as {
        setMarkers?: (ms: SeriesMarker<Time>[]) => void;
      };
      seriesAny.setMarkers?.(seriesMarkers);
    }

    chartRef.current?.timeScale().fitContent();
  }, [bars, overlays, markers, showVolume]);

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
