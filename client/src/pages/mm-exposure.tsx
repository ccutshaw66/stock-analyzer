import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
  ComposedChart, Area,
} from "recharts";
import {
  Shield, AlertTriangle, Target, TrendingUp, TrendingDown,
  Loader2, Crosshair, Activity, Zap, Eye, ArrowUpRight,
  ArrowDownRight, Minus, BarChart3, Clock, Volume2,
} from "lucide-react";
import { HelpBlock, Example, ScoreRange } from "@/components/HelpBlock";
import { useTicker } from "@/contexts/TickerContext";
import { apiRequest } from "@/lib/queryClient";
import mascotUrl from "@/assets/mascot.jpg";
import InvalidSymbol, { isSymbolNotFound } from "@/components/InvalidSymbol";
import { Disclaimer } from "@/components/Disclaimer";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MMData {
  ticker: string;
  companyName: string;
  spot: number;
  callWall: { strike: number; callOI: number; callGEX: number } | null;
  putWall: { strike: number; putOI: number; putGEX: number } | null;
  gammaFlip: number | null;
  maxPain: number;
  totalGEX: number;
  regime: string;
  regimeLabel: string;
  regimeDesc: string;
  putCallRatioOI: number;
  putCallRatioVol: number;
  totalCallOI: number;
  totalPutOI: number;
  totalCallVol: number;
  totalPutVol: number;
  gexByStrike: {
    strike: number;
    callGEX: number;
    putGEX: number;
    netGEX: number;
    callOI: number;
    putOI: number;
    callVolume: number;
    putVolume: number;
  }[];
  unusualActivity: {
    type: string;
    strike: number;
    volume: number;
    openInterest: number;
    ratio: number;
    iv: number;
    expiry: string;
    bid: number;
    ask: number;
  }[];
  tradeIdeas: {
    strategy: string;
    reasoning: string;
    level: string;
    sentiment: string;
  }[];
  expirations: string[];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function MMExposure() {
  const { activeTicker } = useTicker();
  const [customTicker, setCustomTicker] = useState("");
  const [searchTicker, setSearchTicker] = useState<string | null>(null);

  const ticker = searchTicker || activeTicker;

  const { data, isLoading, error } = useQuery<MMData>({
    queryKey: ["/api/mm-exposure", ticker],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/mm-exposure/${ticker}`);
      return res.json();
    },
    enabled: !!ticker,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (customTicker.trim()) setSearchTicker(customTicker.trim().toUpperCase());
  };

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-5 max-w-[1200px] mx-auto" data-testid="mm-exposure-page">
      <div>
        <h1 className="text-lg font-bold text-foreground">Market Maker Exposure</h1>
        <p className="text-xs text-muted-foreground">
          Where they're hiding, where they're hedging, and how to trade alongside them.
        </p>
      <Disclaimer />
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex items-center gap-2">
        <input
          type="text"
          value={customTicker}
          onChange={e => setCustomTicker(e.target.value.toUpperCase())}
          placeholder={ticker || "Enter ticker..."}
          className="h-9 w-40 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary/50 focus:border-primary/50"
          data-testid="mm-ticker-input"
        />
        <button type="submit" disabled={!customTicker.trim() || isLoading}
          className="h-9 px-4 text-sm font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5">
          {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
          Scan
        </button>
      </form>

      {/* Help */}
      <HelpBlock title="Understanding Market Maker Exposure">
        <p><strong className="text-foreground">GEX (Gamma Exposure):</strong> Measures how much dealers must buy or sell to hedge for each 1% move. High GEX strikes act as magnets — price gets pinned there.</p>
        <p><strong className="text-foreground">Call Wall (Resistance):</strong> Strike with the highest call open interest. MMs sold these calls and will SELL stock to hedge as price approaches — creating a ceiling.</p>
        <p><strong className="text-foreground">Put Wall (Support):</strong> Strike with the highest put open interest. MMs sold these puts and will BUY stock to hedge as price drops — creating a floor.</p>
        <p><strong className="text-foreground">Gamma Flip:</strong> Price where dealer gamma switches from positive to negative. Above = MMs dampen moves (range-bound). Below = MMs amplify moves (volatile).</p>
        <p><strong className="text-foreground">Max Pain:</strong> Price where the most options expire worthless. MMs profit most here — price gravitates to this level into expiration.</p>
        <Example type="good">
          <strong className="text-green-400">Positive Gamma (Dealer Long):</strong> MMs buy dips, sell rallies. Tight range. Sell premium.
        </Example>
        <Example type="bad">
          <strong className="text-red-400">Negative Gamma (Dealer Short):</strong> MMs sell into drops, buy into rallies. Wild swings. Buy directional.
        </Example>
      </HelpBlock>

      {/* Loading */}
      {isLoading && ticker && (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">Scanning {ticker} options chain...</span>
            <span className="text-[10px] text-muted-foreground">Fetching 4 expirations, calculating GEX...</span>
          </div>
        </div>
      )}

      {/* Error / Upgrade Prompt */}
      {error && !isLoading && (() => {
        const msg = (error as any).message || "";
        const isUpgrade = msg.includes("403") || msg.includes("Upgrade") || msg.includes("upgrade") || msg.includes("Pro");
        if (isUpgrade) {
          return (
            <div className="flex flex-col items-center justify-center py-10 text-center bg-card border border-primary/20 rounded-xl">
              <img src={mascotUrl} alt="Stock Otter" className="h-40 w-auto mb-4 drop-shadow-lg" />
              <h3 className="text-lg font-bold text-foreground mb-2">Market Maker Exposure</h3>
              <p className="text-sm text-muted-foreground max-w-md mb-1">
                See where dealers are hiding — gamma exposure by strike, call/put walls, gamma flip level, max pain, and trade ideas based on real options flow.
              </p>
              <p className="text-xs text-muted-foreground/60 mb-5">
                Available on Pro and Elite plans.
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
          return <InvalidSymbol ticker={ticker} />;
        }
        return (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <span className="text-xs text-red-400">{msg.replace(/^\d+:\s*/, "").replace(/[{}"]*/g, "").replace(/error:/i, "").trim() || "Failed to load MM exposure data"}</span>
          </div>
        );
      })()}

      {/* No ticker */}
      {!ticker && !isLoading && (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-card border border-card-border rounded-lg">
          <Shield className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">Enter a symbol to expose market maker positioning</p>
          <p className="text-[11px] text-muted-foreground mt-1">Works best on optionable stocks with high open interest (SPY, QQQ, AAPL, TSLA, NVDA...)</p>
        </div>
      )}

      {/* Data loaded */}
      {data && !isLoading && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-foreground font-mono">{data.ticker}</h2>
              <p className="text-xs text-muted-foreground">{data.companyName} · ${data.spot.toFixed(2)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground">Expirations scanned</p>
              <p className="text-xs font-mono text-foreground">{data.expirations.join(", ")}</p>
            </div>
          </div>

          {/* Regime Banner */}
          <div className={`p-4 rounded-lg border ${data.regime === "POSITIVE_GAMMA"
            ? "bg-green-500/5 border-green-500/30"
            : "bg-red-500/5 border-red-500/30"
          }`} data-testid="regime-banner">
            <div className="flex items-center gap-2 mb-2">
              {data.regime === "POSITIVE_GAMMA"
                ? <Shield className="h-5 w-5 text-green-400" />
                : <Zap className="h-5 w-5 text-red-400" />
              }
              <span className={`text-sm font-bold ${data.regime === "POSITIVE_GAMMA" ? "text-green-400" : "text-red-400"}`}>
                {data.regimeLabel}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{data.regimeDesc}</p>
          </div>

          {/* Key Levels Grid */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="key-levels">
            <LevelCard
              label="Call Wall"
              value={data.callWall ? `$${data.callWall.strike}` : "N/A"}
              subtitle={data.callWall ? `${data.callWall.callOI.toLocaleString()} OI` : ""}
              icon={<TrendingDown className="h-3.5 w-3.5" />}
              color="text-red-400"
              hint="Resistance"
            />
            <LevelCard
              label="Put Wall"
              value={data.putWall ? `$${data.putWall.strike}` : "N/A"}
              subtitle={data.putWall ? `${data.putWall.putOI.toLocaleString()} OI` : ""}
              icon={<TrendingUp className="h-3.5 w-3.5" />}
              color="text-green-400"
              hint="Support"
            />
            <LevelCard
              label="Gamma Flip"
              value={data.gammaFlip ? `$${data.gammaFlip.toFixed(2)}` : "N/A"}
              subtitle={data.gammaFlip ? (data.spot > data.gammaFlip ? "Spot ABOVE" : "Spot BELOW") : ""}
              icon={<Activity className="h-3.5 w-3.5" />}
              color="text-yellow-400"
              hint="Regime boundary"
            />
            <LevelCard
              label="Max Pain"
              value={`$${data.maxPain}`}
              subtitle={data.spot > data.maxPain ? `Spot $${(data.spot - data.maxPain).toFixed(0)} above` : `Spot $${(data.maxPain - data.spot).toFixed(0)} below`}
              icon={<Target className="h-3.5 w-3.5" />}
              color="text-primary"
              hint="Expiry magnet"
            />
            <LevelCard
              label="P/C Ratio (OI)"
              value={data.putCallRatioOI.toFixed(2)}
              subtitle={data.putCallRatioOI > 1.2 ? "Bearish positioning" : data.putCallRatioOI < 0.8 ? "Bullish positioning" : "Neutral"}
              icon={<BarChart3 className="h-3.5 w-3.5" />}
              color={data.putCallRatioOI > 1.2 ? "text-red-400" : data.putCallRatioOI < 0.8 ? "text-green-400" : "text-foreground"}
              hint="Put/Call"
            />
          </div>

          {/* GEX Chart */}
          <div className="bg-card border border-card-border rounded-lg p-4" data-testid="gex-chart">
            <h3 className="text-sm font-bold text-foreground mb-1">Gamma Exposure by Strike</h3>
            <p className="text-[10px] text-muted-foreground mb-3">Green = Call GEX (resistance above). Red = Put GEX (support below). Net GEX shown as line.</p>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.gexByStrike} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <XAxis
                    dataKey="strike"
                    tick={{ fontSize: 10, fill: "#888" }}
                    tickFormatter={(v: number) => `$${v}`}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fontSize: 10, fill: "#888" }} tickFormatter={(v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(0)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : `${v}`} />
                  <Tooltip
                    contentStyle={{ background: "#0a1628", border: "1px solid #1e293b", borderRadius: 8, fontSize: 11 }}
                    labelFormatter={(v: number) => `Strike: $${v}`}
                    formatter={(value: number, name: string) => {
                      const label = name === "callGEX" ? "Call GEX" : name === "putGEX" ? "Put GEX" : "Net GEX";
                      return [`$${Math.abs(value).toLocaleString()}`, label];
                    }}
                  />
                  <ReferenceLine x={data.spot} stroke="#6366f1" strokeDasharray="3 3" label={{ value: `Spot $${data.spot.toFixed(0)}`, fill: "#6366f1", fontSize: 10, position: "top" }} />
                  {data.callWall && <ReferenceLine x={data.callWall.strike} stroke="#ef4444" strokeDasharray="3 3" label={{ value: "Call Wall", fill: "#ef4444", fontSize: 9, position: "top" }} />}
                  {data.putWall && <ReferenceLine x={data.putWall.strike} stroke="#22c55e" strokeDasharray="3 3" label={{ value: "Put Wall", fill: "#22c55e", fontSize: 9, position: "top" }} />}
                  {data.gammaFlip && <ReferenceLine x={data.gammaFlip} stroke="#eab308" strokeDasharray="5 3" label={{ value: "Flip", fill: "#eab308", fontSize: 9, position: "insideTopRight" }} />}
                  <Bar dataKey="callGEX" fill="#22c55e" opacity={0.6} />
                  <Bar dataKey="putGEX" fill="#ef4444" opacity={0.6} />
                  <Area type="monotone" dataKey="netGEX" stroke="#6366f1" fill="none" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* OI Chart */}
          <div className="bg-card border border-card-border rounded-lg p-4" data-testid="oi-chart">
            <h3 className="text-sm font-bold text-foreground mb-1">Open Interest by Strike</h3>
            <p className="text-[10px] text-muted-foreground mb-3">Where the positions are. Tall bars = heavily defended levels.</p>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.gexByStrike} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <XAxis dataKey="strike" tick={{ fontSize: 10, fill: "#888" }} tickFormatter={(v: number) => `$${v}`} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: "#888" }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : `${v}`} />
                  <Tooltip
                    contentStyle={{ background: "#0a1628", border: "1px solid #1e293b", borderRadius: 8, fontSize: 11 }}
                    labelFormatter={(v: number) => `Strike: $${v}`}
                    formatter={(value: number, name: string) => [value.toLocaleString(), name === "callOI" ? "Call OI" : "Put OI"]}
                  />
                  <ReferenceLine x={data.spot} stroke="#6366f1" strokeDasharray="3 3" />
                  <ReferenceLine x={data.maxPain} stroke="#a855f7" strokeDasharray="3 3" label={{ value: "Max Pain", fill: "#a855f7", fontSize: 9, position: "top" }} />
                  <Bar dataKey="callOI" fill="#22c55e" opacity={0.5} />
                  <Bar dataKey="putOI" fill="#ef4444" opacity={0.5} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Trade Ideas */}
          <div className="bg-card border border-card-border rounded-lg p-4" data-testid="trade-ideas">
            <div className="flex items-center gap-2 mb-3">
              <Crosshair className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold text-foreground">Where to Hide — Trade Ideas</h3>
            </div>
            <div className="space-y-3">
              {data.tradeIdeas.map((idea, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-muted/20 border border-card-border/50 rounded-lg">
                  <div className={`shrink-0 mt-0.5 ${idea.sentiment === "Bullish" ? "text-green-400" : idea.sentiment === "Bearish" ? "text-red-400" : "text-yellow-400"}`}>
                    {idea.sentiment === "Bullish" ? <ArrowUpRight className="h-4 w-4" /> : idea.sentiment === "Bearish" ? <ArrowDownRight className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-bold text-foreground">{idea.strategy}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                        idea.sentiment === "Bullish" ? "bg-green-500/15 text-green-400" :
                        idea.sentiment === "Bearish" ? "bg-red-500/15 text-red-400" :
                        "bg-yellow-500/15 text-yellow-400"
                      }`}>{idea.sentiment}</span>
                      <span className="text-[10px] font-mono text-primary">{idea.level}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{idea.reasoning}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Unusual Activity */}
          {data.unusualActivity.length > 0 && (
            <div className="bg-card border border-card-border rounded-lg p-4" data-testid="unusual-activity">
              <div className="flex items-center gap-2 mb-3">
                <Volume2 className="h-4 w-4 text-yellow-400" />
                <h3 className="text-sm font-bold text-foreground">Unusual Options Activity</h3>
                <span className="text-[10px] text-muted-foreground">Volume/OI ratio &gt; 2.0 = fresh positioning</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-card-border text-muted-foreground">
                      <th className="text-left py-2 px-2 font-semibold">Type</th>
                      <th className="text-right py-2 px-2 font-semibold">Strike</th>
                      <th className="text-right py-2 px-2 font-semibold">Volume</th>
                      <th className="text-right py-2 px-2 font-semibold">OI</th>
                      <th className="text-right py-2 px-2 font-semibold">V/OI</th>
                      <th className="text-right py-2 px-2 font-semibold hidden sm:table-cell">IV</th>
                      <th className="text-right py-2 px-2 font-semibold hidden sm:table-cell">Bid/Ask</th>
                      <th className="text-left py-2 px-2 font-semibold hidden md:table-cell">Expiry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.unusualActivity.map((u, i) => (
                      <tr key={i} className="border-b border-card-border/30 hover:bg-muted/30">
                        <td className="py-2 px-2">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${u.type === "CALL" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                            {u.type}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right font-mono font-bold text-foreground">${u.strike}</td>
                        <td className="py-2 px-2 text-right font-mono text-yellow-400 font-bold">{u.volume.toLocaleString()}</td>
                        <td className="py-2 px-2 text-right font-mono text-foreground">{u.openInterest.toLocaleString()}</td>
                        <td className="py-2 px-2 text-right font-mono font-bold text-yellow-400">{u.ratio}x</td>
                        <td className="py-2 px-2 text-right font-mono text-muted-foreground hidden sm:table-cell">{u.iv}%</td>
                        <td className="py-2 px-2 text-right font-mono text-muted-foreground hidden sm:table-cell">${u.bid}/{u.ask}</td>
                        <td className="py-2 px-2 font-mono text-muted-foreground hidden md:table-cell">{u.expiry}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Stats Footer */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Call OI" value={data.totalCallOI.toLocaleString()} color="text-green-400" />
            <StatCard label="Total Put OI" value={data.totalPutOI.toLocaleString()} color="text-red-400" />
            <StatCard label="Call Volume" value={data.totalCallVol.toLocaleString()} color="text-green-400" />
            <StatCard label="Put Volume" value={data.totalPutVol.toLocaleString()} color="text-red-400" />
          </div>
        </>
      )}
    </div>
  );
}

// ─── Components ───────────────────────────────────────────────────────────────

function LevelCard({ label, value, subtitle, icon, color, hint }: {
  label: string; value: string; subtitle: string; icon: React.ReactNode; color: string; hint: string;
}) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-3">
      <div className="flex items-center gap-1 mb-1">
        <span className={`${color} opacity-70`}>{icon}</span>
        <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <span className={`text-sm font-bold tabular-nums font-mono ${color}`}>{value}</span>
      <span className="block text-[9px] text-muted-foreground">{subtitle || hint}</span>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-muted/20 border border-card-border/50 rounded-lg p-2.5">
      <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider block mb-0.5">{label}</span>
      <span className={`text-xs font-bold tabular-nums font-mono ${color}`}>{value}</span>
    </div>
  );
}
