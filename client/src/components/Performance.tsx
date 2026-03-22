import { TrendingUp } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { formatPercent, getChangeColor, formatCurrency } from "@/lib/format";

interface PerformanceProps {
  data: any;
}

function ReturnRow({ label, value }: { label: string; value: number | null }) {
  const color = getChangeColor(value);
  return (
    <div className="flex justify-between items-center py-2 border-b border-card-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${color}`}>
        {value !== null ? (value >= 0 ? "+" : "") + formatPercent(value) : "N/A"}
      </span>
    </div>
  );
}

function CustomTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-popover border border-popover-border rounded-lg shadow-lg px-3 py-2">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-sm font-semibold tabular-nums text-foreground">
          {formatCurrency(payload[0].value)}
        </p>
      </div>
    );
  }
  return null;
}

export function Performance({ data }: PerformanceProps) {
  const { historicalReturns, chartData } = data;

  return (
    <div className="bg-card border border-card-border rounded-lg p-6" data-testid="performance">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
        <TrendingUp className="h-4 w-4" />
        Performance
      </h3>

      {/* Returns Table */}
      <div className="mb-6">
        <ReturnRow label="1-Year Return" value={historicalReturns?.oneYear ?? null} />
        <ReturnRow label="3-Year Return" value={historicalReturns?.threeYear ?? null} />
        <ReturnRow label="5-Year Return" value={historicalReturns?.fiveYear ?? null} />
      </div>

      {/* Price Chart */}
      {chartData && chartData.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-3">1-Year Price History</div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                <defs>
                  <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(217, 72%, 58%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(217, 72%, 58%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(225, 12%, 16%)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "hsl(220, 8%, 56%)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(d: string) => {
                    const date = new Date(d);
                    return date.toLocaleDateString("en-US", { month: "short" });
                  }}
                  interval={Math.floor((chartData.length || 1) / 6)}
                />
                <YAxis
                  tick={{ fill: "hsl(220, 8%, 56%)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  domain={["auto", "auto"]}
                  tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                  width={50}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke="hsl(217, 72%, 58%)"
                  strokeWidth={2}
                  fill="url(#chartGradient)"
                  dot={false}
                  activeDot={{ r: 4, fill: "hsl(217, 72%, 58%)", stroke: "hsl(225, 18%, 7%)", strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
