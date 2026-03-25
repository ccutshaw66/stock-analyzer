import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3, TrendingUp, Target, DollarSign,
  Activity, AlertTriangle, Percent, Award,
} from "lucide-react";
import { HelpBlock, Example, ScoreRange } from "@/components/HelpBlock";
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell,
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
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function TradeAnalytics() {
  const { data: analytics, isLoading, error } = useQuery<AnalyticsData>({
    queryKey: ["/api/trades/analytics"],
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
