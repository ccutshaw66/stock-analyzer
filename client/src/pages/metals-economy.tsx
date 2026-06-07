/**
 * /metals-economy — Metals vs the Economy through history (owner-only, Admin Playground).
 *
 * World GDP vs US GDP vs Gold & Silver from 1971 (Nixon off the gold standard)
 * to present, with major crises (wars, financial crashes, pandemics, policy
 * shocks) shaded. Two views: indexed-to-100 (log) to compare 50-yr growth, and
 * year-over-year % to see how each moved THROUGH each crisis.
 *
 * Static annual data (see client/src/data/metals-economy-history.ts) — FMP only
 * has metals from 2007 and no world GDP, and 50-yr-old annual figures never
 * change, so it's the right cache-forever one-source pattern.
 */
import { useMemo, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  CartesianGrid, ReferenceArea,
} from "recharts";
import { PageTemplate } from "@/components/PageTemplate";
import { MACRO_HISTORY, CRISES, type CrisisType } from "@/data/metals-economy-history";
import {
  SIGNAL_BULL, CHART_RSI, SIGNAL_WATCH_SHORT, CHART_TEXT,
  OVERLAY_BEAR_40, OVERLAY_BULL_40, OVERLAY_NEUTRAL_8,
} from "@/lib/design-tokens";

const SERIES = [
  { key: "world", label: "World GDP", color: CHART_RSI },
  { key: "us", label: "US GDP", color: SIGNAL_BULL },
  { key: "gold", label: "Gold", color: SIGNAL_WATCH_SHORT },
  { key: "silver", label: "Silver", color: CHART_TEXT },
] as const;

const CRISIS_FILL: Record<CrisisType, string> = {
  war: OVERLAY_BEAR_40,
  financial: SIGNAL_WATCH_SHORT,
  pandemic: CHART_RSI,
  policy: OVERLAY_BULL_40,
};
const CRISIS_DOT: Record<CrisisType, string> = {
  war: OVERLAY_BEAR_40, financial: SIGNAL_WATCH_SHORT, pandemic: CHART_RSI, policy: SIGNAL_BULL,
};

type View = "indexed" | "yoy";

export default function MetalsEconomyPage() {
  const [view, setView] = useState<View>("indexed");

  const data = useMemo(() => {
    const base = MACRO_HISTORY[0];
    return MACRO_HISTORY.map((row, i) => {
      if (view === "indexed") {
        return {
          year: row.year,
          world: +(row.worldGdpT / base.worldGdpT * 100).toFixed(1),
          us: +(row.usGdpT / base.usGdpT * 100).toFixed(1),
          gold: +(row.gold / base.gold * 100).toFixed(1),
          silver: +(row.silver / base.silver * 100).toFixed(1),
        };
      }
      const prev = MACRO_HISTORY[i - 1];
      const yoy = (a: number, b: number) => (prev ? +(((a - b) / b) * 100).toFixed(1) : 0);
      return {
        year: row.year,
        world: prev ? yoy(row.worldGdpT, prev.worldGdpT) : 0,
        us: prev ? yoy(row.usGdpT, prev.usGdpT) : 0,
        gold: prev ? yoy(row.gold, prev.gold) : 0,
        silver: prev ? yoy(row.silver, prev.silver) : 0,
      };
    });
  }, [view]);

  const Btn = ({ v, children }: { v: View; children: any }) => (
    <button onClick={() => setView(v)}
      className={`rounded px-3 py-1.5 text-2xs font-medium transition-colors ${view === v ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground"}`}>
      {children}
    </button>
  );

  return (
    <PageTemplate
      howItWorksTitle="Metals vs the Economy, 1971 → today"
      howItWorks={
        <>
          <p>
            Since <strong className="text-foreground">1971</strong>, when the dollar came off the gold
            standard and began floating, this tracks <strong className="text-foreground">World GDP</strong> and{" "}
            <strong className="text-foreground">US GDP</strong> against <strong className="text-bull-light">Gold</strong> and{" "}
            <strong className="text-foreground">Silver</strong>, with the era's major shocks shaded.
            <strong className="text-foreground"> Indexed</strong> (log) compares 50-year growth on one
            scale; <strong className="text-foreground">Year-over-year %</strong> shows how each moved
            through each crisis.
          </p>
          <p className="text-2xs italic text-muted-foreground">
            Annual figures from public records (World Bank nominal GDP; London-fix gold/silver averages) —
            FMP carries metals only from 2007 and no world-GDP series, so the deep history is bundled.
          </p>
        </>
      }
    >
      <div className="space-y-4 max-w-[1100px] mx-auto p-1">
        <div className="flex items-center gap-2">
          <Btn v="indexed">Indexed to 100 (1971)</Btn>
          <Btn v="yoy">Year-over-year %</Btn>
        </div>

        <div className="rounded-lg border border-border bg-card p-3">
          <ResponsiveContainer width="100%" height={420}>
            <LineChart data={data} margin={{ top: 10, right: 16, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={OVERLAY_NEUTRAL_8} vertical={false} />
              {CRISES.map((c, i) => (
                <ReferenceArea key={i} x1={c.start - 0.4} x2={c.end + 0.4}
                  fill={CRISIS_FILL[c.type]} fillOpacity={0.12} stroke="none" ifOverflow="extendDomain" />
              ))}
              <XAxis dataKey="year" type="number" domain={[1971, 2025]} tick={{ fontSize: 11, fill: CHART_TEXT }}
                tickCount={12} stroke={OVERLAY_NEUTRAL_8} />
              <YAxis
                scale={view === "indexed" ? "log" : "auto"}
                domain={view === "indexed" ? [80, "auto"] : ["auto", "auto"]}
                tick={{ fontSize: 11, fill: CHART_TEXT }}
                stroke={OVERLAY_NEUTRAL_8}
                width={48}
                tickFormatter={(v: number) => view === "yoy" ? `${v}%` : `${v}`}
                allowDataOverflow
              />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: CHART_TEXT }}
                formatter={(val: number, name: string) => [view === "yoy" ? `${val}%` : val, name]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {SERIES.map(s => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color}
                  strokeWidth={2} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div className="text-2xs text-muted-foreground mt-1 px-1">
            Shaded = crisis/shock years. {view === "indexed" ? "Log scale: a steeper slope = faster growth; gold's climb is the dollar losing purchasing power." : "Watch the metals spike while GDP growth stalls or goes negative through each shock."}
          </div>
        </div>

        {/* Crisis legend / timeline */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-semibold text-foreground mb-3">Major shocks on the chart</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {CRISES.map((c, i) => (
              <div key={i} className="flex items-start gap-2 text-2xs">
                <span className="mt-1 h-2 w-2 rounded-full shrink-0" style={{ background: CRISIS_DOT[c.type] }} />
                <div>
                  <span className="text-foreground font-medium">{c.start}{c.end !== c.start ? `–${c.end}` : ""} · {c.label}</span>
                  <span className="text-muted-foreground capitalize"> ({c.type})</span>
                  {c.note && <div className="text-muted-foreground">{c.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageTemplate>
  );
}
