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
  // Double-Spread Fly (CDSF/PDSF) = a BUTTERFLY legged in as two verticals that SHARE the body
  // strike K2: buy the lower vertical (K1/K2, debit) + sell the upper vertical (K2/K3, credit). If
  // the credit collected > the debit paid, you bank a net credit that is your FLOOR — at the body
  // K2 you get (width + credit); away from it the fly dies but you keep the credit (no loss). Enter
  // your ACTUAL two spread fills below — that net is what drives the P&L (not theoretical BS value).
  { id: "cdsf", name: "Call Double-Spread Fly (CDSF)", group: "Butterflies", uses: ["K1", "K2", "K3"], legs: k => [{ side: 1, kind: "call", strike: k.K1 }, { side: -1, kind: "call", strike: k.K2 }, { side: -1, kind: "call", strike: k.K2 }, { side: 1, kind: "call", strike: k.K3 }], seed: fly },
  { id: "pdsf", name: "Put Double-Spread Fly (PDSF)", group: "Butterflies", uses: ["K1", "K2", "K3"], legs: k => [{ side: 1, kind: "put", strike: k.K1 }, { side: -1, kind: "put", strike: k.K2 }, { side: -1, kind: "put", strike: k.K2 }, { side: 1, kind: "put", strike: k.K3 }], seed: fly },
];
const STRIKE_LABEL: Record<string, string> = { K1: "K1 (low)", K2: "K2 (mid/ATM)", K3: "K3 (high)", K4: "K4 (far)" };
const $ = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

// Defined at MODULE scope (not inside the component) so React keeps the same
// element identity across renders — otherwise every keystroke remounts the
// input and the field loses focus.
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

export default function StrategyLabPage() {
  const [stratId, setStratId] = useState("bull_call");
  const [S, setS] = useState(600);
  const [iv, setIv] = useState(25);
  const [days, setDays] = useState(30);
  const [qty, setQty] = useState(1);
  const [Px, setPx] = useState(600);
  const [k, setK] = useState<Record<string, number>>({ K1: 570, K2: 600, K3: 630, K4: 660 });
  // Double-Spread Fly: the two actual vertical fills (per share). Buy = lower vertical (debit you
  // pay), sell = upper vertical (credit you collect). Net credit = sell − buy = your floor.
  const [buySpread, setBuySpread] = useState(2.0);
  const [sellSpread, setSellSpread] = useState(2.5);
  // Optional real fill (per share, magnitude). Blank = use the Black-Scholes theoretical price.
  // The structure keeps its natural debit/credit DIRECTION; you just type the price off the chain.
  const [priceOverride, setPriceOverride] = useState("");
  // Stop-loss reality check (credit trades): exit when the loss = this % of the credit collected.
  const [stopPct, setStopPct] = useState(60);

  const strat = STRATS.find(s => s.id === stratId)!;
  const isDsf = strat.id === "cdsf" || strat.id === "pdsf";
  const T = days / 365, sig = iv / 100, mult = 100 * Math.max(1, qty || 1);
  const legs = strat.legs(k);

  const legPrice = (l: Leg) => l.kind === "stock" ? S : bsPrice(S, l.strike, T, sig, l.kind === "call");
  const legIntrinsic = (l: Leg, P: number) => l.kind === "stock" ? P : Math.max(0, l.kind === "call" ? P - l.strike : l.strike - P);
  const legEntry = (l: Leg) => l.kind === "stock" ? S : legPrice(l);
  // gross expiry value of the structure (no entry cost) — used with netCost below.
  const grossAt = (P: number) => legs.reduce((a, l) => a + l.side * legIntrinsic(l, P) * mult, 0);
  // net cost: +debit (you pay) / −credit (you collect). Black-Scholes fair by default.
  const netCostBS = legs.reduce((a, l) => a + l.side * legEntry(l) * mult, 0);
  // Split stock cost from option premium: the real-fill override must only swap the OPTION price,
  // never the cost of owned shares (else a covered call "costs a penny" — the bug Chris caught).
  const stockCost = legs.reduce((a, l) => a + (l.kind === "stock" ? l.side * S * mult : 0), 0);
  const optionNetBS = netCostBS - stockCost;
  const ovr = priceOverride.trim() === "" ? null : parseFloat(priceOverride);
  const optDir = optionNetBS >= 0 ? 1 : -1; // keep option leg's debit/credit direction
  const optionNet = (ovr != null && Number.isFinite(ovr)) ? optDir * Math.abs(ovr) * mult : optionNetBS;
  const netCost = isDsf ? (buySpread - sellSpread) * mult : stockCost + optionNet;
  const pnlAt = (P: number) => grossAt(P) - netCost;
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

  // ── stop-loss reality check (credit trades only) ──────────────────────────
  // The credit is NOT banked — you're SHORT the structure and owe it back. A
  // "−X% stop" is a real LOSS of X% of the credit, not "keep (100−X)%". Win the
  // full credit, or buy it back at a loss. Breakeven win rate falls straight out
  // of that risk:reward; a stop can't move it.
  const isCredit = netCost < 0 && stockCost === 0;
  const creditMag = -netCost;                       // total $ credit collected
  const creditPerSh = creditMag / mult;
  const lossAtStop = (stopPct / 100) * creditMag;   // real net loss if stopped
  const buybackPerSh = creditPerSh * (1 + stopPct / 100); // sold here, bought back here
  const buybackTotal = buybackPerSh * mult;         // total $ to close the short at the stop
  const beWinRate = stopPct / (100 + stopPct);      // loss/(win+loss), win=credit loss=stop%·credit

  // payoff svg path
  const W = 560, H = 150;
  const ymin = Math.min(minP, 0), ymax = Math.max(maxP, 0), yr = ymax - ymin || 1;
  const xOf = (P: number) => ((P - lo) / (hi - lo)) * W;
  const yOf = (v: number) => H - ((v - ymin) / yr) * H;
  const path = curve.filter((_, i) => i % 2 === 0).map((c, i) => `${i === 0 ? "M" : "L"}${xOf(c.P).toFixed(1)},${yOf(c.pnl).toFixed(1)}`).join(" ");

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
          {!isDsf && (
            <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex flex-wrap items-end gap-4">
                <label className="text-2xs text-muted-foreground">{stockCost !== 0 ? "Actual option fill ($/share) — blank = theoretical" : "Actual fill ($/share) — blank = theoretical"}
                  <div className="mt-1">
                    <input type="number" step={0.05} value={priceOverride} onChange={e => setPriceOverride(e.target.value)} placeholder={Math.abs(optionNetBS / mult).toFixed(2)}
                      className="w-40 rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground tabular-nums" />
                  </div>
                </label>
                <div className="text-2xs text-muted-foreground pb-1.5">
                  Theoretical option (BS @ {iv}% IV): <span className="text-foreground tabular-nums">${Math.abs(optionNetBS / mult).toFixed(2)}/sh</span>
                  {ovr != null && Number.isFinite(ovr) && <span className="text-primary"> · using your real fill ${Math.abs(ovr).toFixed(2)} (model price ignored)</span>}
                  {stockCost !== 0 && <span> · plus {Math.round(stockCost / S / 100) * 100} shares @ ${S} (the real cost)</span>}
                </div>
              </div>
              <div className="text-2xs text-muted-foreground mt-2">Type the <strong className="text-foreground">option</strong> price you'd actually pay/collect off the chain — break-even, P&amp;L, max loss all use it. {stockCost !== 0 && "The cost of the shares you own is kept at the real spot price (not overridden)."}</div>
            </div>
          )}
          {isDsf && (
            <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="text-2xs font-semibold text-primary mb-2">Dual-vertical entry (your actual fills) — buy the K1/K2 spread, sell the K2/K3 spread; they share the body K2.</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Inp label="Buy spread — debit ($)" val={buySpread} set={setBuySpread} step={0.05} />
                <Inp label="Sell spread — credit ($)" val={sellSpread} set={setSellSpread} step={0.05} />
              </div>
              <div className="text-2xs text-muted-foreground mt-2">
                Net {sellSpread - buySpread >= 0
                  ? <><span className="text-bull-light font-semibold">credit ${(sellSpread - buySpread).toFixed(2)}/sh</span> = your floor. At the body ${k.K2} you collect width (${(k.K2 - k.K1).toFixed(2)}) + the credit; away from it the fly dies but you keep the credit — no loss.</>
                  : <><span className="text-bear-light font-semibold">debit ${(buySpread - sellSpread).toFixed(2)}/sh</span> = your max risk. A symmetric fly normally fills for a small debit — the "no-loss" floor only exists if you genuinely sell the upper spread for more than the lower costs.</>}
              </div>
            </div>
          )}
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
            {lossUncapped
              ? <Stat label="Max loss" value="↓ large/uncapped" color="text-bear-light" />
              : minP >= 0
                ? <Stat label="Floor (worst case)" value={`+${$(minP)}`} color="text-bull-light" />
                : <Stat label="Max loss" value={$(minP)} color="text-bear-light" />}
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

        {/* stop-loss reality check — credit trades only */}
        {isCredit && (
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-2">
              <div className="text-sm font-semibold text-foreground">Stop-loss reality check</div>
              <label className="text-2xs text-muted-foreground">Stop at % of credit
                <div className="relative mt-1">
                  <input type="number" step={5} value={Number.isFinite(stopPct) ? stopPct : ""} onChange={e => setStopPct(parseFloat(e.target.value))}
                    className="w-28 rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground tabular-nums" />
                  <span className="absolute right-2 top-1.5 text-2xs text-muted-foreground">%</span>
                </div>
              </label>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-3">
              <Stat label="Credit collected" value={`+${$(creditMag)}`} color="text-bull-light" />
              <Stat label={`If stopped (−${stopPct}%)`} value={$(-lossAtStop)} color="text-bear-light" />
              <Stat label="Buy back at" value={`$${buybackPerSh.toFixed(2)}/sh`} />
              <Stat label="Breakeven win rate" value={`${(beWinRate * 100).toFixed(0)}%`} />
            </div>

            {/* the ledger — where the money ACTUALLY is. The credit is cancelled by the
                short-spread IOU, so the only thing that moves is the IOU growing. */}
            <div className="mt-3 overflow-x-auto">
              <div className="text-2xs font-semibold text-foreground mb-1">Where your money actually is — you're <span className="text-bear-light">short</span> the spread (you owe it back)</div>
              <table className="w-full text-2xs tabular-nums border-collapse">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="py-1 pr-2 font-medium">Moment</th>
                    <th className="py-1 px-2 font-medium text-right">Cash</th>
                    <th className="py-1 px-2 font-medium text-right">Spread you OWE</th>
                    <th className="py-1 pl-2 font-medium text-right">Net P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border">
                    <td className="py-1 pr-2 text-foreground">1. You sell it (credit + IOU cancel)</td>
                    <td className="py-1 px-2 text-right text-bull-light">+{$(creditMag)}</td>
                    <td className="py-1 px-2 text-right text-bear-light">{$(-creditMag)}</td>
                    <td className="py-1 pl-2 text-right text-foreground">$0</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="py-1 pr-2 text-foreground">2. It moves against you (IOU grows)</td>
                    <td className="py-1 px-2 text-right text-bull-light">+{$(creditMag)}</td>
                    <td className="py-1 px-2 text-right text-bear-light">{$(-buybackTotal)}</td>
                    <td className="py-1 pl-2 text-right text-bear-light">{$(-lossAtStop)}</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="py-1 pr-2 text-foreground">3. You buy it back (−{stopPct}% stop)</td>
                    <td className="py-1 px-2 text-right text-bear-light">{$(-lossAtStop)}</td>
                    <td className="py-1 px-2 text-right text-foreground">$0</td>
                    <td className="py-1 pl-2 text-right text-bear-light font-semibold">{$(-lossAtStop)}</td>
                  </tr>
                  <tr className="border-t border-border bg-bull-light/5">
                    <td className="py-1 pr-2 text-muted-foreground italic">…or it expires worthless (you win)</td>
                    <td className="py-1 px-2 text-right text-bull-light">+{$(creditMag)}</td>
                    <td className="py-1 px-2 text-right text-foreground">$0</td>
                    <td className="py-1 pl-2 text-right text-bull-light font-semibold">+{$(creditMag)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="text-2xs text-muted-foreground mt-1.5">The +{$(creditMag)} cash never moves — it was cancelled by the IOU in row 1. The only thing that changes is the <strong className="text-foreground">IOU growing from {$(-creditMag)} to {$(-buybackTotal)}</strong>. That {$(lossAtStop)} of growth is your loss. (It's short-selling: you got cash up front, but you owe the position back — profit only if you buy it back for less.)</p>
            </div>

            <div className="mt-3 space-y-1.5 text-2xs text-muted-foreground">
              <p>The credit isn't banked — you're <strong className="text-foreground">short</strong> this structure and owe it back. A −{stopPct}% stop is a <strong className="text-bear-light">real loss of {$(lossAtStop)}</strong> (sold for ${creditPerSh.toFixed(2)}/sh, bought back at ${buybackPerSh.toFixed(2)}/sh). You keep <strong className="text-foreground">$0</strong> of the credit — not {100 - stopPct}%.</p>
              <p>You win the full <span className="text-bull-light">+{$(creditMag)}</span> or you lose <span className="text-bear-light">{$(-lossAtStop)}</span> → you must win <strong className="text-foreground">{(beWinRate * 100).toFixed(0)}%</strong> of trades just to break even. A fairly-priced trade's real odds sit right on that line, so <strong className="text-foreground">no stop turns it positive</strong> — expectancy ≈ $0 before costs, negative after.</p>
              <p><strong className="text-foreground">Gaps ignore your stop.</strong> A stop only caps the loss if it fills. Price gapping through your strikes overnight skips it → full max loss {lossUncapped ? <span className="text-bear-light">large / uncapped</span> : <span className="text-bear-light">{$(minP)}</span>}.</p>
              <p><strong className="text-foreground">Trailing stop?</strong> Same math. It locks open profit on winners but whipsaws you out of eventual winners on noise and is equally useless on a gap — it can't move the {(beWinRate * 100).toFixed(0)}% breakeven above.</p>
            </div>
          </div>
        )}

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
