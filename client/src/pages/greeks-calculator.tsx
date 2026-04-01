import { useState, useMemo } from "react";
import {
  Activity, TrendingUp, DollarSign, Percent,
  AlertTriangle, Calculator, Target, Download,
} from "lucide-react";
import { HelpBlock, Example, ScoreRange } from "@/components/HelpBlock";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Disclaimer } from "@/components/Disclaimer";

// ─── Black-Scholes Math ──────────────────────────────────────────────────────

/** Cumulative Normal Distribution — Abramowitz & Stegun rational approximation */
function cnd(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);
  return 0.5 * (1.0 + sign * y);
}

/** Normal PDF */
function npdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

interface GreeksResult {
  d1: number;
  d2: number;
  price: number;
  delta: number;
  gamma: number;
  theta: number;   // daily
  vega: number;     // per 1% IV
  rho: number;      // per 1% rate
  probITM: number;
}

function calcGreeks(
  S: number, K: number, T: number, sigma: number, r: number, isCall: boolean,
): GreeksResult | null {
  if (S <= 0 || K <= 0 || T <= 0 || sigma <= 0) return null;

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const expRT = Math.exp(-r * T);

  let price: number;
  let delta: number;
  let rho: number;
  let theta: number;

  if (isCall) {
    price = S * cnd(d1) - K * expRT * cnd(d2);
    delta = cnd(d1);
    rho = K * T * expRT * cnd(d2) / 100;
    theta = (-S * npdf(d1) * sigma / (2 * sqrtT) - r * K * expRT * cnd(d2)) / 365;
  } else {
    price = K * expRT * cnd(-d2) - S * cnd(-d1);
    delta = cnd(d1) - 1;
    rho = -K * T * expRT * cnd(-d2) / 100;
    theta = (-S * npdf(d1) * sigma / (2 * sqrtT) + r * K * expRT * cnd(-d2)) / 365;
  }

  const gamma = npdf(d1) / (S * sigma * sqrtT);
  const vega = S * npdf(d1) * sqrtT / 100;
  const probITM = isCall ? cnd(d2) : cnd(-d2);

  return { d1, d2, price, delta, gamma, theta, vega, rho, probITM };
}

// ─── Interpretation helpers ──────────────────────────────────────────────────

function deltaInterpretation(delta: number, isCall: boolean): string {
  const absDelta = Math.abs(delta);
  const pct = (absDelta * 100).toFixed(0);
  if (isCall) {
    if (absDelta > 0.7) return `Deep ITM — acts almost like stock. ${pct}% chance of expiring ITM.`;
    if (absDelta > 0.4) return `Near the money — moderate price sensitivity. ${pct}% chance of expiring ITM.`;
    return `Out of the money — low probability of profit. ${pct}% chance of expiring ITM.`;
  }
  if (absDelta > 0.7) return `Deep ITM put — high sensitivity to price drops. ${pct}% chance of expiring ITM.`;
  if (absDelta > 0.4) return `Near the money put — moderate sensitivity. ${pct}% chance of expiring ITM.`;
  return `OTM put — low probability of profit. ${pct}% chance of expiring ITM.`;
}

function gammaInterpretation(gamma: number): string {
  if (gamma > 0.05) return `High gamma — delta will change rapidly. Be cautious near expiration.`;
  if (gamma > 0.02) return `Moderate gamma — delta changes meaningfully with each $1 move.`;
  return `Low gamma — delta is relatively stable across stock price changes.`;
}

function thetaInterpretation(theta: number, isCall: boolean): string {
  const absTheta = Math.abs(theta);
  return `This option ${theta < 0 ? "loses" : "gains"} $${(absTheta * 100).toFixed(2)} per contract per day from time decay.`;
}

function vegaInterpretation(vega: number): string {
  return `A 1% increase in implied volatility adds $${(vega * 100).toFixed(2)} per contract.`;
}

function rhoInterpretation(rho: number, isCall: boolean): string {
  return `A 1% rate increase ${rho > 0 ? "adds" : "reduces"} $${(Math.abs(rho) * 100).toFixed(2)} per contract.`;
}

// ─── Color helpers ───────────────────────────────────────────────────────────

function deltaColor(delta: number): string {
  const ad = Math.abs(delta);
  if (ad > 0.7) return "text-green-400";
  if (ad > 0.4) return "text-yellow-400";
  return "text-red-400";
}

function gammaColor(gamma: number): string {
  if (gamma > 0.05) return "text-red-400";   // high gamma = risky near expiry
  if (gamma > 0.02) return "text-yellow-400";
  return "text-green-400";
}

function thetaColor(theta: number): string {
  if (theta < -0.05) return "text-red-400";
  if (theta < -0.02) return "text-yellow-400";
  return "text-green-400";
}

function vegaColor(vega: number): string {
  if (vega > 0.15) return "text-green-400";
  if (vega > 0.05) return "text-yellow-400";
  return "text-muted-foreground";
}

// ─── Main Component ──────────────────────────────────────────────────────────

function ImportPositionButton({ onImport }: { onImport: (trade: any) => void }) {
  const [open, setOpen] = useState(false);
  const { data: trades } = useQuery<any[]>({
    queryKey: ["/api/trades"],
    queryFn: async () => { const r = await apiRequest("GET", "/api/trades"); return r.json(); },
    enabled: open,
  });
  const openOptions = (trades || []).filter((t: any) => !t.closeDate && t.tradeCategory === "Option");
  const openStocks = (trades || []).filter((t: any) => !t.closeDate && t.tradeCategory === "Stock");
  const allOpen = [...openOptions, ...openStocks];

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} 
        className="text-[11px] text-primary hover:underline flex items-center gap-1 mb-3"
        data-testid="button-import-position">
        <Download className="h-3 w-3" /> Import Open Position
      </button>
    );
  }

  return (
    <div className="mb-3">
      <select 
        onChange={(e) => {
          const trade = allOpen.find(t => t.id === parseInt(e.target.value));
          if (trade) { onImport(trade); setOpen(false); }
        }}
        defaultValue=""
        className="w-full h-8 px-2 text-xs bg-background border border-primary/30 rounded-md text-foreground"
        data-testid="select-import-position"
      >
        <option value="" disabled>Select an open position...</option>
        {allOpen.map(t => (
          <option key={t.id} value={t.id}>
            {t.symbol} — {t.tradeType} {t.strikes || ''} @ ${Math.abs(t.openPrice).toFixed(2)} ({t.contractsShares} {t.tradeCategory === 'Option' ? 'contracts' : 'shares'})
          </option>
        ))}
      </select>
      <button onClick={() => setOpen(false)} className="text-[10px] text-muted-foreground hover:text-foreground mt-1">Cancel</button>
    </div>
  );
}

export default function GreeksCalculator() {
  const [stockPrice, setStockPrice] = useState(100);
  const [strikePrice, setStrikePrice] = useState(100);
  const [dte, setDte] = useState(30);
  const [iv, setIv] = useState(30);
  const [riskFreeRate, setRiskFreeRate] = useState(5);
  const [optionType, setOptionType] = useState<"call" | "put">("call");

  const isCall = optionType === "call";

  const greeks = useMemo(() => {
    const T = dte / 365;
    const sigma = iv / 100;
    const r = riskFreeRate / 100;
    return calcGreeks(stockPrice, strikePrice, T, sigma, r, isCall);
  }, [stockPrice, strikePrice, dte, iv, riskFreeRate, isCall]);

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-6 max-w-[1200px] mx-auto" data-testid="greeks-calculator-page">
      <h1 className="text-lg font-bold text-foreground">Options Greeks Calculator</h1>
      <p className="text-xs text-muted-foreground -mt-4">Black-Scholes Greeks with plain-English interpretation. Click the blue info bar for details.</p>

      <div className="bg-card border border-card-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Black-Scholes Calculator</h3>
        </div>

        <HelpBlock title="Understanding the Options Greeks">
          <p>The Greeks measure how an option's price changes when market conditions change. They help you manage risk.</p>
          <p><strong className="text-foreground">Delta (Δ):</strong> How much the option price moves per $1 stock move. A delta of 0.50 means the option gains ~$50 per contract per $1 stock increase. Calls have positive delta (0 to 1), puts have negative delta (-1 to 0).</p>
          <Example type="good">
            <strong className="text-green-400">Delta = 0.70 (Call):</strong> Deep ITM. The option behaves like 70 shares of stock. High probability of expiring ITM.
          </Example>
          <p><strong className="text-foreground">Gamma (Γ):</strong> How fast delta changes. High gamma near expiration means delta (and your position) can shift dramatically.</p>
          <p><strong className="text-foreground">Theta (Θ):</strong> Time decay — how much value the option loses each day. Negative for long options (you lose money each day), positive for short options (you benefit from decay).</p>
          <Example type="bad">
            <strong className="text-red-400">Theta = -$0.15:</strong> You're losing $15 per contract per day just from the passage of time. Consider whether your directional move will outpace the decay.
          </Example>
          <p><strong className="text-foreground">Vega (ν):</strong> Sensitivity to implied volatility. A vega of 0.10 means a 1% IV increase adds $10 per contract. Buy options when you expect IV to rise, sell when you expect it to fall.</p>
          <p><strong className="text-foreground">Rho (ρ):</strong> Sensitivity to interest rates. Usually the least impactful Greek, but matters for LEAPS and in high-rate environments.</p>
          <ScoreRange label="High Delta" range="|Δ| > 0.70" color="green" description="Deep ITM — high probability of profit, behaves like stock" />
          <ScoreRange label="At the Money" range="|Δ| ≈ 0.50" color="yellow" description="Highest gamma and time value — maximum uncertainty" />
          <ScoreRange label="Low Delta" range="|Δ| < 0.30" color="red" description="OTM — low probability, but cheap. Lottery ticket territory" />
        </HelpBlock>

        <ImportPositionButton onImport={(trade) => {
          if (trade.currentPrice) setStockPrice(trade.currentPrice);
          if (trade.strikes) {
            const firstStrike = parseFloat(trade.strikes.split('/')[0] || trade.strikes.split('|')[0]);
            if (!isNaN(firstStrike)) setStrikePrice(firstStrike);
          }
          const tt = trade.tradeType as string;
          if (['C', 'SC', 'CCS', 'CDS', 'CBFLY', 'CCTV'].includes(tt)) setOptionType('call');
          else if (['P', 'SP', 'PCS', 'PDS', 'PBFLY', 'PCTV'].includes(tt)) setOptionType('put');
        }} />

        {/* Inputs */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Stock Price ($)</label>
            <input
              type="number" step="0.5" min={0.01} value={stockPrice}
              onChange={e => setStockPrice(parseFloat(e.target.value) || 0)}
              className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums"
              data-testid="greeks-stock-price"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Strike Price ($)</label>
            <input
              type="number" step="0.5" min={0.01} value={strikePrice}
              onChange={e => setStrikePrice(parseFloat(e.target.value) || 0)}
              className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums"
              data-testid="greeks-strike-price"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Days to Expiry</label>
            <input
              type="number" step="1" min={1} value={dte}
              onChange={e => setDte(parseInt(e.target.value) || 1)}
              className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums"
              data-testid="greeks-dte"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">IV (%)</label>
            <input
              type="number" step="0.5" min={0.1} value={iv}
              onChange={e => setIv(parseFloat(e.target.value) || 0)}
              className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums"
              data-testid="greeks-iv"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Risk-Free Rate (%)</label>
            <input
              type="number" step="0.1" min={0} value={riskFreeRate}
              onChange={e => setRiskFreeRate(parseFloat(e.target.value) || 0)}
              className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums"
              data-testid="greeks-rfr"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Option Type</label>
            <select
              value={optionType}
              onChange={e => setOptionType(e.target.value as "call" | "put")}
              className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground"
              data-testid="greeks-option-type"
            >
              <option value="call">Call</option>
              <option value="put">Put</option>
            </select>
          </div>
        </div>

        {greeks ? (
          <>
            {/* Greeks Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <GreekCard
                label="Theoretical Price"
                value={`$${greeks.price.toFixed(4)}`}
                color="text-foreground"
                icon={<DollarSign className="h-3 w-3" />}
                interpretation={`Per contract: $${(greeks.price * 100).toFixed(2)}`}
              />
              <GreekCard
                label="Delta (Δ)"
                value={greeks.delta.toFixed(4)}
                color={deltaColor(greeks.delta)}
                icon={<TrendingUp className="h-3 w-3" />}
                interpretation={deltaInterpretation(greeks.delta, isCall)}
              />
              <GreekCard
                label="Gamma (Γ)"
                value={greeks.gamma.toFixed(4)}
                color={gammaColor(greeks.gamma)}
                icon={<Activity className="h-3 w-3" />}
                interpretation={gammaInterpretation(greeks.gamma)}
              />
              <GreekCard
                label="Theta (Θ)"
                value={greeks.theta.toFixed(4)}
                color={thetaColor(greeks.theta)}
                icon={<Calculator className="h-3 w-3" />}
                interpretation={thetaInterpretation(greeks.theta, isCall)}
              />
              <GreekCard
                label="Vega (ν)"
                value={greeks.vega.toFixed(4)}
                color={vegaColor(greeks.vega)}
                icon={<Percent className="h-3 w-3" />}
                interpretation={vegaInterpretation(greeks.vega)}
              />
              <GreekCard
                label="Rho (ρ)"
                value={greeks.rho.toFixed(4)}
                color="text-muted-foreground"
                icon={<Percent className="h-3 w-3" />}
                interpretation={rhoInterpretation(greeks.rho, isCall)}
              />
              <GreekCard
                label="Prob. ITM"
                value={`${(greeks.probITM * 100).toFixed(2)}%`}
                color={greeks.probITM > 0.5 ? "text-green-400" : greeks.probITM > 0.3 ? "text-yellow-400" : "text-red-400"}
                icon={<Target className="h-3 w-3" />}
                interpretation={`There is a ${(greeks.probITM * 100).toFixed(1)}% chance this option expires in the money.`}
              />
            </div>

            {/* Quick Summary Table */}
            <div className="bg-muted/20 border border-card-border/50 rounded-lg p-3">
              <h4 className="text-xs font-semibold text-foreground mb-2">Per-Contract Dollar Impact</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-card-border">
                      <th className="text-left pb-2 text-[11px] font-semibold uppercase tracking-wider">Scenario</th>
                      <th className="text-right pb-2 text-[11px] font-semibold uppercase tracking-wider">$ Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-card-border/30">
                      <td className="py-1.5 text-muted-foreground">Stock moves +$1</td>
                      <td className={`py-1.5 text-right tabular-nums font-mono ${greeks.delta >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {greeks.delta >= 0 ? "+" : ""}${(greeks.delta * 100).toFixed(2)}
                      </td>
                    </tr>
                    <tr className="border-b border-card-border/30">
                      <td className="py-1.5 text-muted-foreground">Stock moves -$1</td>
                      <td className={`py-1.5 text-right tabular-nums font-mono ${-greeks.delta >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {-greeks.delta >= 0 ? "+" : ""}${(-greeks.delta * 100).toFixed(2)}
                      </td>
                    </tr>
                    <tr className="border-b border-card-border/30">
                      <td className="py-1.5 text-muted-foreground">One day passes</td>
                      <td className={`py-1.5 text-right tabular-nums font-mono ${greeks.theta >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {greeks.theta >= 0 ? "+" : ""}${(greeks.theta * 100).toFixed(2)}
                      </td>
                    </tr>
                    <tr className="border-b border-card-border/30">
                      <td className="py-1.5 text-muted-foreground">IV increases 1%</td>
                      <td className="py-1.5 text-right tabular-nums font-mono text-green-400">
                        +${(greeks.vega * 100).toFixed(2)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 text-muted-foreground">IV decreases 1%</td>
                      <td className="py-1.5 text-right tabular-nums font-mono text-red-400">
                        -${(greeks.vega * 100).toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 p-4 bg-muted/20 border border-card-border/50 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-yellow-400" />
            <span className="text-xs text-muted-foreground">Enter valid positive values for stock price, strike, DTE, and IV to calculate Greeks.</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Greek Card ──────────────────────────────────────────────────────────────

function GreekCard({ label, value, color, icon, interpretation }: {
  label: string; value: string; color: string; icon: React.ReactNode; interpretation: string;
}) {
  return (
    <div className="bg-muted/30 border border-card-border/50 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`${color} opacity-70`}>{icon}</span>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <span className={`text-lg font-bold tabular-nums font-mono block ${color}`}>{value}</span>
      <span className="text-[10px] text-muted-foreground leading-snug block mt-1">{interpretation}</span>
    </div>
  );
}
