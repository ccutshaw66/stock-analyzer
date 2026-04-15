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
  Zap,
} from "lucide-react";
import { HelpBlock, Example, ScoreRange } from "@/components/HelpBlock";
import mascotUrl from "@/assets/mascot.jpg";
import { LimitReached } from "@/components/LimitReached";
import InvalidSymbol, { isSymbolNotFound } from "@/components/InvalidSymbol";
import { useSubscription } from "@/hooks/useSubscription";
import {
  ResponsiveContainer,
  AreaChart,
  ComposedChart,
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
  if (signal.startsWith("GO")) return { bg: "bg-green-500", text: "text-green-400", border: "border-green-500/30" };
  if (signal.startsWith("SET")) return { bg: "bg-blue-500", text: "text-blue-400", border: "border-blue-500/30" };
  if (signal.startsWith("READY")) return { bg: "bg-amber-500", text: "text-amber-400", border: "border-amber-500/30" };
  if (signal.startsWith("GATES CLOSED")) return { bg: "bg-red-500", text: "text-red-400", border: "border-red-500/30" };
  if (signal === "ENTER") return { bg: "bg-green-500", text: "text-green-500", border: "border-green-500/30" };
  if (signal === "SELL") return { bg: "bg-red-500", text: "text-red-500", border: "border-red-500/30" };
  return { bg: "bg-zinc-500", text: "text-zinc-400", border: "border-zinc-500/30" };
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
  const hasBuy = payload.bbtcSignal === "BUY" || payload.bbtcSignal === "ADD_LONG" || payload.verSignal === "BUY";
  const hasSell = payload.bbtcSignal === "SELL" || payload.bbtcSignal === "STOP_HIT" || payload.bbtcSignal === "REDUCE" || payload.verSignal === "SELL";
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
  const { isAnalysisExhausted } = useSubscription();

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
      {/* Limit reached */}
      {isAnalysisExhausted && !isLoading && <LimitReached feature="Trade Analysis" />}

      {/* Loading */}
      {!isAnalysisExhausted && isLoading && <LoadingState />}

      {/* Error */}
      {error && !isLoading && !isAnalysisExhausted && (() => {
        const msg = error.message || "";
        const isUpgrade = msg.includes("403") || msg.includes("limit reached") || msg.includes("Upgrade");
        if (isUpgrade) {
          return (
            <div className="flex flex-col items-center justify-center py-10 text-center bg-card border border-primary/20 rounded-xl" data-testid="upgrade-prompt">
              <img src={mascotUrl} alt="Stock Otter" className="h-40 w-auto mb-4 drop-shadow-lg" />
              <h3 className="text-lg font-bold text-foreground mb-2">You've Hit Your Daily Limit</h3>
              <p className="text-sm text-muted-foreground max-w-md mb-1">
                Free accounts get 1 stock analysis per day. Upgrade to Pro for 25 per day, or go Elite for unlimited.
              </p>
              <p className="text-xs text-muted-foreground/60 mb-5">
                Your limit resets at midnight. Or unlock everything right now.
              </p>
              <div className="flex items-center gap-3">
                <a href="/#/account" className="h-10 px-6 text-sm font-bold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors inline-flex items-center gap-2">
                  Upgrade to Pro — $15/mo
                </a>
                <a href="/#/account" className="h-10 px-6 text-sm font-bold rounded-lg bg-muted text-foreground hover:bg-muted/80 transition-colors inline-flex items-center gap-2">
                  Go Elite — $39/mo
                </a>
              </div>
            </div>
          );
        }
        if (isSymbolNotFound(msg)) {
          return <InvalidSymbol ticker={activeTicker} />;
        }
        return (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 text-center" data-testid="error-message">
            <p className="text-red-400 font-medium mb-2">Trade analysis unavailable</p>
            <p className="text-sm text-muted-foreground">
              {msg.replace(/^\d+:\s*/, "").replace(/[{}"]/g, "").replace(/error:/i, "").trim() || "Failed to load trade analysis. Please try again."}
            </p>
          </div>
        );
      })()}

      {/* FAQ / How It Works */}
      <HelpBlock title="How Trade Analysis Scoring Works">
        <p>Each stock is scored on <strong className="text-foreground">8 categories</strong> (1–10 scale), weighted and combined into a final 0–10 score that drives the YES / WATCH / NO verdict.</p>

        <p className="font-semibold text-foreground mt-2">Scoring Categories & What Drives Them:</p>
        <p><strong className="text-foreground">Income Strength (15%)</strong> — Dividend yield. <span className="text-green-400">9/10</span> = yield above 4%. <span className="text-yellow-400">5/10</span> = yield 1–2.5%. <span className="text-red-400">2/10</span> = no dividend.</p>
        <p><strong className="text-foreground">Income Quality (15%)</strong> — Payout ratio (what % of earnings go to dividends). <span className="text-green-400">9/10</span> = under 50% (sustainable). <span className="text-yellow-400">5/10</span> = 75–100%. <span className="text-red-400">3/10</span> = over 100% (paying out more than they earn).</p>
        <p><strong className="text-foreground">Business Quality (15%)</strong> — Revenue growth + gross margins. <span className="text-green-400">High</span> = 10%+ revenue growth with 40%+ margins. <span className="text-red-400">Low</span> = shrinking revenue or thin margins.</p>
        <p><strong className="text-foreground">Balance Sheet Quality (15%)</strong> — Debt-to-equity + current ratio. <span className="text-green-400">High</span> = low debt (D/E under 30), strong liquidity (current ratio 2+). <span className="text-red-400">Low</span> = D/E above 150 or current ratio below 1.</p>
        <p><strong className="text-foreground">Performance Quality (15%)</strong> — 1-year and 3-year stock returns. <span className="text-green-400">High</span> = 20%+ annual return. <span className="text-red-400">Low</span> = negative returns.</p>
        <p><strong className="text-foreground">Valuation Sanity (10%)</strong> — P/E ratio check. <span className="text-green-400">9/10</span> = P/E under 12 (bargain). <span className="text-yellow-400">5/10</span> = P/E 20–30 (fairly valued). <span className="text-red-400">2/10</span> = P/E above 50 (expensive). Bonus +1 if forward P/E is lower (earnings growing).</p>
        <p><strong className="text-foreground">Liquidity & Scale (5%)</strong> — Market cap + trading volume. Large-cap ($100B+) with high volume = safest. Micro-cap ($300M) with thin volume = risky.</p>
        <p><strong className="text-foreground">Thesis Durability (10%)</strong> — Combination of low beta (less volatile), steady revenue growth, low debt, and dividend yield. Stocks that check all boxes hold up in any environment.</p>

        <p className="font-semibold text-foreground mt-2">Final Verdict:</p>
        <ScoreRange label="YES" range="7.0–10.0" color="green" description="Strong conviction buy. Fundamentals, income, and performance all align." />
        <ScoreRange label="WATCH" range="4.0–6.9" color="yellow" description="Hold or watchlist. Mixed signals, needs improvement in key areas before committing." />
        <ScoreRange label="NO" range="0–3.9" color="red" description="Avoid for now. Significant concerns across multiple scoring categories." />

        <p className="font-semibold text-foreground mt-2">Examples:</p>
        <Example type="good">
          <p><strong className="text-green-400">JNJ (Score 8.1, YES):</strong> 2.9% dividend yield (7/10 income), 42% payout (9/10 quality), 67% gross margin (8/10 business), D/E 45 (7/10 balance), P/E 16 (7/10 valuation). Consistent across the board.</p>
        </Example>
        <Example type="neutral">
          <p><strong className="text-yellow-400">INTC (Score 5.4, WATCH):</strong> 1.4% yield (3/10 income), decent margins but revenue declining (4/10 business), P/E 28 (5/10 valuation), poor 1-year return (3/10 performance). Some strengths but too many weak spots.</p>
        </Example>
        <Example type="bad">
          <p><strong className="text-red-400">RIVN (Score 2.8, NO):</strong> No dividend (2/10), negative margins and cash burn (2/10 business), no profitability (2/10 balance), P/E negative (3/10 valuation). Early-stage company without investment-grade fundamentals yet.</p>
        </Example>

        <p className="font-semibold text-foreground mt-2">Strategy Signals (BBTC / VER / AMC):</p>
        <p className="font-semibold text-foreground mt-2">Trade Lifecycle — 3 Phases:</p>
        <p><strong className="text-red-400">Phase 1 — VER (Reversal Signal):</strong> Catches exhaustion reversals using RSI divergence + volume spike (2x avg) + Bollinger Band extreme. This fires first when a trend has gone too far and is snapping back.</p>
        <p><strong className="text-yellow-400">Phase 2 — AMC (Momentum Confirms):</strong> Validates that momentum is actually shifting. Uses MACD histogram divergence, Bollinger squeeze, volume confirmation, and ADX strength. When AMC confirms after VER, the reversal has real legs.</p>
        <p><strong className="text-green-400">Phase 3 — BBTC (Trend Rides):</strong> EMA 9/21/50 crossovers confirm the new trend is established. ATR-based stops and trailing exits. This is where you ride the move with defined risk.</p>
        <p><span className="text-green-400 font-semibold">BUY</span> = active buy signal. <span className="text-red-400 font-semibold">SELL</span> = active sell signal. <span className="text-yellow-400 font-semibold">NEUTRAL</span> = no clear setup. When 2–3 strategies agree, confidence is "Strong". When they disagree, it's "Weak" or "Mixed".</p>
      </HelpBlock>

      {/* Data */}
      {data && !isLoading && !isAnalysisExhausted && (
        <div className="space-y-6">
          {/* Combined Signal Banner — ticker + price first */}
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
                        data.combined.confidence === "HIGH" || data.combined.confidence === "Strong"
                          ? "border-green-500/40 text-green-500"
                          : data.combined.confidence === "MODERATE"
                          ? "border-blue-500/40 text-blue-400"
                          : data.combined.confidence === "EARLY"
                          ? "border-amber-500/40 text-amber-400"
                          : data.combined.confidence === "Weak" || data.combined.confidence === "NEUTRAL"
                          ? "border-zinc-500/40 text-zinc-400"
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

          {/* 3-Gate Signal Pipeline — prominently styled */}
          {data.gates && (
            <div className={`rounded-xl p-4 sm:p-5 border-2 ${
              data.gates.gatesCleared === 3 ? "border-green-500/40 bg-green-500/5" :
              data.gates.gatesCleared === 2 ? "border-blue-500/40 bg-blue-500/5" :
              data.gates.gatesCleared === 1 ? "border-amber-500/40 bg-amber-500/5" :
              "border-card-border bg-card"
            }`} data-testid="gate-pipeline">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-bold text-foreground">Signal Pipeline</h3>
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                  data.gates.confidence === "HIGH" ? "bg-green-500/10 text-green-400 ring-1 ring-green-500/30" :
                  data.gates.confidence === "MODERATE" ? "bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/30" :
                  data.gates.confidence === "EARLY" ? "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30" :
                  "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/30"
                }`}>
                  {data.gates.confidence} CONFIDENCE
                </span>
              </div>

              {/* Gate Progress Bar */}
              <div className="flex items-center gap-1 mb-5">
                {[1, 2, 3].map((gate) => (
                  <div key={gate} className="flex-1 relative">
                    <div className={`h-2 rounded-full transition-all ${
                      gate <= data.gates.gatesCleared
                        ? gate === 3 ? "bg-green-500" : gate === 2 ? "bg-blue-500" : "bg-amber-500"
                        : "bg-muted/30"
                    }`} />
                  </div>
                ))}
              </div>

              {/* Summary */}
              {data.gates.signal !== "NO SETUP" && (
                <div className={`text-sm font-semibold mb-4 ${getSignalColor(data.gates.signal).text}`} data-testid="gate-summary">
                  {data.gates.summary}
                </div>
              )}

              {/* 3 Gate Cards — consistent layout */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Gate 1: READY */}
                <div className={`rounded-lg border p-3 ${
                  data.gates.gate1.cleared ? "border-amber-500/30 bg-amber-500/5" : "border-card-border bg-card"
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`h-2 w-2 rounded-full ${
                      data.gates.gate1.cleared ? "bg-amber-500" : "bg-muted-foreground/30"
                    }`} />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Gate 1 — Ready</span>
                  </div>
                  <div className="text-sm font-bold text-foreground mb-1">
                    {data.gates.gate1.cleared ? `Reversal ${data.gates.gate1.direction === "BULLISH" ? "↑" : "↓"}` : "No Reversal"}
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed mb-2">{data.gates.gate1.detail}</p>
                  {data.gates.gate1.rsi !== null && (
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span>RSI: <span className="font-mono text-foreground">{data.gates.gate1.rsi}</span></span>
                      {data.gates.gate1.volumeRatio !== null && (
                        <span>Vol: <span className="font-mono text-foreground">{data.gates.gate1.volumeRatio}x</span></span>
                      )}
                    </div>
                  )}
                </div>

                {/* Gate 2: SET */}
                <div className={`rounded-lg border p-3 ${
                  data.gates.gate2.cleared ? "border-blue-500/30 bg-blue-500/5" : "border-card-border bg-card"
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`h-2 w-2 rounded-full ${
                      data.gates.gate2.cleared ? "bg-blue-500" : "bg-muted-foreground/30"
                    }`} />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Gate 2 — Set</span>
                  </div>
                  <div className="text-sm font-bold text-foreground mb-1">
                    {data.gates.gate2.cleared ? "Momentum Confirmed" : `AMC Score: ${data.gates.gate2.amcScore}/5`}
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed mb-2">{data.gates.gate2.detail}</p>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((dot) => (
                      <div key={dot} className={`h-1.5 w-1.5 rounded-full ${
                        dot <= data.gates.gate2.amcScore ? "bg-blue-500" : "bg-muted-foreground/20"
                      }`} />
                    ))}
                  </div>
                </div>

                {/* Gate 3: GO */}
                <div className={`rounded-lg border p-3 ${
                  data.gates.gate3.cleared ? "border-green-500/30 bg-green-500/5" : "border-card-border bg-card"
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`h-2 w-2 rounded-full ${
                      data.gates.gate3.cleared ? "bg-green-500" : "bg-muted-foreground/30"
                    }`} />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Gate 3 — Go</span>
                  </div>
                  <div className="text-sm font-bold text-foreground mb-1">
                    {data.gates.gate3.cleared ? "All Clear" : "Waiting"}
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed mb-2">{data.gates.gate3.detail}</p>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className={data.gates.gate3.emaStackAligned ? "text-green-400" : "text-muted-foreground/50"}>EMA {data.gates.gate3.emaStackAligned ? "✓" : "✗"}</span>
                    <span className={data.gates.gate3.priceAboveEma9 ? "text-green-400" : "text-muted-foreground/50"}>Price {data.gates.gate3.priceAboveEma9 ? "✓" : "✗"}</span>
                    {data.gates.gate3.mmeAligned !== null && (
                      <span className={data.gates.gate3.mmeAligned ? "text-green-400" : "text-muted-foreground/50"}>MME {data.gates.gate3.mmeAligned ? "✓" : "✗"}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}



          {/* Strategy Cards — signals overridden by gate system for confluence */}
          <div className="hidden md:grid grid-cols-3 gap-1 mb-2">
            <div className="text-center">
              <span className={`text-[10px] font-bold uppercase tracking-widest ${data.gates?.gate1?.cleared ? "text-amber-400" : "text-muted-foreground/40"}`}>1 — Reversal Signal</span>
            </div>
            <div className="text-center">
              <span className={`text-[10px] font-bold uppercase tracking-widest ${data.gates?.gate2?.cleared ? "text-blue-400" : "text-muted-foreground/40"}`}>2 — Momentum Confirms</span>
            </div>
            <div className="text-center">
              <span className={`text-[10px] font-bold uppercase tracking-widest ${data.gates?.gate3?.cleared ? "text-green-400" : "text-muted-foreground/40"}`}>3 — Trend Rides</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* VER — Phase 1: Reversal Signal */}
            <Card data-testid="card-ver">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Target className="h-4 w-4 text-primary" />
                    VER Volume Exhaustion Reversal
                  </CardTitle>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                    data.gates?.gate1?.cleared ? "bg-amber-500/20 text-amber-400" : "bg-muted text-muted-foreground"
                  }`}>{data.gates?.gate1?.cleared ? "Gate 1 ✓" : "Waiting"}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">{data.ver.signalDetail}</p>

                {/* RSI Gauge */}
                <div className="bg-muted/50 rounded-md p-3">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                    RSI (14)
                  </div>
                  <RSIGauge value={data.ver.rsi} />
                </div>

                {/* Bollinger Bands + Volume Ratio */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted/30 rounded-md p-2.5">
                    <div className="text-[10px] text-muted-foreground uppercase">BB Upper</div>
                    <div className="text-sm font-semibold tabular-nums text-red-400">
                      {data.ver.bbUpper !== null ? formatCurrency(data.ver.bbUpper) : "N/A"}
                    </div>
                  </div>
                  <div className="bg-muted/30 rounded-md p-2.5">
                    <div className="text-[10px] text-muted-foreground uppercase">BB Lower</div>
                    <div className="text-sm font-semibold tabular-nums text-green-400">
                      {data.ver.bbLower !== null ? formatCurrency(data.ver.bbLower) : "N/A"}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted/30 rounded-md p-2.5">
                    <div className="text-[10px] text-muted-foreground uppercase">BB Middle</div>
                    <div className="text-sm font-semibold tabular-nums text-purple-500">
                      {data.ver.bbMiddle !== null ? formatCurrency(data.ver.bbMiddle) : "N/A"}
                    </div>
                  </div>
                  <div className="bg-muted/30 rounded-md p-2.5">
                    <div className="text-[10px] text-muted-foreground uppercase">Vol Ratio</div>
                    <div className="text-sm font-semibold tabular-nums text-foreground">
                      {data.ver.volumeRatio !== null ? `${data.ver.volumeRatio}x avg` : "N/A"}
                    </div>
                  </div>
                </div>

                {/* Price vs Bollinger Band relationship */}
                <div className="flex items-center gap-2 text-xs">
                  <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Band Position:</span>
                  {data.ver.bbUpper !== null && data.ver.bbLower !== null ? (
                    data.currentPrice >= data.ver.bbUpper ? (
                      <span className="font-semibold text-red-500">At Upper Band</span>
                    ) : data.currentPrice <= data.ver.bbLower ? (
                      <span className="font-semibold text-green-500">At Lower Band</span>
                    ) : (
                      <span className="font-semibold text-yellow-500">Inside Bands</span>
                    )
                  ) : (
                    <span className="font-semibold text-muted-foreground">N/A</span>
                  )}
                </div>

                {/* Recent Signals */}
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Recent Signals
                  </div>
                  <RecentSignalsList signals={data.ver.recentSignals} />
                </div>
              </CardContent>
            </Card>

            {/* AMC — Phase 2: Momentum Confirms */}
            <Card data-testid="card-amc">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-purple-400" />
                    <CardTitle className="text-sm font-semibold">AMC Strategy</CardTitle>
                  </div>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                    data.gates?.gate2?.cleared ? "bg-blue-500/20 text-blue-400" : "bg-muted text-muted-foreground"
                  }`}>{data.gates?.gate2?.cleared ? "Gate 2 ✓" : "Waiting"}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{data.amc?.signalDetail || "Adaptive Momentum Confluence"}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Score + Mode */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted/30 rounded-md p-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">Score</p>
                    <p className={`text-lg font-bold tabular-nums ${(data.amc?.score || 0) >= 4 ? "text-green-400" : (data.amc?.score || 0) >= 3 ? "text-yellow-400" : "text-muted-foreground"}`}>
                      {data.amc?.score || 0}<span className="text-xs text-muted-foreground">/5</span>
                    </p>
                  </div>
                  <div className="bg-muted/30 rounded-md p-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">Mode</p>
                    <p className={`text-sm font-bold ${data.amc?.mode === "momentum" ? "text-green-400" : data.amc?.mode === "reversion" ? "text-cyan-400" : "text-muted-foreground"}`}>
                      {data.amc?.mode === "momentum" ? "Momentum" : data.amc?.mode === "reversion" ? "Reversion" : "Flat"}
                    </p>
                  </div>
                </div>

                {/* VAMI Value */}
                <div className="bg-muted/30 rounded-md p-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-muted-foreground uppercase">VAMI (Custom)</p>
                    <span className={`text-xs ${(data.amc?.vami || 0) > 0 ? "text-green-400" : (data.amc?.vami || 0) < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                      {(data.amc?.vami || 0) > 0 ? "Bullish" : (data.amc?.vami || 0) < 0 ? "Bearish" : "Neutral"}
                    </span>
                  </div>
                  <p className={`text-xl font-bold tabular-nums ${(data.amc?.vami || 0) > 0 ? "text-green-400" : (data.amc?.vami || 0) < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                    {(data.amc?.vami || 0).toFixed(2)}
                  </p>
                  {/* VAMI bar */}
                  <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${(data.amc?.vami || 0) > 0 ? "bg-green-500" : "bg-red-500"}`}
                      style={{ width: `${Math.min(100, Math.abs(data.amc?.vami || 0) * 2)}%`, marginLeft: (data.amc?.vami || 0) >= 0 ? "50%" : `${50 - Math.min(50, Math.abs(data.amc?.vami || 0) * 2)}%` }}
                    />
                  </div>
                </div>

                {/* Recent Signals */}
                {data.amc?.recentSignals?.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Recent Signals</h4>
                    <div className="space-y-1">
                      {data.amc.recentSignals.slice(-5).map((s: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground font-mono">{s.date}</span>
                          <span className={s.signal.includes("BUY") ? "text-green-400 font-semibold" : "text-red-400 font-semibold"}>{s.signal}</span>
                          <span className="tabular-nums text-muted-foreground">${s.price}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* BBTC — Phase 3: Trend Rides */}
            <Card data-testid="card-bbtc">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    BBTC EMA Pyramid
                  </CardTitle>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                    data.gates?.gate3?.cleared ? "bg-green-500/20 text-green-400" : "bg-muted text-muted-foreground"
                  }`}>{data.gates?.gate3?.cleared ? "Gate 3 ✓" : "Waiting"}</span>
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
          </div>

          {/* Price Chart with Overlays */}
          <Card data-testid="card-price-chart">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Price Chart (1Y) with EMA Overlays</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
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
                  </ComposedChart>
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
      {!data && !isLoading && !error && !isAnalysisExhausted && (
        <div className="text-center py-16 text-muted-foreground" data-testid="empty-state">
          <Activity className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg">Enter a ticker symbol to analyze trading signals</p>
          <p className="text-sm mt-1">3-phase confirmation: VER catches the reversal, AMC confirms momentum, BBTC rides the trend</p>
        </div>
      )}
    </div>
  );
}
