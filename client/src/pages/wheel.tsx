import { useMemo, useState } from "react";
import {
  RefreshCw, DollarSign, Percent, Calendar,
  Target, AlertTriangle, TrendingUp, ShieldCheck,
} from "lucide-react";
import { HelpBlock, Example, ScoreRange } from "@/components/HelpBlock";
import { Disclaimer } from "@/components/Disclaimer";
import { useTicker } from "@/contexts/TickerContext";
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";

// ─── The Wheel Strategy Calculator ─────────────────────────────────────────────
// Simulates a cash-secured put → covered call cycle:
//   1. Sell a cash-secured put (CSP) at a strike below current price.
//   2. If not assigned at expiry, keep premium and sell another CSP.
//   3. If assigned, own shares at strike (cost basis = strike − put premium).
//   4. Sell covered calls (CC) above cost basis until called away.
//   5. Repeat.

type Phase = "CSP" | "CC";

export default function WheelCalculator() {
  const { activeTicker } = useTicker();

  // ── Inputs ──
  const [stockPrice, setStockPrice] = useState(100);
  const [putStrike, setPutStrike] = useState(95);
  const [putPremium, setPutPremium] = useState(1.5);
  const [callStrike, setCallStrike] = useState(105);
  const [callPremium, setCallPremium] = useState(1.5);
  const [dte, setDte] = useState(30);
  const [contracts, setContracts] = useState(1);
  const [accountValue, setAccountValue] = useState(25000);

  // ── Derived values ──
  const metrics = useMemo(() => {
    const shares = contracts * 100;
    const capitalAtRisk = putStrike * shares; // cash secured
    const assignmentCostBasis = putStrike - putPremium;

    const putReturnPct = (putPremium / putStrike) * 100;
    const putAnnualized = dte > 0 ? (putReturnPct * 365) / dte : 0;

    const callCycleReturn =
      ((callPremium + (callStrike - assignmentCostBasis)) / assignmentCostBasis) * 100;
    const callAnnualized = dte > 0 ? (callCycleReturn * 365) / dte : 0;

    const breakEven = assignmentCostBasis;
    const maxLossPerShare = assignmentCostBasis; // if stock → $0
    const maxLossTotal = maxLossPerShare * shares;

    const premiumIncomePerCycle = (putPremium + callPremium) * shares;
    const cycleDays = dte * 2; // put cycle + call cycle assumes assignment
    const fullCycleReturn =
      ((callPremium * shares + putPremium * shares + (callStrike - putStrike) * shares) /
        capitalAtRisk) *
      100;
    const fullCycleAnnualized = cycleDays > 0 ? (fullCycleReturn * 365) / cycleDays : 0;

    const percentOfAccount = accountValue > 0 ? (capitalAtRisk / accountValue) * 100 : 0;

    return {
      shares,
      capitalAtRisk,
      assignmentCostBasis,
      putReturnPct,
      putAnnualized,
      callCycleReturn,
      callAnnualized,
      breakEven,
      maxLossPerShare,
      maxLossTotal,
      premiumIncomePerCycle,
      fullCycleReturn,
      fullCycleAnnualized,
      percentOfAccount,
    };
  }, [
    contracts, putStrike, putPremium, callStrike, callPremium, dte, accountValue,
  ]);

  // ── P/L chart at expiration (combined put leg + assignment scenarios) ──
  const chartData = useMemo(() => {
    const points: { price: number; putPL: number; wheelPL: number }[] = [];
    const low = Math.max(0, stockPrice * 0.6);
    const high = stockPrice * 1.4;
    const steps = 60;
    const shares = metrics.shares;

    for (let i = 0; i <= steps; i++) {
      const price = low + ((high - low) * i) / steps;

      // CSP leg only (if sitting in CSP phase at expiry)
      let putPL: number;
      if (price >= putStrike) {
        // put expires worthless — keep premium
        putPL = putPremium * shares;
      } else {
        // assigned: must buy at strike, stock worth `price`
        putPL = (price - putStrike + putPremium) * shares;
      }

      // Full wheel (post-assignment, covered call phase)
      // Cost basis = strike - put premium. At CC expiry:
      //   if price >= callStrike: called away; gain = (callStrike - costBasis) + callPrem
      //   if price <  callStrike: keep shares + callPrem; MTM = (price - costBasis) + callPrem
      const cb = metrics.assignmentCostBasis;
      let wheelPL: number;
      if (price >= callStrike) {
        wheelPL = ((callStrike - cb) + callPremium) * shares;
      } else {
        wheelPL = ((price - cb) + callPremium) * shares;
      }

      points.push({
        price: Math.round(price * 100) / 100,
        putPL: Math.round(putPL * 100) / 100,
        wheelPL: Math.round(wheelPL * 100) / 100,
      });
    }
    return points;
  }, [stockPrice, putStrike, putPremium, callStrike, callPremium, metrics.shares, metrics.assignmentCostBasis]);

  // ── Wheel health heuristics ──
  const health = useMemo(() => {
    const flags: { label: string; ok: boolean; detail: string }[] = [];

    // 1. Strike should be below current price for CSP
    flags.push({
      label: "Put strike below stock price",
      ok: putStrike < stockPrice,
      detail: putStrike < stockPrice
        ? `Strike $${putStrike} is ${(((stockPrice - putStrike) / stockPrice) * 100).toFixed(1)}% OTM`
        : `Strike $${putStrike} is at or above $${stockPrice} — not a cash-secured put`,
    });

    // 2. Call strike above assignment cost basis
    flags.push({
      label: "Call strike above cost basis",
      ok: callStrike > metrics.assignmentCostBasis,
      detail: callStrike > metrics.assignmentCostBasis
        ? `$${callStrike} > cost basis $${metrics.assignmentCostBasis.toFixed(2)} → guaranteed profit if called`
        : `$${callStrike} ≤ cost basis $${metrics.assignmentCostBasis.toFixed(2)} → you'd lock in a loss if called away`,
    });

    // 3. Annualized return sanity
    flags.push({
      label: "Put annualized yield > 10%",
      ok: metrics.putAnnualized > 10,
      detail: `${metrics.putAnnualized.toFixed(1)}% annualized (${metrics.putReturnPct.toFixed(2)}% over ${dte}d)`,
    });

    // 4. Position sizing
    flags.push({
      label: "Capital at risk < 25% of account",
      ok: metrics.percentOfAccount < 25,
      detail: `Using $${metrics.capitalAtRisk.toLocaleString()} (${metrics.percentOfAccount.toFixed(1)}% of account)`,
    });

    // 5. DTE reasonable
    flags.push({
      label: "Days to expiration in sweet spot (21–45)",
      ok: dte >= 21 && dte <= 45,
      detail: dte < 21
        ? `${dte} DTE is short — gamma risk is high`
        : dte > 45
          ? `${dte} DTE is long — theta decay slow, capital tied up`
          : `${dte} DTE — good theta/gamma balance`,
    });

    const pass = flags.filter(f => f.ok).length;
    const score = Math.round((pass / flags.length) * 100);
    return { flags, score };
  }, [stockPrice, putStrike, callStrike, dte, metrics]);

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-6 max-w-[1200px] mx-auto" data-testid="wheel-page">
      <div className="flex items-center gap-2">
        <RefreshCw className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">The Wheel Strategy</h1>
      </div>
      <p className="text-xs text-muted-foreground -mt-4">
        Generate income by selling cash-secured puts and covered calls in a continuous cycle.
        {activeTicker && <> Currently analyzing <span className="text-primary font-semibold">{activeTicker}</span>.</>}
      </p>

      {/* ── Instructions ─────────────────────────────────────────── */}
      <HelpBlock title="What is the Wheel Strategy?" defaultOpen>
        <p>
          The Wheel is a <strong className="text-foreground">neutral-to-bullish income strategy</strong> that combines
          <strong className="text-foreground"> cash-secured puts (CSPs)</strong> and
          <strong className="text-foreground"> covered calls (CCs)</strong> on a stock you'd be happy to own.
        </p>
        <ol className="list-decimal list-inside space-y-1 text-[11px] leading-relaxed">
          <li><strong className="text-foreground">Phase 1 (CSP):</strong> Sell a put at a strike below current price. Set aside strike × 100 in cash per contract.</li>
          <li><strong className="text-foreground">Expiry:</strong> If stock stays above strike, put expires worthless — keep the premium, sell another CSP.</li>
          <li><strong className="text-foreground">Assignment:</strong> If stock drops below strike, you buy 100 shares per contract at the strike. Your cost basis is <em>strike − put premium</em>.</li>
          <li><strong className="text-foreground">Phase 2 (CC):</strong> Now sell covered calls above your cost basis. Collect premium each cycle.</li>
          <li><strong className="text-foreground">Called away:</strong> If stock rises above the call strike, shares are sold. Pocket the gain + call premium, then restart with a new CSP.</li>
        </ol>
        <Example type="good">
          <strong className="text-green-400">Ideal setup:</strong> Stock at $100, sell 30 DTE $95 put for $1.50. Capital: $9,500.
          Return if unassigned: 1.58% in 30 days ≈ 19.2% annualized. If assigned, cost basis = $93.50 and you start selling calls.
        </Example>
        <Example type="bad">
          <strong className="text-red-400">Wheel trap:</strong> Stock crashes from $100 to $60. You're assigned at $95, stuck with
          $35/share unrealized loss, and any call you sell above $95 barely covers the bleeding. Only wheel stocks you're
          <em> genuinely willing to own through a drawdown</em>.
        </Example>
        <ScoreRange label="Great candidate" range="IV Rank 30–60, stable price, quality business" color="green" description="High premium, limited tail risk" />
        <ScoreRange label="OK candidate" range="IV Rank 15–30 or slight uptrend" color="yellow" description="Lower income, but safer" />
        <ScoreRange label="Avoid" range="Biotech / earnings run-ups / meme stocks" color="red" description="Gap-down risk destroys the wheel" />
      </HelpBlock>

      {/* ── Inputs ──────────────────────────────────────────────── */}
      <div className="bg-card border border-card-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Trade Setup</h3>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <NumField label="Stock Price ($)" value={stockPrice} onChange={setStockPrice} step={0.1} testId="wheel-stock-price" />
          <NumField label="Contracts" value={contracts} onChange={setContracts} step={1} min={1} testId="wheel-contracts" />
          <NumField label="Days to Expiration" value={dte} onChange={setDte} step={1} min={1} testId="wheel-dte" />
          <NumField label="Account Value ($)" value={accountValue} onChange={setAccountValue} step={100} testId="wheel-account" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-muted/30 border border-card-border/50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-[11px] font-semibold text-blue-400 uppercase tracking-wider">Cash-Secured Put</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Put Strike ($)" value={putStrike} onChange={setPutStrike} step={0.5} testId="wheel-put-strike" />
              <NumField label="Put Premium ($)" value={putPremium} onChange={setPutPremium} step={0.05} testId="wheel-put-premium" />
            </div>
          </div>
          <div className="bg-muted/30 border border-card-border/50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-3.5 w-3.5 text-green-400" />
              <span className="text-[11px] font-semibold text-green-400 uppercase tracking-wider">Covered Call (after assignment)</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Call Strike ($)" value={callStrike} onChange={setCallStrike} step={0.5} testId="wheel-call-strike" />
              <NumField label="Call Premium ($)" value={callPremium} onChange={setCallPremium} step={0.05} testId="wheel-call-premium" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Results ─────────────────────────────────────────────── */}
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
          <ResultCard
            label="Put Cycle"
            pct={metrics.putReturnPct}
            annualized={metrics.putAnnualized}
            dollar={putPremium * metrics.shares}
            accent="blue"
          />
          <ResultCard
            label="Call Cycle (if assigned)"
            pct={metrics.callCycleReturn}
            annualized={metrics.callAnnualized}
            dollar={callPremium * metrics.shares}
            accent="green"
          />
          <ResultCard
            label="Full Wheel Cycle"
            pct={metrics.fullCycleReturn}
            annualized={metrics.fullCycleAnnualized}
            dollar={metrics.premiumIncomePerCycle + (callStrike - putStrike) * metrics.shares}
            accent="primary"
          />
          <InfoCard
            label="Assignment Cost Basis"
            value={`$${metrics.assignmentCostBasis.toFixed(2)}`}
            sub={`Break-even $${metrics.breakEven.toFixed(2)}`}
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <InfoCard
            label="Capital Required"
            value={`$${metrics.capitalAtRisk.toLocaleString()}`}
            sub={`${metrics.percentOfAccount.toFixed(1)}% of account`}
          />
          <InfoCard
            label="Shares at Stake"
            value={`${metrics.shares}`}
            sub={`${contracts} contract${contracts !== 1 ? "s" : ""}`}
          />
          <InfoCard
            label="Max Loss (stock → $0)"
            value={`-$${metrics.maxLossTotal.toLocaleString()}`}
            sub="Only if stock collapses entirely"
            danger
          />
          <InfoCard
            label="Premium Income / Cycle"
            value={`$${metrics.premiumIncomePerCycle.toLocaleString()}`}
            sub="Put + Call combined"
          />
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
          <p>The <span className="text-green-400 font-semibold">green line</span> shows the full wheel: you got assigned and then sold a covered call.</p>
          <p>Look for the flat top on the green line — that's the cap on your upside once called away. The kink on the downside is your cost basis.</p>
        </HelpBlock>

        <div className="bg-muted/20 border border-card-border/50 rounded-lg p-3" data-testid="wheel-payoff-chart">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--card-border))" opacity={0.5} />
              <XAxis
                dataKey="price"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                label={{ value: "Stock Price at Expiry", position: "insideBottom", offset: -5, fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`}
              />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--card-border))", borderRadius: 8, fontSize: 11 }}
                formatter={(value: number, name: string) => [
                  `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
                  name === "putPL" ? "CSP only" : "Full Wheel",
                ]}
                labelFormatter={(label: number) => `Stock @ $${label}`}
              />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
              <ReferenceLine x={putStrike} stroke="#3b82f6" strokeDasharray="4 4" label={{ value: "Put Strike", fontSize: 9, fill: "#3b82f6", position: "top" }} />
              <ReferenceLine x={callStrike} stroke="#22c55e" strokeDasharray="4 4" label={{ value: "Call Strike", fontSize: 9, fill: "#22c55e", position: "top" }} />
              <ReferenceLine x={metrics.breakEven} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: "Break-even", fontSize: 9, fill: "#f59e0b", position: "top" }} />
              <Line type="monotone" dataKey="putPL" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="wheelPL" stroke="#22c55e" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Health Checks ───────────────────────────────────────── */}
      <div className="bg-card border border-card-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">
            Setup Quality: <span className={health.score >= 80 ? "text-green-400" : health.score >= 60 ? "text-yellow-400" : "text-red-400"}>
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
              {f.ok ? (
                <ShieldCheck className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <div className="text-xs font-semibold text-foreground">{f.label}</div>
                <div className="text-[11px] text-muted-foreground">{f.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <Disclaimer />
    </div>
  );
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

function NumField({
  label, value, onChange, step = 1, min, testId,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  testId?: string;
}) {
  return (
    <div>
      <label className="text-[11px] font-medium text-muted-foreground mb-1 block">{label}</label>
      <input
        type="number"
        step={step}
        min={min}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums"
        data-testid={testId}
      />
    </div>
  );
}

function ResultCard({
  label, pct, annualized, dollar, accent,
}: {
  label: string;
  pct: number;
  annualized: number;
  dollar: number;
  accent: "blue" | "green" | "primary";
}) {
  const color =
    accent === "blue" ? "text-blue-400"
    : accent === "green" ? "text-green-400"
    : "text-primary";
  return (
    <div className="bg-muted/30 border border-card-border/50 rounded-lg p-3">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-bold tabular-nums font-mono ${color}`}>{pct.toFixed(2)}%</div>
      <div className="text-[11px] text-muted-foreground">
        <span className="text-foreground font-semibold tabular-nums">{annualized.toFixed(1)}%</span> annualized
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
        ${dollar.toLocaleString(undefined, { maximumFractionDigits: 0 })} premium
      </div>
    </div>
  );
}

function InfoCard({
  label, value, sub, danger,
}: {
  label: string;
  value: string;
  sub?: string;
  danger?: boolean;
}) {
  return (
    <div className="bg-muted/30 border border-card-border/50 rounded-lg p-3">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-bold tabular-nums font-mono ${danger ? "text-red-400" : "text-foreground"}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
