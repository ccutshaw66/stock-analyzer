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
import { SignalPulse } from "@/components/SignalPulse";
import { IndicatorOscillator } from "@/components/IndicatorOscillator";
import { CandlePane } from "@/compartments/confluence-chart/CandlePane";
import { ChartHeader } from "@/compartments/confluence-chart/ChartHeader";
import { ConfluenceDashboardPanel } from "@/compartments/confluence-chart/ConfluenceDashboardPanel";
import { VerdictStrip } from "@/compartments/confluence-chart/VerdictStrip";
import { EmptyState } from "@/compartments/confluence-chart/EmptyState";
import { HowToRead } from "@/compartments/confluence-chart/HowToRead";
import { useConfluenceChart } from "@/compartments/confluence-chart/useConfluenceChart";
import { Loader2 } from "lucide-react";

export default function ConfluenceChartPage() {
  const [match, params] = useRoute<{ ticker?: string }>("/chart/confluence/:ticker?");
  const { activeTicker, setActiveTicker } = useTicker();
  const { timeframe } = useTimeframe();
  const [_, navigate] = useLocation();
  const [showEma21, setShowEma21] = useState(true);
  const [showEma50, setShowEma50] = useState(true);
  const [showEma200, setShowEma200] = useState(false);

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

  // No ticker yet — show the branded empty state.
  if (!activeTicker) {
    return (
      <div className="flex flex-col min-h-[calc(100vh-3.5rem)] bg-background">
        <ChartHeader ticker={null} />
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-3.5rem)] bg-background">
      <ChartHeader
        ticker={activeTicker}
        companyName={companyName}
        spotPrice={spotPrice}
        dayChangePct={dayChangePct}
      />

      {/* Candle pane — the centerpiece. ~55% of remaining height. */}
      <div className="relative flex-1 flex flex-col">
        <div className="relative" style={{ height: "55vh", minHeight: 360 }}>
          {/* EMA toggle legend — top-left of the candle pane */}
          <div className="absolute top-2 left-3 z-10 flex items-center gap-1 text-[10px]">
            <button
              onClick={() => setShowEma21((v) => !v)}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                showEma21 ? "bg-yellow-500/20 text-yellow-400" : "bg-muted/40 text-muted-foreground"
              }`}
              data-testid="toggle-ema21"
            >
              EMA 21
            </button>
            <button
              onClick={() => setShowEma50((v) => !v)}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                showEma50 ? "bg-purple-500/20 text-purple-300" : "bg-muted/40 text-muted-foreground"
              }`}
              data-testid="toggle-ema50"
            >
              EMA 50
            </button>
            <button
              onClick={() => setShowEma200((v) => !v)}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                showEma200 ? "bg-zinc-300/20 text-zinc-200" : "bg-muted/40 text-muted-foreground"
              }`}
              data-testid="toggle-ema200"
            >
              SMA 200
            </button>
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
                <p className="text-sm text-red-500">Couldn't load {activeTicker}</p>
                <p className="text-xs text-muted-foreground mt-1">Try another ticker or refresh.</p>
              </div>
            </div>
          ) : (
            <CandlePane
              bars={bars}
              showEma21={showEma21}
              showEma50={showEma50}
              showEma200={showEma200}
            />
          )}
        </div>

        {/* Signal Pulse — drop-in existing component */}
        <div className="border-t border-border px-2 py-1">
          <SignalPulse ticker={activeTicker} />
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
    </div>
  );
}
