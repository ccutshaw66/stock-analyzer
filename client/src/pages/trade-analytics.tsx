import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3, TrendingUp, Target, DollarSign,
  Activity, AlertTriangle, Percent, Award,
  Crosshair, Info, Clock,
} from "lucide-react";
import { HelpBlock, Example, ScoreRange } from "@/components/HelpBlock";
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  ScatterChart, Scatter, ZAxis,
  LineChart, Line, ReferenceLine, Legend,
} from "recharts";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AnalyticsData {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  expectancy: number;
  avgRWin: number;
  avgRLoss: number;
  currentStreak: number;
  longestWinStreak: number;
  longestLossStreak: number;
  byType: Record<string, { profit: number; count: number; wins: number; avgR: number }>;
  byDayOfWeek: Record<string, { profit: number; count: number; wins: number }>;
  monthlyPL: Record<string, number>;
  trades: any[];
  exitEfficiency: { symbol: string; tradeType: string; profit: number; mfe: number; efficiency: number }[];
  durationAnalysis: {
    dayTrades: DurationGroup;
    shortTerm: DurationGroup;
    swingTrades: DurationGroup;
    longTerm: DurationGroup;
  };
}

interface DurationGroup {
  count: number;
  wins: number;
  winRate: number;
  totalPL: number;
  avgPL: number;
  avgDays: number;
}

interface MFEMAEData {
  trades: {
    tradeId: number;
    mfe: number;
    mae: number;
    exitEfficiency: number;
    symbol: string;
    tradeType: string;
    openPrice: number;
    closePrice: number;
    history: { date: string; pl: number }[];
  }[];
  summary: {
    avgMFE: number;
    avgMAE: number;
    avgExitEfficiency: number;
    totalTracked: number;
  };
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function TradeAnalytics() {
  const { data: analytics, isLoading, error } = useQuery<AnalyticsData>({
    queryKey: ["/api/trades/analytics"],
  });

  const { data: mfeData } = useQuery<MFEMAEData>({
    queryKey: ["/api/trades/mfe-mae"],
  });

  const monthlyData = useMemo(() => {
    if (!analytics?.monthlyPL) return [];
    return Object.entries(analytics.monthlyPL)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, pl]) => ({
        month,
        label: new Date(month + "-01").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        pl: Math.round(pl * 100) / 100,
      }));
  }, [analytics]);

  const byTypeData = useMemo(() => {
    if (!analytics?.byType) return [];
    return Object.entries(analytics.byType)
      .map(([type, stats]) => ({
        type,
        profit: Math.round(stats.profit * 100) / 100,
        count: stats.count,
        winRate: stats.count > 0 ? Math.round(stats.wins / stats.count * 100) : 0,
      }))
      .sort((a, b) => b.profit - a.profit);
  }, [analytics]);

  const dayData = useMemo(() => {
    if (!analytics?.byDayOfWeek) return [];
    const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    return dayOrder
      .filter(d => analytics.byDayOfWeek[d])
      .map(day => ({
        day: day.substring(0, 3),
        profit: Math.round(analytics.byDayOfWeek[day].profit * 100) / 100,
        count: analytics.byDayOfWeek[day].count,
      }));
  }, [analytics]);

  const avgExitEfficiency = useMemo(() => {
    if (!analytics?.exitEfficiency?.length) return null;
    const valid = analytics.exitEfficiency.filter(e => e.efficiency > 0 && e.efficiency <= 100);
    if (valid.length === 0) return null;
    return Math.round(valid.reduce((s, e) => s + e.efficiency, 0) / valid.length * 100) / 100;
  }, [analytics]);

  // MFE/MAE chart data
  const scatterData = useMemo(() => {
    if (!mfeData?.trades?.length) return [];
    return mfeData.trades.map(t => ({
      mae: Math.round(t.mae * 100) / 100,
      mfe: Math.round(t.mfe * 100) / 100,
      symbol: t.symbol,
      efficiency: Math.round(t.exitEfficiency * 10) / 10,
      profitable: t.exitEfficiency > 0 ? 1 : 0,
    }));
  }, [mfeData]);

  const exitEfficiencyBars = useMemo(() => {
    if (!mfeData?.trades?.length) return [];
    return [...mfeData.trades]
      .sort((a, b) => b.exitEfficiency - a.exitEfficiency)
      .map(t => ({
        label: `${t.symbol} (${t.tradeType})`,
        efficiency: Math.round(t.exitEfficiency * 10) / 10,
        fill: t.exitEfficiency >= 70 ? "#22c55e" : t.exitEfficiency >= 30 ? "#eab308" : "#ef4444",
      }));
  }, [mfeData]);

  // Pick top 5 trades with most history points for the timeline chart
  const timelineTrades = useMemo(() => {
    if (!mfeData?.trades?.length) return [];
    return mfeData.trades
      .filter(t => t.history.length >= 2)
      .sort((a, b) => b.history.length - a.history.length)
      .slice(0, 5);
  }, [mfeData]);

  if (isLoading) {
    return (
      <div className="p-3 sm:p-4 md:p-6 max-w-[1200px] mx-auto">
        <h1 className="text-lg font-bold text-foreground mb-4">Trade Analytics</h1>
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="h-4 w-4 animate-spin" />
            <span>Analyzing your trade history...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 sm:p-4 md:p-6 max-w-[1200px] mx-auto">
        <h1 className="text-lg font-bold text-foreground mb-4">Trade Analytics</h1>
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertTriangle className="h-4 w-4 text-red-400" />
          <span className="text-xs text-red-400">Failed to load analytics. Please try again.</span>
        </div>
      </div>
    );
  }

  if (!analytics || analytics.totalTrades === 0) {
    return (
      <div className="p-3 sm:p-4 md:p-6 max-w-[1200px] mx-auto">
        <h1 className="text-lg font-bold text-foreground mb-4">Trade Analytics</h1>
        <div className="flex flex-col items-center justify-center py-12 text-center bg-card border border-card-border rounded-lg">
          <BarChart3 className="h-8 w-8 text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground font-medium">No closed trades yet</p>
          <p className="text-xs text-muted-foreground mt-1">Close some trades in the Trade Tracker to see analytics.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-6 max-w-[1200px] mx-auto" data-testid="trade-analytics-page">
      <h1 className="text-lg font-bold text-foreground">Trade Analytics</h1>
      <p className="text-xs text-muted-foreground -mt-4">Comprehensive performance analysis of your closed trades.</p>

      {/* Key Metrics */}
      <div className="bg-card border border-card-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Key Metrics</h3>
        </div>

        <HelpBlock title="Understanding your trading metrics">
          <p><strong className="text-foreground">Win Rate:</strong> Percentage of trades that are profitable. Most successful options sellers target 65-80%. A 50% win rate can still be profitable with good risk management.</p>
          <p><strong className="text-foreground">Profit Factor:</strong> Gross profits ÷ gross losses. A value above 1.0 means you're profitable overall. Above 2.0 is excellent.</p>
          <Example type="good">
            <strong className="text-green-400">Profit Factor = 2.5:</strong> For every $1 you lose, you make $2.50. This is a strong edge.
          </Example>
          <p><strong className="text-foreground">Expectancy:</strong> Average amount you expect to make per trade = (Win Rate × Avg Win) − (Loss Rate × Avg Loss). Positive = profitable system.</p>
          <p><strong className="text-foreground">R-Multiple:</strong> How many "R" (initial risk) your trade returned. An R of 2.0 means you made 2× your initial risk. Negative R means you lost more than planned.</p>
          <p><strong className="text-foreground">MFE (Maximum Favorable Excursion):</strong> The maximum profit available during the trade. <strong className="text-foreground">MAE (Maximum Adverse Excursion):</strong> The maximum drawdown during the trade.</p>
          <p><strong className="text-foreground">Exit Efficiency:</strong> Actual profit ÷ MFE — how much of the available profit you captured. 50-75% is good for credit spreads (closing at 50% max profit).</p>
          <ScoreRange label="Excellent" range="> 70%" color="green" description="Win rate above 70% with positive expectancy — strong consistent edge" />
          <ScoreRange label="Good" range="50-70%" color="yellow" description="Profitable but room to improve — focus on either win rate or reward/risk" />
          <ScoreRange label="Needs Work" range="< 50%" color="red" description="Losing more than winning — review your entries, position sizing, and exits" />
        </HelpBlock>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricCard
            label="Total Trades"
            value={String(analytics.totalTrades)}
            color="text-foreground"
            icon={<BarChart3 className="h-3 w-3" />}
            subtitle={`${analytics.wins}W / ${analytics.losses}L`}
          />
          <MetricCard
            label="Win Rate"
            value={`${analytics.winRate}%`}
            color={analytics.winRate >= 60 ? "text-green-400" : analytics.winRate >= 45 ? "text-yellow-400" : "text-red-400"}
            icon={<Percent className="h-3 w-3" />}
          />
          <MetricCard
            label="Profit Factor"
            value={analytics.profitFactor === Infinity ? "∞" : analytics.profitFactor.toFixed(2)}
            color={analytics.profitFactor >= 1.5 ? "text-green-400" : analytics.profitFactor >= 1 ? "text-yellow-400" : "text-red-400"}
            icon={<TrendingUp className="h-3 w-3" />}
          />
          <MetricCard
            label="Expectancy"
            value={`$${analytics.expectancy.toFixed(2)}`}
            color={analytics.expectancy >= 0 ? "text-green-400" : "text-red-400"}
            icon={<DollarSign className="h-3 w-3" />}
            subtitle="per trade"
          />
          <MetricCard
            label="Best Trade"
            value={`$${analytics.largestWin.toFixed(2)}`}
            color="text-green-400"
            icon={<Award className="h-3 w-3" />}
          />
          <MetricCard
            label="Worst Trade"
            value={`$${analytics.largestLoss.toFixed(2)}`}
            color="text-red-400"
            icon={<AlertTriangle className="h-3 w-3" />}
          />
        </div>

        {/* Win/Loss & R-Multiple Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <MetricCard label="Avg Win" value={`$${analytics.avgWin.toFixed(2)}`} color="text-green-400" />
          <MetricCard label="Avg Loss" value={`$${analytics.avgLoss.toFixed(2)}`} color="text-red-400" />
          <MetricCard label="Avg R (Wins)" value={`${analytics.avgRWin}R`} color="text-green-400" />
          <MetricCard label="Avg R (Losses)" value={`${analytics.avgRLoss}R`} color="text-red-400" />
        </div>
      </div>

      {/* Streaks & Efficiency */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-card border border-card-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Streak Analysis</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MetricCard
              label="Current"
              value={`${analytics.currentStreak > 0 ? "+" : ""}${analytics.currentStreak}`}
              color={analytics.currentStreak > 0 ? "text-green-400" : analytics.currentStreak < 0 ? "text-red-400" : "text-muted-foreground"}
              subtitle={analytics.currentStreak > 0 ? "win streak" : analytics.currentStreak < 0 ? "loss streak" : "neutral"}
            />
            <MetricCard
              label="Best Streak"
              value={String(analytics.longestWinStreak)}
              color="text-green-400"
              subtitle="consecutive wins"
            />
            <MetricCard
              label="Worst Streak"
              value={String(analytics.longestLossStreak)}
              color="text-red-400"
              subtitle="consecutive losses"
            />
          </div>
        </div>

        {avgExitEfficiency != null && (
          <div className="bg-card border border-card-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Target className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold text-foreground">Exit Efficiency (MFE)</h3>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <MetricCard
                label="Avg Exit Efficiency"
                value={`${avgExitEfficiency}%`}
                color={avgExitEfficiency >= 50 ? "text-green-400" : avgExitEfficiency >= 25 ? "text-yellow-400" : "text-red-400"}
                subtitle="of available profit captured"
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              Exit efficiency = Actual P/L ÷ Max Favorable Excursion. Shows how well you time your exits.
            </p>
          </div>
        )}
      </div>

      {/* Monthly P/L Chart */}
      {monthlyData.length > 0 && (
        <div className="bg-card border border-card-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Monthly P/L</h3>
          </div>
          <div className="bg-muted/20 border border-card-border/50 rounded-lg p-3" data-testid="monthly-pl-chart">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={monthlyData} margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--card-border))" opacity={0.5} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--card-border))", borderRadius: 8, fontSize: 11 }}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, "P/L"]}
                />
                <Bar dataKey="pl" radius={[4, 4, 0, 0]}>
                  {monthlyData.map((entry, index) => (
                    <Cell key={index} fill={entry.pl >= 0 ? "#22c55e" : "#ef4444"} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Performance by Trade Type */}
      {byTypeData.length > 0 && (
        <div className="bg-card border border-card-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Performance by Trade Type</h3>
          </div>
          <div className="bg-muted/20 border border-card-border/50 rounded-lg p-3" data-testid="by-type-chart">
            <ResponsiveContainer width="100%" height={Math.max(150, byTypeData.length * 40)}>
              <BarChart data={byTypeData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--card-border))" opacity={0.5} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                />
                <YAxis
                  type="category"
                  dataKey="type"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  width={35}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--card-border))", borderRadius: 8, fontSize: 11 }}
                  formatter={(value: number, _name: string, props: any) => [
                    `$${value.toFixed(2)} (${props.payload.count} trades, ${props.payload.winRate}% WR)`,
                    "P/L",
                  ]}
                />
                <Bar dataKey="profit" radius={[0, 4, 4, 0]}>
                  {byTypeData.map((entry, index) => (
                    <Cell key={index} fill={entry.profit >= 0 ? "#22c55e" : "#ef4444"} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Day of Week Performance */}
      {dayData.length > 0 && (
        <div className="bg-card border border-card-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Performance by Day of Week</h3>
          </div>
          <div className="bg-muted/20 border border-card-border/50 rounded-lg p-3" data-testid="day-of-week-chart">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dayData} margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--card-border))" opacity={0.5} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--card-border))", borderRadius: 8, fontSize: 11 }}
                  formatter={(value: number, _name: string, props: any) => [
                    `$${value.toFixed(2)} (${props.payload.count} trades)`,
                    "P/L",
                  ]}
                />
                <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                  {dayData.map((entry, index) => (
                    <Cell key={index} fill={entry.profit >= 0 ? "#22c55e" : "#ef4444"} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* Position Duration Analysis */}
      {/* ================================================================ */}
      {analytics.durationAnalysis && (() => {
        const da = analytics.durationAnalysis;
        const categories = [
          { key: "dayTrades" as const, label: "Day Trades", sublabel: "0 days", data: da.dayTrades },
          { key: "shortTerm" as const, label: "Short-term", sublabel: "1-7 days", data: da.shortTerm },
          { key: "swingTrades" as const, label: "Swing", sublabel: "8-45 days", data: da.swingTrades },
          { key: "longTerm" as const, label: "Long-term", sublabel: "45+ days", data: da.longTerm },
        ];
        const hasData = categories.some(c => c.data.count > 0);
        const chartData = categories
          .filter(c => c.data.count > 0)
          .map(c => ({
            name: c.label,
            winRate: Math.round(c.data.winRate * 10000) / 100,
            avgPL: c.data.avgPL,
          }));

        const borderColor = (wr: number) =>
          wr > 0.55 ? "border-green-500/40" : wr < 0.45 ? "border-red-500/40" : "border-yellow-500/40";

        return (
          <div className="bg-card border border-card-border rounded-lg p-4" data-testid="duration-analysis-section">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold text-foreground">Position Duration Analysis</h3>
            </div>

            <HelpBlock title="Understanding position duration">
              <p><strong className="text-foreground">Day Trade:</strong> Opened and closed the same day. Fast, high frequency trading style.</p>
              <p><strong className="text-foreground">Short-term (1-7 days):</strong> Quick swing trades or weekly options. Captures short momentum moves.</p>
              <p><strong className="text-foreground">Swing (8-45 days):</strong> Standard swing trades, monthly options. Holds through a move or earnings cycle.</p>
              <p><strong className="text-foreground">Long-term (45+ days):</strong> Position trades, LEAPs, or stock holds. Larger moves, less frequent.</p>
              <Example type="good">
                <strong className="text-green-400">Compare win rates across durations</strong> to find your optimal holding period.
              </Example>
              <Example type="neutral">
                If your <strong className="text-yellow-400">day trades have a low win rate</strong> but your <strong className="text-green-400">swings are profitable</strong>, you might be better suited for swing trading.
              </Example>
            </HelpBlock>

            {!hasData ? (
              <div className="flex flex-col items-center justify-center py-8 text-center bg-muted/20 border border-card-border/50 rounded-lg">
                <Info className="h-6 w-6 text-muted-foreground/40 mb-2" />
                <p className="text-xs text-muted-foreground font-medium">No duration data available</p>
                <p className="text-[10px] text-muted-foreground mt-1">Close some trades with different holding periods to see analysis.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* 4 Category Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {categories.map(cat => {
                    const wrPct = Math.round(cat.data.winRate * 10000) / 100;
                    return (
                      <div
                        key={cat.key}
                        className={`bg-muted/30 border-2 ${cat.data.count > 0 ? borderColor(cat.data.winRate) : "border-card-border/50"} rounded-lg p-3`}
                        data-testid={`duration-card-${cat.key}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="text-xs font-bold text-foreground">{cat.label}</p>
                            <p className="text-[10px] text-muted-foreground">{cat.sublabel}</p>
                          </div>
                          {cat.data.count > 0 && (
                            <span className={`text-lg font-bold tabular-nums font-mono ${
                              wrPct > 55 ? "text-green-400" : wrPct < 45 ? "text-red-400" : "text-yellow-400"
                            }`}>
                              {wrPct}%
                            </span>
                          )}
                        </div>
                        {cat.data.count > 0 ? (
                          <div className="space-y-1">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-muted-foreground">Trades</span>
                              <span className="font-mono text-foreground">{cat.data.count} ({cat.data.wins}W)</span>
                            </div>
                            <div className="flex justify-between text-[10px]">
                              <span className="text-muted-foreground">Total P/L</span>
                              <span className={`font-mono font-semibold ${cat.data.totalPL >= 0 ? "text-green-400" : "text-red-400"}`}>
                                ${cat.data.totalPL.toFixed(2)}
                              </span>
                            </div>
                            <div className="flex justify-between text-[10px]">
                              <span className="text-muted-foreground">Avg P/L</span>
                              <span className={`font-mono font-semibold ${cat.data.avgPL >= 0 ? "text-green-400" : "text-red-400"}`}>
                                ${cat.data.avgPL.toFixed(2)}
                              </span>
                            </div>
                            <div className="flex justify-between text-[10px]">
                              <span className="text-muted-foreground">Avg Days</span>
                              <span className="font-mono text-foreground">{cat.data.avgDays}</span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[10px] text-muted-foreground">No trades</p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Comparison Bar Chart */}
                {chartData.length > 0 && (
                  <div className="bg-muted/20 border border-card-border/50 rounded-lg p-3" data-testid="duration-bar-chart">
                    <h4 className="text-xs font-semibold text-muted-foreground mb-2">Duration Comparison</h4>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={chartData} margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--card-border))" opacity={0.5} />
                        <XAxis
                          dataKey="name"
                          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        />
                        <YAxis
                          yAxisId="left"
                          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                          tickFormatter={(v: number) => `${v}%`}
                          label={{ value: "Win Rate %", angle: -90, position: "insideLeft", style: { fontSize: 9, fill: "hsl(var(--muted-foreground))" } }}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                          tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                          label={{ value: "Avg P/L $", angle: 90, position: "insideRight", style: { fontSize: 9, fill: "hsl(var(--muted-foreground))" } }}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--card-border))", borderRadius: 8, fontSize: 11 }}
                          formatter={(value: number, name: string) => [
                            name === "winRate" ? `${value.toFixed(1)}%` : `$${value.toFixed(2)}`,
                            name === "winRate" ? "Win Rate" : "Avg P/L"
                          ]}
                        />
                        <Legend
                          formatter={(value: string) => value === "winRate" ? "Win Rate %" : "Avg P/L $"}
                          wrapperStyle={{ fontSize: 10 }}
                        />
                        <Bar yAxisId="left" dataKey="winRate" radius={[4, 4, 0, 0]}>
                          {chartData.map((entry, index) => (
                            <Cell key={index} fill={entry.winRate >= 55 ? "#22c55e" : entry.winRate >= 45 ? "#eab308" : "#ef4444"} fillOpacity={0.8} />
                          ))}
                        </Bar>
                        <Bar yAxisId="right" dataKey="avgPL" radius={[4, 4, 0, 0]}>
                          {chartData.map((entry, index) => (
                            <Cell key={index} fill={entry.avgPL >= 0 ? "#22c55e" : "#ef4444"} fillOpacity={0.5} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ================================================================ */}
      {/* MFE / MAE Analysis Section */}
      {/* ================================================================ */}
      <div className="bg-card border border-card-border rounded-lg p-4" data-testid="mfe-mae-section">
        <div className="flex items-center gap-2 mb-3">
          <Crosshair className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">MFE / MAE Analysis</h3>
        </div>

        <HelpBlock title="Understanding MFE & MAE">
          <p><strong className="text-foreground">MFE (Maximum Favorable Excursion):</strong> The BEST your trade ever got before you closed it — the peak unrealized profit during the life of the trade.</p>
          <p><strong className="text-foreground">MAE (Maximum Adverse Excursion):</strong> The WORST your trade ever got before recovering — the maximum drawdown experienced during the trade.</p>
          <p><strong className="text-foreground">Exit Efficiency:</strong> What percentage of the maximum available profit you actually captured. Actual P/L ÷ MFE.</p>
          <Example type="good">
            <strong className="text-green-400">Exit Efficiency = 75%:</strong> You captured 75% of the best price — excellent exit timing.
          </Example>
          <Example type="bad">
            <strong className="text-red-400">Exit Efficiency = 15%:</strong> The trade was up big but you gave most of it back before closing.
          </Example>
          <p>If your exit efficiency is consistently low, you're closing winners too early or holding too long after the peak.</p>
          <p>If your MAE is consistently large relative to your final P/L, your stops might be too wide.</p>
          <ScoreRange label="Excellent" range="> 70%" color="green" description="Capturing most of the available profit — strong exit discipline" />
          <ScoreRange label="Acceptable" range="30-70%" color="yellow" description="Decent but room to improve exit timing" />
          <ScoreRange label="Needs Work" range="< 30%" color="red" description="Leaving significant profit on the table — review your exit strategy" />
        </HelpBlock>

        {(!mfeData || mfeData.summary.totalTracked === 0) ? (
          <div className="flex flex-col items-center justify-center py-8 text-center bg-muted/20 border border-card-border/50 rounded-lg">
            <Info className="h-6 w-6 text-muted-foreground/40 mb-2" />
            <p className="text-xs text-muted-foreground font-medium">No MFE/MAE data yet</p>
            <p className="text-[10px] text-muted-foreground mt-1 max-w-sm">
              MFE/MAE data builds over time as you refresh prices on open trades.
              Click "Refresh P/L" on the Trade Tracker page to start recording price snapshots.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard
                label="Avg MFE"
                value={`$${mfeData.summary.avgMFE.toFixed(2)}`}
                color="text-green-400"
                icon={<TrendingUp className="h-3 w-3" />}
                subtitle="avg peak profit"
              />
              <MetricCard
                label="Avg MAE"
                value={`$${mfeData.summary.avgMAE.toFixed(2)}`}
                color="text-red-400"
                icon={<AlertTriangle className="h-3 w-3" />}
                subtitle="avg max drawdown"
              />
              <MetricCard
                label="Avg Exit Efficiency"
                value={`${mfeData.summary.avgExitEfficiency.toFixed(1)}%`}
                color={mfeData.summary.avgExitEfficiency >= 70 ? "text-green-400" : mfeData.summary.avgExitEfficiency >= 30 ? "text-yellow-400" : "text-red-400"}
                icon={<Target className="h-3 w-3" />}
                subtitle="profit captured"
              />
              <MetricCard
                label="Trades Tracked"
                value={String(mfeData.summary.totalTracked)}
                color="text-foreground"
                icon={<BarChart3 className="h-3 w-3" />}
                subtitle="with price history"
              />
            </div>

            {/* MFE/MAE Scatter Chart */}
            {scatterData.length > 0 && (
              <div className="bg-muted/20 border border-card-border/50 rounded-lg p-3">
                <h4 className="text-xs font-semibold text-muted-foreground mb-2">MFE vs MAE Scatter</h4>
                <p className="text-[10px] text-muted-foreground mb-3">Each dot is a trade. X = max drawdown (MAE), Y = peak profit (MFE). Green = profitable exit, Red = loss.</p>
                <ResponsiveContainer width="100%" height={280}>
                  <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--card-border))" opacity={0.5} />
                    <XAxis
                      type="number"
                      dataKey="mae"
                      name="MAE"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                      label={{ value: "MAE (drawdown)", position: "insideBottom", offset: -5, style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" } }}
                    />
                    <YAxis
                      type="number"
                      dataKey="mfe"
                      name="MFE"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                      label={{ value: "MFE (peak profit)", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" } }}
                    />
                    <ZAxis dataKey="symbol" name="Symbol" />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--card-border))", borderRadius: 8, fontSize: 11 }}
                      formatter={(value: number, name: string) => [`$${value.toFixed(2)}`, name]}
                      labelFormatter={() => ""}
                      content={({ payload }) => {
                        if (!payload?.length) return null;
                        const d = payload[0]?.payload;
                        if (!d) return null;
                        return (
                          <div className="bg-card border border-card-border rounded-lg p-2 text-xs">
                            <p className="font-bold text-foreground">{d.symbol}</p>
                            <p className="text-green-400">MFE: ${d.mfe.toFixed(2)}</p>
                            <p className="text-red-400">MAE: ${d.mae.toFixed(2)}</p>
                            <p className="text-muted-foreground">Efficiency: {d.efficiency}%</p>
                          </div>
                        );
                      }}
                    />
                    <Scatter data={scatterData.filter(d => d.profitable === 1)} fill="#22c55e" fillOpacity={0.7} />
                    <Scatter data={scatterData.filter(d => d.profitable === 0)} fill="#ef4444" fillOpacity={0.7} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Exit Efficiency Bar Chart */}
            {exitEfficiencyBars.length > 0 && (
              <div className="bg-muted/20 border border-card-border/50 rounded-lg p-3">
                <h4 className="text-xs font-semibold text-muted-foreground mb-2">Exit Efficiency by Trade</h4>
                <p className="text-[10px] text-muted-foreground mb-3">Green (&gt;70%) = excellent, Yellow (30-70%) = acceptable, Red (&lt;30%) = needs work.</p>
                <ResponsiveContainer width="100%" height={Math.max(150, exitEfficiencyBars.length * 32)}>
                  <BarChart data={exitEfficiencyBars} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--card-border))" opacity={0.5} />
                    <XAxis
                      type="number"
                      domain={[-100, 100]}
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(v: number) => `${v}%`}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                      width={75}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--card-border))", borderRadius: 8, fontSize: 11 }}
                      formatter={(value: number) => [`${value.toFixed(1)}%`, "Exit Efficiency"]}
                    />
                    <Bar dataKey="efficiency" radius={[0, 4, 4, 0]}>
                      {exitEfficiencyBars.map((entry, index) => (
                        <Cell key={index} fill={entry.fill} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Trade P/L Timeline */}
            {timelineTrades.length > 0 && (
              <div className="bg-muted/20 border border-card-border/50 rounded-lg p-3">
                <h4 className="text-xs font-semibold text-muted-foreground mb-2">Trade P/L Timeline</h4>
                <p className="text-[10px] text-muted-foreground mb-3">Unrealized P/L over time for top tracked trades. Peak = MFE, Trough = MAE.</p>
                <div className="space-y-4">
                  {timelineTrades.map(trade => {
                    const data = trade.history.map(h => ({
                      date: h.date,
                      pl: Math.round(h.pl * 100) / 100,
                    }));
                    const maxPL = Math.max(...data.map(d => d.pl));
                    const minPL = Math.min(...data.map(d => d.pl));
                    return (
                      <div key={trade.tradeId} className="border border-card-border/30 rounded-lg p-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-foreground">{trade.symbol} <span className="text-muted-foreground font-normal">({trade.tradeType})</span></span>
                          <span className={`text-[10px] font-mono ${trade.exitEfficiency >= 50 ? "text-green-400" : trade.exitEfficiency >= 0 ? "text-yellow-400" : "text-red-400"}`}>
                            Efficiency: {trade.exitEfficiency.toFixed(1)}%
                          </span>
                        </div>
                        <ResponsiveContainer width="100%" height={120}>
                          <LineChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--card-border))" opacity={0.3} />
                            <XAxis
                              dataKey="date"
                              tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }}
                              tickFormatter={(v: string) => v.substring(5)} // MM-DD
                            />
                            <YAxis
                              tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }}
                              tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                            />
                            <Tooltip
                              contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--card-border))", borderRadius: 8, fontSize: 10 }}
                              formatter={(value: number) => [`$${value.toFixed(2)}`, "Unrealized P/L"]}
                            />
                            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
                            <ReferenceLine y={maxPL} stroke="#22c55e" strokeDasharray="4 4" opacity={0.6} label={{ value: `MFE: $${maxPL.toFixed(0)}`, position: "right", style: { fontSize: 8, fill: "#22c55e" } }} />
                            <ReferenceLine y={minPL} stroke="#ef4444" strokeDasharray="4 4" opacity={0.6} label={{ value: `MAE: $${minPL.toFixed(0)}`, position: "right", style: { fontSize: 8, fill: "#ef4444" } }} />
                            <Line
                              type="monotone"
                              dataKey="pl"
                              stroke="hsl(var(--primary))"
                              strokeWidth={1.5}
                              dot={{ fill: "hsl(var(--primary))", r: 2 }}
                              activeDot={{ r: 4 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Shared ──────────────────────────────────────────────────────────────────

function MetricCard({ label, value, color, icon, subtitle }: {
  label: string; value: string; color: string; icon?: React.ReactNode; subtitle?: string;
}) {
  return (
    <div className="bg-muted/30 border border-card-border/50 rounded-lg p-2.5">
      <div className="flex items-center gap-1 mb-0.5">
        {icon && <span className={`${color} opacity-70`}>{icon}</span>}
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <span className={`text-sm font-bold tabular-nums font-mono ${color}`}>{value}</span>
      {subtitle && <span className="block text-[10px] text-muted-foreground">{subtitle}</span>}
    </div>
  );
}
