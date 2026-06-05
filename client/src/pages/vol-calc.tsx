/**
 * /vol-calc — Straddle / Volatility Calculator (owner, Admin Playground).
 *
 * Pure client-side. Put in spot, strike, days, IV → it shows the expected move,
 * the Black-Scholes fair call/put, and a full P&L sheet for SELL-vol and BUY-vol
 * as two separate panels (each with its own editable call/put prices so you can
 * drop in real chain quotes). Mirrors the chalkboard lesson exactly.
 */
import { useState } from "react";
import { PageTemplate } from "@/components/PageTemplate";

// --- normal CDF via erf (Abramowitz-Stegun) ---
function erf(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const N = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
function bs(S: number, K: number, T: number, sig: number) {
  if (T <= 0 || sig <= 0 || S <= 0 || K <= 0) return { call: Math.max(S - K, 0), put: Math.max(K - S, 0) };
  const d1 = (Math.log(S / K) + 0.5 * sig * sig * T) / (sig * Math.sqrt(T));
  const d2 = d1 - sig * Math.sqrt(T);
  return { call: S * N(d1) - K * N(d2), put: K * N(-d2) - S * N(-d1) };
}
// Long-straddle delta per share = call Δ + put Δ = 2·N(d1) − 1.
function straddleDelta(S: number, K: number, T: number, sig: number) {
  if (T <= 0 || sig <= 0 || S <= 0 || K <= 0) return S > K ? 1 : S < K ? -1 : 0;
  const d1 = (Math.log(S / K) + 0.5 * sig * sig * T) / (sig * Math.sqrt(T));
  return 2 * N(d1) - 1;
}
// Lognormal P(price < x) at expiry, r=0 — matches ToS Probability Analysis.
function popBelow(S: number, x: number, T: number, sig: number) {
  if (T <= 0 || sig <= 0 || S <= 0 || x <= 0) return x > S ? 1 : 0;
  const d2 = (Math.log(S / x) - 0.5 * sig * sig * T) / (sig * Math.sqrt(T));
  return N(-d2);
}
const $ = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
const $2 = (n: number) => "$" + n.toFixed(2);

function Num({ label, value, set, step = 1, suffix }: { label: string; value: number; set: (n: number) => void; step?: number; suffix?: string }) {
  return (
    <label className="text-2xs text-muted-foreground block">
      {label}
      <div className="relative mt-1">
        <input type="number" step={step} value={Number.isFinite(value) ? value : ""} onChange={e => set(parseFloat(e.target.value))}
          className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground tabular-nums" />
        {suffix && <span className="absolute right-2 top-1.5 text-2xs text-muted-foreground">{suffix}</span>}
      </div>
    </label>
  );
}

// Module-scope (stable identity) so inputs don't lose focus on each keystroke.
function PriceRow({ side, cOv, pOv, setC, setP, fairCall, fairPut }: any) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="text-2xs text-muted-foreground">Call {side}
        <input type="number" step={0.01} value={cOv ?? +fairCall.toFixed(2)} onChange={e => setC(e.target.value === "" ? null : parseFloat(e.target.value))}
          className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground tabular-nums" />
      </label>
      <label className="text-2xs text-muted-foreground">Put {side}
        <input type="number" step={0.01} value={pOv ?? +fairPut.toFixed(2)} onChange={e => setP(e.target.value === "" ? null : parseFloat(e.target.value))}
          className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground tabular-nums" />
      </label>
    </div>
  );
}
function Line({ k, v, color }: { k: string; v: string; color?: string }) {
  return <div className="flex justify-between text-2xs py-0.5"><span className="text-muted-foreground">{k}</span><span className={`tabular-nums ${color ?? "text-foreground"}`}>{v}</span></div>;
}

export default function VolCalcPage() {
  const [S, setS] = useState(600);
  const [K, setK] = useState(600);
  const [days, setDays] = useState(30);
  const [iv, setIv] = useState(25);
  const [contracts, setContracts] = useState(1);
  const [expiry, setExpiry] = useState(600);
  // per-side editable price overrides (null = use BS fair)
  const [sCall, setSCall] = useState<number | null>(null);
  const [sPut, setSPut] = useState<number | null>(null);
  const [bCall, setBCall] = useState<number | null>(null);
  const [bPut, setBPut] = useState<number | null>(null);

  const T = days / 365;
  const sig = iv / 100;
  const sqrtT = Math.sqrt(Math.max(T, 0));
  const expMove = S * sig * sqrtT;            // 1-sigma expected $ move
  const fair = bs(S, K, T, sig);
  const mult = 100 * Math.max(1, contracts || 1);

  const panel = (callOv: number | null, putOv: number | null, sell: boolean) => {
    const call = callOv ?? fair.call;
    const put = putOv ?? fair.put;
    const prem = call + put;
    const beLo = K - prem, beHi = K + prem;
    const straddleAtExpiry = Math.abs(expiry - K);              // |P-K|
    const pnlPerShare = sell ? prem - straddleAtExpiry : straddleAtExpiry - prem;
    const pnl = pnlPerShare * mult;
    const cash = prem * mult;
    return { call, put, prem, beLo, beHi, pnl, cash, straddleAtExpiry };
  };
  const sellP = panel(sCall, sPut, true);
  const buyP = panel(bCall, bPut, false);

  // Probability of profit (lognormal, matches ToS) + the price cone
  const sellPOP = popBelow(S, sellP.beHi, T, sig) - popBelow(S, sellP.beLo, T, sig);
  const buyPOP = 1 - (popBelow(S, buyP.beHi, T, sig) - popBelow(S, buyP.beLo, T, sig));
  const coneAt = (k: number) => S * Math.exp(-0.5 * sig * sig * T + k * sig * Math.sqrt(T));

  // Delta & hedge map across a price range (current time still on the clock)
  const hedgeRows = [0.95, 0.975, 1.0, 1.025, 1.05].map(m => {
    const px = K * m;
    const d = straddleDelta(px, K, T, sig);
    const shares = Math.round(d * mult);
    return { px, d, shares, atm: m === 1.0 };
  });

  return (
    <PageTemplate
      howItWorksTitle="Straddle / Vol calculator"
      howItWorks={
        <p className="text-2xs text-muted-foreground">
          Enter spot, strike, days to expiry, and the implied vol. It shows the expected move
          (<code>S × σ × √T</code>), the Black-Scholes fair call/put, and the full P&amp;L for selling vol
          vs. buying vol. Each side has its own editable call/put prices — type in real chain quotes
          if you want, or leave them on the theoretical fair value.
        </p>
      }
    >
      <div className="space-y-4 max-w-[1000px] mx-auto p-1">
        {/* Shared inputs */}
        <div className="rounded-lg border border-border bg-card p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Num label="Spot ($)" value={S} set={setS} />
          <Num label="Strike ($)" value={K} set={setK} />
          <Num label="Days to expiry" value={days} set={setDays} />
          <Num label="Implied vol" value={iv} set={setIv} suffix="%" />
          <Num label="Contracts" value={contracts} set={setContracts} />
          <Num label="Price at expiry ($)" value={expiry} set={setExpiry} />
        </div>

        {/* Translation strip */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-semibold text-foreground mb-2">What the vol means (chalkboard)</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-2xs">
            <div><div className="text-muted-foreground">√T</div><div className="text-foreground tabular-nums">{sqrtT.toFixed(4)}</div></div>
            <div><div className="text-muted-foreground">Expected 1σ move (S×σ×√T)</div><div className="text-foreground tabular-nums">±{$2(expMove)} ({(sig * sqrtT * 100).toFixed(1)}%)</div></div>
            <div><div className="text-muted-foreground">Fair call / put (BS)</div><div className="text-foreground tabular-nums">{$2(fair.call)} / {$2(fair.put)}</div></div>
            <div><div className="text-muted-foreground">Fair straddle</div><div className="text-foreground tabular-nums">{$2(fair.call + fair.put)}</div></div>
          </div>
          <div className="text-2xs text-muted-foreground mt-2">Daily-move rule of thumb: {iv}% ÷ 16 ≈ <span className="text-foreground">{(iv / 16).toFixed(2)}%/day</span></div>
        </div>

        {/* Two panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* SELL */}
          <div className="rounded-lg border border-bear-light/30 bg-card p-4">
            <div className="text-sm font-semibold text-bear-light mb-2">SELL VOL — short straddle</div>
            <PriceRow side="(sell)" cOv={sCall} pOv={sPut} setC={setSCall} setP={setSPut} fairCall={fair.call} fairPut={fair.put} />
            <div className="mt-3 border-t border-border pt-2">
              <Line k="Premium COLLECTED" v={`${$2(sellP.prem)}/sh → ${$(sellP.cash)}`} color="text-bull-light" />
              <Line k="Break-evens (keep $ between)" v={`${$2(sellP.beLo)} ── ${$2(sellP.beHi)}`} />
              <Line k="Max profit (pins at strike)" v={$(sellP.cash)} color="text-bull-light" />
              <Line k="Risk beyond break-evens" v="$1/sh per $1 further — uncapped" color="text-bear-light" />
              <div className="mt-2 rounded bg-background px-2 py-1.5">
                <Line k={`P&L if expiry = ${$2(expiry)}`} v={$(sellP.pnl)} color={sellP.pnl >= 0 ? "text-bull-light" : "text-bear-light"} />
                <div className="text-2xs text-muted-foreground">straddle worth {$2(sellP.straddleAtExpiry)} at expiry; you sold it for {$2(sellP.prem)}</div>
              </div>
            </div>
          </div>

          {/* BUY */}
          <div className="rounded-lg border border-bull-light/30 bg-card p-4">
            <div className="text-sm font-semibold text-bull-light mb-2">BUY VOL — long straddle</div>
            <PriceRow side="(buy)" cOv={bCall} pOv={bPut} setC={setBCall} setP={setBPut} fairCall={fair.call} fairPut={fair.put} />
            <div className="mt-3 border-t border-border pt-2">
              <Line k="Premium PAID" v={`${$2(buyP.prem)}/sh → ${$(buyP.cash)}`} color="text-bear-light" />
              <Line k="Break-evens (profit OUTSIDE)" v={`${$2(buyP.beLo)} ── ${$2(buyP.beHi)}`} />
              <Line k="Max loss (pins at strike)" v={$(buyP.cash)} color="text-bear-light" />
              <Line k="Reward beyond break-evens" v="$1/sh per $1 further — uncapped, either way" color="text-bull-light" />
              <div className="mt-2 rounded bg-background px-2 py-1.5">
                <Line k={`P&L if expiry = ${$2(expiry)}`} v={$(buyP.pnl)} color={buyP.pnl >= 0 ? "text-bull-light" : "text-bear-light"} />
                <div className="text-2xs text-muted-foreground">straddle worth {$2(buyP.straddleAtExpiry)} at expiry; you paid {$2(buyP.prem)}</div>
              </div>
            </div>
          </div>
        </div>
        {/* Probability of profit + price cone (matches ToS Probability Analysis) */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-semibold text-foreground mb-2">
            Probability &amp; price cone <span className="text-2xs text-muted-foreground">(lognormal at {iv}% IV, {days}d — same engine ToS draws)</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-2xs">
            <div><div className="text-muted-foreground">SELL-vol P.O.P.</div><div className="text-lg font-semibold text-bear-light tabular-nums">{(sellPOP * 100).toFixed(0)}%</div></div>
            <div><div className="text-muted-foreground">BUY-vol P.O.P.</div><div className="text-lg font-semibold text-bull-light tabular-nums">{(buyPOP * 100).toFixed(0)}%</div></div>
            <div><div className="text-muted-foreground">±1σ cone (68%)</div><div className="text-foreground tabular-nums">${coneAt(-1).toFixed(2)} – ${coneAt(1).toFixed(2)}</div></div>
            <div><div className="text-muted-foreground">±2σ cone (95%)</div><div className="text-foreground tabular-nums">${coneAt(-2).toFixed(2)} – ${coneAt(2).toFixed(2)}</div></div>
          </div>
          <div className="text-2xs text-muted-foreground mt-2">
            P.O.P. = chance the trade finishes in profit by expiry. Sell-vol wins if price stays <em>between</em> the break-evens;
            buy-vol wins if it breaks <em>outside</em>. The cone is the lognormal expected move (slightly asymmetric — more room up) —
            it's exactly the band ToS's Probability Analysis draws.
          </div>
        </div>

        {/* Delta & hedge map */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-semibold text-foreground mb-1">
            Delta &amp; hedge map <span className="text-2xs text-muted-foreground">(at {iv}% IV, {days} days still on the clock)</span>
          </div>
          <div className="text-2xs text-muted-foreground mb-2">
            Shares to trade to flatten your delta as the stock moves. Notice the <span className="text-bull-light">long</span> straddle
            sells-high / buys-low (the gamma scalp), and the <span className="text-bear-light">short</span> straddle does the opposite.
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-2xs">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="py-1 pr-4">If stock at</th><th className="pr-4">Straddle Δ</th>
                  <th className="pr-4"><span className="text-bull-light">LONG</span>: hedge</th>
                  <th className="pr-4"><span className="text-bear-light">SHORT</span>: hedge</th>
                </tr>
              </thead>
              <tbody>
                {hedgeRows.map((r, i) => {
                  const longH = r.shares === 0 ? "flat" : r.shares > 0 ? `SELL ${r.shares} sh` : `BUY ${Math.abs(r.shares)} sh`;
                  const shortH = r.shares === 0 ? "flat" : r.shares > 0 ? `BUY ${r.shares} sh` : `SELL ${Math.abs(r.shares)} sh`;
                  return (
                    <tr key={i} className="border-t border-border/50">
                      <td className="py-1 pr-4 text-foreground tabular-nums">{$2(r.px)}{r.atm ? " (ATM)" : ""}</td>
                      <td className={`pr-4 tabular-nums ${r.d >= 0 ? "text-bull-light" : "text-bear-light"}`}>{r.d >= 0 ? "+" : ""}{r.d.toFixed(2)}</td>
                      <td className="pr-4 text-bull-light tabular-nums">{longH}</td>
                      <td className="pr-4 text-bear-light tabular-nums">{shortH}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="text-2xs text-muted-foreground mt-2">
            Δ is per-share for {Math.max(1, contracts || 1)} contract(s) = {mult} shares. Long straddle: above the strike you're long → sell;
            below → buy (harvest the swing). Short straddle: the mirror — you chase the move and pay for it (theta covers you if it stays calm).
          </div>
        </div>

        <div className="text-2xs text-muted-foreground px-1">
          Prices default to Black-Scholes fair from your IV (r = 0). Override either side's call/put with real chain quotes
          to price the actual trade. "Price at expiry" drives both P&amp;L lines so you can stress a calm vs. wild outcome.
        </div>
      </div>
    </PageTemplate>
  );
}
