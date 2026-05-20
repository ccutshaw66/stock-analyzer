/**
 * HTF Setups page — High Tight Flag scanner results + portfolio + backtest.
 *
 * Five tabs:
 *   - Today's Setups (actionable)
 *   - Filtered (blocked + reason)
 *   - Portfolio (reads open trades, summarises capacity / sector / risk)
 *   - Backtest (per-ticker walk-forward simulation with Givens exits)
 *   - Config (account capital + risk caps)
 *
 * All loading / empty / error states use the BrandedLoader / BrandedEmptyState
 * primitives per the quality-bar memory.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Flag, AlertTriangle, Play, RefreshCw, Activity, Flame, Eye } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { BrandedLoader } from "@/components/BrandedLoader";
import { BrandedEmptyState } from "@/components/BrandedEmptyState";
import { Disclaimer } from "@/components/Disclaimer";
import { HelpBlock, ScoreRange } from "@/components/HelpBlock";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import {
  useHtfScanner,
  useHtfScannerRefresh,
  type HtfSetupRow,
  type HtfSetupsResponse,
} from "@/compartments/htf-scanner";

// ─── Local types not owned by the compartment ────────────────────────────
// HtfSetupRow / HtfSetupsResponse come from @/compartments/htf-scanner.

interface PortfolioPosition {
  symbol: string;
  sector: string;
  shares: number;
  entry: number;
  stop: number;
  value: number;
  atRisk: number;
}

interface PortfolioResponse {
  nOpen: number;
  maxOpen: number;
  capacityRemaining: number;
  totalValue: number;
  totalOpenRisk: number;
  maxOpenRisk: number;
  openRiskPct: number;
  cashRemainingEstimate: number;
  positions: PortfolioPosition[];
}

interface AccountConfig {
  capital: number;
  maxRiskPerTradePct: number;
  maxPositionPct: number;
  maxSimultaneousPositions: number;
  maxSectorExposurePct: number;
  maxTotalOpenRiskPct: number;
  minRewardRiskRatio: number;
  commissionPerTrade: number;
  slippagePct: number;
}

interface BacktestSummary {
  nTrades: number;
  winRatePct?: number;
  avgReturnPct?: number;
  profitFactor?: number;
  expectancyPerTradePct?: number;
  avgHoldDays?: number;
  bestTrade?: number;
  worstTrade?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function scoreColor(score: number): string {
  if (score >= 85) return "text-bull";
  if (score >= 70) return "text-watch-light";
  return "text-bear-light";
}

function scoreBg(score: number): string {
  if (score >= 85) return "bg-bull/15 border-bull/40";
  if (score >= 70) return "bg-watch/15 border-watch/40";
  return "bg-bear/15 border-bear/40";
}

function fmt$(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}
function fmt$0(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}
function fmtPct(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function fmtAgo(isoOrDate: string | Date | null): string {
  if (!isoOrDate) return "never";
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

// ─── Setups table ─────────────────────────────────────────────────────────
function SetupsTable({ rows, showBlocked }: { rows: HtfSetupRow[]; showBlocked: boolean }) {
  const [, navigate] = useLocation();
  const openChart = (symbol: string) => {
    navigate(`/htf/${symbol}`);
  };
  if (rows.length === 0) {
    return (
      <BrandedEmptyState
        icon={Flag}
        title={showBlocked ? "No filtered setups" : "No setups today"}
        description={
          showBlocked
            ? "Every breakout in the latest run was actionable. Filtered setups appear here when portfolio caps or R/R rules block a trade."
            : "The nightly scan hasn't surfaced any HTF breakouts that pass the volume + flag filters. In choppy markets this is normal — don't loosen the rules to force signals."
        }
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Symbol</th>
            <th className="px-3 py-2 text-right">Score</th>
            <th className="px-3 py-2 text-right">Breakout</th>
            <th className="px-3 py-2 text-right">Target</th>
            <th className="px-3 py-2 text-right">Stop</th>
            <th className="px-3 py-2 text-right">R/R</th>
            <th className="px-3 py-2 text-right">Shares</th>
            <th className="px-3 py-2 text-right">$ Position</th>
            <th className="px-3 py-2 text-right">$ Risk</th>
            <th className="px-3 py-2 text-right">Pole</th>
            <th className="px-3 py-2 text-right">Flag</th>
            <th className="px-3 py-2 text-right">Vol</th>
            {showBlocked && <th className="px-3 py-2 text-left">Why blocked</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr
              key={r.id}
              onClick={() => openChart(r.symbol)}
              className="cursor-pointer border-t border-border hover:bg-muted/30 transition-colors"
              data-testid={`htf-row-${r.symbol}`}
              title="Open the HTF pattern chart"
            >
              <td className="px-3 py-2 font-bold text-foreground underline decoration-dotted underline-offset-2">
                {r.symbol}
              </td>
              <td className={`px-3 py-2 text-right font-bold ${scoreColor(r.qualityScore)}`}>
                <span className={`px-2 py-0.5 rounded border ${scoreBg(r.qualityScore)}`}>
                  {r.qualityScore}
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt$(r.breakoutPrice)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-bull-light">{fmt$(r.targetPrice)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-bear-light">{fmt$(r.stopPrice)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.rewardRiskRatio.toFixed(1)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.recommendedShares.toLocaleString()}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt$0(r.positionValue)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt$0(r.actualRisk)}</td>
              <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                +{r.poleGainPct.toFixed(0)}% / {r.poleDays}d
              </td>
              <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                {r.flagDays}d / -{r.flagPullbackPct.toFixed(1)}%
              </td>
              <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                {r.breakoutVolRatio.toFixed(1)}×
              </td>
              {showBlocked && (
                <td className="px-3 py-2 text-xs text-bear-light">{r.blockedReason ?? "—"}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────

/** "Live" tab — fired breakouts. The actionable "this bitch is about to blow" list. */
function LiveTab() {
  const [minScore, setMinScore] = useState(70);
  const q = useHtfScanner({ actionableOnly: true, minScore, stage: "fired" });

  if (q.isLoading) {
    return (
      <BrandedLoader message="Scanning the universe for live HTF setups… (first run can take ~1 min)" />
    );
  }
  if (q.isError) {
    return (
      <BrandedEmptyState
        icon={AlertTriangle}
        title="Couldn't load setups"
        description={(q.error as any)?.message || "The HTF scan endpoint returned an error."}
      />
    );
  }
  const data = q.data;
  if (!data) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Scanned <span className="text-foreground font-semibold">{fmtAgo(data.scannedAt)}</span>
            {data.universeSize > 0 && (
              <> · {data.universeSize.toLocaleString()} tickers · {data.rows.length} live</>
            )}
          </span>
          {data.rows.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded border border-bull/40 bg-bull/10 text-bull-light font-semibold">
              Enter at next market open
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="minScore" className="text-xs">Min score</Label>
          <Input
            id="minScore"
            type="number"
            value={minScore}
            onChange={e => setMinScore(Number(e.target.value))}
            className="w-20 h-8 text-sm"
            min={0}
            max={100}
          />
        </div>
      </div>
      <SetupsTable rows={data.rows} showBlocked={false} />
    </div>
  );
}

/** "Watch" tab — patterns still forming. Pole + flag valid, no breakout yet. */
function WatchTab() {
  const [minScore, setMinScore] = useState(70);
  const q = useHtfScanner({ minScore, stage: "forming" });

  if (q.isLoading) {
    return (
      <BrandedLoader message="Scanning for patterns about to break out… (first run can take ~1 min)" />
    );
  }
  if (q.isError) {
    return (
      <BrandedEmptyState
        icon={AlertTriangle}
        title="Couldn't load watch list"
        description={(q.error as any)?.message || "The HTF scan endpoint returned an error."}
      />
    );
  }
  const data = q.data;
  if (!data) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Scanned <span className="text-foreground font-semibold">{fmtAgo(data.scannedAt)}</span>
            {data.universeSize > 0 && (
              <> · {data.universeSize.toLocaleString()} tickers · {data.rows.length} watching</>
            )}
          </span>
          {data.rows.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded border border-watch/40 bg-watch/10 text-watch-light font-semibold">
              Entry price = trigger if/when flag high breaks
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="minScoreW" className="text-xs">Min score</Label>
          <Input
            id="minScoreW"
            type="number"
            value={minScore}
            onChange={e => setMinScore(Number(e.target.value))}
            className="w-20 h-8 text-sm"
            min={0}
            max={100}
          />
        </div>
      </div>
      {data.rows.length === 0 ? (
        <BrandedEmptyState
          icon={Eye}
          title="No patterns forming right now"
          description="The watch list surfaces stocks with a 30%+ pole and a tight flag that's still consolidating. Refresh in a few hours, or widen the score floor."
        />
      ) : (
        <SetupsTable rows={data.rows} showBlocked={false} />
      )}
    </div>
  );
}

function PortfolioTab() {
  const q = useQuery<PortfolioResponse>({
    queryKey: ["/api/htf/portfolio"],
    queryFn: async () => (await apiRequest("GET", "/api/htf/portfolio")).json(),
  });
  if (q.isLoading) return <BrandedLoader message="Loading portfolio…" />;
  if (q.isError || !q.data) {
    return (
      <BrandedEmptyState
        icon={AlertTriangle}
        title="Couldn't load portfolio"
        description="The portfolio endpoint returned an error."
      />
    );
  }
  const p = q.data;
  const stats: Array<[string, string]> = [
    ["Open", `${p.nOpen} / ${p.maxOpen}`],
    ["Capacity left", `${p.capacityRemaining}`],
    ["Total value", fmt$0(p.totalValue)],
    ["Total at risk", `${fmt$0(p.totalOpenRisk)} / ${fmt$0(p.maxOpenRisk)} (${fmtPct(p.openRiskPct)})`],
    ["Cash estimate", fmt$0(p.cashRemainingEstimate)],
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-md border border-border p-3 bg-card">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-sm font-bold text-foreground mt-0.5">{value}</div>
          </div>
        ))}
      </div>
      {p.positions.length === 0 ? (
        <BrandedEmptyState
          icon={Activity}
          title="No open positions"
          description="Open positions in the Trade Tracker show up here automatically. The HTF scanner uses this to gate new setups against your capacity."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Symbol</th>
                <th className="px-3 py-2 text-left">Sector</th>
                <th className="px-3 py-2 text-right">Shares</th>
                <th className="px-3 py-2 text-right">Entry</th>
                <th className="px-3 py-2 text-right">Stop</th>
                <th className="px-3 py-2 text-right">Value</th>
                <th className="px-3 py-2 text-right">At risk</th>
              </tr>
            </thead>
            <tbody>
              {p.positions.map(pos => (
                <tr key={pos.symbol} className="border-t border-border">
                  <td className="px-3 py-2 font-bold">{pos.symbol}</td>
                  <td className="px-3 py-2 text-muted-foreground">{pos.sector}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pos.shares.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt$(pos.entry)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-bear-light">{fmt$(pos.stop)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt$0(pos.value)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt$0(pos.atRisk)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BacktestTab() {
  const [symbol, setSymbol] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [result, setResult] = useState<{ trades: any[]; summary: BacktestSummary } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/htf/backtest", { symbol, minScore });
      return r.json();
    },
    onSuccess: d => {
      setResult(d);
      setError(null);
    },
    onError: (e: any) => setError(e?.message || "backtest failed"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <Label htmlFor="bt-sym" className="text-xs">Symbol</Label>
          <Input
            id="bt-sym"
            value={symbol}
            onChange={e => setSymbol(e.target.value.toUpperCase())}
            placeholder="e.g. RKLB"
            className="w-32 h-9"
          />
        </div>
        <div>
          <Label htmlFor="bt-score" className="text-xs">Min score</Label>
          <Input
            id="bt-score"
            type="number"
            value={minScore}
            onChange={e => setMinScore(Number(e.target.value))}
            className="w-24 h-9"
            min={0}
            max={100}
          />
        </div>
        <Button
          onClick={() => symbol && m.mutate()}
          disabled={!symbol || m.isPending}
          className="h-9"
        >
          {m.isPending ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
          Run
        </Button>
      </div>
      {error && (
        <div className="rounded-md border border-bear/40 bg-bear/10 p-3 text-sm text-bear-light">
          {error}
        </div>
      )}
      {m.isPending && <BrandedLoader message={`Backtesting ${symbol}…`} />}
      {result && !m.isPending && (
        <>
          {result.summary.nTrades === 0 ? (
            <BrandedEmptyState
              icon={Flag}
              title="No HTF setups in history"
              description="This ticker has no breakouts matching the Givens rules in the available bars."
            />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {([
                ["Trades", result.summary.nTrades],
                ["Win rate", fmtPct(result.summary.winRatePct)],
                ["Avg return", fmtPct(result.summary.avgReturnPct)],
                ["Profit factor", result.summary.profitFactor?.toFixed(2) ?? "—"],
                ["Expectancy", fmtPct(result.summary.expectancyPerTradePct)],
                ["Avg hold", `${result.summary.avgHoldDays ?? "—"}d`],
                ["Best", fmtPct(result.summary.bestTrade)],
                ["Worst", fmtPct(result.summary.worstTrade)],
              ] as Array<[string, any]>).map(([label, value]) => (
                <div key={label} className="rounded-md border border-border p-3 bg-card">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="text-sm font-bold text-foreground mt-0.5">{value}</div>
                </div>
              ))}
            </div>
          )}
          {result.trades.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Entry</th>
                    <th className="px-3 py-2 text-left">Exit</th>
                    <th className="px-3 py-2 text-right">Days</th>
                    <th className="px-3 py-2 text-right">Entry $</th>
                    <th className="px-3 py-2 text-right">Exit $</th>
                    <th className="px-3 py-2 text-right">Return</th>
                    <th className="px-3 py-2 text-right">DD</th>
                    <th className="px-3 py-2 text-left">Reason</th>
                    <th className="px-3 py-2 text-right">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.map((t: any, i: number) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs">{t.entryDate}</td>
                      <td className="px-3 py-2 font-mono text-xs">{t.exitDate}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{t.holdingDays}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt$(t.entryPrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt$(t.exitPrice)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-bold ${t.blendedReturnPct >= 0 ? "text-bull-light" : "text-bear-light"}`}>
                        {fmtPct(t.blendedReturnPct)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {fmtPct(t.maxDrawdownPct)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{t.exitReason}</td>
                      <td className={`px-3 py-2 text-right font-bold ${scoreColor(t.qualityScore)}`}>
                        {t.qualityScore}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ConfigTab() {
  const qc = useQueryClient();
  const q = useQuery<AccountConfig>({
    queryKey: ["/api/htf/config"],
    queryFn: async () => (await apiRequest("GET", "/api/htf/config")).json(),
  });
  const [draft, setDraft] = useState<AccountConfig | null>(null);
  const m = useMutation({
    mutationFn: async (cfg: AccountConfig) => (await apiRequest("PUT", "/api/htf/config", cfg)).json(),
    onSuccess: (saved: AccountConfig) => {
      qc.setQueryData(["/api/htf/config"], saved);
      setDraft(null);
      // Resize-on-read recomputes shares / $ position / actionable status
      // against the new config — invalidate every setups + portfolio query
      // so the next tab visit reflects the edit immediately.
      qc.invalidateQueries({ queryKey: ["/api/htf/setups"] });
      qc.invalidateQueries({ queryKey: ["/api/htf/setups/filtered"] });
      qc.invalidateQueries({ queryKey: ["/api/htf/portfolio"] });
    },
  });

  if (q.isLoading) return <BrandedLoader message="Loading config…" />;
  if (q.isError || !q.data) {
    return (
      <BrandedEmptyState
        icon={AlertTriangle}
        title="Couldn't load config"
        description="The config endpoint returned an error."
      />
    );
  }
  const cfg = draft ?? q.data;
  const update = (k: keyof AccountConfig, v: number) =>
    setDraft({ ...(draft ?? q.data!), [k]: v });

  type Unit = "dollar" | "percent" | "integer" | "ratio";
  interface Field {
    key: keyof AccountConfig;
    label: string;
    unit: Unit;
    hint: string;
    step?: number;
  }
  // Server stores percentages as fractions (0.10 = 10%). The UI shows the
  // human-friendly whole-number percent and converts on save.
  const fields: Field[] = [
    { key: "capital", label: "Capital", unit: "dollar", hint: "Starting account value", step: 100 },
    { key: "maxRiskPerTradePct", label: "Max risk per trade", unit: "percent", hint: "Of capital, per single trade", step: 1 },
    { key: "maxPositionPct", label: "Max position size", unit: "percent", hint: "Of capital, in any one name", step: 1 },
    { key: "maxSimultaneousPositions", label: "Max open positions", unit: "integer", hint: "Concurrent trades cap", step: 1 },
    { key: "maxSectorExposurePct", label: "Max sector exposure", unit: "percent", hint: "Of capital, in any one sector", step: 1 },
    { key: "maxTotalOpenRiskPct", label: "Max total open risk", unit: "percent", hint: "Sum of risk across all open trades", step: 1 },
    { key: "minRewardRiskRatio", label: "Min R/R ratio", unit: "ratio", hint: "2 = 2:1 reward-to-risk", step: 0.1 },
    { key: "commissionPerTrade", label: "Commission per trade", unit: "dollar", hint: "Broker fee per round-trip", step: 0.01 },
    { key: "slippagePct", label: "Slippage", unit: "percent", hint: "On entry + exit (0.2 = 0.2%)", step: 0.1 },
  ];

  const toDisplay = (f: Field): number => {
    const v = cfg[f.key];
    return f.unit === "percent" ? Math.round(v * 1000) / 10 : v;
  };
  const fromDisplay = (f: Field, raw: number): number =>
    f.unit === "percent" ? raw / 100 : raw;
  const suffix = (u: Unit): string =>
    u === "percent" ? "%" : u === "dollar" ? "$" : "";

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {fields.map(f => (
          <div key={f.key} className="rounded-md border border-border p-3 bg-card">
            <Label htmlFor={`cfg-${f.key}`} className="text-xs">
              {f.label}
              {suffix(f.unit) && (
                <span className="text-muted-foreground ml-1">({suffix(f.unit)})</span>
              )}
            </Label>
            <Input
              id={`cfg-${f.key}`}
              type="number"
              step={f.step ?? "any"}
              min={0}
              value={toDisplay(f)}
              onChange={e => update(f.key, fromDisplay(f, Number(e.target.value)))}
              className="mt-1 h-9"
            />
            <div className="text-xs text-muted-foreground mt-1">{f.hint}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button
          onClick={() => draft && m.mutate(draft)}
          disabled={!draft || m.isPending}
        >
          {m.isPending ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : null}
          Save
        </Button>
        {draft && (
          <Button variant="outline" onClick={() => setDraft(null)}>
            Cancel
          </Button>
        )}
        {m.isError && (
          <span className="text-xs text-bear-light">
            {(m.error as any)?.message || "save failed"}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────
export default function HtfSetupsPage() {
  const scan = useHtfScannerRefresh();

  return (
    <div className="space-y-4">
      <PageHeader
        right={
          <Button
            onClick={() => scan.mutate()}
            disabled={scan.isPending}
            size="sm"
            data-testid="htf-run-scan"
            title="Force a fresh scan of the universe (bypasses the 30-min cache)"
          >
            {scan.isPending ? (
              <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            Refresh
          </Button>
        }
      />
      <HelpBlock title="How HTF setups work">
        <p>
          <span className="font-semibold text-foreground">The High Tight Flag</span> is Bulkowski's #1-ranked
          chart pattern. This scanner uses Ross Givens' loosening of the rules — looking for a sharp
          run-up followed by a tight consolidation, then a breakout on heavy volume.
        </p>

        <div className="space-y-1">
          <div className="font-semibold text-foreground">What the scanner looks for</div>
          <ul className="list-disc list-inside space-y-0.5 marker:text-muted-foreground/60">
            <li><span className="font-semibold">Pole</span> — a 30%+ price rise in 5–60 days</li>
            <li><span className="font-semibold">Flag</span> — 3–30 days of consolidation, pulling back no more than 25% from the pole high</li>
            <li><span className="font-semibold">Breakout</span> — close above the consolidation high on volume ≥1.3× the 30-day average</li>
          </ul>
        </div>

        <div className="space-y-1">
          <div className="font-semibold text-foreground">Quality score (0–100)</div>
          <div className="space-y-1">
            <ScoreRange label="High conviction" range="85+" color="green" description="big pole, tight flag, strong volume — small sample but highest hit rate" />
            <ScoreRange label="Standard fire" range="70–84" color="yellow" description="production threshold; what the scanner emits as actionable by default" />
            <ScoreRange label="Noise" range="<70" color="red" description="weak setup; the scanner filters these out unless you lower the threshold" />
          </div>
        </div>

        <div className="space-y-1">
          <div className="font-semibold text-foreground">How position sizing works</div>
          <p>
            For each breakout, the scanner sizes a position using your account config (Config tab):
            shares are capped by both <span className="font-mono">max-risk-per-trade</span> (default 10% =
            $700 on $7K) and <span className="font-mono">max-position-size</span> (default 25% = $1,750).
            Trades with reward-to-risk below 1:1 are <span className="text-bear-light">blocked</span>;
            ones below your minimum R/R (default 2:1) are warned but allowed.
          </p>
        </div>

        <div className="space-y-1">
          <div className="font-semibold text-foreground">Portfolio gates</div>
          <p>
            Before a setup shows up as <span className="text-bull-light">actionable</span>, it must also
            pass your portfolio rules: max 5 open positions, max 30% total at risk, max 40% in one
            sector, and you can't already hold the ticker. Blocked setups land in the{" "}
            <span className="font-semibold">Filtered</span> tab with the reason.
          </p>
        </div>

        <div className="space-y-1">
          <div className="font-semibold text-foreground">Suggested exits (Givens' rules)</div>
          <ul className="list-disc list-inside space-y-0.5 marker:text-muted-foreground/60">
            <li><span className="font-semibold">Buy</span> the next day's open after the breakout day</li>
            <li><span className="font-semibold">Hard stop</span> just below the consolidation low</li>
            <li>After <span className="font-semibold">3 days of strength</span> (close &gt;5% above entry),
              sell 1/3 of the position</li>
            <li><span className="font-semibold">Trail</span> the remaining 2/3 with a close below the
              20-day moving average</li>
          </ul>
        </div>

        <div className="space-y-1">
          <div className="font-semibold text-foreground">The tabs</div>
          <ul className="list-disc list-inside space-y-0.5 marker:text-muted-foreground/60">
            <li><span className="font-semibold text-bull-light">🔥 Live</span> — breakouts that already fired. Enter at the next market open per Givens' rule. The "this is about to blow" list.</li>
            <li><span className="font-semibold text-watch-light">👀 Watch</span> — patterns still forming. Pole is built (+30% in ≤60d), flag is consolidating, price hasn't broken above the flag high yet. Gives you time to set an alert before the trigger.</li>
            <li><span className="font-semibold">Portfolio</span> — your current open positions, capacity remaining, total risk (reads from Trade Tracker).</li>
            <li><span className="font-semibold">Backtest</span> — run the Givens entry + exit rules against any ticker's history.</li>
            <li><span className="font-semibold">Config</span> — edit your capital, risk caps, and position-sizing knobs.</li>
          </ul>
        </div>

        <div className="space-y-1">
          <div className="font-semibold text-foreground">Only setups firing right now</div>
          <p>
            Givens' rule says enter at the <span className="font-semibold">next market open</span>{" "}
            after a breakout. This scanner only shows setups where the breakout fired{" "}
            <span className="font-semibold">today or yesterday</span> — so the entry-day open is
            either right now (yesterday breakout → today's open) or the next session (today
            breakout → tomorrow's open). It also drops anything where price already hit the target,
            already stopped out, or already ran more than 10% past the breakout (you'd be chasing).
          </p>
        </div>

        <p className="text-muted-foreground/80 italic">
          In choppy or downtrending markets this scanner may return 0–3 setups per night. That's the
          system working — don't loosen the filters to force more signals.
        </p>
      </HelpBlock>
      <Tabs defaultValue="live" className="space-y-4">
        <TabsList>
          <TabsTrigger value="live" className="gap-1.5">
            <Flame className="h-3.5 w-3.5" />
            Live
          </TabsTrigger>
          <TabsTrigger value="watch" className="gap-1.5">
            <Eye className="h-3.5 w-3.5" />
            Watch
          </TabsTrigger>
          <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
          <TabsTrigger value="backtest">Backtest</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
        </TabsList>
        <TabsContent value="live"><LiveTab /></TabsContent>
        <TabsContent value="watch"><WatchTab /></TabsContent>
        <TabsContent value="portfolio"><PortfolioTab /></TabsContent>
        <TabsContent value="backtest"><BacktestTab /></TabsContent>
        <TabsContent value="config"><ConfigTab /></TabsContent>
      </Tabs>
      <Disclaimer />
    </div>
  );
}
