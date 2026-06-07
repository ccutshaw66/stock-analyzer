/**
 * /metals-economy — Metals vs the Economy through history (owner-only, Admin Playground).
 *
 * Numbers-first: the chart shows ACTUAL dollar values (Gold/Silver $/oz, GDP $T),
 * not an index, and a per-crisis table spells out "$X -> $Y (+Z%)" for gold,
 * silver, and the gold/silver ratio so every percentage is tied to a real price.
 * 1971 (Nixon off gold) -> present. Static annual public-record data.
 */
import { useMemo, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  CartesianGrid, ReferenceArea,
} from "recharts";
import { PageTemplate } from "@/components/PageTemplate";
import { DataTable, DataTableColumn } from "@/components/DataTable";
import { MACRO_HISTORY, CRISES, type CrisisType, type MacroYear } from "@/data/metals-economy-history";
import {
  SIGNAL_BULL, SIGNAL_BEAR, CHART_RSI, SIGNAL_WATCH_SHORT, CHART_TEXT, OVERLAY_NEUTRAL_8,
} from "@/lib/design-tokens";

type View = "metals" | "gdp" | "yoy";

const CRISIS_COLOR: Record<CrisisType, string> = {
  war: SIGNAL_BEAR,
  financial: SIGNAL_WATCH_SHORT,
  pandemic: CHART_RSI,
  policy: SIGNAL_BULL,
};

const usd = (n: number) => "$" + (n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(2).replace(/\.00$/, ""));
const pct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(0) + "%";
const at = (year: number): MacroYear => MACRO_HISTORY.find(r => r.year === year) ?? MACRO_HISTORY[MACRO_HISTORY.length - 1];

export default function MetalsEconomyPage() {
  const [view, setView] = useState<View>("metals");

  const chartData = useMemo(() => MACRO_HISTORY.map((row, i) => {
    if (view === "yoy") {
      const p = MACRO_HISTORY[i - 1];
      const yoy = (a: number, b: number) => (p ? +(((a - b) / b) * 100).toFixed(1) : 0);
      return { year: row.year, gold: p ? yoy(row.gold, p.gold) : 0, silver: p ? yoy(row.silver, p.silver) : 0,
        us: p ? yoy(row.usGdpT, p.usGdpT) : 0, world: p ? yoy(row.worldGdpT, p.worldGdpT) : 0 };
    }
    return { year: row.year, gold: row.gold, silver: row.silver, us: row.usGdpT, world: row.worldGdpT };
  }), [view]);

  const series = view === "gdp"
    ? [{ key: "world", label: "World GDP ($T)", color: CHART_RSI }, { key: "us", label: "US GDP ($T)", color: SIGNAL_BULL }]
    : view === "yoy"
      ? [{ key: "gold", label: "Gold %", color: SIGNAL_WATCH_SHORT }, { key: "silver", label: "Silver %", color: CHART_TEXT },
         { key: "us", label: "US GDP %", color: SIGNAL_BULL }, { key: "world", label: "World GDP %", color: CHART_RSI }]
      : [{ key: "gold", label: "Gold ($/oz)", color: SIGNAL_WATCH_SHORT }, { key: "silver", label: "Silver ($/oz)", color: CHART_TEXT }];

  const fmtAxis = (v: number) => view === "yoy" ? `${v}%` : view === "gdp" ? `$${v}T` : `$${v}`;
  const fmtTip = (v: number, name: string) =>
    [view === "yoy" ? `${v}%` : view === "gdp" ? `$${v}T` : usd(v), name];

  // Per-crisis numbers: gold/silver start -> peak (+%), and the G/S ratio at each.
  const crisisStats = useMemo(() => CRISES.map(c => {
    const start = at(c.start);
    const win = MACRO_HISTORY.filter(r => r.year >= c.start && r.year <= Math.min(c.end + 2, 2025));
    const gPeak = win.reduce((a, b) => (b.gold > a.gold ? b : a), start);
    const sPeak = win.reduce((a, b) => (b.silver > a.silver ? b : a), start);
    const endRow = at(Math.min(c.end, 2025));
    return {
      ...c,
      goldStart: start.gold, goldPeak: gPeak.gold, goldPct: (gPeak.gold / start.gold - 1) * 100,
      silverStart: start.silver, silverPeak: sPeak.silver, silverPct: (sPeak.silver / start.silver - 1) * 100,
      ratioStart: start.gold / start.silver, ratioPeak: gPeak.gold / at(gPeak.year).silver,
      usPct: (endRow.usGdpT / start.usGdpT - 1) * 100, worldPct: (endRow.worldGdpT / start.worldGdpT - 1) * 100,
    };
  }), []);

  const cols: DataTableColumn<any>[] = [
    { key: "crisis", header: "Crisis", width: "w-52",
      accessor: c => <span><span className="text-foreground font-medium">{c.start}{c.end !== c.start ? `–${c.end}` : ""}</span> <span className="text-muted-foreground">{c.label}</span></span>,
      sortValue: c => c.start },
    { key: "gold", header: "Gold", type: "price", width: "w-44",
      accessor: c => <span>{usd(c.goldStart)} → <span className="text-foreground">{usd(c.goldPeak)}</span> <span className="text-bull-light">({pct(c.goldPct)})</span></span>,
      sortValue: c => c.goldPct },
    { key: "silver", header: "Silver", type: "price", width: "w-44",
      accessor: c => <span>{usd(c.silverStart)} → <span className="text-foreground">{usd(c.silverPeak)}</span> <span className="text-bull-light">({pct(c.silverPct)})</span></span>,
      sortValue: c => c.silverPct },
    { key: "ratio", header: "G/S ratio", type: "number", width: "w-28",
      accessor: c => <span>{c.ratioStart.toFixed(0)} → <span className="text-foreground">{c.ratioPeak.toFixed(0)}</span></span>,
      sortValue: c => c.ratioPeak },
    { key: "us", header: "US GDP", type: "number", width: "w-24", accessor: c => pct(c.usPct), sortValue: c => c.usPct },
    { key: "world", header: "World GDP", type: "number", width: "w-24", accessor: c => pct(c.worldPct), sortValue: c => c.worldPct },
  ];

  const Btn = ({ v, children }: { v: View; children: any }) => (
    <button onClick={() => setView(v)}
      className={`rounded px-3 py-1.5 text-2xs font-medium transition-colors ${view === v ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground"}`}>
      {children}
    </button>
  );

  const g71 = MACRO_HISTORY[0];

  return (
    <PageTemplate
      howItWorksTitle="Metals vs the Economy, 1971 → today"
      howItWorks={
        <p>
          Actual prices, not an index. In <strong className="text-foreground">1971</strong> the dollar left
          the gold standard with <strong className="text-bull-light">gold at {usd(g71.gold)}/oz</strong> and{" "}
          <strong className="text-foreground">silver at {usd(g71.silver)}/oz</strong>. The chart tracks the
          real dollar values through every major shock (shaded); the table below spells out what gold, silver,
          and the gold/silver ratio actually did in each one.
        </p>
      }
    >
      <div className="space-y-4 max-w-[1100px] mx-auto p-1">
        <div className="flex items-center gap-2">
          <Btn v="metals">Gold &amp; Silver ($/oz)</Btn>
          <Btn v="gdp">World &amp; US GDP ($T)</Btn>
          <Btn v="yoy">Year-over-year %</Btn>
        </div>

        <div className="rounded-lg border border-border bg-card p-3">
          <ResponsiveContainer width="100%" height={420}>
            <LineChart data={chartData} margin={{ top: 10, right: 16, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={OVERLAY_NEUTRAL_8} vertical={false} />
              {CRISES.map((c, i) => (
                <ReferenceArea key={i} x1={c.start - 0.4} x2={c.end + 0.4}
                  fill={CRISIS_COLOR[c.type]} fillOpacity={0.22} stroke={CRISIS_COLOR[c.type]} strokeOpacity={0.5} ifOverflow="extendDomain" />
              ))}
              <XAxis dataKey="year" type="number" domain={[1971, 2025]} tick={{ fontSize: 11, fill: CHART_TEXT }} tickCount={12} stroke={OVERLAY_NEUTRAL_8} />
              <YAxis scale={view === "metals" ? "log" : "auto"} domain={view === "metals" ? [1, "auto"] : ["auto", "auto"]}
                tick={{ fontSize: 11, fill: CHART_TEXT }} stroke={OVERLAY_NEUTRAL_8} width={56} tickFormatter={fmtAxis} allowDataOverflow />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: CHART_TEXT }} formatter={fmtTip as any} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {series.map(s => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div className="text-2xs text-muted-foreground mt-1 px-1">
            {view === "metals" ? "Log scale so $1.55 silver and $2,700 gold both read clearly — hover any year for the exact price." : view === "gdp" ? "World vs US economic output, trillions of dollars." : "Annual % move — watch metals spike while GDP growth stalls through each shock."}
          </div>
        </div>

        {/* The numbers, per crisis */}
        <DataTable
          title="What gold & silver did in each crisis"
          rightSlot={<span className="text-2xs text-muted-foreground">start → peak (% move). G/S ratio = oz of silver per oz of gold.</span>}
          dense
          columns={cols}
          data={crisisStats}
          getRowKey={(c: any) => `${c.start}-${c.label}`}
          defaultSort={{ key: "crisis", direction: "asc" }}
          emptyMessage="No crises."
        />

        {/* Color key for the bands */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 px-1 text-2xs text-muted-foreground">
          {(["policy", "war", "financial", "pandemic"] as CrisisType[]).map(t => (
            <span key={t} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CRISIS_COLOR[t] }} /> {t}
            </span>
          ))}
        </div>
      </div>
    </PageTemplate>
  );
}
