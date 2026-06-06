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
import { useEffect, useRef, useState } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  CrosshairMode,
  ColorType,
  LineStyle,
  type IChartApi,
  type IPriceLine,
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
  CHART_RSI,
  SIGNAL_WATCH_SHORT,
  SIGNAL_SHORT_ADD,
  CHART_AXIS_LINE,
} from "@/lib/design-tokens";
import otterMascot from "@/assets/icon.png";
import type { ChartBar, LineOverlay, ChartMarker, PriceLine } from "./types";
import { computeChartOscillators } from "./oscillators";

export interface CandlePaneProps {
  /** Bars to render. */
  bars: ChartBar[];
  /** Line overlays to plot on top of candles (EMAs, SMAs, custom indicators). */
  overlays?: LineOverlay[];
  /** Signal markers (entry/exit arrows, alerts). */
  markers?: ChartMarker[];
  /** Horizontal price lines (target, stop, breakout level, etc.). */
  priceLines?: PriceLine[];
  /** Show the volume histogram in the bottom 20% of the pane. Default true. */
  showVolume?: boolean;
  /** Show the otter watermark in the corner. Default true. */
  showWatermark?: boolean;
  /**
   * Momentum oscillator sub-panes rendered INSIDE this chart (one shared time
   * scale → they pan/zoom in lockstep with the candles, from the same bars).
   * Reads `bar.macd` / `bar.macdSignal` / `bar.macdHist` and `bar.rsi`.
   */
  subPanes?: { macd?: boolean; rsi?: boolean };
  /** Test ID — defaults to "candle-pane". Override for multi-pane pages. */
  testId?: string;
  /**
   * Initial candle style. Heikin Ashi by default (smoothed trend view); the
   * built-in toggle lets the user flip to real candlesticks. Optional so a
   * page CAN seed a different default without per-page toggle wiring.
   */
  defaultCandleType?: CandleType;
}

function dateToTime(dateStr: string): UTCTimestamp {
  // Bars from /api/analyze come as ISO date strings (YYYY-MM-DD or similar).
  // Lightweight Charts wants seconds-since-epoch as a UTCTimestamp.
  const t = Math.floor(new Date(dateStr).getTime() / 1000);
  return t as UTCTimestamp;
}

type CandleType = "heikin-ashi" | "normal";
type Candle = { time: Time; open: number; high: number; low: number; close: number };

// Heikin Ashi = smoothed candles derived from the same OHLC (no new data):
//   HA close = (O+H+L+C)/4
//   HA open  = midpoint of the PRIOR HA candle (first bar seeds from its own O/C)
//   HA high  = max(real high, HA open, HA close)   HA low = min(real low, HA open, HA close)
// Bodies no longer sit at true price (that's the trade-off), but trends read cleaner.
// Input must already be de-duped + sorted ascending by time (the bars effect does that).
function toHeikinAshi(data: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const haOpen = i === 0 ? (c.open + c.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({
      time: c.time,
      open: haOpen,
      high: Math.max(c.high, haOpen, haClose),
      low: Math.min(c.low, haOpen, haClose),
      close: haClose,
    });
  }
  return out;
}

export function CandlePane({
  bars,
  overlays = [],
  markers = [],
  priceLines = [],
  showVolume = true,
  showWatermark = true,
  subPanes,
  testId = "candle-pane",
  defaultCandleType = "heikin-ashi",
}: CandlePaneProps) {
  const [candleType, setCandleType] = useState<CandleType>(defaultCandleType);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  /** Per-overlay series refs, keyed by dataKey so we can update individually. */
  const overlaySeriesRef = useRef<Record<string, ISeriesApi<"Line">>>({});
  /** Markers plugin — v5 API attaches markers via a separate plugin instance,
   * not via `series.setMarkers`. Created once at chart init and reused. */
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  /** Active price-line handles so we can remove them on re-render. */
  const priceLineRefs = useRef<IPriceLine[]>([]);
  /** Oscillator sub-pane series (MACD pane + RSI pane), created on demand. */
  const macdHistRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const macdLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiLineRef = useRef<ISeriesApi<"Line"> | null>(null);

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
      macdHistRef.current = null;
      macdLineRef.current = null;
      macdSignalRef.current = null;
      rsiLineRef.current = null;
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

    // Real candles by default; Heikin Ashi is a derived view of the SAME bars.
    candleSeriesRef.current.setData(candleType === "heikin-ashi" ? toHeikinAshi(candleData) : candleData);
    if (showVolume) volumeSeriesRef.current?.setData(volumeData);

    chartRef.current?.timeScale().fitContent();
  }, [bars, showVolume, candleType]);

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

  // Oscillator sub-panes (MACD + RSI) drawn INSIDE this chart. They live on
  // their own pane indices but share the candle's single time scale, so
  // panning/zooming the candles moves them in lockstep — and they read the
  // SAME `bars` (bar.macd* / bar.rsi), never a separate fetch.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const wantMacd = !!subPanes?.macd;
    const wantRsi = !!subPanes?.rsi;
    const macdPane = 1;
    const rsiPane = wantMacd ? 2 : 1;

    const dedupe = (rows: Array<{ time: Time; value: number; color?: string }>) => {
      const seen = new Set<number>();
      const out: typeof rows = [];
      for (const r of rows) {
        const k = r.time as unknown as number;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(r);
      }
      return out.sort((a, b) => (a.time as number) - (b.time as number));
    };

    // If the chart's bars already carry rsi/macd* (e.g. /api/chart), use them;
    // otherwise compute from closes (same math) so `subPanes` is plug-and-play
    // on ANY chart with no data plumbing. Identical bars → identical oscillators.
    const closes = bars.map(b => b.close);
    const needCompute =
      !bars.some(b => typeof b.macd === "number") || !bars.some(b => typeof b.rsi === "number");
    const computed = needCompute ? computeChartOscillators(closes) : null;
    const pick = (raw: number | string | undefined, fb: number | undefined): number =>
      typeof raw === "number" ? raw : (typeof fb === "number" ? fb : NaN);

    // ── MACD pane ──
    if (wantMacd) {
      if (!macdHistRef.current) {
        macdHistRef.current = chart.addSeries(HistogramSeries, {
          priceLineVisible: false, lastValueVisible: false,
        }, macdPane);
      }
      if (!macdLineRef.current) {
        macdLineRef.current = chart.addSeries(LineSeries, {
          color: CHART_RSI, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "MACD",
        }, macdPane);
      }
      if (!macdSignalRef.current) {
        macdSignalRef.current = chart.addSeries(LineSeries, {
          color: SIGNAL_WATCH_SHORT, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "Signal",
        }, macdPane);
      }
      const hist: Array<{ time: Time; value: number; color?: string }> = [];
      const macdL: Array<{ time: Time; value: number }> = [];
      const sigL: Array<{ time: Time; value: number }> = [];
      bars.forEach((b, i) => {
        const t = dateToTime(b.date);
        const h = pick(b.macdHist, computed?.macdHist[i]);
        const m = pick(b.macd, computed?.macd[i]);
        const s = pick(b.macdSignal, computed?.macdSignal[i]);
        if (!isNaN(h)) hist.push({ time: t, value: h, color: h >= 0 ? OVERLAY_BULL_40 : OVERLAY_BEAR_40 });
        if (!isNaN(m)) macdL.push({ time: t, value: m });
        if (!isNaN(s)) sigL.push({ time: t, value: s });
      });
      macdHistRef.current.setData(dedupe(hist));
      macdLineRef.current.setData(dedupe(macdL));
      macdSignalRef.current.setData(dedupe(sigL));
    } else {
      if (macdHistRef.current) { chart.removeSeries(macdHistRef.current); macdHistRef.current = null; }
      if (macdLineRef.current) { chart.removeSeries(macdLineRef.current); macdLineRef.current = null; }
      if (macdSignalRef.current) { chart.removeSeries(macdSignalRef.current); macdSignalRef.current = null; }
    }

    // ── RSI pane ──
    if (wantRsi) {
      if (!rsiLineRef.current) {
        rsiLineRef.current = chart.addSeries(LineSeries, {
          color: SIGNAL_SHORT_ADD, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: "RSI",
        }, rsiPane);
        rsiLineRef.current.createPriceLine({ price: 70, color: SIGNAL_BEAR, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "" });
        rsiLineRef.current.createPriceLine({ price: 50, color: CHART_AXIS_LINE, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });
        rsiLineRef.current.createPriceLine({ price: 30, color: SIGNAL_BULL, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "" });
      }
      const rsi: Array<{ time: Time; value: number }> = [];
      bars.forEach((b, i) => {
        const t = dateToTime(b.date);
        const r = pick(b.rsi, computed?.rsi[i]);
        if (!isNaN(r)) rsi.push({ time: t, value: r });
      });
      rsiLineRef.current.setData(dedupe(rsi));
    } else {
      if (rsiLineRef.current) { chart.removeSeries(rsiLineRef.current); rsiLineRef.current = null; }
    }

    // Price pane keeps the lion's share; each oscillator gets a slim strip.
    if (wantMacd || wantRsi) {
      const panes = chart.panes();
      panes[0]?.setStretchFactor(3);
      if (wantMacd) panes[macdPane]?.setStretchFactor(1);
      if (wantRsi) panes[rsiPane]?.setStretchFactor(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, subPanes?.macd, subPanes?.rsi]);

  // Sync horizontal price lines. Each call removes the old set and creates
  // fresh ones — small N (typically <10), so the cost is negligible. Drawn
  // on the candle series so they share the candle price scale.
  useEffect(() => {
    const candle = candleSeriesRef.current;
    if (!candle) return;
    for (const handle of priceLineRefs.current) {
      try { candle.removePriceLine(handle); } catch { /* ignore */ }
    }
    priceLineRefs.current = [];
    const styleMap = {
      solid: LineStyle.Solid,
      dashed: LineStyle.Dashed,
      dotted: LineStyle.Dotted,
    } as const;
    for (const pl of priceLines) {
      const handle = candle.createPriceLine({
        price: pl.price,
        color: pl.color,
        lineWidth: (pl.width ?? 1) as 1 | 2 | 3 | 4,
        lineStyle: styleMap[pl.style ?? "dashed"],
        title: pl.title ?? "",
        axisLabelVisible: pl.axisLabelVisible ?? true,
      });
      priceLineRefs.current.push(handle);
    }
  }, [JSON.stringify(priceLines)]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative w-full h-full" data-testid={testId}>
      <div ref={containerRef} className="w-full h-full" />
      {/* Candle-style toggle — lives in the shared pane so every chart gets it
          for free (universal-structure rule). Heikin Ashi default; real candles
          one click away. */}
      <div className="absolute top-2 left-2 z-10 flex overflow-hidden rounded border border-border bg-card/80 backdrop-blur text-2xs">
        {([
          ["heikin-ashi", "Heikin Ashi"],
          ["normal", "Candles"],
        ] as [CandleType, string][]).map(([type, label]) => (
          <button
            key={type}
            type="button"
            onClick={() => setCandleType(type)}
            className={`px-2 py-1 transition-colors ${candleType === type ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            data-testid={`candle-type-${type}`}
          >
            {label}
          </button>
        ))}
      </div>
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
