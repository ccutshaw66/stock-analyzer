/**
 * /gamma-collector — Gamma Collector watch (owner-only, Admin Playground).
 *
 * Keeps the quietly-accumulating dealer-gamma collector in front of you: a
 * progress bar toward the validation milestone, basket coverage, last run, and
 * the current gamma landscape (which big-caps are most short-gamma right now).
 */
import { useQuery } from "@tanstack/react-query";
import { PageTemplate } from "@/components/PageTemplate";

const fmtGex = (g: number) => {
  const a = Math.abs(g);
  if (a >= 1e9) return (g / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (g / 1e6).toFixed(1) + "M";
  return Math.round(g).toLocaleString();
};

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

        {/* Current gamma landscape */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-semibold text-foreground mb-2">
            Current gamma landscape <span className="text-2xs text-muted-foreground">(most short-gamma first — squeeze-prone at top)</span>
          </div>
          {data?.latest?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-2xs">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="py-1 pr-4">Ticker</th><th className="pr-4">Regime</th><th className="pr-4">GEX ($/1%)</th>
                    <th className="pr-4">Squeeze bias</th><th className="pr-4">ATM IV</th><th className="pr-4">As of</th>
                  </tr>
                </thead>
                <tbody>
                  {data.latest.map((s: any) => (
                    <tr key={s.ticker} className="border-t border-border/50">
                      <td className="py-1 pr-4 font-medium text-foreground">{s.ticker}</td>
                      <td className="pr-4">{s.regime === "short-γ" ? <span className="text-bear-light">short-γ</span> : <span className="text-bull-light">long-γ</span>}</td>
                      <td className={`pr-4 ${s.totalGEX < 0 ? "text-bear-light" : "text-bull-light"}`}>{fmtGex(s.totalGEX)}</td>
                      <td className="pr-4 text-foreground">
                        {s.squeezeBias === "up" ? <span className="text-bull-light">↑ up</span>
                          : s.squeezeBias === "down" ? <span className="text-bear-light">↓ down</span>
                          : <span className="text-muted-foreground">neutral</span>}
                        {s.squeezeStrength ? <span className="text-muted-foreground"> ({(s.squeezeStrength * 100).toFixed(0)})</span> : null}
                      </td>
                      <td className="pr-4 text-foreground">{s.atmIV ? (s.atmIV * 100).toFixed(0) + "%" : "—"}</td>
                      <td className="pr-4 text-muted-foreground">{s.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-2xs text-muted-foreground">
              No snapshots yet — the collector runs at the next market close (21:30 UTC, weekdays). Check back after tonight.
            </div>
          )}
        </div>
      </div>
    </PageTemplate>
  );
}
