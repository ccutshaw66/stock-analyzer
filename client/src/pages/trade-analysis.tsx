import { useTicker } from "@/contexts/TickerContext";
import { formatCurrency, formatNumber } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  BarChart3,
  Target,
  ShieldAlert,
  ArrowUpCircle,
  ArrowDownCircle,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from "recharts";

function getSignalColor(signal: string) {
  switch (signal) {
    case "ENTER":
      return { bg: "bg-green-500", text: "text-green-500", border: "border-green-500/30" };
    case "SELL":
      return { bg: "bg-red-500", text: "text-red-500", border: "border-red-500/30" };
    case "HOLD":
    default:
      return { bg: "bg-yellow-500", text: "text-yellow-500", border: "border-yellow-500/30" };
  }
}

function getTrendIcon(trend: string) {
  switch (trend) {
    case "UP":
      return <TrendingUp className="h-4 w-4 text-green-500" />;
    case "DOWN":
      return <TrendingDown className="h-4 w-4 text-red-500" />;
    default:
      return <Minus className="h-4 w-4 text-yellow-500" />;
  }
}

function getTrendColor(trend: string) {
  switch (trend) {
    case "UP":
    case "LONG":
      return "text-green-500";
    case "DOWN":
    case "SHORT":
      return "text-red-500";
    default:
      return "text-yellow-500";
  }
}

function SignalBadge({ signal, size = "sm" }: { signal: string; size?: "sm" | "lg" }) {
  const colors = getSignalColor(signal);
  const sizeClasses = size === "lg" ? "px-5 py-2 text-lg" : "px-3 py-1 text-xs";
  return (
    <span
      className={`${colors.bg} text-white font-bold rounded-lg inline-flex items-center ${sizeClasses}`}
      data-testid={`signal-badge-${signal.toLowerCase()}`}
    >
      {signal}
    </span>
  );
}

function RecentSignalsList({ signals }: { signals: { date: string; signal: string; price: number }[] }) {
  const last5 = signals.slice(-5);
  if (last5.length === 0) {
    return <p className="text-xs text-muted-foreground">No recent signals</p>;
  }
  return (
    <div className="space-y-1.5">
      {last5.map((s, i) => (
        <div key={i} className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground font-mono">{s.date}</span>
          <span
            className={`font-semibold ${
              s.signal === "BUY" || s.signal === "ADD_LONG"
                ? "text-green-500"
                : s.signal === "SELL" || s.signal === "STOP_HIT" || s.signal === "REDUCE"
                ? "text-red-500"
                : "text-muted-foreground"
            }`}
          >
            {s.signal}
          </span>
          <span className="text-foreground tabular-nums">${s.price.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

function RSIGauge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground text-sm">N/A</span>;
  const pct = Math.min(100, Math.max(0, value));
  const color = value > 70 ? "bg-red-500" : value < 30 ? "bg-green-500" : "bg-blue-500";
  const textColor = value > 70 ? "text-red-500" : value < 30 ? "text-green-500" : "text-blue-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className={`text-lg font-bold tabular-nums ${textColor}`}>{value.toFixed(1)}</span>
        <span className="text-xs text-muted-foreground">
          {value > 70 ? "Overbought" : value < 30 ? "Oversold" : "Neutral"}
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden relative">
        <div className="absolute inset-0 flex">
          <div className="w-[30%] bg-green-500/20" />
          <div className="w-[40%] bg-blue-500/10" />
          <div className="w-[30%] bg-red-500/20" />
        </div>
        <div
          className={`h-full ${color} rounded-full transition-all relative z-10`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-32 w-full" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

// Custom dot for signal markers on price chart
function SignalDot(props: any) {
  const { cx, cy, payload } = props;
  if (!payload) return null;
  const hasBuy = payload.bbtcSignal === "BUY" || payload.bbtcSignal === "ADD_LONG" || payload.dtsSignal === "BUY";
  const hasSell = payload.bbtcSignal === "SELL" || payload.bbtcSignal === "STOP_HIT" || payload.bbtcSignal === "REDUCE" || payload.dtsSignal === "SELL";
  if (!hasBuy && !hasSell) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill={hasBuy ? "#22c55e" : "#ef4444"}
      stroke="#fff"
      strokeWidth={1.5}
    />
  );
}

export default function TradeAnalysis() {
  const { activeTicker, tradeData: data, isTradeLoading: isLoading, tradeError: error } = useTicker();

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Loading */}
      {isLoading && <LoadingState />}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-center" data-testid="error-message">
          <p className="text-red-400 font-medium">
            {error.message || "Failed to load trade analysis."}
          </p>
        </div>
      )}

      {/* Data */}
      {data && !isLoading && (
        <div className="space-y-6">
          {/* Combined Signal Banner */}
          <div
            className={`bg-card border rounded-lg p-6 ${getSignalColor(data.combined.signal).border}`}
            data-testid="combined-signal-banner"
          >
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <SignalBadge signal={data.combined.signal} size="lg" />
                <div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        data.combined.confidence === "Strong"
                          ? "border-green-500/40 text-green-500"
                          : data.combined.confidence === "Weak"
                          ? "border-red-500/40 text-red-500"
                          : "border-yellow-500/40 text-yellow-500"
                      }`}
                    >
                      {data.combined.confidence} Confidence
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1" data-testid="text-reasoning">
                    {data.combined.reasoning}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">{data.ticker}</div>
                <div className="text-2xl font-bold tabular-nums text-foreground" data-testid="text-current-price">
                  {formatCurrency(data.currentPrice)}
                </div>
              </div>
            </div>
          </div>

          {/* Strategy Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* BBTC EMA Pyramid Card */}
            <Card data-testid="card-bbtc">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    BBTC EMA Pyramid
                  </CardTitle>
                  <SignalBadge signal={data.bbtc.signal} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">{data.bbtc.signalDetail}</p>

                {/* Bias & Trend */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted/50 rounded-md p-2.5">
                    <div className="text-xs text-muted-foreground mb-0.5">Bias</div>
                    <div className={`text-sm font-bold ${getTrendColor(data.bbtc.bias)}`}>
                      {data.bbtc.bias === "LONG" && <ArrowUpCircle className="h-3.5 w-3.5 inline mr-1" />}
                      {data.bbtc.bias === "SHORT" && <ArrowDownCircle className="h-3.5 w-3.5 inline mr-1" />}
                      {data.bbtc.bias}
                    </div>
                  </div>
                  <div className="bg-muted/50 rounded-md p-2.5">
                    <div className="text-xs text-muted-foreground mb-0.5">Trend</div>
                    <div className={`text-sm font-bold flex items-center gap-1 ${getTrendColor(data.bbtc.trend)}`}>
                      {getTrendIcon(data.bbtc.trend)}
                      {data.bbtc.trend}
                    </div>
                  </div>
                </div>

                {/* EMA Values */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-muted/30 rounded p-2">
                    <div className="text-[10px] text-muted-foreground uppercase">EMA 9</div>
                    <div className="text-sm font-semibold tabular-nums text-green-500">
                      {data.bbtc.ema9 !== null ? formatNumber(data.bbtc.ema9) : "N/A"}
                    </div>
                  </div>
                  <div className="bg-muted/30 rounded p-2">
                    <div className="text-[10px] text-muted-foreground uppercase">EMA 21</div>
                    <div className="text-sm font-semibold tabular-nums text-orange-500">
                      {data.bbtc.ema21 !== null ? formatNumber(data.bbtc.ema21) : "N/A"}
                    </div>
                  </div>
                  <div className="bg-muted/30 rounded p-2">
                    <div className="text-[10px] text-muted-foreground uppercase">EMA 50</div>
                    <div className="text-sm font-semibold tabular-nums text-cyan-500">
                      {data.bbtc.ema50 !== null ? formatNumber(data.bbtc.ema50) : "N/A"}
                    </div>
                  </div>
                </div>

                {/* ATR + Stop/Target */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ATR(14)</span>
                    <span className="font-mono tabular-nums">{data.bbtc.atr !== null ? formatNumber(data.bbtc.atr) : "N/A"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Stop</span>
                    <span className="font-mono tabular-nums text-red-500">
                      {data.bbtc.stopPrice !== null ? formatCurrency(data.bbtc.stopPrice) : "N/A"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Target</span>
                    <span className="font-mono tabular-nums text-green-500">
                      {data.bbtc.targetPrice !== null ? formatCurrency(data.bbtc.targetPrice) : "N/A"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Trail Stop</span>
                    <span className="font-mono tabular-nums text-yellow-500">
                      {data.bbtc.trailStop !== null ? formatCurrency(data.bbtc.trailStop) : "N/A"}
                    </span>
                  </div>
                </div>

                {/* Recent Signals */}
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Recent Signals
                  </div>
                  <RecentSignalsList signals={data.bbtc.recentSignals} />
                </div>
              </CardContent>
            </Card>

            {/* DTS Reversal Swing Card */}
            <Card data-testid="card-dts">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Target className="h-4 w-4 text-primary" />
                    DTS Reversal Swing
                  </CardTitle>
                  <SignalBadge signal={data.dts.signal} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">{data.dts.signalDetail}</p>

                {/* RSI Gauge */}
                <div className="bg-muted/50 rounded-md p-3">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                    RSI (14)
                  </div>
                  <RSIGauge value={data.dts.rsi} />
                </div>

                {/* SMA200 + Highest High */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted/30 rounded-md p-2.5">
                    <div className="text-[10px] text-muted-foreground uppercase">SMA 200</div>
                    <div className="text-sm font-semibold tabular-nums text-purple-500">
                      {data.dts.sma200 !== null ? formatCurrency(data.dts.sma200) : "N/A"}
                    </div>
                  </div>
                  <div className="bg-muted/30 rounded-md p-2.5">
                    <div className="text-[10px] text-muted-foreground uppercase">High (15 bar)</div>
                    <div className="text-sm font-semibold tabular-nums text-foreground">
                      {data.dts.highestHigh15 !== null ? formatCurrency(data.dts.highestHigh15) : "N/A"}
                    </div>
                  </div>
                </div>

                {/* Price vs SMA200 relationship */}
                <div className="flex items-center gap-2 text-xs">
                  <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Price vs SMA200:</span>
                  {data.dts.sma200 !== null && data.currentPrice > data.dts.sma200 ? (
                    <span className="font-semibold text-green-500">Above</span>
                  ) : data.dts.sma200 !== null ? (
                    <span className="font-semibold text-red-500">Below</span>
                  ) : (
                    <span className="font-semibold text-muted-foreground">N/A</span>
                  )}
                </div>

                {/* Recent Signals */}
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Recent Signals
                  </div>
                  <RecentSignalsList signals={data.dts.recentSignals} />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Price Chart with Overlays */}
          <Card data-testid="card-price-chart">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Price Chart (1Y) with EMA Overlays</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                    <defs>
                      <linearGradient id="closeGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(v) => {
                        const d = new Date(v);
                        return `${d.getMonth() + 1}/${d.getDate()}`;
                      }}
                      interval="preserveStartEnd"
                      minTickGap={50}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      domain={["auto", "auto"]}
                      tickFormatter={(v) => `$${v}`}
                      width={60}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      labelFormatter={(l) => l}
                      formatter={(value: any, name: string) => {
                        if (value === null) return ["N/A", name];
                        return [`$${Number(value).toFixed(2)}`, name];
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="close"
                      stroke="hsl(var(--primary))"
                      fill="url(#closeGradient)"
                      strokeWidth={1.5}
                      dot={<SignalDot />}
                      name="Close"
                    />
                    <Line type="monotone" dataKey="ema9" stroke="#22c55e" strokeWidth={1} dot={false} name="EMA 9" connectNulls />
                    <Line type="monotone" dataKey="ema21" stroke="#f97316" strokeWidth={1} dot={false} name="EMA 21" connectNulls />
                    <Line type="monotone" dataKey="ema50" stroke="#06b6d4" strokeWidth={1} dot={false} name="EMA 50" connectNulls />
                    <Line
                      type="monotone"
                      dataKey="sma200"
                      stroke="#a855f7"
                      strokeWidth={1.5}
                      strokeDasharray="6 3"
                      dot={false}
                      name="SMA 200"
                      connectNulls
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-4 mt-3 justify-center text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-green-500 rounded" /> EMA 9
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-orange-500 rounded" /> EMA 21
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-cyan-500 rounded" /> EMA 50
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-purple-500 rounded border-dashed" style={{ borderTop: "1px dashed #a855f7", height: 0 }} /> SMA 200
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500" /> Buy Signal
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Sell Signal
                </span>
              </div>
            </CardContent>
          </Card>

          {/* RSI Chart */}
          <Card data-testid="card-rsi-chart">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">RSI (14)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(v) => {
                        const d = new Date(v);
                        return `${d.getMonth() + 1}/${d.getDate()}`;
                      }}
                      interval="preserveStartEnd"
                      minTickGap={50}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      domain={[0, 100]}
                      ticks={[0, 30, 50, 70, 100]}
                      width={35}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      formatter={(value: any) => {
                        if (value === null) return ["N/A", "RSI"];
                        return [Number(value).toFixed(2), "RSI"];
                      }}
                    />
                    <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.6} />
                    <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.6} />
                    <Line
                      type="monotone"
                      dataKey="rsi"
                      stroke="#3b82f6"
                      strokeWidth={1.5}
                      dot={false}
                      name="RSI"
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex gap-4 mt-2 justify-center text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-green-500 rounded opacity-60" style={{ borderTop: "1px dashed #22c55e", height: 0 }} /> Oversold (30)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-red-500 rounded opacity-60" style={{ borderTop: "1px dashed #ef4444", height: 0 }} /> Overbought (70)
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Empty State */}
      {!data && !isLoading && !error && (
        <div className="text-center py-16 text-muted-foreground" data-testid="empty-state">
          <Activity className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg">Enter a ticker symbol to analyze trading signals</p>
          <p className="text-sm mt-1">Combines BBTC EMA Pyramid and DTS Reversal Swing strategies</p>
        </div>
      )}
    </div>
  );
}
