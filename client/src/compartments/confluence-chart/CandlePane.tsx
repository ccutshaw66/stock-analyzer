/**
 * Candle pane — TradingView Lightweight Charts wrapper.
 *
 * Renders OHLC candles + EMA21/50/200 line overlays + volume histogram
 * in a single chart with a synced time axis. Brand-tuned colors
 * (Stock Otter indigo accent, brand-friendly green/red), dark theme,
 * smooth crosshair, watermark.
 *
 * Future v2: signal markers, backtester entry/exit triangles, MM
 * exposure horizontal price lines all use Lightweight Charts'
 * `setMarkers` + `createPriceLine` APIs.
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
} from "lightweight-charts";
import type { CandleBar } from "./useConfluenceChart";
import otterMascot from "@/assets/icon.png";

interface CandlePaneProps {
  bars: CandleBar[];
  showEma21?: boolean;
  showEma50?: boolean;
  showEma200?: boolean;
}

// Brand-tuned palette (matches Stock Otter dark theme).
const BULL = "#22c55e";
const BEAR = "#ef4444";
const WICK = "#6b7280";
const BG = "transparent";
const TEXT = "#a1a1aa";
const GRID = "rgba(127, 127, 127, 0.08)";
const EMA21_COLOR = "#facc15"; // yellow
const EMA50_COLOR = "#a78bfa"; // brand-adjacent purple
const EMA200_COLOR = "#e4e4e7"; // near-white
const VOLUME_UP = "rgba(34, 197, 94, 0.4)";
const VOLUME_DOWN = "rgba(239, 68, 68, 0.4)";

function dateToTime(dateStr: string): UTCTimestamp {
  // Bars from /api/analyze come as ISO date strings (YYYY-MM-DD or similar).
  // Lightweight Charts wants seconds-since-epoch as a UTCTimestamp.
  const t = Math.floor(new Date(dateStr).getTime() / 1000);
  return t as UTCTimestamp;
}

export function CandlePane({
  bars,
  showEma21 = true,
  showEma50 = true,
  showEma200 = false,
}: CandlePaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const ema21Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema200Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  // Initialize chart once. All data updates go through refs.
  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: BG },
        textColor: TEXT,
        fontFamily: "Inter, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: GRID },
        horzLines: { color: GRID },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#6366f1", width: 1, style: 3 }, // dashed indigo
        horzLine: { color: "#6366f1", width: 1, style: 3 },
      },
      rightPriceScale: {
        borderColor: GRID,
        scaleMargins: { top: 0.05, bottom: 0.25 },
      },
      timeScale: {
        borderColor: GRID,
        timeVisible: false,
        secondsVisible: false,
      },
      autoSize: true,
      handleScroll: true,
      handleScale: true,
      // Otter watermark is rendered as an absolutely-positioned <img> overlay
      // below — Lightweight Charts' built-in watermark API varies between
      // major versions, so we use a brand-friendly image overlay instead.
    });
    chartRef.current = chart;

    // Candles
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: BULL,
      downColor: BEAR,
      borderUpColor: BULL,
      borderDownColor: BEAR,
      wickUpColor: WICK,
      wickDownColor: WICK,
    });
    candleSeriesRef.current = candles;

    // Volume histogram, scaled to bottom 20% of pane via overlay price scale.
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: VOLUME_UP,
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeriesRef.current = volume;

    // EMA overlays
    ema21Ref.current = chart.addSeries(LineSeries, {
      color: EMA21_COLOR,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ema50Ref.current = chart.addSeries(LineSeries, {
      color: EMA50_COLOR,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ema200Ref.current = chart.addSeries(LineSeries, {
      color: EMA200_COLOR,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      ema21Ref.current = null;
      ema50Ref.current = null;
      ema200Ref.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  // Push bar data whenever it changes.
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
    if (bars.length === 0) return;

    // De-dup by date — Lightweight Charts requires unique sorted times.
    const seen = new Set<number>();
    const candleData: Array<{ time: Time; open: number; high: number; low: number; close: number }> = [];
    const volumeData: Array<{ time: Time; value: number; color: string }> = [];
    const ema21Data: Array<{ time: Time; value: number }> = [];
    const ema50Data: Array<{ time: Time; value: number }> = [];
    const ema200Data: Array<{ time: Time; value: number }> = [];

    for (const b of bars) {
      const t = dateToTime(b.date);
      if (seen.has(t as unknown as number)) continue;
      seen.add(t as unknown as number);
      candleData.push({ time: t, open: b.open, high: b.high, low: b.low, close: b.close });
      if (typeof b.volume === "number" && !isNaN(b.volume)) {
        volumeData.push({
          time: t,
          value: b.volume,
          color: b.close >= b.open ? VOLUME_UP : VOLUME_DOWN,
        });
      }
      if (b.ema21 != null && !isNaN(b.ema21)) ema21Data.push({ time: t, value: b.ema21 });
      if (b.ema50 != null && !isNaN(b.ema50)) ema50Data.push({ time: t, value: b.ema50 });
      if (b.sma200 != null && !isNaN(b.sma200)) ema200Data.push({ time: t, value: b.sma200 });
    }
    candleData.sort((a, b) => (a.time as number) - (b.time as number));
    volumeData.sort((a, b) => (a.time as number) - (b.time as number));
    ema21Data.sort((a, b) => (a.time as number) - (b.time as number));
    ema50Data.sort((a, b) => (a.time as number) - (b.time as number));
    ema200Data.sort((a, b) => (a.time as number) - (b.time as number));

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);
    ema21Ref.current?.setData(ema21Data);
    ema50Ref.current?.setData(ema50Data);
    ema200Ref.current?.setData(ema200Data);

    chartRef.current?.timeScale().fitContent();
  }, [bars]);

  // Toggle EMA visibility without recreating the chart.
  useEffect(() => {
    ema21Ref.current?.applyOptions({ visible: showEma21 });
  }, [showEma21]);
  useEffect(() => {
    ema50Ref.current?.applyOptions({ visible: showEma50 });
  }, [showEma50]);
  useEffect(() => {
    ema200Ref.current?.applyOptions({ visible: showEma200 });
  }, [showEma200]);

  return (
    <div className="relative w-full h-full" data-testid="confluence-candle-pane">
      <div ref={containerRef} className="w-full h-full" />
      {/* Otter watermark — bottom-right, subtle. Brand presence without distraction. */}
      <img
        src={otterMascot}
        alt=""
        className="absolute bottom-3 right-3 h-12 w-12 opacity-[0.07] pointer-events-none select-none"
        aria-hidden
      />
    </div>
  );
}
