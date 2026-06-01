/**
 * Unified Scanner page — one scanner across every quality-scored strategy.
 * Required filters (market-cap tier + adaptive price band) gate the scan;
 * results are green-grade (80+) only, deterministic, best-first. Company names
 * route to /profile (Company Research) via the site-wide ticker-nav rule.
 */
import { useState, useMemo } from "react";
import { PageTemplate } from "@/components/PageTemplate";
import { useTickerNavigate } from "@/lib/useTickerNavigate";
import { useUnifiedScanner } from "@/compartments/unified-scanner/useUnifiedScanner";
import { MARKET_CAP_TIERS, MIN_GREEN, DEFAULT_TOP_N, type ScanFilters } from "@shared/scanner/types";
import { listScannableStrategies } from "@shared/strategies/registry";
import { Radar, Loader2, RefreshCw, TrendingUp, ArrowUpRight } from "lucide-react";

const SECTORS = [
  "All", "Technology", "Healthcare", "Financial Services", "Consumer Cyclical",
  "Communication Services", "Industrials", "Consumer Defensive", "Energy",
  "Real Estate", "Utilities", "Basic Materials",
];

const SCANNABLE = listScannableStrategies();

export default function UnifiedScannerPage() {
  const drillTo = useTickerNavigate();

  const [tierId, setTierId] = useState<string>("");
  const [bandId, setBandId] = useState<string>("");
  const [sector, setSector] = useState<string>("All");
  const [strategyIds, setStrategyIds] = useState<string[]>(
    SCANNABLE.filter(m => m.liveScan?.defaultOn).map(m => m.id),
  );
  const [minScore, setMinScore] = useState<number>(MIN_GREEN);
  const [topN, setTopN] = useState<number>(DEFAULT_TOP_N);
  const [submitted, setSubmitted] = useState<ScanFilters | null>(null);
  const [refresh, setRefresh] = useState(false);

  const tier = MARKET_CAP_TIERS.find(t => t.id === tierId);
  const priceBands = tier?.priceBands ?? [];
  const canScan = !!tierId && !!bandId && strategyIds.length > 0;

  const { data, isLoading, error, refetch } = useUnifiedScanner(submitted, refresh);

  function runScan(asRefresh: boolean) {
    if (!canScan) return;
    setRefresh(asRefresh);
    const f: ScanFilters = {
      marketCapTier: tierId as ScanFilters["marketCapTier"],
      priceBandId: bandId, sector, strategyIds, minScore, topN,
    };
    setSubmitted(f);
    if (asRefresh) setTimeout(() => refetch(), 0);
  }

  function toggleStrategy(id: string) {
    setStrategyIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  const hits = data?.hits ?? [];
  const emptyReason = useMemo(() => {
    if (!tier || !bandId) return "";
    const band = priceBands.find(b => b.id === bandId);
    return `No green-grade setups in ${tier.label.split(" (")[0]} / ${band?.label ?? ""}${sector !== "All" ? ` / ${sector}` : ""} right now — widen a filter or try "Refresh now".`;
  }, [tier, bandId, sector, priceBands]);

  return (
    <PageTemplate>
      <div className="space-y-5">
        {/* ─── Filters ─── */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Market cap — required, no All */}
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Market Cap <span className="text-amber-500">*required</span>
              <select
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                value={tierId}
                onChange={(e) => { setTierId(e.target.value); setBandId(""); }}
              >
                <option value="">Choose a tier…</option>
                {MARKET_CAP_TIERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>

            {/* Price — required, adapts to tier */}
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Price <span className="text-amber-500">*required</span>
              <select
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-40"
                value={bandId}
                disabled={!tierId}
                onChange={(e) => setBandId(e.target.value)}
              >
                <option value="">{tierId ? "Choose a range…" : "Pick a market cap first"}</option>
                {priceBands.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            </label>

            {/* Sector — optional */}
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Sector
              <select
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                value={sector}
                onChange={(e) => setSector(e.target.value)}
              >
                {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>

            {/* Top N */}
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Max results
              <input
                type="number" min={1} max={200} value={topN}
                onChange={(e) => setTopN(Math.min(200, Math.max(1, Number(e.target.value) || DEFAULT_TOP_N)))}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>
          </div>

          {/* Strategies */}
          <div className="mt-3 flex flex-wrap gap-2">
            {SCANNABLE.map(m => (
              <button
                key={m.id}
                onClick={() => toggleStrategy(m.id)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  strategyIds.includes(m.id)
                    ? "border-primary bg-primary/15 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {m.shortName}{m.experimental ? " (exp)" : ""}
              </button>
            ))}
          </div>

          {/* Score gate notice + scan buttons */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Showing <span className="text-green-500 font-medium">green-grade setups only ({minScore}+)</span>.
              <input
                type="range" min={MIN_GREEN} max={100} value={minScore}
                onChange={(e) => setMinScore(Math.max(MIN_GREEN, Number(e.target.value)))}
                className="ml-3 align-middle accent-green-500"
              />
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => runScan(false)}
                disabled={!canScan}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
              >
                <Radar className="h-4 w-4" /> Scan
              </button>
              <button
                onClick={() => runScan(true)}
                disabled={!canScan}
                title="Bypass the cache and re-scan now"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Refresh now
              </button>
            </div>
          </div>
          {!canScan && (
            <p className="mt-2 text-xs text-amber-500">Choose a market cap, a price range, and at least one strategy to scan.</p>
          )}
        </div>

        {/* ─── Results ─── */}
        {submitted && isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg border border-border bg-card/60" />
            ))}
            <p className="text-center text-xs text-muted-foreground">
              {refresh ? "Re-scanning the market…" : "Scanning…"}
            </p>
          </div>
        )}

        {submitted && error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-6 text-center">
            <p className="text-sm text-red-400">Couldn't run the scan. Try Refresh now, or adjust a filter.</p>
          </div>
        )}

        {submitted && !isLoading && !error && hits.length === 0 && (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <Radar className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">{emptyReason}</p>
          </div>
        )}

        {submitted && !isLoading && hits.length > 0 && (
          <>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{hits.length} green-grade setup{hits.length === 1 ? "" : "s"}</span>
              {data?.source === "cache" && data.ageHours != null && (
                <span>from last scan ({data.ageHours}h ago) · Refresh now for live</span>
              )}
              {data?.source === "live" && <span>live scan</span>}
            </div>
            <div className="space-y-2">
              {hits.map((h, i) => (
                <div key={`${h.symbol}-${h.strategyId}-${i}`} className="flex items-center gap-4 rounded-lg border border-border bg-card p-3">
                  <div className="flex w-14 flex-col items-center">
                    <span className="rounded-md bg-green-500/15 px-2 py-0.5 text-sm font-bold text-green-500">{h.score}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <button
                      onClick={() => drillTo(h.symbol)}
                      className="group inline-flex items-center gap-1 text-left"
                    >
                      <span className="font-mono font-semibold text-foreground">{h.symbol}</span>
                      <span className="truncate text-xs text-muted-foreground group-hover:text-foreground">{h.companyName}</span>
                      <ArrowUpRight className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                        <TrendingUp className="h-3 w-3" />{h.strategyLabel}
                      </span>
                      <span>${h.price.toFixed(2)}</span>
                      <span>{h.sector}</span>
                      <span className="text-muted-foreground/70">{h.asOf}</span>
                    </div>
                  </div>
                  <div className="hidden shrink-0 gap-4 text-right text-xs sm:flex">
                    <div><div className="text-muted-foreground/60">Entry</div><div className="font-mono text-foreground">${h.entry.toFixed(2)}</div></div>
                    <div><div className="text-muted-foreground/60">Stop</div><div className="font-mono text-red-400">${h.stop.toFixed(2)}</div></div>
                    <div><div className="text-muted-foreground/60">Target</div><div className="font-mono text-green-500">${h.target.toFixed(2)}</div></div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </PageTemplate>
  );
}
