/**
 * Expectancy widget — the dashboard north-star tile.
 *
 * Answers the one question that should greet the owner every session:
 * "are my winners bigger than my losers?" Shows the headline Win:Loss size
 * ratio, expectancy per trade, and a one-line green/red verdict.
 *
 * One source of truth: reads the SAME /api/trades/analytics payload that the
 * full Expectancy Scorecard on /analytics uses — no second fetch, no parallel
 * calculation. Click-through opens /analytics for the full scorecard.
 */
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Scale, Loader2, TrendingUp, AlertTriangle } from "lucide-react";

interface AnalyticsData {
  wins: number;
  losses: number;
  winLossRatio: number;
  expectancy: number;
}

export function ExpectancyWidget() {
  const [, navigate] = useLocation();
  const { data, isLoading, error } = useQuery<AnalyticsData>({
    queryKey: ["/api/trades/analytics"],
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading expectancy…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-bear-light px-4 text-center">
        Expectancy unavailable.
      </div>
    );
  }

  // Empty state — no closed trades yet. Quiet prompt, not zeros or a broken card.
  const noTrades = (data.wins + data.losses) === 0;
  if (noTrades) {
    return (
      <button
        type="button"
        onClick={() => navigate("/analytics")}
        className="h-full w-full flex flex-col text-left cursor-pointer hover:bg-muted/20 transition-colors"
        data-testid="expectancy-widget"
        title="Click to open Performance Analytics"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-card-border">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-muted-foreground">
            <Scale className="h-3.5 w-3.5" />
            Expectancy
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-4 gap-1 text-center">
          <Scale className="h-6 w-6 text-muted-foreground/50" />
          <div className="text-sm font-medium text-foreground">No closed trades yet</div>
          <div className="text-micro text-muted-foreground">Log closed trades to track your expectancy</div>
        </div>
      </button>
    );
  }

  const positive = data.expectancy >= 0;
  const ratio = data.winLossRatio;
  const ratioStr = ratio === Infinity || !isFinite(ratio) ? "∞" : ratio.toFixed(2);
  const expStr = `${data.expectancy >= 0 ? "+" : "−"}$${Math.abs(data.expectancy).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  // Plain-English verdict
  let verdict: string;
  if (positive) {
    const ratioPhrase = ratio === Infinity || !isFinite(ratio)
      ? "No losing trades yet"
      : `Winners ${ratioStr}× losers`;
    verdict = `${ratioPhrase} — ${expStr}/trade, you're growing`;
  } else {
    verdict = `Losers bigger than winners — ${expStr}/trade, needs fixing`;
  }

  const tone = positive ? "text-bull-light" : "text-bear-light";

  return (
    <button
      type="button"
      onClick={() => navigate("/analytics")}
      className="h-full w-full flex flex-col text-left cursor-pointer hover:bg-muted/20 transition-colors"
      data-testid="expectancy-widget"
      title="Click to open the full Expectancy Scorecard"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-card-border">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-muted-foreground">
          <Scale className="h-3.5 w-3.5" />
          Expectancy
        </div>
        <span className="text-micro text-muted-foreground">winners vs losers</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-3 py-3 gap-1">
        <div className={`text-4xl font-bold tabular-nums font-mono ${tone}`}>{ratioStr}×</div>
        <div className="text-micro text-muted-foreground">win : loss size ratio</div>
        <div className={`text-lg font-semibold tabular-nums ${tone}`}>{expStr}<span className="text-micro font-normal text-muted-foreground"> / trade</span></div>
      </div>

      <div
        className={`flex items-center gap-2 px-3 py-2 border-t border-card-border ${positive ? "bg-bull/10" : "bg-bear/10"}`}
        data-testid="expectancy-verdict"
      >
        {positive
          ? <TrendingUp className="h-3.5 w-3.5 text-bull-light shrink-0" />
          : <AlertTriangle className="h-3.5 w-3.5 text-bear-light shrink-0" />}
        <span className={`text-micro font-semibold ${tone}`}>{verdict}</span>
      </div>
    </button>
  );
}
