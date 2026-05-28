import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTickerNavigate } from "@/lib/useTickerNavigate";
import { useTimeframe } from "@/contexts/TimeframeContext";
import {
  Radar, Search, TrendingUp, TrendingDown, Minus,
  Activity, BarChart3, Volume2, Zap, ChevronDown, ChevronUp,
  SlidersHorizontal, Eye, EyeOff, Flame
} from "lucide-react";
import { IndicatorOscillator } from "@/components/IndicatorOscillator";
import { PageTemplate } from "@/components/PageTemplate";

const SECTORS = [
  "All Sectors", "Technology", "Healthcare", "Financial Services",
  "Consumer Cyclical", "Communication Services", "Industrials",
  "Consumer Defensive", "Energy", "Real Estate", "Utilities", "Basic Materials"
];
const MARKET_CAP_TIERS = [
  { value: "all", label: "All Caps" },
  { value: "mega", label: "Mega ($200B+)" },
  { value: "large", label: "Large ($10B-$200B)" },
  { value: "mid", label: "Mid ($2B-$10B)" },
  { value: "small", label: "Small ($300M-$2B)" },
];
const PRICE_RANGES = [
  { value: "all", label: "Any Price", min: 5, max: 10000 },
  { value: "penny", label: "Under $10", min: 1, max: 10 },
  { value: "low", label: "$10 - $50", min: 10, max: 50 },
  { value: "mid", label: "$50 - $150", min: 50, max: 150 },
  { value: "high", label: "$150 - $500", min: 150, max: 500 },
  { value: "premium", label: "$500+", min: 500, max: 10000 },
];

// ─── Shared Components ───

function SignalBadge({ signal, size = "sm" }: { signal: string; size?: "sm" | "md" }) {
  const base = size === "md" ? "px-3 py-1.5 text-sm" : "px-2 py-0.5 text-2xs";
  const s = (signal || "").toUpperCase();
  const isUp = /↑/.test(signal) || /_UP$|_BUY$|BULL/.test(s);
  const isDown = /↓/.test(signal) || /_DOWN$|_SELL$|BEAR/.test(s);
  const isGo = s.startsWith("GO");
  const isSet = s.startsWith("SET");
  const isReady = s.startsWith("READY");
  const isPullback = s.startsWith("PULLBACK");
  const isClosed = s.includes("CLOSED") || s.includes("NO SETUP") || s === "NONE";

  let color = "bg-muted text-muted-foreground";
  if (isGo && isUp) color = "bg-bull text-white";
  else if (isGo && isDown) color = "bg-bear text-white";
  else if (isSet && isUp) color = "bg-bull/70 text-white";
  else if (isSet && isDown) color = "bg-bear/70 text-white";
  else if (isReady && isUp) color = "bg-bull/30 text-bull-light border border-bull/40";
  else if (isReady && isDown) color = "bg-bear/30 text-bear-light border border-bear/40";
  else if (isPullback) color = "bg-amber-500/30 text-amber-300 border border-amber-500/40";
  else if (isClosed) color = "bg-zinc-700 text-zinc-400";
  else if (["ENTER", "CONFIRMED_BUY", "LEAN_BUY"].includes(s))
    color = s === "CONFIRMED_BUY" ? "bg-bull text-white" : s === "LEAN_BUY" ? "bg-bull/20 text-bull-light" : "bg-bull/80 text-white";
  else if (["SELL", "CONFIRMED_SELL", "LEAN_SELL"].includes(s))
    color = s === "CONFIRMED_SELL" ? "bg-bear text-white" : s === "LEAN_SELL" ? "bg-bear/20 text-bear-light" : "bg-bear/80 text-white";
  else if (["HOLD", "NEUTRAL"].includes(s)) color = "bg-watch/20 text-watch-light";

  return <span className={`${base} ${color} font-bold rounded-md uppercase whitespace-nowrap`}>{(signal || "—").replace(/_/g, " ")}</span>;
}

function ScoreBar({ score, max = 7 }: { score: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, ((score + max) / (max * 2)) * 100));
  const color = score >= max * 0.7 ? "bg-bull" : score >= max * 0.4 ? "bg-bull-light" : score >= max * 0.25 ? "bg-watch-light" : score >= 0 ? "bg-watch/50" : "bg-bear-light";
  return (
    <div className="flex items-center gap-2">
      <span className={`text-sm font-bold tabular-nums w-10 text-right ${score >= max * 0.4 ? "text-bull-light" : score >= 0 ? "text-watch-light" : "text-bear-light"}`}>{score}/{max}</span>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden max-w-[80px]">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ConfirmationDetail({ c }: { c: any }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-card-border/50">
      <div className="flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">MACD:</span>
        <span className={`text-xs font-semibold ${c.macd === "bullish" ? "text-bull-light" : c.macd === "bearish" ? "text-bear-light" : "text-muted-foreground"}`}>{c.macd}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">BB:</span>
        <span className={`text-xs font-semibold ${c.bollingerPosition === "near_lower" ? "text-bull-light" : c.bollingerPosition === "near_upper" ? "text-bear-light" : "text-muted-foreground"}`}>{c.bollingerPosition?.replace(/_/g, " ")}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Vol:</span>
        <span className={`text-xs font-semibold ${c.volumeSurge ? "text-bull-light" : "text-muted-foreground"}`}>{c.volumeSurge ? "Surge" : "Normal"}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Zap className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">ADX:</span>
        <span className={`text-xs font-semibold ${c.adxTrending ? "text-bull-light" : "text-muted-foreground"}`}>{c.adx ?? "N/A"} {c.adxTrending ? "↑" : ""}</span>
      </div>
    </div>
  );
}

// ─── 3-Strategy Result Card ───

function GatePips({ gatesCleared }: { gatesCleared: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3].map((g) => (
        <div key={g} className={`h-1.5 w-4 rounded-full ${
          g <= gatesCleared
            ? g === 3 ? "bg-bull" : g === 2 ? "bg-blue-500" : "bg-amber-500"
            : "bg-muted-foreground/15"
        }`} />
      ))}
    </div>
  );
}

function ThreeStrategyCard({ result, rank, onClick, onAnalyze }: { result: any; rank: number; onClick: () => void; onAnalyze?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const g = result.gates;
  // Use gate signal directly
  const label = g?.signal || "NO SETUP";
  const labelColor = label.startsWith("GO") ? "bg-bull text-white"
    : label.startsWith("SET") ? "bg-blue-500 text-white"
    : label.startsWith("READY") ? "bg-amber-500 text-white"
    : label.startsWith("PULLBACK") ? "bg-orange-500 text-white"
    : label.startsWith("GATES CLOSED") ? "bg-bear text-white"
    : "bg-zinc-500/20 text-zinc-400";

  const borderClass = label.startsWith("GO") ? "border-bull/40"
    : label.startsWith("SET") ? "border-blue-500/40"
    : label.startsWith("READY") ? "border-amber-500/30"
    : label.startsWith("PULLBACK") ? "border-orange-500/40"
    : label.startsWith("GATES CLOSED") ? "border-bear/40"
    : "border-card-border";

  return (
    <div className={`bg-card border ${borderClass} rounded-lg p-4 hover:border-primary/30 transition-colors`} data-testid={`scanner-result-${result.ticker}`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold text-muted-foreground/40 tabular-nums w-8">{rank}</span>
          <div>
            <div className="flex items-center gap-2">
              <span onClick={onClick} title="Load in Signal Pulse" className="font-mono font-bold text-base text-foreground hover:text-primary cursor-pointer transition-colors">{result.ticker}</span>
              <span className="text-sm tabular-nums text-muted-foreground">${result.price.toFixed(2)}</span>
              {onAnalyze && (
                <button onClick={onAnalyze} className="text-micro px-2 py-0.5 rounded bg-primary/20 text-primary hover:bg-primary/30 font-semibold">Analyze →</button>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {result.bbtc.trend === "UP" ? <TrendingUp className="h-3 w-3 text-bull" /> : result.bbtc.trend === "DOWN" ? <TrendingDown className="h-3 w-3 text-bear" /> : <Minus className="h-3 w-3 text-watch" />}
              <span className="text-micro text-muted-foreground">{result.bbtc.trend} · {result.bbtc.bias}</span>
              {result.ver.rsi !== null && <span className={`text-micro ml-1 ${result.ver.rsi < 30 ? "text-bull-light" : result.ver.rsi > 70 ? "text-bear-light" : "text-muted-foreground"}`}>· RSI {result.ver.rsi}</span>}
            </div>
          </div>
        </div>
        <span className={`${labelColor} px-3 py-1 text-xs font-bold rounded-md uppercase`}>{label}</span>
      </div>

      {/* Gate Pipeline Bar */}
      {g && (
        <div className="flex items-center gap-2 mb-3">
          <GatePips gatesCleared={g.gatesCleared} />
          <span className={`text-micro font-semibold tracking-wider ${
            label.startsWith("GO") ? "text-bull-light" :
            label.startsWith("SET") ? "text-blue-400" :
            label.startsWith("READY") ? "text-amber-400" :
            label.startsWith("GATES") ? "text-bear-light" :
            "text-muted-foreground/40"
          }`}>
            {g.summary}
          </span>
        </div>
      )}

      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-center gap-1 mt-1 pt-2 border-t border-card-border/30 text-xs text-muted-foreground hover:text-foreground transition-colors">
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {expanded ? "Hide" : "Show"} details
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex flex-col items-center gap-0.5"><SignalBadge signal={result.ver.signal} /><span className="text-mini text-muted-foreground">VER</span></div>
            <div className="flex flex-col items-center gap-0.5"><SignalBadge signal={result.bbtc.signal} /><span className="text-mini text-muted-foreground">BBTC</span></div>
            <div className="flex flex-col items-center gap-0.5"><SignalBadge signal={result.confirmation.signal} /><span className="text-mini text-muted-foreground">Confirm</span></div>
            <div className="ml-auto"><ScoreBar score={result.score} max={7} /></div>
          </div>
          <ConfirmationDetail c={result.confirmation} />
          <div className="bg-background/40 rounded p-2">
            <IndicatorOscillator ticker={result.ticker} bars={60} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AMC Result Card ───

function AMCCard({ result, rank, onClick, onAnalyze }: { result: any; rank: number; onClick: () => void; onAnalyze?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const labelColor = result.amcScore >= 5 ? "bg-bull text-white" : result.amcScore >= 4 ? "bg-bull/70 text-white" : result.amcScore >= 3 ? "bg-watch-light/80 text-black" : "bg-muted text-muted-foreground";
  const labelText = result.label || (result.amcScore >= 2 ? "AMC WATCH" : "AMC LOW");
  return (
    <div className="bg-card border border-card-border rounded-lg p-4 hover:border-purple-500/30 transition-colors" data-testid={`amc-result-${result.ticker}`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold text-muted-foreground/40 tabular-nums w-8">{rank}</span>
          <div>
            <div className="flex items-center gap-2">
              <span onClick={onClick} title="Load in Signal Pulse" className="font-mono font-bold text-base text-foreground hover:text-primary cursor-pointer transition-colors">{result.ticker}</span>
              <span className="text-sm tabular-nums text-muted-foreground">${result.price.toFixed(2)}</span>
              <SignalBadge signal={result.signal} />
              {onAnalyze && (
                <button onClick={onAnalyze} className="text-micro px-2 py-0.5 rounded bg-primary/20 text-primary hover:bg-primary/30 font-semibold">Analyze →</button>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {result.trend === "UP" ? <TrendingUp className="h-3 w-3 text-bull" /> : result.trend === "DOWN" ? <TrendingDown className="h-3 w-3 text-bear" /> : <Minus className="h-3 w-3 text-watch" />}
              <span className="text-micro text-muted-foreground">{result.trend}</span>
              {result.mode !== "flat" && <span className={`text-micro ${result.mode === "momentum" ? "text-bull-light" : "text-cyan-400"}`}>· {result.mode}</span>}
              {result.rsi !== null && <span className={`text-micro ${result.rsi < 30 ? "text-bull-light" : result.rsi > 70 ? "text-bear-light" : "text-muted-foreground"}`}>· RSI {result.rsi}</span>}
            </div>
          </div>
        </div>
        <span className={`${labelColor} px-3 py-1 text-xs font-bold rounded-md uppercase`}>{labelText}</span>
      </div>

      {/* Score bar + VAMI */}
      <div className="flex items-center gap-4">
        <ScoreBar score={result.amcScore} max={5} />
        <div className="flex items-center gap-1.5 ml-auto">
          <Zap className={`h-3 w-3 ${result.vami > 0 ? "text-bull-light" : result.vami < 0 ? "text-bear-light" : "text-muted-foreground"}`} />
          <span className={`text-xs font-bold tabular-nums ${result.vami > 0 ? "text-bull-light" : result.vami < 0 ? "text-bear-light" : "text-muted-foreground"}`}>
            VAMI {result.vami > 0 ? "+" : ""}{result.vami}
          </span>
        </div>
      </div>

      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-center gap-1 mt-3 pt-2 border-t border-card-border/30 text-xs text-muted-foreground hover:text-foreground transition-colors">
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {expanded ? "Hide" : "Show"} details
      </button>
      {expanded && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-3 pt-3 border-t border-card-border/50">
          <div className="text-center">
            <p className="text-mini text-muted-foreground uppercase">MACD</p>
            <p className={`text-xs font-bold ${result.macd === "bullish" ? "text-bull-light" : "text-bear-light"}`}>{result.macd} {result.macdAccel ? "↑" : ""}</p>
          </div>
          <div className="text-center">
            <p className="text-mini text-muted-foreground uppercase">RSI</p>
            <p className={`text-xs font-bold tabular-nums ${result.rsi >= 45 && result.rsi <= 65 ? "text-bull-light" : result.rsi < 30 ? "text-cyan-400" : result.rsi > 70 ? "text-bear-light" : "text-muted-foreground"}`}>{result.rsi ?? "N/A"}</p>
          </div>
          <div className="text-center">
            <p className="text-mini text-muted-foreground uppercase">VAMI</p>
            <p className={`text-xs font-bold tabular-nums ${result.vami > 0 ? "text-bull-light" : "text-bear-light"}`}>{result.vami}</p>
          </div>
          <div className="text-center">
            <p className="text-mini text-muted-foreground uppercase">Trend</p>
            <p className={`text-xs font-bold ${result.trend === "UP" ? "text-bull-light" : result.trend === "DOWN" ? "text-bear-light" : "text-watch-light"}`}>{result.trend}</p>
          </div>
          <div className="text-center">
            <p className="text-mini text-muted-foreground uppercase">Close</p>
            <p className={`text-xs font-bold ${result.greenClose ? "text-bull-light" : "text-bear-light"}`}>{result.greenClose ? "Green ↑" : "Red ↓"}</p>
          </div>
          <div className="col-span-2 sm:col-span-5 bg-background/40 rounded p-2 mt-1">
            <IndicatorOscillator ticker={result.ticker} bars={60} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Scanner 2.0 Explosion Card ───

function ExplosionCard({ result, rank, onClick, onAnalyze }: { result: any; rank: number; onClick: () => void; onAnalyze?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const score = result.score ?? 0;
  const direction = result.direction ?? "either";
  const triggered = (result.signals ?? []).filter((s: any) => s.triggered);

  const dirStyle =
    direction === "up" ? "bg-bull/20 text-bull-light border-bull/40"
    : direction === "down" ? "bg-bear/20 text-bear-light border-bear/40"
    : "bg-zinc-500/20 text-zinc-400 border-zinc-500/40";

  const scoreColor =
    score >= 30 ? "bg-fuchsia-500 text-white"
    : score >= 20 ? "bg-fuchsia-500/80 text-white"
    : score >= 10 ? "bg-fuchsia-500/50 text-white"
    : "bg-muted text-muted-foreground";

  const borderClass =
    score >= 30 ? "border-fuchsia-500/50"
    : score >= 15 ? "border-fuchsia-500/30"
    : "border-card-border";

  return (
    <div className={`bg-card border ${borderClass} rounded-lg p-4 hover:border-fuchsia-400/60 transition-colors`}>
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 flex-shrink-0 rounded-full bg-fuchsia-500/10 text-fuchsia-400 font-bold text-sm flex items-center justify-center">
          {rank}
        </div>
        <button onClick={onClick} title="Load in Signal Pulse" className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-bold text-foreground tracking-tight">{result.symbol}</span>
            <span className={`text-micro font-bold rounded px-1.5 py-0.5 uppercase border ${dirStyle}`}>
              {direction === "up" ? "↑ UP" : direction === "down" ? "↓ DOWN" : "↔ EITHER"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {result.companyName} · {result.sector || "—"}
          </p>
        </button>
        {onAnalyze && (
          <button onClick={onAnalyze} className="text-micro px-2 py-0.5 rounded bg-primary/20 text-primary hover:bg-primary/30 font-semibold flex-shrink-0">Analyze →</button>
        )}
        <div className="text-right flex-shrink-0">
          <span className={`text-xs font-bold rounded px-2 py-1 ${scoreColor}`}>{score}</span>
          <p className="text-micro text-muted-foreground mt-0.5">score</p>
        </div>
        <button onClick={() => setExpanded(!expanded)} className="flex-shrink-0 text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Signal chips — always show triggered ones compactly */}
      {triggered.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {triggered.map((s: any) => {
            const chipColor =
              s.direction === "up" ? "bg-bull/15 text-bull-light border-bull/30"
              : s.direction === "down" ? "bg-bear/15 text-bear-light border-bear/30"
              : "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
            return (
              <span key={s.id} className={`text-micro font-semibold rounded px-1.5 py-0.5 border ${chipColor}`} title={s.detail || ""}>
                {s.label} · {(s.strength ?? 0).toFixed(2)}
              </span>
            );
          })}
        </div>
      )}

      {expanded && (
        <div className="mt-3 pt-3 border-t border-card-border/50 space-y-2">
          {/* Indicator oscillator (MACD histogram + RSI) */}
          <div className="bg-background/40 rounded p-2">
            <IndicatorOscillator ticker={result.symbol} bars={60} />
          </div>
          {(result.signals ?? []).map((s: any) => (
            <div key={s.id} className="flex items-center gap-2 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.triggered ? "bg-fuchsia-400" : "bg-muted-foreground/40"}`} />
              <span className={`font-medium w-32 ${s.triggered ? "text-foreground" : "text-muted-foreground"}`}>{s.label}</span>
              <span className="text-muted-foreground flex-1 truncate">{s.detail || "—"}</span>
              {s.triggered && (
                <span className="text-micro tabular-nums text-muted-foreground">{s.strength.toFixed(2)}</span>
              )}
            </div>
          ))}
          <div className="flex items-center gap-4 mt-2 pt-2 border-t border-card-border/30 text-micro text-muted-foreground">
            <span>Price ${result.price?.toFixed(2)}</span>
            <span>Vol {result.volume?.toLocaleString?.()}</span>
            <span>Mkt Cap ${((result.marketCap ?? 0) / 1e9).toFixed(1)}B</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Scanner ───

export default function Scanner() {
  const tickerNavigate = useTickerNavigate();
  const { timeframe } = useTimeframe();
  const [scanMode, setScanMode] = useState<"3strategy" | "amc" | "v2">("3strategy");
  const [sector, setSector] = useState("All Sectors");
  const [priceRange, setPriceRange] = useState("all");
  const [marketCap, setMarketCap] = useState("all");
  const [showAll, setShowAll] = useState(true);
  const [scanCount, setScanCount] = useState(250);
  const [v2UniverseSize, setV2UniverseSize] = useState(2000);
  const [signalFilter, setSignalFilter] = useState<"both" | "buy" | "sell">("both");
  const [filtersOpen, setFiltersOpen] = useState(true);

  const priceConfig = PRICE_RANGES.find(p => p.value === priceRange) || PRICE_RANGES[0];
  const queryParams = new URLSearchParams({
    minPrice: String(priceConfig.min), maxPrice: String(priceConfig.max),
    sector: sector === "All Sectors" ? "all" : sector,
    marketCap, count: String(scanCount), showAll: String(showAll),
    direction: signalFilter,
    timeframe,
  }).toString();

  // Scan results persisted via queryClient cache + sessionStorage backup.
  // queryClient alone wasn't surviving component unmount reliably (manual
  // setQueryData without a useQuery observer can drop on remount). Session-
  // Storage acts as a belt-and-suspenders fallback. Cache key includes
  // timeframe so flipping the picker shows the right cached entry.
  const ssKey = (mode: string) => `scanner-cache:${mode}:${timeframe}`;
  const ssGet = (mode: string): any => {
    try {
      const raw = sessionStorage.getItem(ssKey(mode));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const ssSet = (mode: string, value: any) => {
    try {
      sessionStorage.setItem(ssKey(mode), JSON.stringify(value));
    } catch {
      // sessionStorage may throw on quota; non-fatal — queryClient still has it.
    }
  };
  const readCached = (mode: string, qcKey: string) =>
    queryClient.getQueryData([qcKey, timeframe]) || ssGet(mode) || null;

  const [threeStratData, setThreeStratData] = useState<any>(() => readCached("3strat", "/api/scanner/3strat"));
  const [amcData, setAmcData] = useState<any>(() => readCached("amc", "/api/scanner/amc"));
  const [v2Data, setV2Data] = useState<any>(() => readCached("v2", "/api/scanner/v2"));
  const [v2Direction, setV2Direction] = useState<"either" | "up" | "down">("either");
  const [v2MinScore, setV2MinScore] = useState<number>(10);
  const [isFetching, setIsFetching] = useState(false);

  // When the user flips the timeframe picker, swap displayed scan results
  // for the cached entry under the new timeframe (or clear if none cached yet).
  useEffect(() => {
    setThreeStratData(readCached("3strat", "/api/scanner/3strat"));
    setAmcData(readCached("amc", "/api/scanner/amc"));
    setV2Data(readCached("v2", "/api/scanner/v2"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe]);

  const data = scanMode === "amc" ? amcData : scanMode === "v2" ? v2Data : threeStratData;

  const refetch = async () => {
    setIsFetching(true);
    try {
      let endpoint: string;
      if (scanMode === "amc") {
        endpoint = `/api/scanner/amc?${queryParams}`;
      } else if (scanMode === "v2") {
        // Scanner 2.0: use sector + marketCap + direction + minScore; fixed 2000 universe
        const v2Params = new URLSearchParams({
          sector: sector === "All Sectors" ? "all" : sector,
          marketCap,
          direction: v2Direction,
          minScore: String(v2MinScore),
          universeSize: String(v2UniverseSize),
          count: "100",
        }).toString();
        endpoint = `/api/scanner/v2?${v2Params}`;
      } else {
        endpoint = `/api/scanner?${queryParams}`;
      }
      const res = await apiRequest("GET", endpoint);
      const result = await res.json();
      if (scanMode === "amc") {
        setAmcData(result);
        queryClient.setQueryData(["/api/scanner/amc", timeframe], result);
        ssSet("amc", result);
      } else if (scanMode === "v2") {
        setV2Data(result);
        queryClient.setQueryData(["/api/scanner/v2", timeframe], result);
        ssSet("v2", result);
      } else {
        setThreeStratData(result);
        queryClient.setQueryData(["/api/scanner/3strat", timeframe], result);
        ssSet("3strat", result);
      }
    } catch (err: any) {
      console.error("Scanner fetch failed:", err);
    } finally {
      setIsFetching(false);
    }
  };

  // Per the site-wide rule (2026-05-27), any ticker click goes to /profile
  // unless we're already on a Company Research page. /scanner is NOT in
  // that group, so this always navigates.
  const handleTickerClick = tickerNavigate;


  return (
    <div className="min-h-screen bg-background">
      <PageTemplate
        maxWidth="max-w-5xl"
        icon={Radar}
        title="Scanner"
        subtitle="3-strategy alignment, AMC scoring, and the Explosion Detector — all on one engine."
        howItWorksTitle="How the Scanner page works"
        howItWorks={
          <>
            <p><b className="text-foreground">Signal Pulse (top):</b> Our proprietary oscillator. Each day we run all 12 Scanner 2.0 signals on the selected ticker and plot <span className="text-bull-light">bullish fires</span> minus <span className="text-bear-light">bearish fires</span> as a composite score. Above zero = momentum up, below = momentum down. Click any scanner result below to load it into the Pulse.</p>
            <p><b className="text-foreground">3-Strategy Alignment:</b> Scans for stocks where BBTC + VER + Triple Confluence agree. Verdicts: <span className="text-bull-light">GO ↑</span>/<span className="text-bear-light">GO ↓</span> (all gates clear), <span className="text-bull-light">SET ↑</span>/<span className="text-bear-light">SET ↓</span> (most gates clear), <span className="text-bull-light">READY ↑</span>/<span className="text-bear-light">READY ↓</span> (waiting for confirmation), <span className="text-amber-400">PULLBACK</span>, GATES CLOSED, NO SETUP. Colors differentiate up vs down.</p>
            <p><b className="text-foreground">AMC Strategy:</b> Scores 0-5 using MACD acceleration, RSI sweet spot, trend structure, VAMI momentum, and trend strength.</p>
            <p><b className="text-foreground">Explosion Detector:</b> Scans 2000 US stocks looking for combinations of 12 signals (6 technical + 6 catalyst) that historically precede large moves. Expand any card to see per-signal breakdown and an MACD/RSI indicator chart.</p>
            <p><b className="text-foreground">Credibility:</b> All three scanners use the same signal engine — verdicts here match Trade Analysis, Trade Tracker, and Watchlist exactly.</p>
          </>
        }
      >
        {/* Scan Mode Tabs */}
        <div className="flex border-b border-card-border">
          <button
            onClick={() => setScanMode("3strategy")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${scanMode === "3strategy" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            data-testid="tab-3strategy"
          >
            <Radar className="h-4 w-4" />
            3-Strategy Alignment
          </button>
          <button
            onClick={() => setScanMode("amc")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${scanMode === "amc" ? "border-purple-400 text-purple-400" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            data-testid="tab-amc"
          >
            <Zap className="h-4 w-4" />
            AMC Strategy
          </button>
          <button
            onClick={() => setScanMode("v2")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${scanMode === "v2" ? "border-fuchsia-500 text-fuchsia-400" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            data-testid="tab-v2"
          >
            <Flame className="h-4 w-4" />
            Explosion Detector
          </button>
        </div>

        {/* Description */}
        <div className="text-center py-2">
          {scanMode === "3strategy" ? (
            <p className="text-xs text-muted-foreground">Scans across BBTC + VER + Triple Confluence. Finds stocks where multiple strategies agree.</p>
          ) : scanMode === "amc" ? (
            <p className="text-xs text-muted-foreground">Scores stocks 0-5 using AMC indicators: MACD acceleration, RSI sweet spot, trend structure, VAMI momentum, trend strength.</p>
          ) : (
            <p className="text-xs text-muted-foreground">Explosion Detector: scans 2000 liquid US stocks for 9 signals combining technical setups and catalysts.</p>
          )}
        </div>

        {/* Filter Controls */}
        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <button onClick={() => setFiltersOpen(!filtersOpen)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors">
            <div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-primary" /> Scan Filters</div>
            {filtersOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {filtersOpen && (
            <div className="px-4 pb-4 space-y-4 border-t border-card-border">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
                <div>
                  <label className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">Sector</label>
                  <select value={sector} onChange={(e) => setSector(e.target.value)} className="w-full bg-background border border-card-border rounded-md px-3 py-2 text-sm text-foreground" data-testid="select-sector">
                    {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">Market Cap</label>
                  <select value={marketCap} onChange={(e) => setMarketCap(e.target.value)} className="w-full bg-background border border-card-border rounded-md px-3 py-2 text-sm text-foreground" data-testid="select-marketcap">
                    {MARKET_CAP_TIERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {scanMode !== "v2" && (
                  <div>
                    <label className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">Price Range</label>
                    <select value={priceRange} onChange={(e) => setPriceRange(e.target.value)} className="w-full bg-background border border-card-border rounded-md px-3 py-2 text-sm text-foreground" data-testid="select-price">
                      {PRICE_RANGES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </div>
                )}
                {scanMode !== "v2" && (
                  <div>
                    <label className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">Stocks to Scan</label>
                    <div className="flex gap-2">
                      {[50, 100, 250, 500].map(n => (
                        <button key={n} onClick={() => setScanCount(n)} className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors ${scanCount === n ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>{n}</button>
                      ))}
                    </div>
                  </div>
                )}
                {scanMode !== "v2" && (
                  <div>
                    <label className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">Signal</label>
                    <div className="flex gap-2">
                      {(["both", "buy", "sell"] as const).map(sf => (
                        <button key={sf} onClick={() => setSignalFilter(sf)} className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors capitalize ${signalFilter === sf ? (sf === "buy" ? "bg-bull text-white" : sf === "sell" ? "bg-bear text-white" : "bg-primary text-white") : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>{sf}</button>
                      ))}
                    </div>
                  </div>
                )}
                {scanMode === "v2" && (
                  <div>
                    <label className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">Direction</label>
                    <div className="flex gap-2">
                      {(["either", "up", "down"] as const).map(d => (
                        <button key={d} onClick={() => setV2Direction(d)} data-testid={`v2-dir-${d}`} className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors capitalize ${v2Direction === d ? (d === "up" ? "bg-bull text-white" : d === "down" ? "bg-bear text-white" : "bg-fuchsia-600 text-white") : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>{d}</button>
                      ))}
                    </div>
                  </div>
                )}
                {scanMode === "v2" && (
                  <div>
                    <label className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">Min Score</label>
                    <div className="flex gap-2">
                      {[5, 10, 20, 30].map(n => (
                        <button key={n} onClick={() => setV2MinScore(n)} data-testid={`v2-score-${n}`} className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors ${v2MinScore === n ? "bg-fuchsia-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>{n}+</button>
                      ))}
                    </div>
                  </div>
                )}
                {scanMode === "v2" && (
                  <div>
                    <label className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">Universe Size</label>
                    <div className="flex gap-2">
                      {[1000, 2000, 3000].map(n => (
                        <button key={n} onClick={() => setV2UniverseSize(n)} data-testid={`v2-universe-${n}`} className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors ${v2UniverseSize === n ? "bg-fuchsia-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>{n}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between pt-1">
                {scanMode !== "v2" ? (
                  <button onClick={() => setShowAll(!showAll)} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="toggle-show-all">
                    {showAll ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    {showAll ? "Showing all results" : scanMode === "amc" ? "Score 3+ only" : "Score 2+ only"}
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">Scanning 2000 liquid US stocks</span>
                )}
                <button onClick={() => refetch()} disabled={isFetching} className={`inline-flex items-center gap-2 ${scanMode === "amc" ? "bg-purple-600 hover:bg-purple-500" : scanMode === "v2" ? "bg-fuchsia-600 hover:bg-fuchsia-500" : "bg-primary hover:bg-primary/90"} text-white font-semibold px-6 py-2.5 rounded-lg transition-colors disabled:opacity-50`} data-testid="button-scan">
                  {isFetching ? (<><Radar className="h-4 w-4 animate-spin" />Scanning...</>) : (<><Search className="h-4 w-4" />{data ? "New Scan" : scanMode === "v2" ? `Scan ${v2UniverseSize} Stocks` : `Scan ${scanCount} Stocks`}</>)}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Scan status */}
        {data && !isFetching && (() => {
          const results = data.results || [];
          let gateReady: number | null = null;
          if (scanMode === "amc") {
            gateReady = results.filter((r: any) => r.amcScore >= 3).length;
          } else if (scanMode !== "v2") {
            gateReady = results.filter((r: any) =>
              /^(GO|SET|READY|PULLBACK)/.test(String(r.gates?.signal ?? ""))
            ).length;
          }
          return (
            <div className="text-center text-2xs text-muted-foreground">
              {scanMode === "v2"
                ? <>Scanned {data.universeSize} stocks in {((data.scanDurationMs || 0) / 1000).toFixed(1)}s at {new Date(data.scannedAt).toLocaleTimeString()} · {data.results.length} triggered</>
                : signalFilter === "both"
                  ? <>Scanned {data.totalScanned} stocks at {new Date(data.scannedAt).toLocaleTimeString()} · {gateReady} {scanMode === "amc" ? "AMC setups" : "gate-ready"} of {data.results.length} shown</>
                  : <>Scanned {data.totalScanned} stocks at {new Date(data.scannedAt).toLocaleTimeString()} · {data.results.length} {signalFilter} {scanMode === "amc" ? "setups" : "setups"}</>}
            </div>
          );
        })()}

        {/* Loading */}
        {isFetching && (
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-card border border-card-border rounded-lg p-6">
                <div className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded bg-muted skeleton-shimmer" />
                  <div className="flex-1 space-y-2"><div className="h-4 w-24 rounded bg-muted skeleton-shimmer" /><div className="h-3 w-48 rounded bg-muted skeleton-shimmer" /></div>
                  <div className="h-8 w-20 rounded bg-muted skeleton-shimmer" />
                </div>
              </div>
            ))}
            <p className="text-center text-sm text-muted-foreground animate-pulse">
              {scanMode === "v2"
                ? `Scanning ${v2UniverseSize.toLocaleString()} stocks for explosive setups...`
                : scanMode === "amc"
                  ? `Scanning ${scanCount} stocks for AMC setups...`
                  : `Scanning ${scanCount} stocks for gate-ready setups...`}
            </p>
          </div>
        )}

        {/* Results */}
        {data && !isFetching && scanMode === "v2" && (
          data.results && data.results.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  {data.results.length} Triggered
                </h3>
                <span className="text-xs text-muted-foreground">
                  Ranked by signal score (0-100)
                </span>
              </div>
              {data.results.map((result: any, idx: number) => (
                <ExplosionCard key={result.symbol} result={result} rank={idx + 1} onClick={() => handleTickerClick(result.symbol)} onAnalyze={() => handleTickerClick(result.symbol)} />
              ))}
            </div>
          ) : (
            <div className="bg-card border border-card-border rounded-lg p-8 text-center">
              <p className="text-muted-foreground">No explosion setups found.</p>
              <p className="text-sm text-muted-foreground mt-1">Try lowering the min-score threshold, widening the sector/cap filter, or switching direction.</p>
            </div>
          )
        )}

        {data && !isFetching && scanMode !== "v2" && (() => {
          // Server already filtered by `direction` query param (BUY/SELL drop
          // NO SETUP and direction-mismatched rows server-side). Client just
          // displays what came back.
          const filtered = data.results;
          const gateReadyCount = scanMode === "amc"
            ? filtered.filter((r: any) => r.amcScore >= 3).length
            : filtered.filter((r: any) =>
                /^(GO|SET|READY|PULLBACK)/.test(String(r.gates?.signal ?? ""))
              ).length;
          return filtered.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  {(() => {
                    const setupWord = scanMode === "amc" ? "AMC Setups" : "Gate-Ready";
                    return signalFilter === "both"
                      ? `${filtered.length} Stocks · ${gateReadyCount} ${setupWord}`
                      : `${filtered.length} ${setupWord} (${signalFilter})`;
                  })()}
                </h3>
                <span className="text-xs text-muted-foreground">
                  Ranked by gate progression + RSI extremes
                </span>
              </div>
              {filtered.map((result: any, idx: number) => (
                scanMode === "amc" ? (
                  <AMCCard key={result.ticker} result={result} rank={idx + 1} onClick={() => handleTickerClick(result.ticker)} onAnalyze={() => handleTickerClick(result.ticker)} />
                ) : (
                  <ThreeStrategyCard key={result.ticker} result={result} rank={idx + 1} onClick={() => handleTickerClick(result.ticker)} onAnalyze={() => handleTickerClick(result.ticker)} />
                )
              ))}
            </div>
          ) : (
            <div className="bg-card border border-card-border rounded-lg p-8 text-center">
              <p className="text-muted-foreground">No gate-ready stocks found.</p>
              <p className="text-sm text-muted-foreground mt-1">No stocks are showing reversal setups right now. Try widening filters, changing sector, or enable "Show All" to see the full scan.</p>
            </div>
          );
        })()}

        {!data && !isFetching && (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">Set your filters and press "Scan" to find stocks</p>
          </div>
        )}
      </PageTemplate>
    </div>
  );
}
