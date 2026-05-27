/**
 * /chart/confluence/:ticker? — full-page Confluence Chart.
 *
 * Composes the candle pane (Lightweight Charts) + Signal Pulse + MACD/RSI +
 * Confluence Dashboard panel + sticky verdict strip. Reads/writes
 * `TickerContext.activeTicker` so any ticker click anywhere in the app
 * lands on this page when the user navigates here.
 */
import { useEffect, useMemo, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useTicker } from "@/contexts/TickerContext";
import { useTimeframe } from "@/contexts/TimeframeContext";
import { IndicatorOscillator } from "@/components/IndicatorOscillator";
import { PageTemplate } from "@/components/PageTemplate";
import { CandlePane, emaOverlays, EmaToggleStrip, type EmaToggleState } from "@/components/chart";
import { ConfluenceDashboardPanel } from "@/compartments/confluence-chart/ConfluenceDashboardPanel";
import { VerdictStrip } from "@/compartments/confluence-chart/VerdictStrip";
import { EmptyState } from "@/compartments/confluence-chart/EmptyState";
import { HowToRead } from "@/compartments/confluence-chart/HowToRead";
import { useConfluenceChart } from "@/compartments/confluence-chart/useConfluenceChart";
import { formatCurrency } from "@/lib/format";
import { Loader2, Layers } from "lucide-react";

export default function ConfluenceChartPage() {
  const [match, params] = useRoute<{ ticker?: string }>("/chart/confluence/:ticker?");
  const { activeTicker, setActiveTicker } = useTicker();
  const { timeframe } = useTimeframe();
  const [_, navigate] = useLocation();
  const [emaState, setEmaState] = useState<EmaToggleState>({
    ema9: true, ema21: true, ema50: true, ema200: false,
  });

  // URL ticker → activeTicker bus.
  useEffect(() => {
    const urlTicker = params?.ticker?.toUpperCase();
    if (urlTicker && urlTicker !== activeTicker) {
      setActiveTicker(urlTicker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.ticker]);

  // activeTicker change → URL sync (without losing browser back).
  useEffect(() => {
    if (!activeTicker) return;
    const urlTicker = params?.ticker?.toUpperCase();
    if (urlTicker !== activeTicker) {
      navigate(`/chart/confluence/${activeTicker}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTicker]);

  const { bars, quote, quick, indicators, isLoading, error } = useConfluenceChart(activeTicker, timeframe);

  const spotPrice = quote?.regularMarketPrice ?? null;
  const dayChangePct = quote?.regularMarketChangePercent ?? null;
  const companyName = quote?.shortName ?? quote?.longName ?? undefined;

  const lastUpdated = useMemo(() => Date.now(), [bars]);

  if (!match) return null;

  const changeColor =
    dayChangePct == null
      ? "text-muted-foreground"
      : dayChangePct >= 0
      ? "text-bull"
      : "text-bear";

  const confluenceHowItWorks = (
    <>
      <p>The Confluence Chart pulls Stock Otter's four primary signal layers onto one screen so you can see when several agree at the same time.</p>
      <p><strong className="text-foreground">Candle pane</strong> — OHLC with the EMA stack (9/21/50, plus 200 SMA on toggle). The verdict ribbon at the top summarizes the gate state right now.</p>
      <p><strong className="text-foreground">Signal Pulse</strong> — Stock Otter's proprietary 12-signal oscillator. Green bars above zero mean bullish signals are stacking; red bars below mean bearish.</p>
      <p><strong className="text-foreground">MACD + RSI</strong> — classic momentum + stretch. MACD histogram flips give early trend-change cues; RSI &gt;70 / &lt;30 mark overbought/oversold.</p>
      <p>Look for <strong className="text-foreground">stacking</strong> — when EMA trend + MACD direction + RSI position + Signal Pulse direction all line up, that's a high-conviction read. One signal disagreeing is the noise; four agreeing is the signal.</p>
    </>
  );

  // No ticker yet — show the branded empty state.
  if (!activeTicker) {
    return (
      <PageTemplate
        className="p-3 sm:p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto"
        icon={Layers}
        title="Confluence Chart"
        subtitle="Multi-signal verdict on a single chart — candles + EMAs + signal pulse + MACD/RSI all in one read."
        howItWorks={confluenceHowItWorks}
      >
        <EmptyState />
      </PageTemplate>
    );
  }

  return (
    <PageTemplate
      className="p-3 sm:p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto"
      icon={Layers}
      title="Confluence Chart"
      subtitle="Multi-signal verdict on a single chart — candles + EMAs + signal pulse + MACD/RSI all in one read."
      howItWorks={confluenceHowItWorks}
    >
      {/* Ticker context strip — page-specific info (not chrome). */}
      <div className="flex items-baseline gap-3 mb-3 px-1" data-testid="confluence-ticker-strip">
        <span className="font-mono font-bold text-lg text-foreground" data-testid="header-ticker">
          {activeTicker}
        </span>
        {companyName && (
          <span className="text-xs text-muted-foreground truncate max-w-[280px]">{companyName}</span>
        )}
        {spotPrice != null && (
          <span className="text-base font-semibold tabular-nums text-foreground">
            {formatCurrency(spotPrice)}
          </span>
        )}
        {dayChangePct != null && (
          <span className={`text-xs font-semibold tabular-nums ${changeColor}`}>
            {dayChangePct >= 0 ? "▲" : "▼"} {Math.abs(dayChangePct).toFixed(2)}%
          </span>
        )}
      </div>

      {/* Candle pane — the centerpiece. ~55% of remaining height. */}
      <div className="relative flex-1 flex flex-col">
        <div className="relative" style={{ height: "55vh", minHeight: 360 }}>
          {/* EMA toggle strip — shared primitive, canonical 4-EMA set. */}
          <div className="absolute top-2 left-3 z-10">
            <EmaToggleStrip state={emaState} onChange={setEmaState} />
          </div>

          {isLoading && bars.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center bg-card/50">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="text-xs text-muted-foreground">Loading {activeTicker}…</span>
              </div>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <p className="text-sm text-bear">Couldn't load {activeTicker}</p>
                <p className="text-xs text-muted-foreground mt-1">Try another ticker or refresh.</p>
              </div>
            </div>
          ) : (
            <CandlePane
              bars={bars}
              overlays={emaOverlays(emaState)}
              testId="confluence-candle-pane"
            />
          )}
        </div>

        {/* How to read this chart — collapsible explainer */}
        <HowToRead />

        {/* MACD + RSI — drop-in existing component */}
        <div className="border-t border-border px-4 py-2 flex justify-center">
          <IndicatorOscillator ticker={activeTicker} bars={60} />
        </div>

        {/* Confluence Dashboard table */}
        <ConfluenceDashboardPanel bars={bars} indicators={indicators} quick={quick} />
      </div>

      {/* Sticky verdict strip */}
      <VerdictStrip quick={quick} lastUpdated={lastUpdated} />
    </PageTemplate>
  );
}
