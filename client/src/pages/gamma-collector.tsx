/**
 * /gamma-collector — Gamma Collector watch (owner-only, Admin Playground).
 *
 * Keeps the quietly-accumulating dealer-gamma collector in front of you: a
 * progress bar toward the validation milestone, basket coverage, last run, and
 * the current gamma landscape (which big-caps are most short-gamma right now).
 * The landscape uses the shared sortable DataTable.
 */
import { useQuery } from "@tanstack/react-query";
import { PageTemplate } from "@/components/PageTemplate";
import { OptionsDelayNotice } from "@/components/OptionsDelayNotice";
import { DataTable, DataTableColumn } from "@/components/DataTable";

const fmtGex = (g: number) => {
  const a = Math.abs(g);
  if (a >= 1e9) return (g / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (g / 1e6).toFixed(1) + "M";
  return Math.round(g).toLocaleString();
};

const cols: DataTableColumn<any>[] = [
  { key: "ticker", header: "Ticker", accessor: s => <span className="font-medium text-foreground">{s.ticker}</span>, sortValue: s => s.ticker },
  { key: "regime", header: "Regime", accessor: s => s.regime === "short-γ" ? <span className="text-bear-light">short-γ</span> : <span className="text-bull-light">long-γ</span>, sortValue: s => s.totalGEX },
  { key: "gex", header: "GEX ($/1%)", type: "number", accessor: s => <span className={s.totalGEX < 0 ? "text-bear-light" : "text-bull-light"}>{fmtGex(s.totalGEX)}</span>, sortValue: s => s.totalGEX },
  {
    key: "bias", header: "Squeeze bias",
    accessor: s => (
      <>
        {s.squeezeBias === "up" ? <span className="text-bull-light">↑ up</span>
          : s.squeezeBias === "down" ? <span className="text-bear-light">↓ down</span>
          : <span className="text-muted-foreground">neutral</span>}
        {s.squeezeStrength ? <span className="text-muted-foreground"> ({(s.squeezeStrength * 100).toFixed(0)})</span> : null}
      </>
    ),
    sortValue: s => (s.squeezeBias === "up" ? s.squeezeStrength : s.squeezeBias === "down" ? -s.squeezeStrength : 0),
  },
  { key: "iv", header: "ATM IV", type: "number", accessor: s => s.atmIV ? (s.atmIV * 100).toFixed(0) + "%" : "—", sortValue: s => s.atmIV ?? -1 },
  { key: "date", header: "As of", accessor: s => s.date, sortValue: s => s.date },
];

export default function GammaCollectorPage() {
  const { data } = useQuery<any>({
    queryKey: ["/api/gamma-collector"],
    queryFn: () => fetch("/api/gamma-collector").then(r => r.json()),
    refetchInterval: 15000,
  });

  const Stat = ({ label, value }: { label: string; value: any }) => (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold text-foreground">{value}</div>
    </div>
  );

  return (
    <PageTemplate
      howItWorksTitle="What the collector is doing"
      howItWorks={
        <>
          <p>
            Every market close, the collector snapshots <strong className="text-foreground">dealer
            gamma + implied vol</strong> for the ~95-name big-cap basket and saves it. It can't be
            backtested (no historical option chains exist), so it builds the dataset <em>forward</em>.
            Once enough days accrue, the validation harness answers the load-bearing question for $0:
            <strong className="text-foreground"> does negative gamma predict higher forward volatility?</strong>
          </p>
          <p className="text-2xs italic text-muted-foreground">
            This page exists so you don't forget it's running. Nothing to do — just watch the bar fill.
          </p>
        </>
      }
    >
      <div className="space-y-5 max-w-[1100px] mx-auto p-1">
        <OptionsDelayNotice />
        {/* Progress toward validation */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-foreground">Progress to first validation read</div>
            <div className="text-2xs text-muted-foreground">{data ? `${data.daysCollected} / ~${data.targetDays} collection days` : "…"}</div>
          </div>
          <div className="h-3 w-full rounded-full bg-background overflow-hidden border border-border">
            <div className="h-full bg-primary transition-all" style={{ width: `${data?.progressPct ?? 0}%` }} />
          </div>
          <div className="text-2xs text-muted-foreground mt-2">
            {data?.daysCollected >= data?.targetDays
              ? "Enough data — run the validation harness for the verdict."
              : data ? `~${Math.max(0, data.targetDays - data.daysCollected)} more market closes until the first real read.` : ""}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Stat label="Basket" value={data ? `${data.basketSize} names` : "…"} />
          <Stat label="Days collected" value={data ? data.daysCollected : "…"} />
          <Stat label="Snapshots" value={data ? data.totalSnapshots.toLocaleString() : "…"} />
          <Stat label="Last coverage" value={data ? `${data.coveragePct}%` : "…"} />
          <Stat label="Last collected" value={data?.lastDate ?? "—"} />
        </div>

        {/* Basket gamma tape — macro regime */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-foreground">Basket gamma tape <span className="text-2xs text-muted-foreground">(net dealer gamma across all names, by day)</span></div>
            {data?.gexTrend?.length ? <div className="text-2xs text-muted-foreground">{(data.gexTrend[data.gexTrend.length - 1].shortPct * 100).toFixed(0)}% of basket short-γ today</div> : null}
          </div>
          {data?.gexTrend?.length >= 2 ? (() => {
            const g = data.gexTrend; const ys = g.map((r: any) => r.totalGex);
            const min = Math.min(...ys, 0), max = Math.max(...ys, 0), range = max - min || 1;
            const W = 600, H = 56, zeroY = H - ((0 - min) / range) * H;
            const d = g.map((r: any, i: number) => `${(i / (g.length - 1)) * W},${H - ((r.totalGex - min) / range) * H}`).join(" ");
            return (
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14" preserveAspectRatio="none">
                <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="#6b7280" strokeWidth="1" strokeDasharray="3" />
                <polyline points={d} fill="none" stroke="#f59e0b" strokeWidth="2" />
              </svg>
            );
          })() : <div className="text-2xs text-muted-foreground">Tape fills in as days accrue.</div>}
          <div className="text-2xs text-muted-foreground mt-1">Below the dashed zero-line = basket net <span className="text-bear-light">short-γ</span> (vol-amplifying, fragile); above = net <span className="text-bull-light">long-γ</span> (vol-suppressed, calm). This is the whole-market regime in one line.</div>
        </div>

        {/* Current gamma landscape */}
        <DataTable
          title="Current gamma landscape"
          rightSlot={<span className="text-2xs text-muted-foreground">most short-gamma first — squeeze-prone at top</span>}
          dense
          columns={cols}
          data={data?.latest ?? []}
          getRowKey={(s: any) => s.ticker}
          defaultSort={{ key: "gex", direction: "asc" }}
          emptyMessage="No snapshots yet — the collector runs at the next market close (21:30 UTC, weekdays)."
        />
      </div>
    </PageTemplate>
  );
}
