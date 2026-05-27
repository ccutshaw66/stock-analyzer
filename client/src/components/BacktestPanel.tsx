import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { API_TRACK_RECORD_BACKTEST } from "@shared/api/endpoints";
import { Loader2, Play, Info } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/DataTable";

interface SignalStats {
  id: string;
  label: string;
  fires: number;
  hit1: { hits: number; avg: number; samples: number };
  hit5: { hits: number; avg: number; samples: number };
  hit10: { hits: number; avg: number; samples: number };
  hit20: { hits: number; avg: number; samples: number };
}

interface BestFire {
  signalId: string;
  symbol: string;
  date: string;
  entryClose: number;
  ret1: number | null;
  ret5: number | null;
  ret10: number | null;
  ret20: number | null;
  strength: number;
}

interface BacktestResponse {
  params: { tickers: string[]; years: number; minStrength: number };
  coverage: { tickers: number; daysScanned: number; totalBars: number };
  technical: SignalStats[];
  catalystNote: string;
  catalystStubs: Array<{ id: string; label: string }>;
  bestFires: BestFire[];
  ranAt: string;
}

export function BacktestPanel() {
  const [tickersInput, setTickersInput] = useState("");
  const [years, setYears] = useState(2);
  const [minStrength, setMinStrength] = useState(0.25);

  const mutation = useMutation<BacktestResponse, Error>({
    mutationFn: async () => {
      const tickers = tickersInput
        .split(/[,\s]+/)
        .map(t => t.trim().toUpperCase())
        .filter(Boolean);
      const res = await apiRequest("POST", API_TRACK_RECORD_BACKTEST, {
        tickers,
        years,
        minStrength,
      });
      return res.json();
    },
  });

  const data = mutation.data;

  const pctColor = (v: number) =>
    v > 0 ? "text-bull-light" : v < 0 ? "text-bear-light" : "text-muted-foreground";

  const winRate = (hits: number, samples: number) =>
    samples === 0 ? null : Math.round((hits / samples) * 100);

  return (
    <div className="space-y-4">
      <div className="bg-card border border-card-border rounded-xl p-4">
        <h2 className="text-sm font-bold text-foreground mb-1">Signal Backtester</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Replay Scanner 2.0 technical signals across your tickers over the last N years.
          Forward returns calculated at +1d, +5d, +10d, +20d from actual historical prices.
        </p>


        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="text-micro uppercase text-muted-foreground font-semibold">
              Tickers (comma or space separated — leave blank to use watchlist)
            </label>
            <input
              type="text"
              value={tickersInput}
              onChange={e => setTickersInput(e.target.value)}
              placeholder="AAPL, NVDA, TSLA, AMD…"
              className="w-full mt-1 px-3 py-2 bg-background border border-card-border rounded-md text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-micro uppercase text-muted-foreground font-semibold">Years</label>
            <select
              value={years}
              onChange={e => setYears(Number(e.target.value))}
              className="w-full mt-1 px-3 py-2 bg-background border border-card-border rounded-md text-sm"
            >
              <option value={1}>1 year</option>
              <option value={2}>2 years</option>
              <option value={3}>3 years</option>
              <option value={5}>5 years</option>
            </select>
          </div>
          <div>
            <label className="text-micro uppercase text-muted-foreground font-semibold">Min strength</label>
            <select
              value={minStrength}
              onChange={e => setMinStrength(Number(e.target.value))}
              className="w-full mt-1 px-3 py-2 bg-background border border-card-border rounded-md text-sm"
            >
              <option value={0.15}>0.15 (loose)</option>
              <option value={0.25}>0.25</option>
              <option value={0.40}>0.40</option>
              <option value={0.60}>0.60 (strict)</option>
            </select>
          </div>
        </div>

        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
        >
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {mutation.isPending ? "Running backtest…" : "Run backtest"}
        </button>

        {mutation.isError && (
          <p className="mt-2 text-xs text-bear-light">
            {mutation.error?.message || "Backtest failed"}
          </p>
        )}
      </div>

      {data && (
        <>
          {/* Coverage */}
          <div className="bg-card border border-card-border rounded-xl p-4">
            <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
              <span><b className="text-foreground">{data.coverage.tickers}</b> tickers</span>
              <span>·</span>
              <span><b className="text-foreground">{data.params.years}y</b> history</span>
              <span>·</span>
              <span><b className="text-foreground">{data.coverage.daysScanned.toLocaleString()}</b> days scanned</span>
              <span>·</span>
              <span><b className="text-foreground">{data.coverage.totalBars.toLocaleString()}</b> bars processed</span>
              <span className="ml-auto">Ran {new Date(data.ranAt).toLocaleString()}</span>
            </div>
          </div>

          {/* Per-signal table */}
          <div className="bg-card border border-card-border rounded-xl p-4">
            {(() => {
              const cellNode = (b: { hits: number; avg: number; samples: number }) => {
                const wr = winRate(b.hits, b.samples);
                if (wr == null) return <span className="text-muted-foreground">—</span>;
                return (
                  <>
                    <span className={wr >= 55 ? "text-bull-light" : wr <= 45 ? "text-bear-light" : "text-foreground"}>{wr}%</span>
                    <span className="text-muted-foreground"> / </span>
                    <span className={pctColor(b.avg)}>{b.avg > 0 ? "+" : ""}{b.avg.toFixed(2)}%</span>
                  </>
                );
              };
              return (
                <DataTable<SignalStats>
                  title="Technical signal performance"
                  columns={[
                    { key: "label", header: "Signal", sortValue: s => s.label, accessor: s => <span className="font-medium">{s.label}</span> },
                    { key: "fires", header: "Fires", type: "number", sortValue: s => s.fires, accessor: s => s.fires },
                    { key: "hit1", header: "Hit% 1d / Avg", align: "right", sortValue: s => s.hit1.samples > 0 ? s.hit1.hits / s.hit1.samples : -1, accessor: s => cellNode(s.hit1) },
                    { key: "hit5", header: "Hit% 5d / Avg", align: "right", sortValue: s => s.hit5.samples > 0 ? s.hit5.hits / s.hit5.samples : -1, accessor: s => cellNode(s.hit5) },
                    { key: "hit10", header: "Hit% 10d / Avg", align: "right", sortValue: s => s.hit10.samples > 0 ? s.hit10.hits / s.hit10.samples : -1, accessor: s => cellNode(s.hit10) },
                    { key: "hit20", header: "Hit% 20d / Avg", align: "right", sortValue: s => s.hit20.samples > 0 ? s.hit20.hits / s.hit20.samples : -1, accessor: s => cellNode(s.hit20) },
                  ]}
                  data={data.technical}
                  getRowKey={s => s.id}
                  defaultSort={{ key: "fires", direction: "desc" }}
                  dense
                />
              );
            })()}
          </div>

          {/* Catalyst note */}
          <div className="bg-card border border-card-border rounded-xl p-4">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div className="text-xs text-muted-foreground">
                <p className="mb-2">{data.catalystNote}</p>
                <div className="flex flex-wrap gap-1.5">
                  {data.catalystStubs.map(c => (
                    <span key={c.id} className="text-micro px-2 py-0.5 rounded bg-zinc-700/40 text-zinc-400 border border-zinc-600/30">
                      {c.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Top fires */}
          {data.bestFires.length > 0 && (
            <div className="bg-card border border-card-border rounded-xl p-4">
              <DataTable<BestFire>
                title="Top 20 fires by |20d return|"
                columns={[
                  { key: "signalId", header: "Signal", sortValue: f => f.signalId, accessor: f => <span className="text-muted-foreground">{f.signalId}</span> },
                  { key: "symbol", header: "Ticker", sortValue: f => f.symbol, accessor: f => <span className="font-mono font-semibold">{f.symbol}</span> },
                  { key: "date", header: "Date", sortValue: f => f.date, accessor: f => <span className="text-muted-foreground">{f.date}</span> },
                  { key: "entry", header: "Entry", type: "price", sortValue: f => f.entryClose, accessor: f => `$${f.entryClose.toFixed(2)}` },
                  { key: "r1", header: "+1d", type: "number", sortValue: f => f.ret1 ?? 0, accessor: f => <span className={pctColor(f.ret1 ?? 0)}>{f.ret1 != null ? `${f.ret1 > 0 ? "+" : ""}${f.ret1.toFixed(1)}%` : "—"}</span> },
                  { key: "r5", header: "+5d", type: "number", sortValue: f => f.ret5 ?? 0, accessor: f => <span className={pctColor(f.ret5 ?? 0)}>{f.ret5 != null ? `${f.ret5 > 0 ? "+" : ""}${f.ret5.toFixed(1)}%` : "—"}</span> },
                  { key: "r10", header: "+10d", type: "number", sortValue: f => f.ret10 ?? 0, accessor: f => <span className={pctColor(f.ret10 ?? 0)}>{f.ret10 != null ? `${f.ret10 > 0 ? "+" : ""}${f.ret10.toFixed(1)}%` : "—"}</span> },
                  { key: "r20", header: "+20d", type: "number", sortValue: f => f.ret20 ?? 0, accessor: f => <span className={`font-semibold ${pctColor(f.ret20 ?? 0)}`}>{f.ret20 != null ? `${f.ret20 > 0 ? "+" : ""}${f.ret20.toFixed(1)}%` : "—"}</span> },
                ]}
                data={data.bestFires}
                getRowKey={(_, i) => i}
                defaultSort={{ key: "r20", direction: "desc" }}
                dense
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
