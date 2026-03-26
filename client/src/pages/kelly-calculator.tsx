import { useState, useMemo } from "react";
import {
  Target, TrendingUp, DollarSign, Percent,
  AlertTriangle, Activity, BarChart3,
} from "lucide-react";
import { HelpBlock, Example, ScoreRange } from "@/components/HelpBlock";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

// ─── Kelly Criterion Calculator ──────────────────────────────────────────────

export default function KellyCalculator() {
  const [winRate, setWinRate] = useState(55);
  const [avgWin, setAvgWin] = useState(200);
  const [avgLoss, setAvgLoss] = useState(150);
  const [accountValue, setAccountValue] = useState(10000);

  const [populatedTradeCount, setPopulatedTradeCount] = useState<number | null>(null);

  // Fetch trade analytics for auto-populate
  const { data: tradeSummary, refetch, isFetching } = useQuery<{
    winRate: number;
    avgWin: number;
    avgLoss: number;
    totalTrades: number;
  }>({
    queryKey: ["/api/trades/analytics"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/trades/analytics");
      return res.json();
    },
    enabled: false,
  });

  const autoPopulate = async () => {
    const result = await refetch();
    if (result.data) {
      setWinRate(Math.round(result.data.winRate * 100) / 100);
      setAvgWin(Math.round(result.data.avgWin * 100) / 100);
      setAvgLoss(Math.round(Math.abs(result.data.avgLoss) * 100) / 100);
      setPopulatedTradeCount(result.data.totalTrades ?? null);
    }
  };

  const kelly = useMemo(() => {
    const W = winRate / 100;
    const R = avgLoss > 0 ? avgWin / avgLoss : 0;
    const full = R > 0 ? W - (1 - W) / R : 0;
    const half = full / 2;
    const quarter = full / 4;
    return { full, half, quarter, hasEdge: full > 0 };
  }, [winRate, avgWin, avgLoss]);

  // Simulation: geometric growth over 100 trades
  const simData = useMemo(() => {
    const W = winRate / 100;
    const points: { trade: number; full: number; half: number; quarter: number }[] = [];
    let balFull = accountValue;
    let balHalf = accountValue;
    let balQuarter = accountValue;

    points.push({ trade: 0, full: balFull, half: balHalf, quarter: balQuarter });

    for (let i = 1; i <= 100; i++) {
      // Geometric expected growth per trade
      // E[growth] = W * ln(1 + f*R) + (1-W) * ln(1 - f)
      // For the chart we use the expected value path
      const R = avgLoss > 0 ? avgWin / avgLoss : 0;

      const growFull = kelly.full > 0 && kelly.full < 1
        ? Math.exp(W * Math.log(1 + kelly.full * R) + (1 - W) * Math.log(1 - kelly.full))
        : kelly.full >= 1 ? Math.exp(W * Math.log(1 + 0.99 * R) + (1 - W) * Math.log(1 - 0.99)) : 1;
      const growHalf = kelly.half > 0 && kelly.half < 1
        ? Math.exp(W * Math.log(1 + kelly.half * R) + (1 - W) * Math.log(1 - kelly.half))
        : 1;
      const growQuarter = kelly.quarter > 0 && kelly.quarter < 1
        ? Math.exp(W * Math.log(1 + kelly.quarter * R) + (1 - W) * Math.log(1 - kelly.quarter))
        : 1;

      balFull *= growFull;
      balHalf *= growHalf;
      balQuarter *= growQuarter;
      points.push({
        trade: i,
        full: Math.round(balFull * 100) / 100,
        half: Math.round(balHalf * 100) / 100,
        quarter: Math.round(balQuarter * 100) / 100,
      });
    }
    return points;
  }, [winRate, avgWin, avgLoss, accountValue, kelly]);

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-6 max-w-[1200px] mx-auto" data-testid="kelly-calculator-page">
      <h1 className="text-lg font-bold text-foreground">Kelly Criterion Calculator</h1>
      <p className="text-xs text-muted-foreground -mt-4">Optimal position sizing based on your edge. Click the blue info bars for instructions.</p>

      {/* Input Section */}
      <div className="bg-card border border-card-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Position Sizing</h3>
        </div>

        <HelpBlock title="What is the Kelly Criterion?">
          <p>The Kelly Criterion calculates the <strong className="text-foreground">optimal fraction of your account to risk</strong> on each trade to maximize long-term growth.</p>
          <p><strong className="text-foreground">Formula:</strong> f* = W − (1−W) / R, where W = win rate, R = avg win / avg loss.</p>
          <Example type="good">
            <strong className="text-green-400">Positive Edge:</strong> Win rate = 55%, Avg Win = $200, Avg Loss = $150. R = 1.33. Kelly = 0.55 − 0.45/1.33 = 21.2%. You should risk about 21% of your account per trade for maximum growth. In practice, Half Kelly (10.6%) is recommended to reduce volatility.
          </Example>
          <Example type="bad">
            <strong className="text-red-400">No Edge:</strong> Win rate = 40%, Avg Win = $100, Avg Loss = $120. R = 0.83. Kelly = 0.40 − 0.60/0.83 = −32.5%. Negative Kelly means you have no edge — don't trade this strategy.
          </Example>
          <ScoreRange label="Full Kelly" range="> 0%" color="green" description="You have an edge — but Full Kelly is aggressive and leads to large drawdowns" />
          <ScoreRange label="Half Kelly" range="> 0%" color="yellow" description="Recommended for most traders — 75% of growth with much lower risk of ruin" />
          <ScoreRange label="Negative" range="< 0%" color="red" description="No mathematical edge — this strategy loses money over time" />
        </HelpBlock>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Win Rate (%)</label>
            <input
              type="number" step="0.5" min={0} max={100} value={winRate}
              onChange={e => setWinRate(parseFloat(e.target.value) || 0)}
              className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums"
              data-testid="kelly-win-rate"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Avg Win ($)</label>
            <input
              type="number" step="1" min={0} value={avgWin}
              onChange={e => setAvgWin(parseFloat(e.target.value) || 0)}
              className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums"
              data-testid="kelly-avg-win"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Avg Loss ($)</label>
            <input
              type="number" step="1" min={0} value={avgLoss}
              onChange={e => setAvgLoss(parseFloat(e.target.value) || 0)}
              className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums"
              data-testid="kelly-avg-loss"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Account Value ($)</label>
            <input
              type="number" step="100" min={0} value={accountValue}
              onChange={e => setAccountValue(parseFloat(e.target.value) || 0)}
              className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums"
              data-testid="kelly-account-value"
            />
          </div>
          <div className="flex flex-col items-stretch justify-end gap-1">
            <button
              onClick={autoPopulate}
              disabled={isFetching}
              className="w-full h-8 px-3 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              data-testid="kelly-auto-populate"
            >
              {isFetching ? "Loading…" : "Auto from Trades"}
            </button>
            {populatedTradeCount !== null && (
              <span className="text-[10px] text-muted-foreground text-center" data-testid="kelly-trade-count">
                Populated from {populatedTradeCount} closed trade{populatedTradeCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        {/* Kelly Results */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <KellyCard
            label="Full Kelly"
            pct={kelly.full * 100}
            amount={accountValue * Math.max(kelly.full, 0)}
            hasEdge={kelly.hasEdge}
            subtitle="Maximum growth, high volatility"
          />
          <KellyCard
            label="Half Kelly"
            pct={kelly.half * 100}
            amount={accountValue * Math.max(kelly.half, 0)}
            hasEdge={kelly.hasEdge}
            subtitle="Recommended for most traders"
            recommended
          />
          <KellyCard
            label="Quarter Kelly"
            pct={kelly.quarter * 100}
            amount={accountValue * Math.max(kelly.quarter, 0)}
            hasEdge={kelly.hasEdge}
            subtitle="Conservative"
          />
        </div>

        {!kelly.hasEdge && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg mb-4">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
            <span className="text-xs text-red-400 font-medium">
              Negative Kelly — you have no mathematical edge with these parameters. Do not risk capital on this strategy.
            </span>
          </div>
        )}
      </div>

      {/* Simulation Chart */}
      <div className="bg-card border border-card-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Projected Growth (100 Trades)</h3>
        </div>

        <HelpBlock title="How to read the growth projection">
          <p>This chart shows <strong className="text-foreground">expected account growth</strong> over 100 trades at each Kelly level using geometric expected growth.</p>
          <p>Full Kelly grows fastest but with the most volatility. Half Kelly achieves ~75% of the growth with much smoother equity curves.</p>
          <p>This is a <strong className="text-foreground">theoretical projection</strong> — real results will vary. The chart assumes each trade has the same win rate and avg win/loss as your inputs.</p>
        </HelpBlock>

        <div className="bg-muted/20 border border-card-border/50 rounded-lg p-3" data-testid="kelly-growth-chart">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={simData} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--card-border))" opacity={0.5} />
              <XAxis
                dataKey="trade"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                label={{ value: "Trade #", position: "insideBottom", offset: -5, fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`}
              />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--card-border))", borderRadius: 8, fontSize: 11 }}
                formatter={(value: number, name: string) => [`$${value.toFixed(2)}`, name === "full" ? "Full Kelly" : name === "half" ? "Half Kelly" : "Quarter Kelly"]}
                labelFormatter={(label: number) => `Trade #${label}`}
              />
              <Legend
                wrapperStyle={{ fontSize: 10 }}
                formatter={(value: string) => value === "full" ? "Full Kelly" : value === "half" ? "Half Kelly" : "Quarter Kelly"}
              />
              <Line type="monotone" dataKey="full" stroke="#ef4444" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="half" stroke="#22c55e" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="quarter" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ─── Shared ──────────────────────────────────────────────────────────────────

function KellyCard({ label, pct, amount, hasEdge, subtitle, recommended }: {
  label: string; pct: number; amount: number; hasEdge: boolean; subtitle: string; recommended?: boolean;
}) {
  const color = hasEdge ? "text-green-400" : "text-red-400";
  return (
    <div className={`bg-muted/30 border rounded-lg p-3 ${recommended ? "border-green-500/40" : "border-card-border/50"}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
        {recommended && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">RECOMMENDED</span>
        )}
      </div>
      <span className={`text-lg font-bold tabular-nums font-mono ${color}`}>{pct.toFixed(2)}%</span>
      {amount > 0 && (
        <span className="block text-xs text-muted-foreground mt-0.5">
          Risk <span className="text-foreground font-semibold tabular-nums font-mono">${amount.toFixed(2)}</span> per trade
        </span>
      )}
      <span className="block text-[10px] text-muted-foreground mt-0.5">{subtitle}</span>
    </div>
  );
}
