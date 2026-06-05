/**
 * /strategy-lab — the (honest) Magic Dashboard. Owner, Admin Playground.
 *
 * One compact, selector-driven options lab: pick a structure (single, vertical,
 * covered call, CSP, straddle, strangle, iron condor) and get net debit/credit,
 * max P/L, break-evens, probability of profit, a payoff curve, the Greeks, and a
 * two-layer hedge readout (per-trade delta → shares; portfolio delta→SPY,
 * vega→VIX). Pure client-side Black-Scholes. No mile-long scroll.
 */
import { useState } from "react";
import { PageTemplate } from "@/components/PageTemplate";

// ── math ───────────────────────────────────────────────────────────────────
function erf(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const N = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
const npdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
function d1d2(S: number, K: number, T: number, sig: number) {
  const d1 = (Math.log(S / K) + 0.5 * sig * sig * T) / (sig * Math.sqrt(T));
  return [d1, d1 - sig * Math.sqrt(T)];
}
function bsPrice(S: number, K: number, T: number, sig: number, call: boolean) {
  if (T <= 0 || sig <= 0) return Math.max(0, call ? S - K : K - S);
  const [d1, d2] = d1d2(S, K, T, sig);
  return call ? S * N(d1) - K * N(d2) : K * N(-d2) - S * N(-d1);
}
function bsDelta(S: number, K: number, T: number, sig: number, call: boolean) {
  if (T <= 0 || sig <= 0) return (call ? (S > K ? 1 : 0) : (S < K ? -1 : 0));
  const [d1] = d1d2(S, K, T, sig);
  return call ? N(d1) : N(d1) - 1;
}
function bsVega(S: number, K: number, T: number, sig: number) { // per 1 vol point
  if (T <= 0 || sig <= 0) return 0;
  const [d1] = d1d2(S, K, T, sig);
  return S * npdf(d1) * Math.sqrt(T) / 100;
}
const lognPdf = (P: number, S: number, T: number, sig: number) => {
  if (P <= 0 || T <= 0 || sig <= 0) return 0;
  const v = sig * Math.sqrt(T);
  const z = (Math.log(P / S) + 0.5 * v * v) / v;
  return npdf(z) / (P * v);
};

type Leg = { side: 1 | -1; kind: "call" | "put" | "stock"; strike: number };
type Strat = { id: string; name: string; group: string; uses: string[]; legs: (k: Record<string, number>) => Leg[]; seed: (S: number) => Record<string, number> };
// round strike to a sensible tick for the price level (defaults the user can adjust)
const rnd = (x: number) => x >= 100 ? Math.round(x) : x >= 20 ? Math.round(x * 2) / 2 : Math.round(x * 10) / 10;
const atm = (S: number) => ({ K2: rnd(S) });
const wings = (S: number) => ({ K1: rnd(S * 0.95), K3: rnd(S * 1.05) });
const fly = (S: number) => ({ K1: rnd(S * 0.94), K2: rnd(S), K3: rnd(S * 1.06) });
const condor = (S: number) => ({ K1: rnd(S * 0.90), K2: rnd(S * 0.95), K3: rnd(S * 1.05), K4: rnd(S * 1.10) });
const STRATS: Strat[] = [
  { id: "long_call", name: "Long Call", group: "Singles", uses: ["K2"], legs: k => [{ side: 1, kind: "call", strike: k.K2 }], seed: atm },
  { id: "long_put", name: "Long Put", group: "Singles", uses: ["K2"], legs: k => [{ side: 1, kind: "put", strike: k.K2 }], seed: atm },
  { id: "short_call", name: "Short Call (naked)", group: "Singles", uses: ["K2"], legs: k => [{ side: -1, kind: "call", strike: k.K2 }], seed: atm },
  { id: "short_put", name: "Short Put (naked)", group: "Singles", uses: ["K2"], legs: k => [{ side: -1, kind: "put", strike: k.K2 }], seed: atm },
  { id: "bull_call", name: "Bull Call Spread (debit)", group: "Verticals", uses: ["K1", "K3"], legs: k => [{ side: 1, kind: "call", strike: k.K1 }, { side: -1, kind: "call", strike: k.K3 }], seed: wings },
  { id: "bear_put", name: "Bear Put Spread (debit)", group: "Verticals", uses: ["K1", "K3"], legs: k => [{ side: 1, kind: "put", strike: k.K3 }, { side: -1, kind: "put", strike: k.K1 }], seed: wings },
  { id: "bull_put", name: "Bull Put Spread (credit)", group: "Verticals", uses: ["K1", "K3"], legs: k => [{ side: 1, kind: "put", strike: k.K1 }, { side: -1, kind: "put", strike: k.K3 }], seed: wings },
  { id: "bear_call", name: "Bear Call Spread (credit)", group: "Verticals", uses: ["K1", "K3"], legs: k => [{ side: -1, kind: "call", strike: k.K1 }, { side: 1, kind: "call", strike: k.K3 }], seed: wings },
  { id: "covered_call", name: "Covered Call", group: "Income", uses: ["K3"], legs: k => [{ side: 1, kind: "stock", strike: 0 }, { side: -1, kind: "call", strike: k.K3 }], seed: S => ({ K3: rnd(S * 1.05) }) },
  { id: "csp", name: "Cash-Secured Put", group: "Income", uses: ["K1"], legs: k => [{ side: -1, kind: "put", strike: k.K1 }], seed: S => ({ K1: rnd(S * 0.95) }) },
  { id: "collar", name: "Collar (stock + put − call)", group: "Income", uses: ["K1", "K3"], legs: k => [{ side: 1, kind: "stock", strike: 0 }, { side: 1, kind: "put", strike: k.K1 }, { side: -1, kind: "call", strike: k.K3 }], seed: wings },
  { id: "protective_put", name: "Protective Put (married put)", group: "Income", uses: ["K1"], legs: k => [{ side: 1, kind: "stock", strike: 0 }, { side: 1, kind: "put", strike: k.K1 }], seed: S => ({ K1: rnd(S * 0.97) }) },
  { id: "long_straddle", name: "Long Straddle", group: "Vol", uses: ["K2"], legs: k => [{ side: 1, kind: "call", strike: k.K2 }, { side: 1, kind: "put", strike: k.K2 }], seed: atm },
  { id: "short_straddle", name: "Short Straddle", group: "Vol", uses: ["K2"], legs: k => [{ side: -1, kind: "call", strike: k.K2 }, { side: -1, kind: "put", strike: k.K2 }], seed: atm },
  { id: "long_strangle", name: "Long Strangle", group: "Vol", uses: ["K1", "K3"], legs: k => [{ side: 1, kind: "put", strike: k.K1 }, { side: 1, kind: "call", strike: k.K3 }], seed: wings },
  { id: "short_strangle", name: "Short Strangle", group: "Vol", uses: ["K1", "K3"], legs: k => [{ side: -1, kind: "put", strike: k.K1 }, { side: -1, kind: "call", strike: k.K3 }], seed: wings },
  { id: "iron_condor", name: "Iron Condor (credit)", group: "Vol", uses: ["K1", "K2", "K3", "K4"], legs: k => [{ side: 1, kind: "put", strike: k.K1 }, { side: -1, kind: "put", strike: k.K2 }, { side: -1, kind: "call", strike: k.K3 }, { side: 1, kind: "call", strike: k.K4 }], seed: condor },
  // Butterfly = two verticals sharing the body strike (a bull spread + a bear spread).
  // Long 1 wing / short 2 body / long 1 wing → debit, peaks at the body strike K2 at expiry.
  { id: "call_butterfly", name: "Call Butterfly (long)", group: "Butterflies", uses: ["K1", "K2", "K3"], legs: k => [{ side: 1, kind: "call", strike: k.K1 }, { side: -1, kind: "call", strike: k.K2 }, { side: -1, kind: "call", strike: k.K2 }, { side: 1, kind: "call", strike: k.K3 }], seed: fly },
  { id: "put_butterfly", name: "Put Butterfly (long)", group: "Butterflies", uses: ["K1", "K2", "K3"], legs: k => [{ side: 1, kind: "put", strike: k.K1 }, { side: -1, kind: "put", strike: k.K2 }, { side: -1, kind: "put", strike: k.K2 }, { side: 1, kind: "put", strike: k.K3 }], seed: fly },
  // Broken-wing: unequal wings (body off-center) → done for a credit / removes one side's risk.
  // Call BWB: wider LOWER wing, narrow upper → keeps a residual above = no upside risk.
  { id: "bw_call_butterfly", name: "Broken-Wing Call Butterfly", group: "Butterflies", uses: ["K1", "K2", "K3"], legs: k => [{ side: 1, kind: "call", strike: k.K1 }, { side: -1, kind: "call", strike: k.K2 }, { side: -1, kind: "call", strike: k.K2 }, { side: 1, kind: "call", strike: k.K3 }], seed: S => ({ K1: rnd(S * 0.95), K2: rnd(S), K3: rnd(S * 1.03) }) },
  // Put BWB: narrow lower wing, wider UPPER → keeps a residual below = no downside risk.
  { id: "bw_put_butterfly", name: "Broken-Wing Put Butterfly", group: "Butterflies", uses: ["K1", "K2", "K3"], legs: k => [{ side: 1, kind: "put", strike: k.K1 }, { side: -1, kind: "put", strike: k.K2 }, { side: -1, kind: "put", strike: k.K2 }, { side: 1, kind: "put", strike: k.K3 }], seed: S => ({ K1: rnd(S * 0.97), K2: rnd(S), K3: rnd(S * 1.06) }) },
  // Iron butterfly = short ATM straddle (body K2) + long wings (K1/K3). Credit, peaks pinned at K2.
  { id: "iron_butterfly", name: "Iron Butterfly (credit)", group: "Butterflies", uses: ["K1", "K2", "K3"], legs: k => [{ side: 1, kind: "put", strike: k.K1 }, { side: -1, kind: "put", strike: k.K2 }, { side: -1, kind: "call", strike: k.K2 }, { side: 1, kind: "call", strike: k.K3 }], seed: fly },
  // Double-Spread Fly (CDSF/PDSF) = a long condor: two SEPARATE verticals (no shared strike) → a
  // fly with a FLAT top between the inner strikes K2..K3. You keep the same max profit anywhere in
  // that body band; defined max loss = net debit beyond the outer wings (K1 / K4). NOT risk-free.
  { id: "cdsf", name: "Call Double-Spread Fly (CDSF)", group: "Butterflies", uses: ["K1", "K2", "K3", "K4"], legs: k => [{ side: 1, kind: "call", strike: k.K1 }, { side: -1, kind: "call", strike: k.K2 }, { side: -1, kind: "call", strike: k.K3 }, { side: 1, kind: "call", strike: k.K4 }], seed: condor },
  { id: "pdsf", name: "Put Double-Spread Fly (PDSF)", group: "Butterflies", uses: ["K1", "K2", "K3", "K4"], legs: k => [{ side: 1, kind: "put", strike: k.K1 }, { side: -1, kind: "put", strike: k.K2 }, { side: -1, kind: "put", strike: k.K3 }, { side: 1, kind: "put", strike: k.K4 }], seed: condor },
];
const STRIKE_LABEL: Record<string, string> = { K1: "K1 (low)", K2: "K2 (mid/ATM)", K3: "K3 (high)", K4: "K4 (far)" };
const $ = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

export default function StrategyLabPage() {
  const [stratId, setStratId] = useState("bull_call");
  const [S, setS] = useState(600);
  const [iv, setIv] = useState(25);
  const [days, setDays] = useState(30);
  const [qty, setQty] = useState(1);
  const [Px, setPx] = useState(600);
  const [k, setK] = useState<Record<string, number>>({ K1: 570, K2: 600, K3: 630, K4: 660 });

  const strat = STRATS.find(s => s.id === stratId)!;
  const T = days / 365, sig = iv / 100, mult = 100 * Math.max(1, qty || 1);
  const legs = strat.legs(k);

  const legPrice = (l: Leg) => l.kind === "stock" ? S : bsPrice(S, l.strike, T, sig, l.kind === "call");
  const legIntrinsic = (l: Leg, P: number) => l.kind === "stock" ? P : Math.max(0, l.kind === "call" ? P - l.strike : l.strike - P);
  const legEntry = (l: Leg) => l.kind === "stock" ? S : legPrice(l);
  const pnlAt = (P: number) => legs.reduce((a, l) => a + l.side * (legIntrinsic(l, P) - legEntry(l)) * mult, 0);
  // net cost: +debit (you pay) / -credit (you collect)
  const netCost = legs.reduce((a, l) => a + l.side * legEntry(l) * mult, 0);
  const netDelta = legs.reduce((a, l) => a + l.side * (l.kind === "stock" ? 1 : bsDelta(S, l.strike, T, sig, l.kind === "call")) * mult, 0);
  const netVega = legs.reduce((a, l) => a + l.side * (l.kind === "stock" ? 0 : bsVega(S, l.strike, T, sig)) * mult, 0);

  // scan payoff
  const lo = 0.01 * S, hi = 3 * S, steps = 400;
  let maxP = -Infinity, minP = Infinity, argMax = lo, argMin = lo, pop = 0;
  const curve: { P: number; pnl: number }[] = [];
  const breakevens: number[] = [];
  let prev = pnlAt(lo);
  for (let i = 0; i <= steps; i++) {
    const P = lo + (hi - lo) * (i / steps);
    const pnl = pnlAt(P);
    curve.push({ P, pnl });
    if (pnl > maxP) { maxP = pnl; argMax = P; }
    if (pnl < minP) { minP = pnl; argMin = P; }
    if (pnl > 0) pop += lognPdf(P, S, T, sig) * ((hi - lo) / steps);
    if (i > 0 && Math.sign(pnl) !== Math.sign(prev) && prev !== 0) {
      const P0 = lo + (hi - lo) * ((i - 1) / steps);
      breakevens.push(P0 + (P - P0) * (Math.abs(prev) / (Math.abs(prev) + Math.abs(pnl))));
    }
    prev = pnl;
  }
  // Truly uncapped only if P&L is still SLOPING at the right edge (calls → ∞ on
  // the upside). A flat plateau at the edge (butterfly, condor, vertical) is a
  // DEFINED max — report the number, don't cry "uncapped". Downside is always
  // finite (price can't go below 0), so the scan's minP captures it.
  const dPedge = (hi - lo) / steps;
  const slopeHi = pnlAt(hi) - pnlAt(hi - dPedge);
  const profitUncapped = slopeHi > 1e-4;
  const lossUncapped = slopeHi < -1e-4;
  const pnlNow = pnlAt(Px);

  // payoff svg path
  const W = 560, H = 150;
  const ymin = Math.min(minP, 0), ymax = Math.max(maxP, 0), yr = ymax - ymin || 1;
  const xOf = (P: number) => ((P - lo) / (hi - lo)) * W;
  const yOf = (v: number) => H - ((v - ymin) / yr) * H;
  const path = curve.filter((_, i) => i % 2 === 0).map((c, i) => `${i === 0 ? "M" : "L"}${xOf(c.P).toFixed(1)},${yOf(c.pnl).toFixed(1)}`).join(" ");

  const Inp = ({ label, val, set, step = 1, suffix }: any) => (
    <label className="text-2xs text-muted-foreground">{label}
      <div className="relative mt-1">
        <input type="number" step={step} value={Number.isFinite(val) ? val : ""} onChange={e => set(parseFloat(e.target.value))}
          className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground tabular-nums" />
        {suffix && <span className="absolute right-2 top-1.5 text-2xs text-muted-foreground">{suffix}</span>}
      </div>
    </label>
  );
  const Stat = ({ label, value, color }: any) => (
    <div><div className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</div><div className={`text-base font-semibold tabular-nums ${color ?? "text-foreground"}`}>{value}</div></div>
  );

  return (
    <PageTemplate howItWorksTitle="Strategy Lab"
      howItWorks={<p className="text-2xs text-muted-foreground">Pick a structure, set spot / IV / days / strikes, and it computes net debit-or-credit, max profit/loss, break-evens, probability of profit, the payoff curve, the Greeks, and the hedges. Pure Black-Scholes — same engine as the vol calc and ToS.</p>}>
      <div className="space-y-3 max-w-[1000px] mx-auto p-1">
        {/* selector + inputs */}
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-2xs text-muted-foreground">Strategy
              <select value={stratId} onChange={e => { const id = e.target.value; setStratId(id); const sd = STRATS.find(s => s.id === id)?.seed(S); if (sd) setK(prev => ({ ...prev, ...sd })); }} className="mt-1 block w-64 rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground">
                {["Singles", "Verticals", "Butterflies", "Income", "Vol"].map(g => (
                  <optgroup key={g} label={g}>{STRATS.filter(s => s.group === g).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
                ))}
              </select>
            </label>
            <button onClick={() => setK({ K1: +(S * 0.92).toFixed(0), K2: +S.toFixed(0), K3: +(S * 1.08).toFixed(0), K4: +(S * 1.15).toFixed(0) })}
              className="rounded border border-border px-2 py-1.5 text-2xs text-foreground">↺ center strikes on spot</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 mt-3">
            <Inp label="Spot ($)" val={S} set={setS} />
            <Inp label="Implied vol" val={iv} set={setIv} suffix="%" />
            <Inp label="Days" val={days} set={setDays} />
            <Inp label="Contracts" val={qty} set={setQty} />
            <Inp label="Price at expiry ($)" val={Px} set={setPx} />
            {strat.uses.map(key => (
              <Inp key={key} label={STRIKE_LABEL[key]} val={k[key]} set={(v: number) => setK({ ...k, [key]: v })} />
            ))}
          </div>
          <div className="text-2xs text-muted-foreground mt-2">
            Legs: {legs.map((l, i) => <span key={i} className={l.side > 0 ? "text-bull-light" : "text-bear-light"}>{i ? " · " : ""}{l.side > 0 ? "+" : "−"}{l.kind === "stock" ? "100 shares" : `${l.kind} ${l.strike}`}</span>)}
          </div>
        </div>

        {/* outputs + payoff */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-card p-4 grid grid-cols-2 gap-y-3">
            <Stat label={netCost >= 0 ? "Net DEBIT (you pay)" : "Net CREDIT (you collect)"} value={$(Math.abs(netCost))} color={netCost >= 0 ? "text-bear-light" : "text-bull-light"} />
            <Stat label="Prob. of profit" value={`${(pop * 100).toFixed(0)}%`} />
            <Stat label="Max profit" value={profitUncapped ? "↑ uncapped" : $(maxP)} color="text-bull-light" />
            <Stat label="Max loss" value={lossUncapped ? "↓ large/uncapped" : $(minP)} color="text-bear-light" />
            <Stat label="Break-even(s)" value={breakevens.length ? breakevens.map(b => "$" + b.toFixed(2)).join(" / ") : "—"} />
            <Stat label={`P&L @ $${Px}`} value={$(pnlNow)} color={pnlNow >= 0 ? "text-bull-light" : "text-bear-light"} />
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-2xs text-muted-foreground mb-1">Payoff at expiry (P&L vs price)</div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-36" preserveAspectRatio="none">
              <line x1="0" y1={yOf(0)} x2={W} y2={yOf(0)} stroke="#6b7280" strokeWidth="1" strokeDasharray="3" />
              <line x1={xOf(S)} y1="0" x2={xOf(S)} y2={H} stroke="#6b7280" strokeWidth="0.5" strokeDasharray="2" />
              <path d={path} fill="none" stroke="#f59e0b" strokeWidth="2" />
            </svg>
            <div className="text-2xs text-muted-foreground">dashed vertical = spot ${S}; horizontal = break-even line</div>
          </div>
        </div>

        {/* hedge: two layers */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-semibold text-foreground mb-2">Hedging</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-2xs">
            <div>
              <div className="text-foreground font-medium mb-1">Per-trade (delta)</div>
              <div className="text-muted-foreground">Net delta: <span className="text-foreground tabular-nums">{netDelta >= 0 ? "+" : ""}{netDelta.toFixed(0)}</span> share-equiv.</div>
              <div className="text-muted-foreground">To flatten direction → <span className="text-foreground">{Math.abs(netDelta) < 1 ? "already ~neutral" : `${netDelta > 0 ? "SELL" : "BUY"} ${Math.abs(netDelta).toFixed(0)} shares`}</span>.</div>
              <div className="text-muted-foreground mt-1 italic">Verticals/condors are mostly self-hedged — the short leg caps delta; the defined risk IS the hedge.</div>
            </div>
            <div>
              <div className="text-foreground font-medium mb-1">Portfolio (SPY / VIX)</div>
              <div className="text-muted-foreground"><span className="text-foreground">SPY</span> hedges direction: this trade ≈ <span className="text-foreground tabular-nums">{$(netDelta * S)}</span> of delta exposure → short that much SPY to kill beta.</div>
              <div className="text-muted-foreground"><span className="text-foreground">VIX</span> hedges vol: net vega <span className="text-foreground tabular-nums">{netVega >= 0 ? "+" : ""}{$(netVega)}</span>/vol-pt. {netVega < 0 ? "You're SHORT vol → long VIX (calls) is the tail hedge." : "You're long vol → VIX hedge not needed."}</div>
            </div>
          </div>
        </div>
        <div className="text-2xs text-muted-foreground px-1">v1 prices legs at Black-Scholes fair from your IV (r=0). Probability of profit is the lognormal chance the payoff finishes &gt; 0 at expiry — the same engine as ToS / the vol calc.</div>
      </div>
    </PageTemplate>
  );
}
