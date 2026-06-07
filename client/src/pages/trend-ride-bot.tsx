/**
 * /trend-ride-bot — BBTC Trend-Ride Paper Bot (owner-only, Admin Playground).
 *
 * Watchable dashboard for the in-process, deterministic stock trend-rider: it
 * takes BBTC's validated long entry, then RIDES the trend until a significant
 * break of the long EMA (default 168, 2-close confirm) — winners run, losers cut
 * at the catastrophe stop. Seeds from real recent history, then runs forward
 * daily. Mark-to-market account value (realized + open). Talks to
 * /api/trend-ride-bot. Tables use the shared DataTable.
 */
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageTemplate } from "@/components/PageTemplate";
import { DataTable, DataTableColumn } from "@/components/DataTable";

const fmt$ = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString();
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toFixed(1) + "%");
const money = (v: number | null | undefined) =>
  v != null ? <span className={v >= 0 ? "text-bull-light" : "text-bear-light"}>{fmt$(v)}</span> : <span className="text-muted-foreground">—</span>;
const pctCell = (v: number | null | undefined) =>
  v != null ? <span className={v >= 0 ? "text-bull-light" : "text-bear-light"}>{(v >= 0 ? "+" : "") + v.toFixed(1)}%</span> : <span className="text-muted-foreground">—</span>;

function Sparkline({ pts }: { pts: { date: string; equity: number }[] }) {
  if (!pts || pts.length < 2) return <div className="text-2xs text-muted-foreground">Equity curve appears once the bot has processed some history.</div>;
  const ys = pts.map(p => p.equity);
  const min = Math.min(...ys), max = Math.max(...ys), range = max - min || 1;
  const W = 600, H = 80;
  const d = pts.map((p, i) => `${(i / (pts.length - 1)) * W},${H - ((p.equity - min) / range) * H}`).join(" ");
  const up = ys[ys.length - 1] >= ys[0];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" preserveAspectRatio="none">
      <polyline points={d} fill="none" stroke={up ? "#16a34a" : "#dc2626"} strokeWidth="2" />
    </svg>
  );
}

const posCols: DataTableColumn<any>[] = [
  { key: "ticker", header: "Ticker", width: "w-20", accessor: p => <span className="font-medium text-foreground">{p.ticker}</span>, sortValue: p => p.ticker },
  { key: "entry", header: "Entry", width: "w-28", accessor: p => `${p.shares} @ $${p.entryPrice}`, sortValue: p => p.entryPrice },
  { key: "mark", header: "Mark", type: "price", width: "w-20", accessor: p => p.markPrice != null ? `$${p.markPrice}` : "—", sortValue: p => p.markPrice ?? 0 },
  { key: "upnl", header: "Open P&L", type: "price", width: "w-24", accessor: p => money(p.unrealPnl$), sortValue: p => p.unrealPnl$ ?? 0 },
  { key: "upnlpct", header: "Open %", type: "number", width: "w-20", accessor: p => pctCell(p.unrealPnlPct), sortValue: p => p.unrealPnlPct ?? 0 },
  { key: "stop", header: "Cat. stop", type: "price", width: "w-20", accessor: p => `$${p.hardStop}`, sortValue: p => p.hardStop },
  { key: "held", header: "Held", type: "number", width: "w-20", accessor: p => `${p.daysHeld}d`, sortValue: p => p.daysHeld },
];
const tradeCols: DataTableColumn<any>[] = [
  { key: "ticker", header: "Ticker", width: "w-20", accessor: t => <span className="font-medium text-foreground">{t.ticker}</span>, sortValue: t => t.ticker },
  { key: "entry", header: "Entry", width: "w-28", accessor: t => `${t.shares} @ $${t.entryPrice}`, sortValue: t => t.entryDate },
  { key: "exit", header: "Exit", type: "price", width: "w-20", accessor: t => `$${t.exitPrice}`, sortValue: t => t.exitPrice },
  { key: "pnl", header: "P&L", type: "price", width: "w-24", accessor: t => money(t.pnl$), sortValue: t => t.pnl$ },
  { key: "ret", header: "Return", type: "number", width: "w-20", accessor: t => pctCell(t.pnlPct), sortValue: t => t.pnlPct },
  { key: "hold", header: "Hold", type: "number", width: "w-20", accessor: t => `${t.holdDays}d`, sortValue: t => t.holdDays },
  { key: "why", header: "Exit on", width: "w-24", accessor: t => t.exitReason === "stop" ? <span className="text-bear-light">stop</span> : <span className="text-muted-foreground">trend-break</span>, sortValue: t => t.exitReason },
  { key: "date", header: "Date", width: "w-28", accessor: t => t.exitDate, sortValue: t => t.exitDate },
];

export default function TrendRideBotPage() {
  const { data, refetch } = useQuery<any>({
    queryKey: ["/api/trend-ride-bot"],
    queryFn: () => fetch("/api/trend-ride-bot").then(r => r.json()),
    refetchInterval: 8000,
  });
  const [cfg, setCfg] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data?.config && !cfg) setCfg(data.config); }, [data, cfg]);

  const post = async (url: string, body?: any) => {
    setBusy(true);
    try { await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); }
    finally { setBusy(false); refetch(); }
  };

  const Stat = ({ label, value, color }: { label: string; value: any; color?: string }) => (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold ${color ?? "text-foreground"}`}>{value}</div>
    </div>
  );

  return (
    <PageTemplate
      howItWorksTitle="How the Trend-Ride bot plays"
      howItWorks={
        <>
          <p>
            A <strong className="text-foreground">deterministic paper bot</strong> trading the
            OOS-validated <strong className="text-foreground">BBTC Trend-Ride</strong>: it takes BBTC's
            long entry, then <strong className="text-bull-light">rides the trend</strong> until a
            significant break — {data?.config ? `${data.config.breakConfirmBars} closes below the ${data.config.exitEmaPeriod}-EMA` : "two closes below the long EMA"} —
            with a 2.5×ATR catastrophe stop as the only floor. Winners run for months; losers get cut.
          </p>
          <p className="text-2xs italic text-muted-foreground">
            Paper only — no broker, no real money. Account value is mark-to-market (realized cash + open
            position marks), because this rider holds winners open for a year+ and realized-only would
            badly understate it. It seeds from real recent history, then runs forward each market close.
          </p>
        </>
      }
    >
      <div className="space-y-5 max-w-[1100px] mx-auto p-1">
        {/* Account row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <Stat label="Account value" value={data ? fmt$(data.accountValue) : "…"} color={data && data.accountValue >= data.startingEquity ? "text-bull-light" : "text-bear-light"} />
          <Stat label="Total P&L" value={data ? fmt$(data.totalPnl) : "…"} color={data && data.totalPnl >= 0 ? "text-bull-light" : "text-bear-light"} />
          <Stat label="Open P&L" value={data ? fmt$(data.openPnl ?? 0) : "…"} color={data && (data.openPnl ?? 0) >= 0 ? "text-bull-light" : "text-bear-light"} />
          <Stat label="Return" value={data ? pct(data.totalReturnPct) : "…"} color={data && data.totalReturnPct >= 0 ? "text-bull-light" : "text-bear-light"} />
          <Stat label="Win Rate" value={data ? pct(data.winRate) : "…"} />
          <Stat label="Open" value={data ? `${data.openCount}/${data.config?.maxPositions}` : "…"} />
          <Stat label="Closed" value={data ? data.closedCount : "…"} />
        </div>

        {/* Controls */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-foreground">Money &amp; Rules</div>
            <div className="text-2xs text-muted-foreground">
              {data?.running ? "⏳ run in progress…" : data?.lastRun ? `last run ${new Date(data.lastRun).toLocaleString()} · through ${data.processedThrough ?? "—"}` : "not run yet"}
            </div>
          </div>
          {cfg && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <label className="text-2xs text-muted-foreground">Account ($)
                <input type="number" value={cfg.startingEquity} onChange={e => setCfg({ ...cfg, startingEquity: +e.target.value })}
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground" />
              </label>
              <label className="text-2xs text-muted-foreground">Position size (%)
                <input type="number" step="1" value={+(cfg.positionPct * 100).toFixed(0)} onChange={e => setCfg({ ...cfg, positionPct: +e.target.value / 100 })}
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground" />
              </label>
              <label className="text-2xs text-muted-foreground">Max positions
                <input type="number" value={cfg.maxPositions} onChange={e => setCfg({ ...cfg, maxPositions: +e.target.value })}
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground" />
              </label>
              <label className="text-2xs text-muted-foreground">Trend EMA (period)
                <input type="number" value={cfg.exitEmaPeriod} onChange={e => setCfg({ ...cfg, exitEmaPeriod: +e.target.value })}
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground" />
              </label>
              <label className="text-2xs text-muted-foreground">Break confirm (closes)
                <input type="number" value={cfg.breakConfirmBars} onChange={e => setCfg({ ...cfg, breakConfirmBars: +e.target.value })}
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground" />
              </label>
              <label className="text-2xs text-muted-foreground">Seed months
                <input type="number" value={cfg.seedMonths} onChange={e => setCfg({ ...cfg, seedMonths: +e.target.value })}
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground" />
              </label>
              <label className="text-2xs text-muted-foreground">Universe size (top N)
                <input type="number" value={cfg.universeSize} onChange={e => setCfg({ ...cfg, universeSize: +e.target.value })}
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground" />
              </label>
            </div>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            <button disabled={busy} onClick={() => post("/api/trend-ride-bot/config", cfg)} className="rounded bg-primary px-3 py-1.5 text-2xs font-medium text-primary-foreground disabled:opacity-50">Save settings</button>
            <button disabled={busy || data?.running} onClick={() => post("/api/trend-ride-bot/run")} className="rounded border border-border px-3 py-1.5 text-2xs font-medium text-foreground disabled:opacity-50">▶ Run now</button>
            <button disabled={busy} onClick={() => { if (confirm("Reset the paper account and re-seed from history on the next run?")) post("/api/trend-ride-bot/reset"); }} className="rounded border border-border px-3 py-1.5 text-2xs font-medium text-bear-light disabled:opacity-50">Reset account</button>
            <span className="text-2xs text-muted-foreground self-center">avg win {data ? fmt$(data.avgWin$ ?? 0) : "—"} · avg loss {data ? fmt$(data.avgLoss$ ?? 0) : "—"} · universe {data?.universeSize ?? "—"}</span>
          </div>
        </div>

        {/* Equity curve */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-semibold text-foreground mb-2">Account value (mark-to-market)</div>
          <Sparkline pts={data?.equityCurve ?? []} />
        </div>

        {/* Open positions */}
        <DataTable
          title="Open paper positions (riding)"
          rightSlot={data ? <span className="text-2xs text-muted-foreground">held open until a {data.config?.breakConfirmBars}-close break of the {data.config?.exitEmaPeriod}-EMA</span> : null}
          dense
          columns={posCols}
          data={data?.openPositions ?? []}
          getRowKey={(p: any) => p.id}
          defaultSort={{ key: "upnl", direction: "desc" }}
          emptyMessage="No open positions — run the bot to seed from history."
        />

        {/* Closed trades */}
        <DataTable
          title="Recent closed trades"
          dense
          columns={tradeCols}
          data={data?.recentTrades ?? []}
          getRowKey={(t: any, i: number) => `${t.ticker}-${t.exitDate}-${i}`}
          defaultSort={{ key: "date", direction: "desc" }}
          emptyMessage="No closed trades yet."
        />
      </div>
    </PageTemplate>
  );
}
