/**
 * /insiders — Monthly Insider Buy/Sell Ratio + ranked ticker tables.
 *
 * Source: FMP /insider-trading/latest, 30-day aggregations. SEC Form 4
 * deep-scan (with 10b5-1 footnote parsing) is a planned Pass-2 add —
 * will replace the FMP source where available and tag planned sales
 * separately from discretionary sales.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useTicker } from "@/contexts/TickerContext";
import { PageTemplate } from "@/components/PageTemplate";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { Loader2, ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown } from "lucide-react";

interface MarketRatio {
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  buyDollar: number;
  sellDollar: number;
  buyCount: number;
  sellCount: number;
  buySellRatio: number;
  sellShare: number;
  planned10b5_1Dollar: number | null;
  discretionaryRatio: number | null;
  planned10b5_1Count: number;
}

interface PerSymbolRatio {
  symbol: string;
  buyDollar: number;
  sellDollar: number;
  buyCount: number;
  sellCount: number;
  sellShare: number;
  buySellRatio: number;
  planned10b5_1Dollar: number | null;
  discretionaryRatio: number | null;
}

interface RatioResponse {
  market: { current: MarketRatio; prior: MarketRatio; momDelta: number };
  perSymbol: PerSymbolRatio[];
  scannedAt: string;
}

interface InsiderCluster {
  symbol: string;
  direction: "buy" | "sell";
  insiderCount: number;
  totalShares: number;
  totalDollar: number;
  topInsiders: string[];
  windowDays: number;
  convictionScore: number;
  concentration: number;
  flags: string[];
}

interface ClustersResponse {
  clusters: InsiderCluster[];
  scannedAt: string;
  windowDays: number;
}

function fmtRatio(r: number | null | undefined): string {
  if (r == null || typeof r !== "number" || Number.isNaN(r)) return "—";
  if (!isFinite(r)) return "∞";
  if (r >= 10) return r.toFixed(1);
  return r.toFixed(2);
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || typeof n !== "number" || Number.isNaN(n)) return "$0";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function ratioTone(r: number): string {
  if (!isFinite(r) || r >= 1.5) return "text-bull-light";
  if (r >= 0.66) return "text-watch-light";
  return "text-bear-light";
}

function ratioLabel(r: number): string {
  if (!isFinite(r) || r >= 2) return "Strong buying";
  if (r >= 1.2) return "Buying skew";
  if (r >= 0.83) return "Balanced";
  if (r >= 0.5) return "Selling skew";
  return "Strong selling";
}

export default function InsidersPage() {
  const [, navigate] = useLocation();
  const { setActiveTicker } = useTicker();
  const qc = useQueryClient();
  // Set the global active ticker AND navigate to a research page. Without
  // setActiveTicker, Profile / Trade Analysis / Confluence Pulse would all
  // stay on whatever ticker the user had open before — the URL param alone
  // doesn't reach those pages (they read from TickerContext, not the URL).
  const drillToTicker = (symbol: string) => {
    setActiveTicker(symbol);
    navigate(`/institutional?ticker=${symbol}`);
  };
  // Chris rule (2026-05-22): only show high-signal rows — either ≥$1M
  // dollar activity OR ≥3 distinct insiders transacting in the window
  // (the latter mirrors the insider-cluster definition). Small isolated
  // trades aren't conviction trades; clusters of small trades are.
  const [minActivity, setMinActivity] = useState<number>(1_000_000);
  const MIN_INSIDERS_FALLBACK = 3;

  const { data, isLoading, error, isFetching } = useQuery<RatioResponse>({
    queryKey: ["/api/dashboard/insiders/ratio"],
    queryFn: async () => (await apiRequest("GET", "/api/dashboard/insiders/ratio")).json(),
    refetchInterval: 60 * 60 * 1000,
    staleTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Conviction buy clusters — 14-day window, 3+ unique insiders, ranked by
  // conviction score (penalises sponsor-flood pattern like BXDC IPO mechanics).
  const { data: clusterData, isFetching: clusterFetching } = useQuery<ClustersResponse>({
    queryKey: ["/api/dashboard/insiders/clusters?direction=buy&limit=15"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/dashboard/insiders/clusters?direction=buy&limit=15")).json(),
    refetchInterval: 60 * 60 * 1000,
    staleTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const filteredRows = useMemo(() => {
    if (!data) return [] as PerSymbolRatio[];
    return data.perSymbol.filter(r => {
      const isHighDollar = (r.buyDollar + r.sellDollar) >= minActivity;
      const isCluster = (r.buyCount + r.sellCount) >= MIN_INSIDERS_FALLBACK;
      return isHighDollar || isCluster;
    });
  }, [data, minActivity]);

  return (
    <PageTemplate
      maxWidth="max-w-7xl"
      howItWorks={
        <>
          <p>The Monthly Insider Buy/Sell Ratio aggregates open-market Form 4 transactions (P-Purchase + S-Sale) across the entire insider universe over a 30-day window. The single big number at the top is <code>buy$ / sell$</code> — &gt;1 means insiders are buying more than they're selling.</p>
          <p><strong className="text-foreground">Market tile</strong>: current 30-day ratio, the prior 30-day comparison, and the month-over-month delta. Aggregate buy$/sell$ totals + distinct insider counts on each side.</p>
          <p><strong className="text-foreground">Ranked ticker table</strong>: every ticker with insider activity in the window. Sort by total activity (loudest names first), or pivot to most-bought / most-sold rankings. The <code>Min activity</code> filter hides low-volume noise (default $100K so the table doesn't drown in small grants and gifts).</p>
          <p><strong className="text-foreground">10b5-1 awareness</strong>: SEC Form 4 footnotes are parsed by a separate hourly cron and stored alongside the FMP data. When a sell transaction's footnote mentions a 10b5-1 trading plan, it's flagged as <em>planned</em> — pre-scheduled tax-advantaged selling, not a discretionary signal. The Discretionary B/S Ratio strips these out so you see what insiders are actually <em>choosing</em> to sell. A ticker can have a noisy raw B/S of 0.05 (heavy selling) but a discretionary B/S of 1.2 if most of the sells were planned months in advance.</p>
          <p><strong className="text-foreground">Source</strong>: FMP <code>/insider-trading/latest</code> feed for the buy/sell aggregates; SEC EDGAR Form 4 XML for the 10b5-1 flag. Form 4 coverage backfills hourly — recently-listed tickers may show "—" in the 10b5-1 column until the sweep picks them up.</p>
          <p><strong className="text-foreground">How to read it</strong>: ratios &gt;1.5 = strong buying conviction (rare and informative), 0.66–1.5 = balanced/typical, &lt;0.66 = selling skew. Month-over-month deltas matter more than absolute level — a swing from 0.4 → 0.9 is a more interesting signal than a static 0.9. <strong className="text-foreground">When the raw and discretionary ratios disagree, trust the discretionary one</strong> — that's the real signal.</p>
        </>
      }
    >
      {isLoading && (
        <div className="flex items-center justify-center py-20 gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Scanning insider transactions…
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-bear/10 border border-bear/30 p-4 text-sm text-bear-light">
          Failed to load insider ratio data. The scan may still be warming the cache — retry in 60s.
        </div>
      )}

      {data && (
        <>
          {/* Market headline ribbon */}
          <MarketRibbon current={data.market.current} prior={data.market.prior} momDelta={data.market.momDelta} />

          {/* Conviction buy clusters — high-signal MRP-style setups */}
          <ConvictionClusters
            clusters={clusterData?.clusters ?? []}
            onDrillTo={drillToTicker}
            isRefreshing={clusterFetching}
            onRefresh={() => qc.invalidateQueries({ queryKey: ["/api/dashboard/insiders/clusters?direction=buy&limit=15"] })}
          />

          {/* Ranked tickers — shared DataTable for sortable columns + refresh */}
          <RankedTickersTable
            rows={filteredRows.slice(0, 200)}
            totalRows={data.perSymbol.length}
            passingRows={filteredRows.length}
            minActivity={minActivity}
            setMinActivity={setMinActivity}
            minInsidersFallback={MIN_INSIDERS_FALLBACK}
            onDrillTo={drillToTicker}
            isRefreshing={isFetching}
            onRefresh={() => qc.invalidateQueries({ queryKey: ["/api/dashboard/insiders/ratio"] })}
          />

          <p className="text-micro text-muted-foreground italic">
            Scanned {new Date(data.scannedAt).toLocaleString()}. Cache refreshes every 60 minutes.
          </p>
        </>
      )}
    </PageTemplate>
  );
}

function MarketRibbon({ current, prior, momDelta }: { current: MarketRatio; prior: MarketRatio; momDelta: number }) {
  const tone = ratioTone(current.buySellRatio);
  const discTone = current.discretionaryRatio != null ? ratioTone(current.discretionaryRatio) : "text-muted-foreground";
  const trendUp = momDelta > 0;
  const discretionarySell = current.planned10b5_1Dollar != null
    ? Math.max(0, current.sellDollar - current.planned10b5_1Dollar)
    : null;
  return (
    <div className="bg-card border border-card-border rounded-lg p-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
        {/* Big numbers — raw + discretionary side-by-side */}
        <div className="flex flex-col items-start gap-1 md:col-span-1">
          <div className="text-micro text-muted-foreground uppercase tracking-wider font-semibold">Market B/S ratio · last 30d</div>
          <div className={`text-6xl font-bold tabular-nums ${tone}`}>{fmtRatio(current.buySellRatio)}</div>
          <div className={`text-base font-semibold ${tone}`}>{ratioLabel(current.buySellRatio)}</div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums mt-1">
            {trendUp ? <ArrowUpRight className="h-3.5 w-3.5 text-bull-light" /> : <ArrowDownRight className="h-3.5 w-3.5 text-bear-light" />}
            <span>{typeof momDelta === "number" && !Number.isNaN(momDelta) ? `${momDelta > 0 ? "+" : ""}${momDelta.toFixed(2)}` : "—"} vs prior 30d ({fmtRatio(prior.buySellRatio)})</span>
          </div>

          {/* Discretionary ratio (10b5-1 stripped) — separate, less noisy view */}
          {current.discretionaryRatio != null && (
            <div className="mt-3 pt-3 border-t border-card-border w-full">
              <div className="text-micro text-muted-foreground uppercase tracking-wider font-semibold">
                Discretionary B/S (10b5-1 excluded)
              </div>
              <div className={`text-2xl font-bold tabular-nums ${discTone}`}>{fmtRatio(current.discretionaryRatio)}</div>
              <div className="text-micro text-muted-foreground">
                Removes {fmtMoney(current.planned10b5_1Dollar ?? 0)} of pre-scheduled sales ({current.planned10b5_1Count} txns)
              </div>
            </div>
          )}
          {current.discretionaryRatio == null && (
            <div className="mt-3 pt-3 border-t border-card-border w-full">
              <div className="text-micro text-muted-foreground italic">
                Discretionary ratio (10b5-1 stripped) unavailable — Form 4 sweep hasn't populated yet.
              </div>
            </div>
          )}
        </div>

        {/* Buy / Sell totals */}
        <div className="grid grid-cols-2 gap-4 md:col-span-2">
          <div className="bg-bull/5 border border-bull/30 rounded p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp className="h-3.5 w-3.5 text-bull-light" />
              <span className="text-micro uppercase tracking-wider font-semibold text-muted-foreground">Total buys</span>
            </div>
            <div className="text-2xl font-bold text-bull-light tabular-nums">{fmtMoney(current.buyDollar)}</div>
            <div className="text-micro text-muted-foreground tabular-nums">{current.buyCount} distinct insiders</div>
          </div>
          <div className="bg-bear/5 border border-bear/30 rounded p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingDown className="h-3.5 w-3.5 text-bear-light" />
              <span className="text-micro uppercase tracking-wider font-semibold text-muted-foreground">Total sells</span>
            </div>
            <div className="text-2xl font-bold text-bear-light tabular-nums">{fmtMoney(current.sellDollar)}</div>
            <div className="text-micro text-muted-foreground tabular-nums">{current.sellCount} distinct insiders</div>
            {discretionarySell != null && (
              <div className="text-micro text-muted-foreground/80 mt-1">
                Discretionary: {fmtMoney(discretionarySell)} · Planned: {fmtMoney(current.planned10b5_1Dollar ?? 0)}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <SkewBar sellShare={current.sellShare} tall />
      </div>
    </div>
  );
}

function SkewBar({ sellShare, tall = false }: { sellShare: number; tall?: boolean }) {
  const buyPct = (1 - sellShare) * 100;
  const sellPct = sellShare * 100;
  return (
    <div className={`flex w-full rounded overflow-hidden bg-muted ${tall ? "h-3" : "h-1.5"}`}>
      <div className="bg-bull/70 transition-all" style={{ width: `${buyPct}%` }} title={`${buyPct.toFixed(0)}% buy $`} />
      <div className="bg-bear/70 transition-all" style={{ width: `${sellPct}%` }} title={`${sellPct.toFixed(0)}% sell $`} />
    </div>
  );
}

/**
 * Conviction Clusters — top 10 buy clusters ranked by conviction score.
 * Uses the shared DataTable so headers are click-to-sort, the score column
 * gets a min-score filter, and a refresh button sits in the header.
 */
function ConvictionClusters({
  clusters,
  onDrillTo,
  isRefreshing,
  onRefresh,
}: {
  clusters: InsiderCluster[];
  onDrillTo: (sym: string) => void;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  if (clusters.length === 0) {
    return (
      <div className="bg-card border border-card-border rounded-lg p-4 text-xs text-muted-foreground">
        🔥 <span className="font-bold text-foreground">Conviction Buy Clusters</span> — no clusters in the last 14 days yet. The scan refreshes hourly.
      </div>
    );
  }
  const top = clusters.slice(0, 10);
  const columns: DataTableColumn<InsiderCluster>[] = [
    {
      key: "symbol",
      header: "Ticker",
      accessor: (c) => <span className="font-mono font-bold text-foreground">{c.symbol}</span>,
      sortValue: (c) => c.symbol,
    },
    {
      key: "convictionScore",
      header: "Score",
      type: "score",
      sortValue: (c) => c.convictionScore,
      accessor: (c) => (
        <span
          className={`inline-block px-2 py-0.5 rounded font-bold ${
            c.convictionScore >= 75
              ? "bg-bull/15 text-bull border border-bull/40"
              : c.convictionScore >= 60
              ? "bg-watch/15 text-watch-light border border-watch/40"
              : "bg-muted text-muted-foreground border border-card-border"
          }`}
        >
          {c.convictionScore}
        </span>
      ),
    },
    {
      key: "insiderCount",
      header: "Insiders",
      type: "number",
      sortValue: (c) => c.insiderCount,
      accessor: (c) => c.insiderCount,
    },
    {
      key: "totalDollar",
      header: "Total $",
      type: "number",
      sortValue: (c) => c.totalDollar,
      accessor: (c) => <span className="font-semibold">{fmtMoney(c.totalDollar)}</span>,
    },
    {
      key: "concentration",
      header: "Top %",
      type: "number",
      sortValue: (c) => c.concentration,
      accessor: (c) => (
        <span
          className={
            c.concentration > 0.8
              ? "text-bear-light"
              : c.concentration > 0.6
              ? "text-watch-light"
              : "text-muted-foreground"
          }
        >
          {(c.concentration * 100).toFixed(0)}%
        </span>
      ),
    },
    {
      key: "topInsiders",
      header: "Top buyers",
      sortable: false,
      accessor: (c) => (
        <span className="text-muted-foreground truncate max-w-[260px] inline-block align-bottom" title={c.topInsiders.join(", ")}>
          {c.topInsiders.join(", ")}
        </span>
      ),
    },
    {
      key: "flags",
      header: "Flags",
      sortable: false,
      accessor: (c) =>
        c.flags.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {c.flags.map((f) => (
              <span
                key={f}
                className={`px-1.5 py-0.5 rounded text-mini ${
                  f === "broad-cluster"
                    ? "bg-bull/15 text-bull-light border border-bull/40"
                    : f === "high-dollar"
                    ? "bg-bull/10 text-bull-light border border-bull/30"
                    : f === "sponsor-pattern" || f === "single-dominant"
                    ? "bg-bear/15 text-bear-light border border-bear/40"
                    : f === "top-heavy" || f === "low-dollar"
                    ? "bg-watch/15 text-watch-light border border-watch/40"
                    : "bg-muted text-muted-foreground border border-card-border"
                }`}
              >
                {f}
              </span>
            ))}
          </div>
        ),
    },
  ];

  return (
    <DataTable
      title={
        <span className="flex items-center gap-1.5">
          🔥 Conviction Buy Clusters
          <span className="text-xs font-normal text-muted-foreground">(last 14 days · 3+ insiders)</span>
        </span>
      }
      columns={columns}
      data={top}
      getRowKey={(c) => c.symbol}
      defaultSort={{ key: "convictionScore", direction: "desc" }}
      showScoreFilter
      onRowClick={(c) => onDrillTo(c.symbol)}
      onRefresh={onRefresh}
      isRefreshing={isRefreshing}
    />
  );
}

/**
 * Ranked tickers — shared DataTable; columns are click-to-sort and the
 * Min $ activity filter stays as a page-level control (it is a dollar
 * threshold, not a "score" filter).
 */
function RankedTickersTable({
  rows,
  totalRows,
  passingRows,
  minActivity,
  setMinActivity,
  minInsidersFallback,
  onDrillTo,
  isRefreshing,
  onRefresh,
}: {
  rows: PerSymbolRatio[];
  totalRows: number;
  passingRows: number;
  minActivity: number;
  setMinActivity: (n: number) => void;
  minInsidersFallback: number;
  onDrillTo: (sym: string) => void;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  const columns: DataTableColumn<PerSymbolRatio>[] = [
    {
      key: "symbol",
      header: "Ticker",
      sortValue: (r) => r.symbol,
      accessor: (r) => <span className="font-mono font-bold text-foreground">{r.symbol}</span>,
    },
    {
      key: "buyDollar",
      header: "Buy $",
      type: "number",
      sortValue: (r) => r.buyDollar,
      accessor: (r) => <span className="text-bull-light">{fmtMoney(r.buyDollar)}</span>,
    },
    {
      key: "sellDollar",
      header: "Sell $",
      type: "number",
      sortValue: (r) => r.sellDollar,
      accessor: (r) => <span className="text-bear-light">{fmtMoney(r.sellDollar)}</span>,
    },
    {
      key: "planned",
      header: "10b5-1",
      type: "number",
      sortValue: (r) => r.planned10b5_1Dollar ?? -1,
      accessor: (r) => {
        const heavyPlanned =
          r.planned10b5_1Dollar != null && r.sellDollar > 0 && r.planned10b5_1Dollar / r.sellDollar >= 0.5;
        if (r.planned10b5_1Dollar == null) {
          return (
            <span className="text-muted-foreground/40" title="No Form 4 coverage yet">
              —
            </span>
          );
        }
        if (r.planned10b5_1Dollar === 0) return <span className="text-muted-foreground/60">$0</span>;
        return (
          <span
            className={heavyPlanned ? "text-watch-light font-semibold" : "text-muted-foreground"}
            title={heavyPlanned ? "Most of this ticker's selling is pre-scheduled (10b5-1)" : undefined}
          >
            {fmtMoney(r.planned10b5_1Dollar)}
          </span>
        );
      },
    },
    {
      key: "bsRatio",
      header: "B/S",
      type: "number",
      sortValue: (r) => (isFinite(r.buySellRatio) ? r.buySellRatio : Number.MAX_SAFE_INTEGER),
      accessor: (r) => <span className={`font-semibold ${ratioTone(r.buySellRatio)}`}>{fmtRatio(r.buySellRatio)}</span>,
    },
    {
      key: "discRatio",
      header: "Disc. B/S",
      type: "number",
      sortValue: (r) => (r.discretionaryRatio == null ? -1 : isFinite(r.discretionaryRatio) ? r.discretionaryRatio : Number.MAX_SAFE_INTEGER),
      accessor: (r) =>
        r.discretionaryRatio == null ? (
          <span className="text-muted-foreground/40">—</span>
        ) : (
          <span className={`font-semibold ${ratioTone(r.discretionaryRatio)}`}>{fmtRatio(r.discretionaryRatio)}</span>
        ),
    },
    {
      key: "insiders",
      header: "Insiders",
      type: "number",
      sortValue: (r) => r.buyCount + r.sellCount,
      accessor: (r) => (
        <span className="text-muted-foreground">
          <span className="text-bull-light">{r.buyCount}B</span> / <span className="text-bear-light">{r.sellCount}S</span>
        </span>
      ),
    },
    {
      key: "skew",
      header: "Skew",
      sortValue: (r) => r.sellShare,
      accessor: (r) => <SkewBar sellShare={r.sellShare} />,
    },
  ];

  return (
    <DataTable
      title={
        <span className="flex flex-col items-start">
          <span>Ranked tickers (last 30d)</span>
          <span className="text-micro text-muted-foreground font-normal">
            {totalRows} tickers with insider activity; {passingRows} pass filter (≥${(minActivity / 1_000_000).toFixed(0)}M activity OR ≥{minInsidersFallback} insiders).
          </span>
        </span>
      }
      rightSlot={
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Min activity</span>
          <select
            value={minActivity}
            onChange={(e) => setMinActivity(Number(e.target.value))}
            className="bg-background border border-card-border rounded px-2 py-1 text-foreground text-xs"
            data-testid="insiders-min-activity"
          >
            <option value={1_000_000}>$1M (default)</option>
            <option value={5_000_000}>$5M</option>
            <option value={10_000_000}>$10M</option>
            <option value={25_000_000}>$25M</option>
          </select>
        </label>
      }
      columns={columns}
      data={rows}
      getRowKey={(r) => r.symbol}
      defaultSort={{ key: "buyDollar", direction: "desc" }}
      onRowClick={(r) => onDrillTo(r.symbol)}
      onRefresh={onRefresh}
      isRefreshing={isRefreshing}
      emptyMessage="No tickers match the activity filter. Lower it to see more rows."
    />
  );
}
