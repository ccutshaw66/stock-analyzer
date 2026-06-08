/**
 * /strangle-scanner — Strangle / Volatility Scanner (owner-only, Admin Playground).
 *
 * Ranks the liquid options basket into volatility trades expressed as a strangle:
 * SELL VOL (rich IV + dealers long gamma → collect premium) vs BUY VOL (cheap IV
 * + dealers short gamma → pay for a move). Shows the real strikes, premium,
 * break-evens, and the probability the price stays inside (the short-strangle win
 * zone). Reads the gamma collector's data — one source of truth. /api/strangle-scanner.
 */
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageTemplate } from "@/components/PageTemplate";
import { DataTable, DataTableColumn } from "@/components/DataTable";

const fmt$ = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString();
const money = (v: number | null | undefined) =>
  v != null ? <span className={v >= 0 ? "text-bull-light" : "text-bear-light"}>{fmt$(v)}</span> : <span className="text-muted-foreground">—</span>;
const posCols: DataTableColumn<any>[] = [
  { key: "ticker", header: "Ticker", width: "w-20", accessor: p => <span className="font-medium text-foreground">{p.ticker}</span>, sortValue: p => p.ticker },
  { key: "side", header: "Side", width: "w-24", accessor: p => p.side === "short" ? <span className="text-bull-light">short strangle</span> : <span className="text-watch-light">long strangle</span>, sortValue: p => p.side },
  { key: "strikes", header: "P / C", width: "w-24", accessor: p => `${p.putK} / ${p.callK}`, sortValue: p => p.callK },
  { key: "prem", header: "Premium", type: "price", width: "w-20", accessor: p => `$${p.premium}`, sortValue: p => p.premium },
  { key: "mark", header: "Mark P&L", type: "price", width: "w-24", accessor: p => money(p.markPnl$), sortValue: p => p.markPnl$ ?? 0 },
  { key: "dte", header: "DTE", type: "number", width: "w-16", accessor: p => `${p.daysToExpiry}d`, sortValue: p => p.daysToExpiry },
];
const tradeCols: DataTableColumn<any>[] = [
  { key: "ticker", header: "Ticker", width: "w-20", accessor: t => <span className="font-medium text-foreground">{t.ticker}</span>, sortValue: t => t.ticker },
  { key: "side", header: "Side", width: "w-24", accessor: t => t.side === "short" ? "short" : "long", sortValue: t => t.side },
  { key: "strikes", header: "P / C", width: "w-24", accessor: t => `${t.putK} / ${t.callK}`, sortValue: t => t.callK },
  { key: "exit", header: "Settled @", type: "price", width: "w-20", accessor: t => `$${t.exitSpot}`, sortValue: t => t.exitSpot },
  { key: "pnl", header: "P&L", type: "price", width: "w-24", accessor: t => money(t.pnl$), sortValue: t => t.pnl$ },
  { key: "out", header: "Outcome", width: "w-28", accessor: t => t.outcome === "expired-inside" ? <span className="text-bull-light">inside</span> : <span className="text-bear-light">breached</span>, sortValue: t => t.outcome },
  { key: "date", header: "Date", width: "w-28", accessor: t => t.exitDate, sortValue: t => t.exitDate },
];

const verdictCell = (v: string) =>
  v === "SELL VOL" ? <span className="text-bull-light font-semibold">SELL VOL</span>
  : v === "BUY VOL" ? <span className="text-watch-light font-semibold">BUY VOL</span>
  : <span className="text-muted-foreground">—</span>;

const cols: DataTableColumn<any>[] = [
  { key: "verdict", header: "Trade", width: "w-24", accessor: r => verdictCell(r.verdict), sortValue: r => r.score + (r.verdict !== "—" ? 1000 : 0) },
  { key: "ticker", header: "Ticker", width: "w-20", accessor: r => <span className="font-medium text-foreground">{r.ticker}</span>, sortValue: r => r.ticker },
  { key: "spot", header: "Spot", type: "price", width: "w-20", accessor: r => `$${r.spot}`, sortValue: r => r.spot },
  { key: "iv", header: "ATM IV", type: "number", width: "w-20", accessor: r => `${r.atmIvPct}%`, sortValue: r => r.atmIvPct },
  { key: "ivrank", header: "IV rank", type: "number", width: "w-24", accessor: r => `${r.ivRankPos} of ${r.basketN}`, sortValue: r => r.ivRankPct },
  { key: "regime", header: "Dealer γ", width: "w-20", accessor: r => r.regime === "short-γ" ? <span className="text-bear-light">short-γ</span> : <span className="text-bull-light">long-γ</span>, sortValue: r => r.regime },
  { key: "move", header: "Exp ±move", type: "number", width: "w-28", accessor: r => `±$${r.expMoveDollar} (${r.expMovePct}%)`, sortValue: r => r.expMovePct },
  { key: "strikes", header: "Strangle (P / C)", width: "w-32", accessor: r => <span>${r.putStrike} <span className="text-muted-foreground">put</span> / ${r.callStrike} <span className="text-muted-foreground">call</span></span>, sortValue: r => r.callStrike },
  { key: "prem", header: "Premium", type: "price", width: "w-20", accessor: r => `$${r.premium}`, sortValue: r => r.premium },
  { key: "be", header: "Break-evens", width: "w-32", accessor: r => `$${r.lowerBreakeven} – $${r.upperBreakeven}`, sortValue: r => r.lowerBreakeven },
  { key: "pop", header: "P inside", type: "number", width: "w-20", accessor: r => `${r.popInsidePct}%`, sortValue: r => r.popInsidePct },
];

export default function StrangleScannerPage() {
  const { data } = useQuery<any>({
    queryKey: ["/api/strangle-scanner"],
    queryFn: () => fetch("/api/strangle-scanner").then(r => r.json()),
    refetchInterval: 5 * 60 * 1000,
  });
  const rows = data?.rows ?? [];

  // ── paper bot ──
  const { data: bot, refetch: refetchBot } = useQuery<any>({
    queryKey: ["/api/strangle-bot"],
    queryFn: () => fetch("/api/strangle-bot").then(r => r.json()),
    refetchInterval: 10000,
  });
  const [cfg, setCfg] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (bot?.config && !cfg) setCfg(bot.config); }, [bot, cfg]);
  const post = async (url: string, body?: any) => {
    setBusy(true);
    try { await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); }
    finally { setBusy(false); refetchBot(); }
  };
  const Stat = ({ label, value, color }: any) => (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${color ?? "text-foreground"}`}>{value}</div>
    </div>
  );

  return (
    <PageTemplate
      howItWorksTitle="Strangle / Volatility Scanner"
      howItWorks={
        <>
          <p>
            A strangle (out-of-money call + out-of-money put) is a pure
            <strong className="text-foreground"> volatility</strong> bet. This ranks the liquid options
            basket: <strong className="text-bull-light">SELL VOL</strong> when IV is rich and dealers are
            long gamma (vol suppressed → likely to contract, you keep the premium — the validated lean),{" "}
            <strong className="text-watch-light">BUY VOL</strong> when IV is cheap and dealers are short
            gamma (vol amplified → a move pays for it). Strikes are an ≈1σ strangle priced at the ATM IV.
          </p>
          <p className="text-2xs italic text-muted-foreground">
            Reads the gamma collector's dealer-gamma + IV (one source of truth, no extra options pulls).
            Paper/analysis only — break-evens and P-inside are the lognormal math, not live option fills.
          </p>
        </>
      }
    >
      <div className="space-y-3 max-w-[1150px] mx-auto p-1">
        {data?.note ? (
          <div className="rounded-lg border border-border bg-card p-4 text-2xs text-muted-foreground">{data.note}</div>
        ) : (
          <DataTable
            title="Strangle setups"
            rightSlot={data ? <span className="text-2xs text-muted-foreground">{data.basketN} names · as of {data.asOf} · IV rank 1 = cheapest · P inside = short-strangle win zone</span> : null}
            dense
            columns={cols}
            data={rows}
            getRowKey={(r: any) => r.ticker}
            defaultSort={{ key: "verdict", direction: "desc" }}
            emptyMessage="No setups — gamma collector data not available yet."
          />
        )}

        {/* ── Paper auto-trader ── */}
        <div className="rounded-lg border border-border bg-card p-3 mt-2">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-foreground">Strangle paper bot</div>
            <div className="text-2xs text-muted-foreground">{bot?.running ? "⏳ running…" : bot?.lastRun ? `last run ${new Date(bot.lastRun).toLocaleString()}` : "not run yet"}</div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            <Stat label="Account" value={bot ? fmt$(bot.accountValue) : "…"} color={bot && bot.accountValue >= bot.startingEquity ? "text-bull-light" : "text-bear-light"} />
            <Stat label="Total P&L" value={bot ? fmt$(bot.totalPnl) : "…"} color={bot && bot.totalPnl >= 0 ? "text-bull-light" : "text-bear-light"} />
            <Stat label="Open P&L" value={bot ? fmt$(bot.openPnl ?? 0) : "…"} color={bot && (bot.openPnl ?? 0) >= 0 ? "text-bull-light" : "text-bear-light"} />
            <Stat label="Return" value={bot ? `${bot.totalReturnPct}%` : "…"} color={bot && bot.totalReturnPct >= 0 ? "text-bull-light" : "text-bear-light"} />
            <Stat label="Win rate" value={bot ? (bot.winRate == null ? "—" : `${bot.winRate}%`) : "…"} />
            <Stat label="Open" value={bot ? `${bot.openCount}/${bot.config?.maxPositions}` : "…"} />
            <Stat label="Settled" value={bot ? bot.closedCount : "…"} />
          </div>
          {cfg && (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 mt-2">
              <label className="text-2xs text-muted-foreground">Account ($)
                <input type="number" value={cfg.startingEquity} onChange={e => setCfg({ ...cfg, startingEquity: +e.target.value })} className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground" /></label>
              <label className="text-2xs text-muted-foreground">Contracts/trade
                <input type="number" value={cfg.contractsPerTrade} onChange={e => setCfg({ ...cfg, contractsPerTrade: +e.target.value })} className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground" /></label>
              <label className="text-2xs text-muted-foreground">Max positions
                <input type="number" value={cfg.maxPositions} onChange={e => setCfg({ ...cfg, maxPositions: +e.target.value })} className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground" /></label>
              <label className="text-2xs text-muted-foreground">Hold days (DTE)
                <input type="number" value={cfg.holdDays} onChange={e => setCfg({ ...cfg, holdDays: +e.target.value })} className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground" /></label>
              <label className="text-2xs text-muted-foreground">Sides
                <select value={cfg.sides} onChange={e => setCfg({ ...cfg, sides: e.target.value })} className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground">
                  <option value="both">both</option><option value="sell">sell only</option><option value="buy">buy only</option>
                </select></label>
              <label className="text-2xs text-muted-foreground">Min score
                <input type="number" value={cfg.minScore} onChange={e => setCfg({ ...cfg, minScore: +e.target.value })} className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground" /></label>
            </div>
          )}
          <div className="flex flex-wrap gap-2 mt-2">
            <button disabled={busy} onClick={() => post("/api/strangle-bot/config", cfg)} className="rounded bg-primary px-3 py-1.5 text-2xs font-medium text-primary-foreground disabled:opacity-50">Save settings</button>
            <button disabled={busy || bot?.running} onClick={() => post("/api/strangle-bot/run")} className="rounded border border-border px-3 py-1.5 text-2xs font-medium text-foreground disabled:opacity-50">▶ Run now</button>
            <button disabled={busy} onClick={() => { if (confirm("Reset the strangle paper account?")) post("/api/strangle-bot/reset"); }} className="rounded border border-border px-3 py-1.5 text-2xs font-medium text-bear-light disabled:opacity-50">Reset</button>
          </div>
        </div>

        <DataTable title="Open strangles" dense columns={posCols} data={bot?.openPositions ?? []} getRowKey={(p: any) => p.id} defaultSort={{ key: "dte", direction: "asc" }} emptyMessage="No open strangles — run the bot." />
        <DataTable title="Settled strangles" dense columns={tradeCols} data={bot?.recentTrades ?? []} getRowKey={(t: any, i: number) => `${t.ticker}-${t.exitDate}-${i}`} defaultSort={{ key: "date", direction: "desc" }} emptyMessage="No settled strangles yet." />
      </div>
    </PageTemplate>
  );
}
