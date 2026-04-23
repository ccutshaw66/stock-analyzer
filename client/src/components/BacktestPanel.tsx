import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Play, Info } from "lucide-react";

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
      const res = await apiRequest("POST", "/api/track-record/backtest", {
        tickers,
        years,
        minStrength,
      });
      return res.json();
    },
  });

  const data = mutation.data;

  const pctColor = (v: number) =>
    v > 0 ? "text-green-400" : v < 0 ? "text-red-400" : "text-muted-foreground";

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
            <label className="text-[10px] uppercase text-muted-foreground font-semibold">
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
            <label className="text-[10px] uppercase text-muted-foreground font-semibold">Years</label>
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
            <label className="text-[10px] uppercase text-muted-foreground font-semibold">Min strength</label>
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
          <p className="mt-2 text-xs text-red-400">
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
          <div className="bg-card border border-card-border rounded-xl p-4 overflow-x-auto">
            <h3 className="text-sm font-bold text-foreground mb-3">Technical signal performance</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-muted-foreground uppercase border-b border-card-border/50">
                  <th className="text-left py-2 pr-2">Signal</th>
                  <th className="text-right py-2 px-2">Fires</th>
                  <th className="text-right py-2 px-2">Hit% 1d / Avg</th>
                  <th className="text-right py-2 px-2">Hit% 5d / Avg</th>
                  <th className="text-right py-2 px-2">Hit% 10d / Avg</th>
                  <th className="text-right py-2 px-2">Hit% 20d / Avg</th>
                </tr>
              </thead>
              <tbody>
                {data.technical.map(s => {
                  const cell = (b: { hits: number; avg: number; samples: number }) => {
                    const wr = winRate(b.hits, b.samples);
                    return (
                      <td className="text-right py-2 px-2 tabular-nums">
                        {wr == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            <span className={wr >= 55 ? "text-green-400" : wr <= 45 ? "text-red-400" : "text-foreground"}>
                              {wr}%
                            </span>
                            <span className="text-muted-foreground"> / </span>
                            <span className={pctColor(b.avg)}>{b.avg > 0 ? "+" : ""}{b.avg.toFixed(2)}%</span>
                          </>
                        )}
                      </td>
                    );
                  };
                  return (
                    <tr key={s.id} className="border-b border-card-border/30 hover:bg-background/30">
                      <td className="py-2 pr-2 font-medium text-foreground">{s.label}</td>
                      <td className="text-right py-2 px-2 tabular-nums">{s.fires}</td>
                      {cell(s.hit1)}
                      {cell(s.hit5)}
                      {cell(s.hit10)}
                      {cell(s.hit20)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Catalyst note */}
          <div className="bg-card border border-card-border rounded-xl p-4">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div className="text-xs text-muted-foreground">
                <p className="mb-2">{data.catalystNote}</p>
                <div className="flex flex-wrap gap-1.5">
                  {data.catalystStubs.map(c => (
                    <span key={c.id} className="text-[10px] px-2 py-0.5 rounded bg-zinc-700/40 text-zinc-400 border border-zinc-600/30">
                      {c.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Top fires */}
          {data.bestFires.length > 0 && (
            <div className="bg-card border border-card-border rounded-xl p-4 overflow-x-auto">
              <h3 className="text-sm font-bold text-foreground mb-3">Top 20 fires by |20d return|</h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-muted-foreground uppercase border-b border-card-border/50">
                    <th className="text-left py-2 pr-2">Signal</th>
                    <th className="text-left py-2 px-2">Ticker</th>
                    <th className="text-left py-2 px-2">Date</th>
                    <th className="text-right py-2 px-2">Entry</th>
                    <th className="text-right py-2 px-2">+1d</th>
                    <th className="text-right py-2 px-2">+5d</th>
                    <th className="text-right py-2 px-2">+10d</th>
                    <th className="text-right py-2 px-2">+20d</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bestFires.map((f, i) => (
                    <tr key={i} className="border-b border-card-border/30 hover:bg-background/30">
                      <td className="py-2 pr-2 text-muted-foreground">{f.signalId}</td>
                      <td className="py-2 px-2 font-mono font-semibold">{f.symbol}</td>
                      <td className="py-2 px-2 text-muted-foreground">{f.date}</td>
                      <td className="text-right py-2 px-2 tabular-nums">${f.entryClose.toFixed(2)}</td>
                      <td className={`text-right py-2 px-2 tabular-nums ${pctColor(f.ret1 ?? 0)}`}>
                        {f.ret1 != null ? `${f.ret1 > 0 ? "+" : ""}${f.ret1.toFixed(1)}%` : "—"}
                      </td>
                      <td className={`text-right py-2 px-2 tabular-nums ${pctColor(f.ret5 ?? 0)}`}>
                        {f.ret5 != null ? `${f.ret5 > 0 ? "+" : ""}${f.ret5.toFixed(1)}%` : "—"}
                      </td>
                      <td className={`text-right py-2 px-2 tabular-nums ${pctColor(f.ret10 ?? 0)}`}>
                        {f.ret10 != null ? `${f.ret10 > 0 ? "+" : ""}${f.ret10.toFixed(1)}%` : "—"}
                      </td>
                      <td className={`text-right py-2 px-2 tabular-nums font-semibold ${pctColor(f.ret20 ?? 0)}`}>
                        {f.ret20 != null ? `${f.ret20 > 0 ? "+" : ""}${f.ret20.toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
