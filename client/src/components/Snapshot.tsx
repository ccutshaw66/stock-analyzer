import { BarChart3, CircleDot } from "lucide-react";
import { formatCurrency, formatLargeNumber, formatNumber, formatPercent, formatVolume } from "@/lib/format";

interface SnapshotProps {
  data: any;
}

type Signal = "good" | "bad" | "neutral";

function getSignalColor(signal: Signal): string {
  switch (signal) {
    case "good": return "text-green-500";
    case "bad": return "text-red-500";
    case "neutral": return "text-yellow-500";
  }
}

function getSignalDotBg(signal: Signal): string {
  switch (signal) {
    case "good": return "bg-green-500";
    case "bad": return "bg-red-500";
    case "neutral": return "bg-yellow-500";
  }
}

function getSignalLabel(signal: Signal): string {
  switch (signal) {
    case "good": return "Good";
    case "bad": return "Caution";
    case "neutral": return "Neutral";
  }
}

function getPeSignal(pe: number | null): Signal {
  if (pe === null) return "neutral";
  if (pe < 0) return "bad";
  if (pe < 20) return "good";
  if (pe <= 30) return "neutral";
  return "bad";
}

function getEpsSignal(eps: number | null): Signal {
  if (eps === null) return "neutral";
  if (eps > 3) return "good";
  if (eps > 0) return "neutral";
  return "bad";
}

function getDivYieldSignal(dy: number | null): Signal {
  if (dy === null || dy === 0) return "neutral";
  if (dy > 3) return "good";
  if (dy > 1) return "neutral";
  return "neutral";
}

function getMarketCapSignal(mc: number | null): Signal {
  if (mc === null) return "neutral";
  if (mc > 50e9) return "good";
  if (mc > 10e9) return "neutral";
  return "bad";
}

function getVolumeSignal(vol: number | null): Signal {
  if (vol === null) return "neutral";
  if (vol > 5e6) return "good";
  if (vol > 500e3) return "neutral";
  return "bad";
}

function getBetaSignal(beta: number | null): Signal {
  if (beta === null) return "neutral";
  if (beta >= 0.8 && beta <= 1.2) return "good";
  if (beta > 1.5) return "bad";
  return "neutral";
}

function MetricRow({ label, value, signal, testId }: { label: string; value: string; signal: Signal; testId: string }) {
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-card-border/50 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${getSignalDotBg(signal)}`} />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-sm font-semibold tabular-nums ${getSignalColor(signal)}`} data-testid={testId}>{value}</span>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
          signal === "good" ? "bg-green-500/15 text-green-500" :
          signal === "bad" ? "bg-red-500/15 text-red-500" :
          "bg-yellow-500/15 text-yellow-500"
        }`}>
          {getSignalLabel(signal)}
        </span>
      </div>
    </div>
  );
}

function SectorRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-card-border/50 last:border-0">
      <div className="flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full shrink-0 bg-primary" />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <span className="text-sm font-semibold text-foreground" data-testid={testId}>{value}</span>
    </div>
  );
}

export function Snapshot({ data }: SnapshotProps) {
  const low = data.fiftyTwoWeekLow;
  const high = data.fiftyTwoWeekHigh;
  const price = data.price;
  const rangePosition = low && high && price
    ? Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100))
    : 50;

  // Determine 52-week range signal
  let rangeSignal: Signal = "neutral";
  if (rangePosition > 70) rangeSignal = "good";
  else if (rangePosition < 30) rangeSignal = "bad";

  const rangeSignalColor = rangeSignal === "good" ? "bg-green-500" : rangeSignal === "bad" ? "bg-red-500" : "bg-yellow-500";
  const rangeBarFill = rangeSignal === "good" ? "bg-green-500/25" : rangeSignal === "bad" ? "bg-red-500/25" : "bg-yellow-500/25";
  const rangeDotColor = rangeSignal === "good" ? "bg-green-500" : rangeSignal === "bad" ? "bg-red-500" : "bg-yellow-500";

  return (
    <div className="bg-card border border-card-border rounded-lg p-6" data-testid="snapshot">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
        <BarChart3 className="h-4 w-4" />
        Snapshot
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
        <div>
          <MetricRow label="Price" value={formatCurrency(data.price)} signal="neutral" testId="text-snapshot-price" />
          <MetricRow label="Market Cap" value={formatLargeNumber(data.marketCap)} signal={getMarketCapSignal(data.marketCap)} testId="text-market-cap" />
          <SectorRow label="Sector" value={data.sector || "N/A"} testId="text-sector" />
          <MetricRow label="P/E Ratio" value={data.pe ? formatNumber(data.pe) : "N/A"} signal={getPeSignal(data.pe)} testId="text-pe" />
        </div>
        <div>
          <MetricRow label="EPS" value={data.eps ? formatCurrency(data.eps) : "N/A"} signal={getEpsSignal(data.eps)} testId="text-eps" />
          <MetricRow label="Dividend Yield" value={data.dividendYield ? formatPercent(data.dividendYield) : "N/A"} signal={getDivYieldSignal(data.dividendYield)} testId="text-div-yield" />
          <MetricRow label="Avg Volume" value={formatVolume(data.avgVolume)} signal={getVolumeSignal(data.avgVolume)} testId="text-avg-volume" />
          <MetricRow label="Beta" value={data.beta ? formatNumber(data.beta) : "N/A"} signal={getBetaSignal(data.beta)} testId="text-beta" />
        </div>
      </div>

      {/* 52-Week Range Bar */}
      {low && high && (
        <div className="mt-4 pt-4 border-t border-card-border/50">
          <div className="flex justify-between items-center text-xs text-muted-foreground mb-2">
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${rangeSignalColor}`} />
              <span>52-Week Range</span>
            </div>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
              rangeSignal === "good" ? "bg-green-500/15 text-green-500" :
              rangeSignal === "bad" ? "bg-red-500/15 text-red-500" :
              "bg-yellow-500/15 text-yellow-500"
            }`}>
              {rangeSignal === "good" ? "Near High" : rangeSignal === "bad" ? "Near Low" : "Mid Range"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{formatCurrency(low)}</span>
            <div className="relative flex-1 h-2 bg-muted rounded-full">
              <div
                className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 ${rangeDotColor} rounded-full border-2 border-background shadow-sm`}
                style={{ left: `calc(${rangePosition}% - 6px)` }}
                data-testid="range-indicator"
              />
              <div
                className={`absolute inset-y-0 left-0 ${rangeBarFill} rounded-full`}
                style={{ width: `${rangePosition}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{formatCurrency(high)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
