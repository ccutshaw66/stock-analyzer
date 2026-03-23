import { useState, useMemo } from "react";
import { TRADE_TYPES, type TradeTypeCode } from "@shared/schema";
import {
  Calculator, TrendingUp, DollarSign,
  AlertTriangle, Plus, Minus, RotateCcw, HelpCircle, Info
} from "lucide-react";

// ─── Collapsible Help Section ─────────────────────────────────────────────────

function HelpBlock({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-primary/20 bg-primary/5 rounded-lg mb-4">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-primary hover:text-primary/80">
        <Info className="h-3.5 w-3.5 shrink-0" />
        <span>{title}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open && <div className="px-3 pb-3 text-xs text-muted-foreground leading-relaxed space-y-2">{children}</div>}
    </div>
  );
}

// ─── Risk Calculator ──────────────────────────────────────────────────────────

function RiskCalculator() {
  const [contracts, setContracts] = useState(1);
  const [tradeType, setTradeType] = useState<TradeTypeCode>("PCS");
  const [spreadWidth, setSpreadWidth] = useState(5);
  const [openPrice, setOpenPrice] = useState(1.50);
  const [accountValue, setAccountValue] = useState(10000);
  const [maxRiskPct, setMaxRiskPct] = useState(5);

  const typeDef = TRADE_TYPES[tradeType];
  const isCredit = openPrice > 0;
  const absPrice = Math.abs(openPrice);

  const allocation = useMemo(() => {
    if (typeDef.category === "Stock") return absPrice * contracts;
    if (typeDef.legs >= 2 && spreadWidth > 0) {
      if (isCredit) return (spreadWidth - absPrice) * 100 * contracts;
      return absPrice * 100 * contracts;
    }
    return absPrice * 100 * contracts;
  }, [contracts, absPrice, spreadWidth, isCredit, typeDef]);

  const maxProfit = useMemo(() => {
    if (typeDef.category === "Stock") return Infinity;
    if (typeDef.legs >= 2 && spreadWidth > 0) {
      if (isCredit) return absPrice * 100 * contracts;
      return (spreadWidth - absPrice) * 100 * contracts;
    }
    return Infinity;
  }, [contracts, absPrice, spreadWidth, isCredit, typeDef]);

  const riskPct = accountValue > 0 ? (allocation / accountValue) * 100 : 0;
  const riskWarning = riskPct > maxRiskPct;
  const maxContractsForRisk = useMemo(() => {
    const maxRiskDollars = accountValue * (maxRiskPct / 100);
    if (typeDef.legs >= 2 && spreadWidth > 0) {
      const riskPerContract = isCredit ? (spreadWidth - absPrice) * 100 : absPrice * 100;
      return riskPerContract > 0 ? Math.floor(maxRiskDollars / riskPerContract) : 0;
    }
    return absPrice > 0 ? Math.floor(maxRiskDollars / (absPrice * 100)) : 0;
  }, [accountValue, maxRiskPct, absPrice, spreadWidth, isCredit, typeDef]);

  const optionTypes = Object.entries(TRADE_TYPES)
    .filter(([_, v]) => v.category === "Option")
    .map(([k]) => k as TradeTypeCode);

  return (
    <div className="bg-card border border-card-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <Calculator className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold text-foreground">Risk Calculator</h3>
      </div>

      <HelpBlock title="How to use the Risk Calculator">
        <p>This tool helps you figure out <strong className="text-foreground">how many contracts you can trade</strong> without exceeding your risk limit.</p>
        <p><strong className="text-foreground">Open Price:</strong> Enter the price per contract. Positive = credit received, Negative = debit paid. The default $1.50 means you received $1.50 credit (like selling a put credit spread).</p>
        <p><strong className="text-foreground">Example — PCS (Put Credit Spread):</strong> You sell a $5-wide put credit spread for $1.50 credit. Your max risk = ($5 - $1.50) × 100 = $350 per contract. Max profit = $1.50 × 100 = $150 per contract.</p>
        <p><strong className="text-foreground">Example — CDS (Call Debit Spread):</strong> Set open price to -2.00. You pay $2.00 debit on a $5-wide spread. Risk = $2.00 × 100 = $200. Max profit = ($5 - $2) × 100 = $300.</p>
        <p>The <strong className="text-foreground">Max Contracts</strong> box tells you the most contracts you can trade at your risk % limit.</p>
      </HelpBlock>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Trade Type</label>
          <select value={tradeType} onChange={e => setTradeType(e.target.value as TradeTypeCode)}
            className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground" data-testid="risk-trade-type">
            {optionTypes.map(code => (
              <option key={code} value={code}>{code} - {TRADE_TYPES[code].label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block"># Contracts</label>
          <input type="number" value={contracts} onChange={e => setContracts(parseInt(e.target.value) || 1)} min={1}
            className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums" />
        </div>
        {typeDef.legs >= 2 && (
          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Spread Width ($)</label>
            <input type="number" step="0.5" value={spreadWidth} onChange={e => setSpreadWidth(parseFloat(e.target.value) || 0)}
              className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums" />
          </div>
        )}
        <div>
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Open Price <span className="text-[9px]">(+ credit / - debit)</span></label>
          <input type="number" step="0.01" value={openPrice} onChange={e => setOpenPrice(parseFloat(e.target.value) || 0)}
            className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Account Value ($)</label>
          <input type="number" value={accountValue} onChange={e => setAccountValue(parseFloat(e.target.value) || 0)}
            className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Max Risk %</label>
          <input type="number" step="0.5" value={maxRiskPct} onChange={e => setMaxRiskPct(parseFloat(e.target.value) || 5)}
            className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ResultCard label="Risk ($)" value={`$${allocation.toFixed(2)}`} color={riskWarning ? "text-red-400" : "text-foreground"} warning={riskWarning} />
        <ResultCard label="Risk (%)" value={`${riskPct.toFixed(2)}%`} color={riskWarning ? "text-red-400" : riskPct > 3 ? "text-yellow-400" : "text-green-400"} warning={riskWarning} />
        <ResultCard label="Max Profit ($)" value={maxProfit === Infinity ? "Unlimited" : `$${maxProfit.toFixed(2)}`} color="text-green-400" />
        <ResultCard label="Max Contracts" value={String(maxContractsForRisk)} color="text-primary" subtitle={`at ${maxRiskPct}% risk`} />
      </div>
    </div>
  );
}

// ─── Vertical Spread Expectancy Calculator ────────────────────────────────────

function VerticalExpectancy() {
  const [mode, setMode] = useState<"short" | "long">("short");
  const [credit, setCredit] = useState(75);
  const [probOTM, setProbOTM] = useState(65);
  const [numTrades, setNumTrades] = useState(10);

  const shortCalc = useMemo(() => {
    const probOTMDec = probOTM / 100;
    const probITMDec = 1 - probOTMDec;
    const theoGain = credit * probOTMDec * numTrades;
    const theoLoss = credit * probITMDec * numTrades;
    const netExpectancy = theoGain - theoLoss;
    const stopLossBreakeven = probITMDec > 0 ? (credit * probOTMDec) / probITMDec : 0;
    return { theoGain, theoLoss, netExpectancy, stopLossBreakeven };
  }, [credit, probOTM, numTrades]);

  const longCalc = useMemo(() => {
    const probITMDec = (100 - probOTM) / 100;
    const probOTMDec = probOTM / 100;
    const maxProfit = credit;
    const theoGain = maxProfit * probITMDec * numTrades;
    const theoLoss = maxProfit * probOTMDec * numTrades;
    const netExpectancy = theoGain - theoLoss;
    const maxDebit = probOTMDec > 0 ? (maxProfit * probITMDec) / probOTMDec : 0;
    return { theoGain, theoLoss, netExpectancy, maxDebit };
  }, [credit, probOTM, numTrades]);

  const calc = mode === "short" ? shortCalc : longCalc;

  return (
    <div className="bg-card border border-card-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold text-foreground">Vertical Spread Expectancy</h3>
      </div>

      <HelpBlock title="How to use the Expectancy Calculator">
        <p>This tells you the <strong className="text-foreground">expected profit or loss over multiple trades</strong> of the same type. It's a statistical tool — not a guarantee.</p>
        <p><strong className="text-foreground">Short Vertical (Credit Spread):</strong> You sell a spread and collect a credit. You win when the option expires OTM (out of the money). Enter the credit received and the probability of expiring OTM from your broker's chain.</p>
        <p><strong className="text-foreground">Example:</strong> Sell a PCS for $75 credit, Prob OTM = 65%. Over 10 trades: Theo Gain = $75 × 0.65 × 10 = $487.50. Theo Loss = $75 × 0.35 × 10 = $262.50. Net = +$225 (positive edge).</p>
        <p><strong className="text-foreground">Long Vertical (Debit Spread):</strong> You buy a spread. You win when it goes ITM. Prob OTM means it DOESN'T work for you, so higher OTM = lower chance of winning. Set Prob OTM lower (40-50%) for debit spreads you expect to win.</p>
        <p><strong className="text-foreground">Stop Loss to B/E:</strong> For credit spreads — the dollar amount at which you'd need to set your stop loss so that over many trades, your losses equal your gains (breakeven).</p>
      </HelpBlock>

      <div className="flex gap-2 mb-4">
        {(["short", "long"] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              mode === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
            }`}>
            {m === "short" ? "Short Vertical (Credit)" : "Long Vertical (Debit)"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
            {mode === "short" ? "Credit Received ($)" : "Max Profit ($)"}
          </label>
          <input type="number" value={credit} onChange={e => setCredit(parseFloat(e.target.value) || 0)}
            className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Prob. OTM (%)</label>
          <input type="number" value={probOTM} onChange={e => setProbOTM(parseFloat(e.target.value) || 50)}
            className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block"># Trades</label>
          <input type="number" value={numTrades} onChange={e => setNumTrades(parseInt(e.target.value) || 10)}
            className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ResultCard label={`Theo. Gain (${numTrades} trades)`} value={`$${calc.theoGain.toFixed(2)}`} color="text-green-400" />
        <ResultCard label={`Theo. Loss (${numTrades} trades)`} value={`$${calc.theoLoss.toFixed(2)}`} color="text-red-400" />
        <ResultCard label="Net Expectancy" value={`$${calc.netExpectancy.toFixed(2)}`}
          color={calc.netExpectancy >= 0 ? "text-green-400" : "text-red-400"} />
        {mode === "short" ? (
          <ResultCard label="Stop Loss to B/E" value={`$${shortCalc.stopLossBreakeven.toFixed(2)}`} color="text-yellow-400" />
        ) : (
          <ResultCard label="Max Debit to Pay" value={`$${longCalc.maxDebit.toFixed(2)}`} color="text-yellow-400" />
        )}
      </div>
    </div>
  );
}

// ─── Defined Risk/Reward Calculator ───────────────────────────────────────────

function DefinedRiskReward() {
  const [commission, setCommission] = useState(2.60);
  const [pop, setPop] = useState(65);
  const [strikeWidth, setStrikeWidth] = useState(5);
  const [openPrice, setOpenPrice] = useState(1.50);
  const [contracts, setContracts] = useState(1);

  const isCredit = openPrice > 0;
  const credit = isCredit ? openPrice * 100 * contracts : 0;
  const debit = !isCredit ? Math.abs(openPrice) * 100 * contracts : 0;
  const maxProfit = isCredit ? credit - commission : (strikeWidth * 100 * contracts - debit - commission);
  const maxLoss = isCredit ? (strikeWidth * 100 * contracts - credit + commission) : (debit + commission);

  const pol = 100 - pop;

  // Expectancy over 100 trades
  const expect100 = (pop / 100) * maxProfit * 100 - (pol / 100) * maxLoss * 100;

  const targets = [50, 65, 75].map(pct => ({
    pct,
    profit: maxProfit * (pct / 100),
    loss: maxLoss * (pct / 100),
  }));

  return (
    <div className="bg-card border border-card-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <DollarSign className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold text-foreground">Defined Risk/Reward Calculator</h3>
      </div>

      <HelpBlock title="How to use the Risk/Reward Calculator">
        <p>This evaluates whether a specific spread trade has a <strong className="text-foreground">positive mathematical edge</strong> over 100 trades.</p>
        <p><strong className="text-foreground">POP (Probability of Profit):</strong> Get this from your broker's option chain. For credit spreads it's usually the Prob OTM. For debit spreads it's the Prob ITM.</p>
        <p><strong className="text-foreground">Open Price:</strong> Positive = credit spread (you receive money). Negative = debit spread (you pay money). The sign matters.</p>
        <p><strong className="text-foreground">Example — Credit Spread:</strong> $5-wide PCS, $1.50 credit, POP=65%. Max Profit = $150 - $2.60 comm = $147.40. Max Loss = $500 - $150 + $2.60 = $352.60. Over 100 trades: (65% × $147.40 × 100) - (35% × $352.60 × 100) = +$9,581 - $12,341 = +$9,581 positive edge with these numbers.</p>
        <p><strong className="text-foreground">Target exits:</strong> Shows what dollar amount to close at for 50%, 65%, or 75% of max profit/loss. Most traders close credit spreads at 50% of max profit.</p>
        <p><strong className="text-foreground">If 100-Trade Expectancy is red:</strong> The trade has a negative edge — you'd lose money over time. Try a higher POP, wider strikes, or more credit.</p>
      </HelpBlock>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <div>
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Commission ($)</label>
          <input type="number" step="0.01" value={commission} onChange={e => setCommission(parseFloat(e.target.value) || 0)}
            className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">POP (%)</label>
          <input type="number" value={pop} onChange={e => setPop(parseFloat(e.target.value) || 0)}
            className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Strike Width ($)</label>
          <input type="number" step="0.5" value={strikeWidth} onChange={e => setStrikeWidth(parseFloat(e.target.value) || 0)}
            className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Open Price <span className="text-[9px]">(+ credit / - debit)</span></label>
          <input type="number" step="0.01" value={openPrice} onChange={e => setOpenPrice(parseFloat(e.target.value) || 0)}
            className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block"># Contracts</label>
          <input type="number" value={contracts} onChange={e => setContracts(parseInt(e.target.value) || 1)} min={1}
            className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <ResultCard label={isCredit ? "Credit Received" : "Debit Paid"} value={`$${(isCredit ? credit : debit).toFixed(2)}`}
          color={isCredit ? "text-green-400" : "text-red-400"} />
        <ResultCard label="Max Profit" value={`$${maxProfit.toFixed(2)}`} color="text-green-400" />
        <ResultCard label="Max Loss" value={`$${maxLoss.toFixed(2)}`} color="text-red-400" />
        <ResultCard label="100-Trade Expectancy" value={`$${expect100.toFixed(2)}`}
          color={expect100 >= 0 ? "text-green-400" : "text-red-400"} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-card-border">
              <th className="text-left pb-2 text-[11px] font-semibold uppercase tracking-wider">Exit Target</th>
              <th className="text-right pb-2 text-[11px] font-semibold uppercase tracking-wider">Close at Profit</th>
              <th className="text-right pb-2 text-[11px] font-semibold uppercase tracking-wider">Stop at Loss</th>
            </tr>
          </thead>
          <tbody>
            {targets.map(t => (
              <tr key={t.pct} className="border-b border-card-border/30">
                <td className="py-1.5 font-semibold text-foreground">{t.pct}% of Max</td>
                <td className="py-1.5 text-right text-green-400 tabular-nums font-mono">${t.profit.toFixed(2)}</td>
                <td className="py-1.5 text-right text-red-400 tabular-nums font-mono">${t.loss.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Weighted Price Calculator ────────────────────────────────────────────────

interface Leg {
  id: number;
  contracts: number;
  price: number;
}

function WeightedPriceCalculator() {
  const [calcType, setCalcType] = useState<"OPTIONS" | "STOCKS">("OPTIONS");
  const [legsIn, setLegsIn] = useState<Leg[]>([{ id: 1, contracts: 0, price: 0 }]);
  const [legsOut, setLegsOut] = useState<Leg[]>([{ id: 1, contracts: 0, price: 0 }]);

  const addLeg = (setter: React.Dispatch<React.SetStateAction<Leg[]>>) => {
    setter(prev => [...prev, { id: Date.now(), contracts: 0, price: 0 }]);
  };
  const removeLeg = (setter: React.Dispatch<React.SetStateAction<Leg[]>>, id: number) => {
    setter(prev => prev.filter(l => l.id !== id));
  };
  const updateLeg = (setter: React.Dispatch<React.SetStateAction<Leg[]>>, id: number, field: "contracts" | "price", value: number) => {
    setter(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  const multiplier = calcType === "OPTIONS" ? 100 : 1;
  const inTotal = legsIn.reduce((s, l) => s + l.contracts, 0);
  const inValue = legsIn.reduce((s, l) => s + l.contracts * l.price * multiplier, 0);
  const inWeighted = inTotal > 0 ? inValue / (inTotal * multiplier) : 0;
  const outTotal = legsOut.reduce((s, l) => s + l.contracts, 0);
  const outValue = legsOut.reduce((s, l) => s + l.contracts * l.price * multiplier, 0);
  const outWeighted = outTotal > 0 ? outValue / (outTotal * multiplier) : 0;
  const allocation = Math.abs(inValue);
  const profit = outValue + inValue;
  const roi = allocation > 0 ? (profit / allocation) * 100 : 0;

  const reset = () => {
    setLegsIn([{ id: 1, contracts: 0, price: 0 }]);
    setLegsOut([{ id: 1, contracts: 0, price: 0 }]);
  };

  return (
    <div className="bg-card border border-card-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Weighted Price Calculator</h3>
        </div>
        <div className="flex items-center gap-2">
          <select value={calcType} onChange={e => setCalcType(e.target.value as "OPTIONS" | "STOCKS")}
            className="h-7 px-2 text-[11px] bg-background border border-card-border rounded-md text-foreground">
            <option value="OPTIONS">Options</option>
            <option value="STOCKS">Stocks / ETF</option>
          </select>
          <button onClick={reset} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <HelpBlock title="How to use the Weighted Price Calculator">
        <p>This calculates <strong className="text-foreground">your average entry and exit prices</strong> when you have multiple fill prices on the same trade (scaling in/out).</p>
        <p><strong className="text-foreground">Legs In:</strong> Each time you open a position. Enter the number of contracts/shares and the price you paid.</p>
        <p><strong className="text-foreground">Legs Out:</strong> Each time you close. Enter contracts sold and the price received.</p>
        <p><strong className="text-foreground">Example — Scaling into calls:</strong> Buy 2 contracts at $3.00, then buy 3 more at $2.50. Weighted entry = (2×$3 + 3×$2.50) / 5 = $2.70. If you sell all 5 at $4.00, profit = (5 × $4.00 - 5 × $2.70) × 100 = $650.</p>
        <p><strong className="text-foreground">Use negative prices</strong> for debit legs in and positive for credit legs out.</p>
      </HelpBlock>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <LegSection label="Legs In" legs={legsIn} calcType={calcType} setter={setLegsIn}
          addLeg={() => addLeg(setLegsIn)} removeLeg={(id) => removeLeg(setLegsIn, id)}
          updateLeg={(id, f, v) => updateLeg(setLegsIn, id, f, v)} total={inTotal} weighted={inWeighted} />
        <LegSection label="Legs Out" legs={legsOut} calcType={calcType} setter={setLegsOut}
          addLeg={() => addLeg(setLegsOut)} removeLeg={(id) => removeLeg(setLegsOut, id)}
          updateLeg={(id, f, v) => updateLeg(setLegsOut, id, f, v)} total={outTotal} weighted={outWeighted} />
      </div>

      <div className="grid grid-cols-3 gap-3 mt-4">
        <ResultCard label="Allocation" value={`$${allocation.toFixed(2)}`} color="text-foreground" />
        <ResultCard label="Profit / Loss" value={`$${profit.toFixed(2)}`} color={profit >= 0 ? "text-green-400" : "text-red-400"} />
        <ResultCard label="ROI" value={`${roi.toFixed(2)}%`} color={roi >= 0 ? "text-green-400" : "text-red-400"} />
      </div>
    </div>
  );
}

function LegSection({ label, legs, calcType, addLeg, removeLeg, updateLeg, total, weighted }: {
  label: string; legs: Leg[]; calcType: string; setter: any;
  addLeg: () => void; removeLeg: (id: number) => void;
  updateLeg: (id: number, field: "contracts" | "price", value: number) => void;
  total: number; weighted: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
        <button onClick={addLeg} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><Plus className="h-3 w-3" /></button>
      </div>
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_1fr_28px] gap-2">
          <span className="text-[10px] text-muted-foreground font-semibold"># {calcType === "OPTIONS" ? "Contracts" : "Shares"}</span>
          <span className="text-[10px] text-muted-foreground font-semibold">Price</span>
          <span></span>
        </div>
        {legs.map(leg => (
          <div key={leg.id} className="grid grid-cols-[1fr_1fr_28px] gap-2">
            <input type="number" value={leg.contracts || ""} onChange={e => updateLeg(leg.id, "contracts", parseInt(e.target.value) || 0)}
              className="h-7 px-2 text-xs bg-background border border-card-border rounded text-foreground tabular-nums" placeholder="0" />
            <input type="number" step="0.01" value={leg.price || ""} onChange={e => updateLeg(leg.id, "price", parseFloat(e.target.value) || 0)}
              className="h-7 px-2 text-xs bg-background border border-card-border rounded text-foreground tabular-nums" placeholder="0.00" />
            {legs.length > 1 && (
              <button onClick={() => removeLeg(leg.id)} className="p-1 rounded hover:bg-red-500/15 text-muted-foreground hover:text-red-400">
                <Minus className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        <div className="flex justify-between text-xs pt-1 border-t border-card-border/50">
          <span className="text-muted-foreground">Total: <span className="text-foreground font-semibold tabular-nums">{total}</span></span>
          <span className="text-muted-foreground">Wgt. Price: <span className="text-foreground font-semibold tabular-nums">${weighted.toFixed(2)}</span></span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OptionsCalculator() {
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1200px] mx-auto" data-testid="options-calculator-page">
      <h1 className="text-lg font-bold text-foreground">Options Calculator</h1>
      <p className="text-xs text-muted-foreground -mt-4">Click the blue info bar on each section to see how to fill it out with examples.</p>
      <RiskCalculator />
      <VerticalExpectancy />
      <DefinedRiskReward />
      <WeightedPriceCalculator />
    </div>
  );
}

// ─── Shared Components ────────────────────────────────────────────────────────

function ResultCard({ label, value, color, warning, subtitle }: {
  label: string; value: string; color: string; warning?: boolean; subtitle?: string;
}) {
  return (
    <div className={`bg-muted/30 border rounded-lg p-2.5 ${warning ? "border-red-500/50" : "border-card-border/50"}`}>
      <div className="flex items-center gap-1 mb-0.5">
        {warning && <AlertTriangle className="h-3 w-3 text-red-400" />}
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <span className={`text-sm font-bold tabular-nums ${color}`}>{value}</span>
      {subtitle && <span className="block text-[10px] text-muted-foreground">{subtitle}</span>}
    </div>
  );
}
