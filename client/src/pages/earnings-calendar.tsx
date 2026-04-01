import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar, TrendingUp, TrendingDown, Activity,
  Clock, AlertTriangle, DollarSign,
} from "lucide-react";
import { HelpBlock, Example, ScoreRange } from "@/components/HelpBlock";
import { Disclaimer } from "@/components/Disclaimer";

// ─── Types ───────────────────────────────────────────────────────────────────

interface EarningsQuarter {
  quarter: string;
  actual: number | null;
  estimate: number | null;
  surprise: number | null;
  surprisePct: number | null;
}

interface EarningsEntry {
  ticker: string;
  companyName: string;
  earningsDate: string | null;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  history: EarningsQuarter[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatRevenue(val: number | null): string {
  if (val == null) return "N/A";
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  return `$${val.toLocaleString()}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "TBD";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function EarningsCalendar() {
  const { data: earnings, isLoading, error } = useQuery<EarningsEntry[]>({
    queryKey: ["/api/earnings-calendar"],
  });

  const sorted = useMemo(() => {
    if (!earnings) return [];
    return [...earnings].sort((a, b) => {
      if (!a.earningsDate && !b.earningsDate) return 0;
      if (!a.earningsDate) return 1;
      if (!b.earningsDate) return -1;
      return a.earningsDate.localeCompare(b.earningsDate);
    });
  }, [earnings]);

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-6 max-w-[1200px] mx-auto" data-testid="earnings-calendar-page">
      <h1 className="text-lg font-bold text-foreground">Earnings Calendar</h1>
      <p className="text-xs text-muted-foreground -mt-4">Upcoming earnings dates and history for your watchlist stocks.</p>
      <Disclaimer />

      <div className="bg-card border border-card-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Watchlist Earnings</h3>
        </div>

        <HelpBlock title="Understanding earnings reports">
          <p><strong className="text-foreground">Earnings season</strong> occurs every quarter when public companies report their financial results. These reports often cause significant stock price moves.</p>
          <p><strong className="text-foreground">EPS (Earnings Per Share):</strong> The most watched metric. Analysts publish consensus estimates, and the stock reacts based on whether the company beats or misses.</p>
          <Example type="good">
            <strong className="text-green-400">Beat:</strong> If EPS estimate is $1.50 and actual comes in at $1.65, that's a $0.15 beat (+10%). The stock usually gaps up, especially if guidance is raised.
          </Example>
          <Example type="bad">
            <strong className="text-red-400">Miss:</strong> If EPS estimate is $1.50 and actual is $1.35, that's a $0.15 miss (-10%). The stock often gaps down hard, and IV crush hits option holders.
          </Example>
          <p><strong className="text-foreground">Revenue Estimate:</strong> Even with an EPS beat, a revenue miss can tank a stock — it suggests the earnings quality is poor (cost-cutting vs. actual growth).</p>
          <ScoreRange label="Beat" range="> 0%" color="green" description="Company exceeded analyst expectations — typically bullish" />
          <ScoreRange label="In-line" range="±2%" color="yellow" description="Met expectations — reaction depends on guidance and tone" />
          <ScoreRange label="Miss" range="< 0%" color="red" description="Missed expectations — typically bearish, especially on revenue misses" />
        </HelpBlock>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Activity className="h-4 w-4 animate-spin" />
              <span>Loading earnings data for your watchlist...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
            <span className="text-xs text-red-400">Failed to load earnings data. Please try again.</span>
          </div>
        )}

        {!isLoading && !error && sorted.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Calendar className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground font-medium">No watchlist items found</p>
            <p className="text-xs text-muted-foreground mt-1">Add stocks to your watchlist to see their earnings calendar.</p>
          </div>
        )}

        {sorted.length > 0 && (
          <div className="space-y-4" data-testid="earnings-list">
            {sorted.map(entry => {
              const days = daysUntil(entry.earningsDate);
              return (
                <div
                  key={entry.ticker}
                  className="bg-muted/20 border border-card-border/50 rounded-lg p-4"
                  data-testid={`earnings-card-${entry.ticker}`}
                >
                  {/* Header Row */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-foreground">{entry.ticker}</span>
                        {days != null && (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            days <= 7
                              ? "bg-red-500/15 text-red-400"
                              : days <= 30
                              ? "bg-yellow-500/15 text-yellow-400"
                              : "bg-muted text-muted-foreground"
                          }`} data-testid={`earnings-countdown-${entry.ticker}`}>
                            {days < 0
                              ? `${Math.abs(days)}d ago`
                              : days === 0
                              ? "TODAY"
                              : `${days}d away`}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>{formatDate(entry.earningsDate)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Estimates Row */}
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="bg-card/50 border border-card-border/30 rounded-md p-2">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">EPS Estimate</span>
                      <span className="text-sm font-bold font-mono tabular-nums text-foreground">
                        {entry.epsEstimate != null ? `$${entry.epsEstimate.toFixed(2)}` : "N/A"}
                      </span>
                    </div>
                    <div className="bg-card/50 border border-card-border/30 rounded-md p-2">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">Revenue Estimate</span>
                      <span className="text-sm font-bold font-mono tabular-nums text-foreground">
                        {formatRevenue(entry.revenueEstimate)}
                      </span>
                    </div>
                  </div>

                  {/* Earnings History Table */}
                  {entry.history.length > 0 && (
                    <div>
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                        Quarterly Earnings History
                      </span>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-muted-foreground border-b border-card-border/50">
                              <th className="text-left pb-1.5 text-[10px] font-semibold uppercase tracking-wider">Quarter</th>
                              <th className="text-right pb-1.5 text-[10px] font-semibold uppercase tracking-wider">Actual</th>
                              <th className="text-right pb-1.5 text-[10px] font-semibold uppercase tracking-wider">Estimate</th>
                              <th className="text-right pb-1.5 text-[10px] font-semibold uppercase tracking-wider">Surprise</th>
                              <th className="text-right pb-1.5 text-[10px] font-semibold uppercase tracking-wider">Result</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entry.history.slice(-4).map((q, i) => {
                              const isBeat = q.surprise != null && q.surprise > 0;
                              const isMiss = q.surprise != null && q.surprise < 0;
                              return (
                                <tr key={i} className="border-b border-card-border/20">
                                  <td className="py-1.5 font-medium text-foreground">{q.quarter || "—"}</td>
                                  <td className="py-1.5 text-right font-mono tabular-nums text-foreground">
                                    {q.actual != null ? `$${q.actual.toFixed(2)}` : "—"}
                                  </td>
                                  <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                                    {q.estimate != null ? `$${q.estimate.toFixed(2)}` : "—"}
                                  </td>
                                  <td className={`py-1.5 text-right font-mono tabular-nums ${
                                    isBeat ? "text-green-400" : isMiss ? "text-red-400" : "text-muted-foreground"
                                  }`}>
                                    {q.surprisePct != null ? `${q.surprisePct >= 0 ? "+" : ""}${q.surprisePct.toFixed(1)}%` : "—"}
                                  </td>
                                  <td className="py-1.5 text-right">
                                    {isBeat && (
                                      <span className="inline-flex items-center gap-0.5 text-green-400 font-semibold">
                                        <TrendingUp className="h-3 w-3" /> Beat
                                      </span>
                                    )}
                                    {isMiss && (
                                      <span className="inline-flex items-center gap-0.5 text-red-400 font-semibold">
                                        <TrendingDown className="h-3 w-3" /> Miss
                                      </span>
                                    )}
                                    {!isBeat && !isMiss && q.actual != null && (
                                      <span className="text-yellow-400 font-semibold">In-line</span>
                                    )}
                                    {q.actual == null && <span className="text-muted-foreground">—</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
