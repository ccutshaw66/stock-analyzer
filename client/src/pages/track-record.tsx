import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Trophy, TrendingUp, TrendingDown, Target, BarChart3,
  AlertTriangle, CheckCircle2, XCircle, Loader2, Activity,
  ArrowUpRight, ArrowDownRight, Minus, Calendar, FlaskConical,
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, Cell } from "recharts";
import { Disclaimer } from "@/components/Disclaimer";
import { BacktestPanel } from "@/components/BacktestPanel";
import mascotUrl from "@/assets/mascot.jpg";

interface TrackRecordData {
  totalSignals: number;
  signalsWithOutcomes: { day7: number; day30: number; day90: number };
  performance: {
    day7: { winRate: number; avgReturn: number; count: number; wins: number } | null;
    day30: { winRate: number; avgReturn: number; count: number; wins: number } | null;
    day90: { winRate: number; avgReturn: number; count: number; wins: number } | null;
  };
  byScoreBracket: {
    day30: { label: string; count: number; avgReturn: number; winRate: number }[];
  };
  bestCalls: { ticker: string; date: string; signal: string; score: number; priceAtSignal: number; return30d: number }[];
  worstCalls: { ticker: string; date: string; signal: string; score: number; priceAtSignal: number; return30d: number }[];
  vsSpy: { otterAvg30d: number; spyAvg30d: number; alpha: number; sampleSize: number };
  recentSignals: { ticker: string; date: string; signal: string; score: number; price: number; return7d: number | null; return30d: number | null; return90d: number | null }[];
}

export default function TrackRecord() {
  const [tab, setTab] = useState<"live" | "backtest">("live");
  const { data, isLoading } = useQuery<TrackRecordData>({
    queryKey: ["/api/track-record"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/track-record");
      return res.json();
    },
  });

  const retColor = (v: number | null) => v == null ? "text-muted-foreground" : v >= 0 ? "text-green-400" : "text-red-400";
  const signalColor = (s: string) =>
    s === "STRONG_BUY" || s === "BUY" ? "text-green-400" : s === "STRONG_SELL" || s === "SELL" ? "text-red-400" : "text-yellow-400";
  const signalBg = (s: string) =>
    s === "STRONG_BUY" || s === "BUY" ? "bg-green-500/15" : s === "STRONG_SELL" || s === "SELL" ? "bg-red-500/15" : "bg-yellow-500/15";

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-6 max-w-[1100px] mx-auto" data-testid="track-record-page">
      <Disclaimer />

      <div className="flex items-center gap-3">
        <Trophy className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-lg font-bold text-foreground">Track Record</h1>
          <p className="text-xs text-muted-foreground">Every signal logged. Every outcome tracked. Full transparency.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-card-border">
        <button
          onClick={() => setTab("live")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${tab === "live" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          data-testid="tab-live"
        >
          <Activity className="h-4 w-4" />
          Live Signals
        </button>
        <button
          onClick={() => setTab("backtest")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${tab === "backtest" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          data-testid="tab-backtest"
        >
          <FlaskConical className="h-4 w-4" />
          Backtester
        </button>
      </div>

      {tab === "backtest" && <BacktestPanel />}

      {tab === "live" && <>

      {tab === "live" && isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {data && !isLoading && data.totalSignals === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center bg-card border border-card-border rounded-xl">
          <img src={mascotUrl} alt="Stock Otter" className="h-32 w-auto mb-4 opacity-70" />
          <h3 className="text-base font-bold text-foreground mb-2">Building Our Track Record</h3>
          <p className="text-sm text-muted-foreground max-w-md mb-1">
            Stock Otter logs every signal daily and tracks the outcome at 7, 30, and 90 days.
            Data collection has just started — check back in a week for our first results.
          </p>
          <p className="text-xs text-muted-foreground/50 mt-2">
            Unlike the gurus, we show our receipts. Every call, every miss, fully auditable.
          </p>
        </div>
      )}

      {data && data.totalSignals > 0 && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Signals" value={data.totalSignals.toString()} icon={<Activity className="h-3.5 w-3.5" />} color="text-primary" />
            <StatCard
              label="30-Day Win Rate"
              value={data.performance.day30 ? `${data.performance.day30.winRate}%` : "Pending..."}
              icon={<Target className="h-3.5 w-3.5" />}
              color={data.performance.day30 && data.performance.day30.winRate >= 55 ? "text-green-400" : "text-foreground"}
              subtitle={data.performance.day30 ? `${data.performance.day30.wins}/${data.performance.day30.count} calls` : ""}
            />
            <StatCard
              label="Avg Return (30d)"
              value={data.performance.day30 ? `${data.performance.day30.avgReturn >= 0 ? "+" : ""}${data.performance.day30.avgReturn}%` : "Pending..."}
              icon={<TrendingUp className="h-3.5 w-3.5" />}
              color={data.performance.day30 && data.performance.day30.avgReturn >= 0 ? "text-green-400" : "text-red-400"}
            />
            <StatCard
              label="vs S&P 500 (Alpha)"
              value={data.vsSpy.sampleSize > 0 ? `${data.vsSpy.alpha >= 0 ? "+" : ""}${data.vsSpy.alpha}%` : "Pending..."}
              icon={<BarChart3 className="h-3.5 w-3.5" />}
              color={data.vsSpy.alpha >= 0 ? "text-green-400" : "text-red-400"}
              subtitle={data.vsSpy.sampleSize > 0 ? `Otter: ${data.vsSpy.otterAvg30d}% vs SPY: ${data.vsSpy.spyAvg30d}%` : ""}
            />
          </div>

          {/* Score Bracket Analysis */}
          {data.byScoreBracket.day30.length > 0 && data.byScoreBracket.day30.some(b => b.count > 0) && (
            <div className="bg-card border border-card-border rounded-lg p-4">
              <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" /> Performance by Signal Strength (30-Day)
              </h3>
              <div className="h-[200px] mb-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.byScoreBracket.day30.filter(b => b.count > 0)} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#888" }} />
                    <YAxis tick={{ fontSize: 10, fill: "#888" }} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip contentStyle={{ background: "#0a1628", border: "1px solid #1e293b", borderRadius: 8, fontSize: 11 }} />
                    <ReferenceLine y={0} stroke="#333" />
                    <Bar dataKey="avgReturn" name="Avg Return">
                      {data.byScoreBracket.day30.filter(b => b.count > 0).map((entry, i) => (
                        <Cell key={i} fill={entry.avgReturn >= 0 ? "#22c55e" : "#ef4444"} opacity={0.7} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-card-border text-muted-foreground">
                    <th className="text-left py-2 px-2 font-semibold">Signal Strength</th>
                    <th className="text-right py-2 px-2 font-semibold">Signals</th>
                    <th className="text-right py-2 px-2 font-semibold">Avg Return</th>
                    <th className="text-right py-2 px-2 font-semibold">Win Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byScoreBracket.day30.filter(b => b.count > 0).map((b, i) => (
                    <tr key={i} className="border-b border-card-border/30">
                      <td className="py-2 px-2 text-foreground font-medium">{b.label}</td>
                      <td className="py-2 px-2 text-right font-mono text-foreground">{b.count}</td>
                      <td className={`py-2 px-2 text-right font-mono font-bold ${b.avgReturn >= 0 ? "text-green-400" : "text-red-400"}`}>{b.avgReturn >= 0 ? "+" : ""}{b.avgReturn}%</td>
                      <td className={`py-2 px-2 text-right font-mono font-bold ${b.winRate >= 55 ? "text-green-400" : b.winRate >= 45 ? "text-yellow-400" : "text-red-400"}`}>{b.winRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Best & Worst Calls */}
          <div className="grid md:grid-cols-2 gap-4">
            {data.bestCalls.length > 0 && (
              <div className="bg-card border border-green-500/20 rounded-lg p-4">
                <h3 className="text-sm font-bold text-green-400 mb-3 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" /> Best Calls (30-Day)
                </h3>
                {data.bestCalls.map((c, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-card-border/30 last:border-0">
                    <div>
                      <span className="font-mono font-bold text-xs text-foreground">{c.ticker}</span>
                      <span className="text-[10px] text-muted-foreground ml-2">{c.date}</span>
                    </div>
                    <span className="font-mono font-bold text-xs text-green-400">+{c.return30d?.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            )}
            {data.worstCalls.length > 0 && (
              <div className="bg-card border border-red-500/20 rounded-lg p-4">
                <h3 className="text-sm font-bold text-red-400 mb-3 flex items-center gap-2">
                  <XCircle className="h-4 w-4" /> Worst Calls (30-Day)
                </h3>
                {data.worstCalls.map((c, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-card-border/30 last:border-0">
                    <div>
                      <span className="font-mono font-bold text-xs text-foreground">{c.ticker}</span>
                      <span className="text-[10px] text-muted-foreground ml-2">{c.date}</span>
                    </div>
                    <span className="font-mono font-bold text-xs text-red-400">{c.return30d?.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Signals */}
          <div className="bg-card border border-card-border rounded-lg p-4">
            <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" /> Recent Signals
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-card-border text-muted-foreground">
                    <th className="text-left py-2 px-2 font-semibold">Date</th>
                    <th className="text-left py-2 px-2 font-semibold">Ticker</th>
                    <th className="text-center py-2 px-2 font-semibold">Signal</th>
                    <th className="text-right py-2 px-2 font-semibold">Score</th>
                    <th className="text-right py-2 px-2 font-semibold">Price</th>
                    <th className="text-right py-2 px-2 font-semibold">7d</th>
                    <th className="text-right py-2 px-2 font-semibold">30d</th>
                    <th className="text-right py-2 px-2 font-semibold">90d</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentSignals.map((s, i) => (
                    <tr key={i} className="border-b border-card-border/30 hover:bg-muted/20">
                      <td className="py-2 px-2 text-muted-foreground font-mono">{s.date.substring(5)}</td>
                      <td className="py-2 px-2 font-mono font-bold text-foreground">{s.ticker}</td>
                      <td className="py-2 px-2 text-center">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${signalBg(s.signal)} ${signalColor(s.signal)}`}>
                          {s.signal.replace("_", " ")}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-foreground">{s.score}</td>
                      <td className="py-2 px-2 text-right font-mono text-foreground">${s.price?.toFixed(2)}</td>
                      <td className={`py-2 px-2 text-right font-mono font-bold ${retColor(s.return7d)}`}>
                        {s.return7d != null ? `${s.return7d >= 0 ? "+" : ""}${s.return7d}%` : "—"}
                      </td>
                      <td className={`py-2 px-2 text-right font-mono font-bold ${retColor(s.return30d)}`}>
                        {s.return30d != null ? `${s.return30d >= 0 ? "+" : ""}${s.return30d}%` : "—"}
                      </td>
                      <td className={`py-2 px-2 text-right font-mono font-bold ${retColor(s.return90d)}`}>
                        {s.return90d != null ? `${s.return90d >= 0 ? "+" : ""}${s.return90d}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Methodology */}
          <div className="bg-muted/20 border border-card-border/50 rounded-lg p-4 text-xs text-muted-foreground space-y-2">
            <h4 className="font-bold text-foreground mb-1">Methodology</h4>
            <p>Stock Otter's Track Record logs every technical signal (VER, AMC, BBTC) generated daily on a universe of 25 dynamically screened stocks plus SPY/QQQ/IWM benchmarks.</p>
            <p>Forward returns are measured at 7, 30, and 90 calendar days from signal date. "Win" means: Buy signals resulted in positive returns, Sell signals in negative returns.</p>
            <p>Alpha is calculated as the average return of our Buy signals minus the average return of SPY over the same periods. All data is auditable and stored with timestamps.</p>
            <p className="text-muted-foreground/50 italic">Past performance does not guarantee future results. This track record is provided for transparency and educational purposes only.</p>
          </div>
        </>
      )}
      </>}
    </div>
  );
}

function StatCard({ label, value, icon, color, subtitle }: {
  label: string; value: string; icon: React.ReactNode; color: string; subtitle?: string;
}) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-3">
      <div className="flex items-center gap-1 mb-1">
        <span className={`${color} opacity-70`}>{icon}</span>
        <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <span className={`text-sm font-bold tabular-nums font-mono ${color}`}>{value}</span>
      {subtitle && <span className="block text-[9px] text-muted-foreground">{subtitle}</span>}
    </div>
  );
}
