/**
 * /gamma-bot — Gamma-Vol Paper Bot (owner-only, Admin Playground).
 *
 * Watchable dashboard for the in-process deterministic vol bot: live equity,
 * adjustable money + risk, today's signals across the basket, open paper
 * positions (with a hold countdown), closed-trade log, and an equity sparkline.
 * Self-contained — talks to /api/gamma-bot.
 */
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageTemplate } from "@/components/PageTemplate";

const fmt$ = (n: number) => "$" + Math.round(n).toLocaleString();
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toFixed(1) + "%");

function Sparkline({ pts }: { pts: { date: string; equity: number }[] }) {
  if (!pts || pts.length < 2) return <div className="text-2xs text-muted-foreground">Equity curve appears once trades close.</div>;
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

export default function GammaBotPage() {
  const { data, refetch } = useQuery<any>({
    queryKey: ["/api/gamma-bot"],
    queryFn: () => fetch("/api/gamma-bot").then(r => r.json()),
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

  const sideTag = (s: string) =>
    s === "SHORT" ? <span className="text-bear-light font-medium">SELL VOL</span>
    : s === "LONG" ? <span className="text-bull-light font-medium">BUY VOL</span>
    : <span className="text-muted-foreground">—</span>;

  return (
    <PageTemplate
      howItWorksTitle="How the Gamma-Vol bot plays"
      howItWorks={
        <>
          <p>
            A <strong className="text-foreground">deterministic paper bot</strong> — no emotion, no
            hesitation, just the rules. Every market close it reads dealer-gamma + implied vol for the
            ~95-name big-cap basket and plays two regimes: <strong className="text-bear-light">sell vol</strong> when
            dealers are long gamma and vol is rich, <strong className="text-bull-light">buy vol</strong> when dealers
            are short gamma and vol is cheap. P&amp;L scores realized-vs-implied vol over the hold window.
          </p>
          <p className="text-2xs italic text-muted-foreground">
            Paper only — no broker, no real money. It's the consistency test before any edge is trusted.
            Honest heads-up: "watchable" ≠ "rich by Friday" — a real edge compounds slowly. Crank the risk
            dial to see it move faster, but that's volatility, not magic.
          </p>
        </>
      }
    >
      <div className="space-y-5 max-w-[1100px] mx-auto p-1">
        {/* Equity row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat label="Equity" value={data ? fmt$(data.equity) : "…"} />
          <Stat label="Total P&L" value={data ? fmt$(data.totalPnl) : "…"} color={data && data.totalPnl >= 0 ? "text-bull-light" : "text-bear-light"} />
          <Stat label="Return" value={data ? pct(data.totalReturnPct) : "…"} color={data && data.totalReturnPct >= 0 ? "text-bull-light" : "text-bear-light"} />
          <Stat label="Win Rate" value={data ? pct(data.winRate) : "…"} />
          <Stat label="Open" value={data ? `${data.openCount}/${data.config?.maxPositions}` : "…"} />
          <Stat label="Closed" value={data ? data.closedCount : "…"} />
        </div>

        {/* Controls: money + risk */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-foreground">Money &amp; Risk</div>
            <div className="text-2xs text-muted-foreground">
              {data?.running ? "⏳ live pull running…" : data?.lastRun ? `last run ${new Date(data.lastRun).toLocaleString()}` : "not run yet"}
            </div>
          </div>
          {cfg && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <label className="text-2xs text-muted-foreground">Account ($)
                <input type="number" value={cfg.startingEquity} onChange={e => setCfg({ ...cfg, startingEquity: +e.target.value })}
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground" />
              </label>
              <label className="text-2xs text-muted-foreground">Risk / trade (%)
                <input type="number" step="0.5" value={+(cfg.riskPctPerTrade * 100).toFixed(2)} onChange={e => setCfg({ ...cfg, riskPctPerTrade: +e.target.value / 100 })}
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground" />
              </label>
              <label className="text-2xs text-muted-foreground">Max positions
                <input type="number" value={cfg.maxPositions} onChange={e => setCfg({ ...cfg, maxPositions: +e.target.value })}
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground" />
              </label>
              <label className="text-2xs text-muted-foreground">Hold (days)
                <input type="number" value={cfg.holdDays} onChange={e => setCfg({ ...cfg, holdDays: +e.target.value })}
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground" />
              </label>
            </div>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            <button disabled={busy} onClick={() => post("/api/gamma-bot/config", cfg)} className="rounded bg-primary px-3 py-1.5 text-2xs font-medium text-primary-foreground disabled:opacity-50">Save settings</button>
            <button disabled={busy || data?.running} onClick={() => post("/api/gamma-bot/run")} className="rounded border border-border px-3 py-1.5 text-2xs font-medium text-foreground disabled:opacity-50">▶ Run now (live pull)</button>
            <button disabled={busy} onClick={() => { if (confirm("Reset the paper account to starting equity?")) post("/api/gamma-bot/reset"); }} className="rounded border border-border px-3 py-1.5 text-2xs font-medium text-bear-light disabled:opacity-50">Reset account</button>
          </div>
        </div>

        {/* Equity curve */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-semibold text-foreground mb-2">Equity curve</div>
          <Sparkline pts={data?.equityCurve ?? []} />
        </div>

        {/* Today's signals */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-semibold text-foreground mb-2">
            Today's signals {data ? <span className="text-2xs text-muted-foreground">({data.activeSignalCount} firing of {data.signals?.length ?? 0})</span> : null}
          </div>
          {data?.signals?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-2xs">
                <thead><tr className="text-muted-foreground text-left"><th className="py-1 pr-4">Ticker</th><th className="pr-4">Regime</th><th className="pr-4">IV rank</th><th className="pr-4">Signal</th></tr></thead>
                <tbody>
                  {data.signals.slice(0, 30).map((s: any) => (
                    <tr key={s.ticker} className="border-t border-border/50">
                      <td className="py-1 pr-4 font-medium text-foreground">{s.ticker}</td>
                      <td className="pr-4">{s.regime === "short-γ" ? <span className="text-bear-light">short-γ</span> : <span className="text-bull-light">long-γ</span>}</td>
                      <td className="pr-4 text-foreground">{(s.ivRank * 100).toFixed(0)}%</td>
                      <td className="pr-4">{sideTag(s.side)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="text-2xs text-muted-foreground">No signals yet — warming up. Click "Run now" for a live pull, or wait for tonight's close.</div>}
        </div>

        {/* Open positions */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-semibold text-foreground mb-2">Open paper positions</div>
          {data?.openPositions?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-2xs">
                <thead><tr className="text-muted-foreground text-left"><th className="py-1 pr-4">Ticker</th><th className="pr-4">Side</th><th className="pr-4">Entry IV</th><th className="pr-4">Size</th><th className="pr-4">Hold</th></tr></thead>
                <tbody>
                  {data.openPositions.map((p: any) => (
                    <tr key={p.id} className="border-t border-border/50">
                      <td className="py-1 pr-4 font-medium text-foreground">{p.ticker}</td>
                      <td className="pr-4">{sideTag(p.side)}</td>
                      <td className="pr-4 text-foreground">{(p.entryIV * 100).toFixed(0)}%</td>
                      <td className="pr-4 text-foreground">{fmt$(p.sizeDollars)}</td>
                      <td className="pr-4 text-muted-foreground">{p.daysHeld}/{p.holdDays}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="text-2xs text-muted-foreground">No open positions.</div>}
        </div>

        {/* Recent trades */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-semibold text-foreground mb-2">Recent closed trades</div>
          {data?.recentTrades?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-2xs">
                <thead><tr className="text-muted-foreground text-left"><th className="py-1 pr-4">Ticker</th><th className="pr-4">Side</th><th className="pr-4">Exit</th><th className="pr-4">P&L</th><th className="pr-4">Return</th></tr></thead>
                <tbody>
                  {data.recentTrades.map((t: any, i: number) => (
                    <tr key={i} className="border-t border-border/50">
                      <td className="py-1 pr-4 font-medium text-foreground">{t.ticker}</td>
                      <td className="pr-4">{sideTag(t.side)}</td>
                      <td className="pr-4 text-muted-foreground">{t.exitDate}</td>
                      <td className={`pr-4 ${t.pnl$ >= 0 ? "text-bull-light" : "text-bear-light"}`}>{fmt$(t.pnl$)}</td>
                      <td className={`pr-4 ${t.pnlPct >= 0 ? "text-bull-light" : "text-bear-light"}`}>{(t.pnlPct * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="text-2xs text-muted-foreground">No closed trades yet.</div>}
        </div>
      </div>
    </PageTemplate>
  );
}
