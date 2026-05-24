/**
 * Full-page view for the Wheel compartment.
 *
 * State + all derived calculations flow through `useWheelState` (the
 * canonical hook). The hook in turn calls the pure logic layer
 * (`wheelLogic.ts`). No math lives in this file.
 */
import { SIGNAL_BULL, CHART_RSI, ACCENT_AMBER_DEEP } from "@/lib/design-tokens";
import {
  DollarSign, Percent, Calendar, Target,
  AlertTriangle, TrendingUp, ShieldCheck, FlaskConical,
} from "lucide-react";
import { HelpBlock, Example, ScoreRange } from "@/components/HelpBlock";
import { STRATEGY_REGISTRY } from "@shared/strategies/registry";
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import { useWheelState } from "./useWheel";

export function WheelFullView() {
  const W = useWheelState();
  const { inputs, update, metrics, chart, health } = W;

  return (
    <div className="space-y-6">
      {/* ── Trade Setup ─────────────────────────────────────────── */}
      <div className="bg-card border border-card-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Trade Setup</h3>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <NumField label="Stock Price ($)" value={inputs.stockPrice} onChange={(v) => update("stockPrice", v)} step={0.1} testId="wheel-stock-price" />
          <NumField label="Contracts" value={inputs.contracts} onChange={(v) => update("contracts", v)} step={1} min={1} testId="wheel-contracts" />
          <NumField label="Days to Expiration" value={inputs.dte} onChange={(v) => update("dte", v)} step={1} min={1} testId="wheel-dte" />
          <NumField label="Account Value ($)" value={inputs.accountValue} onChange={(v) => update("accountValue", v)} step={100} testId="wheel-account" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-muted/30 border border-card-border/50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-2xs font-semibold text-blue-400 uppercase tracking-wider">Cash-Secured Put</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Put Strike ($)" value={inputs.putStrike} onChange={(v) => update("putStrike", v)} step={0.5} testId="wheel-put-strike" />
              <NumField label="Put Premium ($)" value={inputs.putPremium} onChange={(v) => update("putPremium", v)} step={0.05} testId="wheel-put-premium" />
            </div>
          </div>
          <div className="bg-muted/30 border border-card-border/50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-3.5 w-3.5 text-bull-light" />
              <span className="text-2xs font-semibold text-bull-light uppercase tracking-wider">Covered Call (after assignment)</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Call Strike ($)" value={inputs.callStrike} onChange={(v) => update("callStrike", v)} step={0.5} testId="wheel-call-strike" />
              <NumField label="Call Premium ($)" value={inputs.callPremium} onChange={(v) => update("callPremium", v)} step={0.05} testId="wheel-call-premium" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Returns ─────────────────────────────────────────────── */}
      <div className="bg-card border border-card-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Percent className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Returns</h3>
        </div>

        <HelpBlock title="How are these numbers calculated?">
          <p><strong className="text-foreground">Put return:</strong> premium / strike. Annualized × (365 / DTE).</p>
          <p><strong className="text-foreground">Cost basis if assigned:</strong> strike − put premium (premium reduces your effective buy price).</p>
          <p><strong className="text-foreground">Call cycle return:</strong> (call premium + (call strike − cost basis)) / cost basis, then annualized.</p>
          <p><strong className="text-foreground">Full-wheel return</strong> assumes you get assigned and then called away — the best-case full cycle over two expirations.</p>
        </HelpBlock>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ResultCard label="Put Cycle" pct={metrics.putReturnPct} annualized={metrics.putAnnualized} dollar={inputs.putPremium * metrics.shares} accent="blue" />
          <ResultCard label="Call Cycle (if assigned)" pct={metrics.callCycleReturn} annualized={metrics.callAnnualized} dollar={inputs.callPremium * metrics.shares} accent="green" />
          <ResultCard label="Full Wheel Cycle" pct={metrics.fullCycleReturn} annualized={metrics.fullCycleAnnualized} dollar={metrics.premiumIncomePerCycle + (inputs.callStrike - inputs.putStrike) * metrics.shares} accent="primary" />
          <InfoCard label="Assignment Cost Basis" value={`$${metrics.assignmentCostBasis.toFixed(2)}`} sub={`Break-even $${metrics.breakEven.toFixed(2)}`} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <InfoCard label="Capital Required" value={`$${metrics.capitalAtRisk.toLocaleString()}`} sub={`${metrics.percentOfAccount.toFixed(1)}% of account`} />
          <InfoCard label="Shares at Stake" value={`${metrics.shares}`} sub={`${inputs.contracts} contract${inputs.contracts !== 1 ? "s" : ""}`} />
          <InfoCard label="Max Loss (stock → $0)" value={`-$${metrics.maxLossTotal.toLocaleString()}`} sub="Only if stock collapses entirely" danger />
          <InfoCard label="Premium Income / Cycle" value={`$${metrics.premiumIncomePerCycle.toLocaleString()}`} sub="Put + Call combined" />
        </div>
      </div>

      {/* ── Payoff Chart ────────────────────────────────────────── */}
      <div className="bg-card border border-card-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Payoff at Expiration</h3>
        </div>

        <HelpBlock title="How to read the payoff chart">
          <p>The <span className="text-blue-400 font-semibold">blue line</span> shows P/L if you only sold the cash-secured put.</p>
          <p>The <span className="text-bull-light font-semibold">green line</span> shows the full wheel: you got assigned and then sold a covered call.</p>
          <p>Look for the flat top on the green line — that's the cap on your upside once called away. The kink on the downside is your cost basis.</p>
        </HelpBlock>

        <div className="bg-muted/20 border border-card-border/50 rounded-lg p-3" data-testid="wheel-payoff-chart">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chart} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--card-border))" opacity={0.5} />
              <XAxis dataKey="price" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                label={{ value: "Stock Price at Expiry", position: "insideBottom", offset: -5, fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--card-border))", borderRadius: 8, fontSize: 11 }}
                formatter={(value: number, name: string) => [
                  `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
                  name === "putPL" ? "CSP only" : "Full Wheel",
                ]}
                labelFormatter={(label: number) => `Stock @ $${label}`} />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
              <ReferenceLine x={inputs.putStrike} stroke={CHART_RSI} strokeDasharray="4 4" label={{ value: "Put Strike", fontSize: 9, fill: CHART_RSI, position: "top" }} />
              <ReferenceLine x={inputs.callStrike} stroke={SIGNAL_BULL} strokeDasharray="4 4" label={{ value: "Call Strike", fontSize: 9, fill: SIGNAL_BULL, position: "top" }} />
              <ReferenceLine x={metrics.breakEven} stroke={ACCENT_AMBER_DEEP} strokeDasharray="4 4" label={{ value: "Break-even", fontSize: 9, fill: ACCENT_AMBER_DEEP, position: "top" }} />
              <Line type="monotone" dataKey="putPL" stroke={CHART_RSI} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="wheelPL" stroke={SIGNAL_BULL} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Health Checks ───────────────────────────────────────── */}
      <div className="bg-card border border-card-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">
            Setup Quality: <span className={health.score >= 80 ? "text-bull-light" : health.score >= 60 ? "text-watch-light" : "text-bear-light"}>
              {health.score}%
            </span>
          </h3>
        </div>

        <HelpBlock title="What these checks mean">
          <p>These rules are rough heuristics for a healthy wheel setup. Failing one isn't fatal — it just flags where you're outside the typical sweet spot.</p>
          <ScoreRange label="80–100" range="Green" color="green" description="Good textbook wheel — premium is meaningful, strikes make sense, sizing is sane" />
          <ScoreRange label="60–79" range="Yellow" color="yellow" description="Workable, but review flagged items before pulling the trigger" />
          <ScoreRange label="Below 60" range="Red" color="red" description="Rethink. Strikes, DTE, or sizing need adjustment" />
        </HelpBlock>

        <ul className="space-y-2">
          {health.flags.map((f, i) => (
            <li key={i} className="flex items-start gap-2 p-2 rounded-md bg-muted/20 border border-card-border/30">
              {f.ok
                ? <ShieldCheck className="h-4 w-4 text-bull-light shrink-0 mt-0.5" />
                : <AlertTriangle className="h-4 w-4 text-watch-light shrink-0 mt-0.5" />}
              <div className="flex-1">
                <div className="text-xs font-semibold text-foreground">{f.label}</div>
                <div className="text-2xs text-muted-foreground">{f.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <ExperimentalStrategiesSection />
    </div>
  );
}

function ExperimentalStrategiesSection() {
  const experimental = Object.values(STRATEGY_REGISTRY).filter(
    m => m.experimental && m.pageGroup === "wheel",
  );
  if (experimental.length === 0) return null;
  return (
    <div className="bg-card border border-card-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <FlaskConical className="h-4 w-4 text-watch-light" />
        <h3 className="text-sm font-bold text-foreground">Experimental Strategies</h3>
        <span className="text-micro text-muted-foreground italic">research-stage</span>
      </div>
      <ul className="space-y-2">
        {experimental.map(m => (
          <li key={m.id} className="border border-card-border/50 rounded-md px-3 py-2 bg-muted/20"
            data-testid={`experimental-strategy-${m.id}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-foreground">{m.name}</span>
              <span className="text-micro font-bold px-1.5 py-0.5 rounded bg-watch/15 text-watch-light border border-watch/30">
                EXPERIMENTAL
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-snug">{m.description}</p>
          </li>
        ))}
      </ul>
      <p className="text-micro text-muted-foreground/60 italic mt-3">
        Experimental strategies are registered in the manifest but not yet wired into the live signal stack. Use for manual paper-tracking; the port to production is tracked separately.
      </p>
    </div>
  );
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

function NumField({
  label, value, onChange, step = 1, min, testId,
}: {
  label: string; value: number; onChange: (n: number) => void;
  step?: number; min?: number; testId?: string;
}) {
  return (
    <div>
      <label className="text-2xs font-medium text-muted-foreground mb-1 block">{label}</label>
      <input type="number" step={step} min={min} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums"
        data-testid={testId} />
    </div>
  );
}

function ResultCard({
  label, pct, annualized, dollar, accent,
}: {
  label: string; pct: number; annualized: number; dollar: number;
  accent: "blue" | "green" | "primary";
}) {
  const color =
    accent === "blue" ? "text-blue-400"
    : accent === "green" ? "text-bull-light"
    : "text-primary";
  return (
    <div className="bg-muted/30 border border-card-border/50 rounded-lg p-3">
      <div className="text-micro font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-bold tabular-nums font-mono ${color}`}>{pct.toFixed(2)}%</div>
      <div className="text-2xs text-muted-foreground">
        <span className="text-foreground font-semibold tabular-nums">{annualized.toFixed(1)}%</span> annualized
      </div>
      <div className="text-micro text-muted-foreground mt-0.5 tabular-nums">
        ${dollar.toLocaleString(undefined, { maximumFractionDigits: 0 })} premium
      </div>
    </div>
  );
}

function InfoCard({
  label, value, sub, danger,
}: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="bg-muted/30 border border-card-border/50 rounded-lg p-3">
      <div className="text-micro font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-bold tabular-nums font-mono ${danger ? "text-bear-light" : "text-foreground"}`}>{value}</div>
      {sub && <div className="text-micro text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
