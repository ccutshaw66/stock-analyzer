import { useState, useMemo } from "react";
import {
  BarChart3, TrendingUp, DollarSign, Target,
  AlertTriangle,
} from "lucide-react";
import { HelpBlock, Example, ScoreRange } from "@/components/HelpBlock";
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";

// ─── Types ───────────────────────────────────────────────────────────────────

type Strategy =
  | "long-call" | "long-put" | "short-call" | "short-put"
  | "bull-call-spread" | "bear-put-spread" | "bull-put-spread" | "bear-call-spread"
  | "iron-condor" | "butterfly" | "straddle" | "strangle";

interface StrategyDef {
  label: string;
  fields: string[];
}

const STRATEGIES: Record<Strategy, StrategyDef> = {
  "long-call":        { label: "Long Call",               fields: ["strike", "premium", "contracts"] },
  "long-put":         { label: "Long Put",                fields: ["strike", "premium", "contracts"] },
  "short-call":       { label: "Short Call",              fields: ["strike", "premium", "contracts"] },
  "short-put":        { label: "Short Put",               fields: ["strike", "premium", "contracts"] },
  "bull-call-spread":  { label: "Bull Call Spread",       fields: ["buyStrike", "sellStrike", "netDebit", "contracts"] },
  "bear-put-spread":   { label: "Bear Put Spread",        fields: ["buyStrike", "sellStrike", "netDebit", "contracts"] },
  "bull-put-spread":   { label: "Bull Put Spread (PCS)",  fields: ["sellStrike", "buyStrike", "netCredit", "contracts"] },
  "bear-call-spread":  { label: "Bear Call Spread (CCS)", fields: ["sellStrike", "buyStrike", "netCredit", "contracts"] },
  "iron-condor":      { label: "Iron Condor",             fields: ["putBuyStrike", "putSellStrike", "callSellStrike", "callBuyStrike", "putCredit", "callCredit", "contracts"] },
  "butterfly":        { label: "Butterfly",               fields: ["lowStrike", "midStrike", "highStrike", "netDebit", "contracts"] },
  "straddle":         { label: "Straddle",                fields: ["strike", "totalPremium", "contracts"] },
  "strangle":         { label: "Strangle",                fields: ["callStrike", "putStrike", "totalPremium", "contracts"] },
};

const FIELD_LABELS: Record<string, string> = {
  strike: "Strike ($)",
  premium: "Premium ($)",
  contracts: "# Contracts",
  buyStrike: "Buy Strike ($)",
  sellStrike: "Sell Strike ($)",
  netDebit: "Net Debit ($)",
  netCredit: "Net Credit ($)",
  putBuyStrike: "Put Buy Strike ($)",
  putSellStrike: "Put Sell Strike ($)",
  callSellStrike: "Call Sell Strike ($)",
  callBuyStrike: "Call Buy Strike ($)",
  putCredit: "Put Credit ($)",
  callCredit: "Call Credit ($)",
  lowStrike: "Low Strike ($)",
  midStrike: "Mid Strike ($)",
  highStrike: "High Strike ($)",
  totalPremium: "Total Premium ($)",
  callStrike: "Call Strike ($)",
  putStrike: "Put Strike ($)",
};

const FIELD_DEFAULTS: Record<string, number> = {
  strike: 100, premium: 3, contracts: 1,
  buyStrike: 95, sellStrike: 105, netDebit: 3, netCredit: 2,
  putBuyStrike: 85, putSellStrike: 90, callSellStrike: 110, callBuyStrike: 115,
  putCredit: 1.5, callCredit: 1.5,
  lowStrike: 95, midStrike: 100, highStrike: 105,
  totalPremium: 5, callStrike: 105, putStrike: 95,
};

// ─── P/L Calculation ─────────────────────────────────────────────────────────

function calcPL(strategy: Strategy, vals: Record<string, number>, stock: number): number {
  const c = vals.contracts || 1;
  const multiplier = 100 * c;
  switch (strategy) {
    case "long-call":
      return (Math.max(stock - vals.strike, 0) - vals.premium) * multiplier;
    case "long-put":
      return (Math.max(vals.strike - stock, 0) - vals.premium) * multiplier;
    case "short-call":
      return (vals.premium - Math.max(stock - vals.strike, 0)) * multiplier;
    case "short-put":
      return (vals.premium - Math.max(vals.strike - stock, 0)) * multiplier;
    case "bull-call-spread":
      return (Math.max(stock - vals.buyStrike, 0) - Math.max(stock - vals.sellStrike, 0) - vals.netDebit) * multiplier;
    case "bear-put-spread":
      return (Math.max(vals.buyStrike - stock, 0) - Math.max(vals.sellStrike - stock, 0) - vals.netDebit) * multiplier;
    case "bull-put-spread":
      return (vals.netCredit - Math.max(vals.sellStrike - stock, 0) + Math.max(vals.buyStrike - stock, 0)) * multiplier;
    case "bear-call-spread":
      return (vals.netCredit - Math.max(stock - vals.sellStrike, 0) + Math.max(stock - vals.buyStrike, 0)) * multiplier;
    case "iron-condor":
      return (vals.putCredit + vals.callCredit
        - Math.max(vals.putSellStrike - stock, 0) + Math.max(vals.putBuyStrike - stock, 0)
        - Math.max(stock - vals.callSellStrike, 0) + Math.max(stock - vals.callBuyStrike, 0)) * multiplier;
    case "butterfly":
      return (Math.max(stock - vals.lowStrike, 0) - 2 * Math.max(stock - vals.midStrike, 0)
        + Math.max(stock - vals.highStrike, 0) - vals.netDebit) * multiplier;
    case "straddle":
      return (Math.max(stock - vals.strike, 0) + Math.max(vals.strike - stock, 0) - vals.totalPremium) * multiplier;
    case "strangle":
      return (Math.max(stock - vals.callStrike, 0) + Math.max(vals.putStrike - stock, 0) - vals.totalPremium) * multiplier;
    default:
      return 0;
  }
}

function getStrikesCenter(strategy: Strategy, vals: Record<string, number>): number {
  switch (strategy) {
    case "long-call": case "long-put": case "short-call": case "short-put": case "straddle":
      return vals.strike;
    case "bull-call-spread": case "bear-put-spread":
      return (vals.buyStrike + vals.sellStrike) / 2;
    case "bull-put-spread": case "bear-call-spread":
      return (vals.sellStrike + vals.buyStrike) / 2;
    case "iron-condor":
      return (vals.putBuyStrike + vals.callBuyStrike) / 2;
    case "butterfly":
      return vals.midStrike;
    case "strangle":
      return (vals.callStrike + vals.putStrike) / 2;
    default:
      return 100;
  }
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function PayoffDiagram() {
  const [strategy, setStrategy] = useState<Strategy>("long-call");
  const [fieldValues, setFieldValues] = useState<Record<string, number>>({ ...FIELD_DEFAULTS });

  const def = STRATEGIES[strategy];

  const setField = (key: string, val: number) => {
    setFieldValues(prev => ({ ...prev, [key]: val }));
  };

  const data = useMemo(() => {
    const center = getStrikesCenter(strategy, fieldValues);
    const range = center * 0.5;
    const lo = Math.max(center - range, 0);
    const hi = center + range;
    const step = (hi - lo) / 199;
    const points: { stock: number; pl: number; gain: number | null; loss: number | null }[] = [];
    for (let i = 0; i < 200; i++) {
      const stock = lo + step * i;
      const pl = calcPL(strategy, fieldValues, stock);
      points.push({
        stock: Math.round(stock * 100) / 100,
        pl: Math.round(pl * 100) / 100,
        gain: pl >= 0 ? Math.round(pl * 100) / 100 : null,
        loss: pl < 0 ? Math.round(pl * 100) / 100 : null,
      });
    }
    return points;
  }, [strategy, fieldValues]);

  const summary = useMemo(() => {
    const pls = data.map(d => d.pl);
    const maxProfit = Math.max(...pls);
    const maxLoss = Math.min(...pls);
    const breakevens: number[] = [];
    for (let i = 1; i < data.length; i++) {
      if ((data[i - 1].pl < 0 && data[i].pl >= 0) || (data[i - 1].pl >= 0 && data[i].pl < 0)) {
        const x0 = data[i - 1].stock, y0 = data[i - 1].pl;
        const x1 = data[i].stock, y1 = data[i].pl;
        const be = x0 + (0 - y0) * (x1 - x0) / (y1 - y0);
        breakevens.push(Math.round(be * 100) / 100);
      }
    }
    // Check if max profit or loss looks unbounded (at edges)
    const lastPL = pls[pls.length - 1];
    const firstPL = pls[0];
    const isMaxProfitUnbounded = maxProfit === lastPL && lastPL > 0 && Math.abs(lastPL) > Math.abs(maxProfit * 0.95);
    const isMaxLossUnbounded = maxLoss === lastPL && lastPL < 0 && Math.abs(lastPL) > Math.abs(maxLoss * 0.95);
    const isFirstLossUnbounded = maxLoss === firstPL && firstPL < 0;
    return {
      maxProfit: isMaxProfitUnbounded ? Infinity : maxProfit,
      maxLoss: isMaxLossUnbounded || isFirstLossUnbounded ? -Infinity : maxLoss,
      breakevens,
    };
  }, [data]);

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-6 max-w-[1200px] mx-auto" data-testid="payoff-diagram-page">
      <h1 className="text-lg font-bold text-foreground">Options Payoff Diagram</h1>
      <p className="text-xs text-muted-foreground -mt-4">Visualize the profit/loss at expiration for any options strategy.</p>

      <div className="bg-card border border-card-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Strategy Builder</h3>
        </div>

        <HelpBlock title="How to read a payoff diagram">
          <p>A payoff diagram shows your <strong className="text-foreground">profit or loss at expiration</strong> for every possible stock price.</p>
          <p><strong className="text-foreground">X-axis:</strong> Stock price at expiration. <strong className="text-foreground">Y-axis:</strong> Your profit or loss in dollars.</p>
          <p><strong className="text-foreground">The horizontal line at $0</strong> is your breakeven — above it you profit, below you lose money.</p>
          <Example type="good">
            <strong className="text-green-400">Long Call at $100 strike, $3 premium:</strong> You break even at $103. Below $100 you lose the full $300 premium. Above $103 you profit dollar-for-dollar. Max loss = $300 (the premium paid).
          </Example>
          <Example type="neutral">
            <strong className="text-yellow-400">Iron Condor:</strong> Max profit is the total credit received — you keep it if the stock stays between the short strikes. Max loss is the width of the wider spread minus the credit.
          </Example>
          <ScoreRange label="Green Area" range="Above $0" color="green" description="Profitable zone — stock prices where you make money at expiration" />
          <ScoreRange label="Red Area" range="Below $0" color="red" description="Loss zone — stock prices where you lose money at expiration" />
        </HelpBlock>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="col-span-2 md:col-span-1">
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Strategy</label>
            <select
              value={strategy}
              onChange={e => setStrategy(e.target.value as Strategy)}
              className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground"
              data-testid="payoff-strategy-select"
            >
              {Object.entries(STRATEGIES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          {def.fields.map(field => (
            <div key={field}>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">{FIELD_LABELS[field]}</label>
              <input
                type="number"
                step={field === "contracts" ? 1 : 0.5}
                min={field === "contracts" ? 1 : 0}
                value={fieldValues[field] ?? FIELD_DEFAULTS[field] ?? 0}
                onChange={e => setField(field, parseFloat(e.target.value) || 0)}
                className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums"
                data-testid={`payoff-${field}`}
              />
            </div>
          ))}
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <ResultCard
            label="Max Profit"
            value={summary.maxProfit === Infinity ? "Unlimited" : `$${summary.maxProfit.toFixed(2)}`}
            color="text-green-400"
          />
          <ResultCard
            label="Max Loss"
            value={summary.maxLoss === -Infinity ? "Unlimited" : `$${summary.maxLoss.toFixed(2)}`}
            color="text-red-400"
          />
          {summary.breakevens.map((be, i) => (
            <ResultCard
              key={i}
              label={summary.breakevens.length > 1 ? `Breakeven ${i + 1}` : "Breakeven"}
              value={`$${be.toFixed(2)}`}
              color="text-yellow-400"
            />
          ))}
          {summary.breakevens.length === 0 && (
            <ResultCard label="Breakeven" value="N/A" color="text-muted-foreground" />
          )}
        </div>

        {/* Chart */}
        <div className="bg-muted/20 border border-card-border/50 rounded-lg p-3" data-testid="payoff-chart">
          <ResponsiveContainer width="100%" height={350}>
            <AreaChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--card-border))" opacity={0.5} />
              <XAxis
                dataKey="stock"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                label={{ value: "Stock Price at Expiration", position: "insideBottom", offset: -5, fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                label={{ value: "Profit / Loss ($)", angle: -90, position: "insideLeft", offset: 0, fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--card-border))", borderRadius: 8, fontSize: 11 }}
                formatter={(value: any) => value != null ? [`$${Number(value).toFixed(2)}`, "P/L"] : ["-", "P/L"]}
                labelFormatter={(label: number) => `Stock: $${label.toFixed(2)}`}
              />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeOpacity={0.7} />
              <Area
                type="monotone"
                dataKey="gain"
                stroke="#22c55e"
                fill="#22c55e"
                fillOpacity={0.25}
                strokeWidth={2}
                connectNulls={false}
                dot={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="loss"
                stroke="#ef4444"
                fill="#ef4444"
                fillOpacity={0.25}
                strokeWidth={2}
                connectNulls={false}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ─── Shared ──────────────────────────────────────────────────────────────────

function ResultCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-muted/30 border border-card-border/50 rounded-lg p-2.5">
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-0.5">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}
