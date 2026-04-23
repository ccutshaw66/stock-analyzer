import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Bell, Plus, Trash2, Zap, TrendingUp, Calendar, Radio } from "lucide-react";
import { HelpBlock } from "@/components/HelpBlock";

interface AlertRule {
  id: number;
  kind: string;
  enabled: boolean;
  ticker: string | null;
  tradeId: number | null;
  config: string | null;
  lastFiredAt: string | null;
  createdAt: string;
}

const KIND_META: Record<string, { label: string; icon: any; desc: string; enabled: boolean }> = {
  SCANNER_VERDICT: { label: "Scanner verdict change", icon: Zap,       desc: "Alert when Scanner 2.0 flips a ticker to GO / SET / PULLBACK.", enabled: true },
  PRICE_TARGET:    { label: "Price target hit",       icon: TrendingUp, desc: "Alert when an open position crosses its target price.",          enabled: true },
  PRICE_STOP:      { label: "Price stop hit",         icon: TrendingUp, desc: "Alert when an open position crosses its stop price.",            enabled: true },
  EARNINGS:        { label: "Earnings within N days", icon: Calendar,   desc: "Alert X days before earnings for an open position.",             enabled: true },
  UNUSUAL_OPTIONS: { label: "Unusual options flow",   icon: Radio,      desc: "Alert when volume spikes above open interest on a watched strike.", enabled: false },
};

export default function AlertsPage() {
  const [showCreate, setShowCreate] = useState(false);

  const { data: rules, isLoading } = useQuery<AlertRule[]>({
    queryKey: ["/api/alert-rules"],
    queryFn: async () => (await apiRequest("GET", "/api/alert-rules")).json(),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) =>
      (await apiRequest("PATCH", `/api/alert-rules/${id}`, { enabled })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/alert-rules"] }),
  });

  const del = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/alert-rules/${id}`)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/alert-rules"] }),
  });

  const evaluateNow = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/alerts/evaluate-now")).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/alerts"] }),
  });

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      <HelpBlock title="How Alerts work">
        <p><b className="text-foreground">What it does:</b> Create rules that fire notifications when something you care about happens. A cron runs every 30 minutes during market hours, evaluates your rules against live data, and drops new alerts into the bell icon in the header.</p>
        <p><b className="text-foreground">Rule types:</b></p>
        <ul className="list-disc pl-4 space-y-1">
          <li><b className="text-foreground">Scanner verdict change</b> — fires when Scanner 2.0 flips a ticker into verdicts you pick (GO ↑/↓, SET ↑/↓, READY ↑/↓, PULLBACK). Deduped so you only get one alert per change.</li>
          <li><b className="text-foreground">Price target hit</b> — fires when an open position crosses its target price. Pulled from the trade’s own target field.</li>
          <li><b className="text-foreground">Price stop hit</b> — fires when price crosses the stop you configured.</li>
          <li><b className="text-foreground">Earnings within N days</b> — fires when an open position has an earnings report scheduled within your window (default 7 days).</li>
        </ul>
        <p><b className="text-foreground">Delivery:</b> Today, all alerts land in the in-app bell (top-right). Email, SMS, and push are coming soon — your rules will keep working and start using those channels automatically when they ship.</p>
        <p><b className="text-foreground">Evaluate now</b> button forces an immediate rule sweep if you don’t want to wait for the next 30-minute tick.</p>
      </HelpBlock>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Bell className="h-5 w-5" /> Alerts
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Rules are evaluated every 30 minutes during market hours. In-app delivery via the bell icon above.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => evaluateNow.mutate()}
            disabled={evaluateNow.isPending}
            className="h-8 px-3 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
          >
            {evaluateNow.isPending ? "Evaluating..." : "Evaluate now"}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="h-8 px-3 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> New rule
          </button>
        </div>
      </div>

      {/* Coming-soon channels */}
      <div className="mb-6 p-3 bg-muted/30 border border-card-border rounded-lg">
        <p className="text-xs font-semibold text-foreground mb-1">Delivery channels</p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-green-500/15 text-green-400">In-app ✓</span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-muted text-muted-foreground">Email — coming soon</span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-muted text-muted-foreground">SMS / Push — coming soon</span>
        </div>
      </div>

      {/* Rules list */}
      <div className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
        ) : !rules?.length ? (
          <div className="text-center py-12 border border-dashed border-card-border rounded-lg">
            <Bell className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No alert rules yet</p>
            <button onClick={() => setShowCreate(true)} className="mt-3 text-xs font-medium text-primary hover:underline">
              Create your first rule
            </button>
          </div>
        ) : (
          rules.map(r => {
            const meta = KIND_META[r.kind] || { label: r.kind, icon: Bell, desc: "", enabled: true };
            const Icon = meta.icon;
            const cfg = r.config ? JSON.parse(r.config) : {};
            return (
              <div key={r.id} className="p-3 bg-card border border-card-border rounded-lg flex items-center gap-3">
                <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{meta.label}</p>
                    {r.ticker && <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-muted text-foreground">{r.ticker}</span>}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {r.kind === "SCANNER_VERDICT" && (cfg.verdicts?.length ? `Watching: ${cfg.verdicts.join(", ")}` : "Watching: GO, SET, PULLBACK")}
                    {r.kind === "EARNINGS" && `${cfg.daysBefore ?? 7} days before earnings`}
                    {r.kind === "PRICE_TARGET" && (r.tradeId ? `Trade #${r.tradeId} target` : "Any open position target")}
                    {r.kind === "PRICE_STOP" && (cfg.stop ? `Stop at $${cfg.stop}` : "Stop price")}
                  </p>
                </div>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={e => toggle.mutate({ id: r.id, enabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="relative w-9 h-5 bg-muted rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                </label>
                <button
                  onClick={() => { if (confirm("Delete this alert rule?")) del.mutate(r.id); }}
                  className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-400 shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {showCreate && <CreateRuleModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function CreateRuleModal({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState("SCANNER_VERDICT");
  const [ticker, setTicker] = useState("");
  const [verdicts, setVerdicts] = useState<string[]>(["GO ↑", "GO ↓", "SET ↑", "SET ↓", "PULLBACK"]);
  const [daysBefore, setDaysBefore] = useState("7");

  const create = useMutation({
    mutationFn: async (body: any) => (await apiRequest("POST", "/api/alert-rules", body)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alert-rules"] });
      onClose();
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: any = { kind, enabled: true };
    if (ticker.trim()) body.ticker = ticker.trim().toUpperCase();
    if (kind === "SCANNER_VERDICT") body.config = { verdicts };
    if (kind === "EARNINGS") body.config = { daysBefore: parseInt(daysBefore) || 7 };
    create.mutate(body);
  };

  const availableKinds = Object.entries(KIND_META).filter(([, m]) => m.enabled);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-card-border rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-card-border">
          <h2 className="text-base font-bold text-foreground">New alert rule</h2>
        </div>
        <form onSubmit={submit} className="p-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Rule type</label>
            <select
              value={kind}
              onChange={e => setKind(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground"
            >
              {availableKinds.map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
            <p className="text-[10px] text-muted-foreground mt-1">{KIND_META[kind]?.desc}</p>
          </div>

          {(kind === "SCANNER_VERDICT" || kind === "EARNINGS" || kind === "PRICE_TARGET" || kind === "PRICE_STOP") && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Ticker <span className="text-[10px]">(optional — leave blank to apply to watchlist + open positions)</span>
              </label>
              <input
                type="text"
                value={ticker}
                onChange={e => setTicker(e.target.value.toUpperCase())}
                placeholder="e.g. NVDA"
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground"
              />
            </div>
          )}

          {kind === "SCANNER_VERDICT" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Verdicts to watch</label>
              <div className="flex flex-wrap gap-1.5">
                {["GO ↑", "GO ↓", "SET ↑", "SET ↓", "READY ↑", "READY ↓", "PULLBACK"].map(v => (
                  <label key={v} className={`px-2 py-1 text-[11px] font-semibold rounded border cursor-pointer transition-colors ${verdicts.includes(v) ? "bg-primary/20 border-primary text-primary" : "bg-muted border-card-border text-muted-foreground"}`}>
                    <input
                      type="checkbox"
                      checked={verdicts.includes(v)}
                      onChange={e => setVerdicts(e.target.checked ? [...verdicts, v] : verdicts.filter(x => x !== v))}
                      className="sr-only"
                    />
                    {v}
                  </label>
                ))}
              </div>
            </div>
          )}

          {kind === "EARNINGS" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Days before earnings</label>
              <input
                type="number"
                min={1}
                max={30}
                value={daysBefore}
                onChange={e => setDaysBefore(e.target.value)}
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground"
              />
            </div>
          )}

          {(kind === "PRICE_TARGET" || kind === "PRICE_STOP") && (
            <p className="text-[10px] text-amber-400">
              Note: Per-position rules work best created from the trade row itself (coming soon — for now this rule will match any open position's target/stop on that ticker).
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-8 px-3 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-foreground">Cancel</button>
            <button type="submit" disabled={create.isPending} className="h-8 px-4 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {create.isPending ? "Creating..." : "Create rule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
