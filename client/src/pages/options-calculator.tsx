import { useState, useMemo } from "react";
import { TRADE_TYPES, type TradeTypeCode } from "@shared/schema";
import {
  Calculator, TrendingUp, TrendingDown, DollarSign,
  AlertTriangle, ArrowRight, Plus, Minus, RotateCcw
} from "lucide-react";

// ─── Risk Calculator ──────────────────────────────────────────────────────────

function RiskCalculator() {
  const [contracts, setContracts] = useState(1);
  const [tradeType, setTradeType] = useState<TradeTypeCode>("CDS");
  const [spreadWidth, setSpreadWidth] = useState(5);
  const [openPrice, setOpenPrice] = useState(1.50);
  const [accountValue, setAccountValue] = useState(10000);
  const [maxRiskPct, setMaxRiskPct] = useState(5);

  const typeDef = TRADE_TYPES[tradeType];
  const isCredit = openPrice > 0;
  const isDebit = openPrice < 0;
  const absPrice = Math.abs(openPrice);

  // Risk & Profit Calculations
  const allocation = useMemo(() => {
    if (typeDef.category === "Stock") {
      return absPrice * contracts;
    }
    if (typeDef.legs >= 2 && spreadWidth > 0) {
      // Spread - risk = (width - credit) or debit * 100 * contracts
      if (isCredit) {
        return (spreadWidth - absPrice) * 100 * contracts;
      }
      return absPrice * 100 * contracts;
    }
    // Single option
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
      const riskPerContract = isCredit
        ? (spreadWidth - absPrice) * 100
        : absPrice * 100;
      return riskPerContract > 0 ? Math.floor(maxRiskDollars / riskPerContract) : 0;
    }
    return absPrice > 0 ? Math.floor(maxRiskDollars / (absPrice * 100)) : 0;
  }, [accountValue, maxRiskPct, absPrice, spreadWidth, isCredit, typeDef]);

  const optionTypes = Object.entries(TRADE_TYPES)
    .filter(([_, v]) => v.category === "Option")
    .map(([k]) => k as TradeTypeCode);

  return (
    <div className="bg-card border border-card-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <Calculator className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold text-foreground">Risk Calculator</h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Trade Type</label>
          <select
            value={tradeType}
            onChange={e => setTradeType(e.target.value as TradeTypeCode)}
            className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground"
            data-testid="risk-trade-type"
          >
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
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Open Price (per unit)</label>
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

      {/* Results */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ResultCard
          label="Risk ($)"
          value={`$${allocation.toFixed(2)}`}
          color={riskWarning ? "text-red-400" : "text-foreground"}
          warning={riskWarning}
        />
        <ResultCard
          label="Risk (%)"
          value={`${riskPct.toFixed(2)}%`}
          color={riskWarning ? "text-red-400" : riskPct > 3 ? "text-yellow-400" : "text-green-400"}
          warning={riskWarning}
        />
        <ResultCard
          label="Max Profit ($)"
          value={maxProfit === Infinity ? "Unlimited" : `$${maxProfit.toFixed(2)}`}
          color="text-green-400"
        />
        <ResultCard
          label="Max Contracts"
          value={String(maxContractsForRisk)}
          color="text-primary"
          subtitle={`at ${maxRiskPct}% risk`}
        />
      </div>
    </div>
  );
}

// ─── Vertical Spread Expectancy Calculator ────────────────────────────────────

function VerticalExpectancy() {
  const [mode, setMode] = useState<"short" | "long">("short");
  const [credit, setCredit] = useState(75);
  const [probOTM, setProbOTM] = useState(55);
  const [numTrades, setNumTrades] = useState(10);

  // Short vertical (credit spread)
  const shortCalc = useMemo(() => {
    const probOTMDec = probOTM / 100;
    const probITMDec = 1 - probOTMDec;
    const maxLoss = credit; // simplified: max loss = credit for illustration
    const theoGain = credit * probOTMDec * numTrades;
    const theoLoss = credit * probITMDec * numTrades;
    const netExpectancy = theoGain - theoLoss;
    const stopLossBreakeven = probITMDec > 0 ? (credit * probOTMDec) / probITMDec : 0;
    return { theoGain, theoLoss, netExpectancy, stopLossBreakeven };
  }, [credit, probOTM, numTrades]);

  // Long vertical (debit spread)
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
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold text-foreground">Vertical Spread Expectancy</h3>
      </div>

      {/* Mode Toggle */}
      <div className="flex gap-2 mb-4">
        {(["short", "long"] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              mode === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {m === "short" ? "Short Vertical (Credit)" : "Long Vertical (Debit)"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
            {mode === "short" ? "Credit ($)" : "Max Profit ($)"}
          </label>
          <input type="number" value={credit} onChange={e => setCredit(parseFloat(e.target.value) || 0)}
            className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
            {mode === "short" ? "Prob. OTM (%)" : "Prob. OTM (%)"}
          </label>
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
          <ResultCard label="Max Debit" value={`$${longCalc.maxDebit.toFixed(2)}`} color="text-yellow-400" />
        )}
      </div>
    </div>
  );
}

// ─── Defined Risk/Reward Calculator ───────────────────────────────────────────

function DefinedRiskReward() {
  const [commission, setCommission] = useState(2.65);
  const [pop, setPop] = useState(31);
  const [strikeWidth, setStrikeWidth] = useState(5);
  const [openPrice, setOpenPrice] = useState(1.45);
  const [contracts, setContracts] = useState(1);

  const isCredit = openPrice > 0;
  const credit = isCredit ? openPrice * 100 * contracts : 0;
  const debit = !isCredit ? Math.abs(openPrice) * 100 * contracts : 0;
  const maxProfit = isCredit ? credit - commission : (strikeWidth * 100 * contracts - debit - commission);
  const maxLoss = isCredit ? (strikeWidth * 100 * contracts - credit + commission) : (debit + commission);

  const pol = 100 - pop;

  // Expectancy over 100 trades
  const expect100 = (pop / 100) * maxProfit * 100 - (pol / 100) * maxLoss * 100;

  // Target profit/loss at different percentages
  const targets = [50, 65, 75].map(pct => ({
    pct,
    profit: maxProfit * (pct / 100),
    loss: maxLoss * (pct / 100),
  }));

  return (
    <div className="bg-card border border-card-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <DollarSign className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold text-foreground">Defined Risk/Reward Calculator</h3>
      </div>

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
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Open Price (per unit)</label>
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
        <ResultCard label={isCredit ? "Credit" : "Debit"} value={`$${(isCredit ? credit : debit).toFixed(2)}`}
          color={isCredit ? "text-green-400" : "text-red-400"} />
        <ResultCard label="Max Profit" value={`$${maxProfit.toFixed(2)}`} color="text-green-400" />
        <ResultCard label="Max Loss" value={`$${maxLoss.toFixed(2)}`} color="text-red-400" />
        <ResultCard label="100-Trade Expectancy" value={`$${expect100.toFixed(2)}`}
          color={expect100 >= 0 ? "text-green-400" : "text-red-400"} />
      </div>

      {/* Target Profit/Loss Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-card-border">
              <th className="text-left pb-2 text-[11px] font-semibold uppercase tracking-wider">Target %</th>
              <th className="text-right pb-2 text-[11px] font-semibold uppercase tracking-wider">Target Profit</th>
              <th className="text-right pb-2 text-[11px] font-semibold uppercase tracking-wider">Target Loss</th>
            </tr>
          </thead>
          <tbody>
            {targets.map(t => (
              <tr key={t.pct} className="border-b border-card-border/30">
                <td className="py-1.5 font-semibold text-foreground">{t.pct}% Target</td>
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
  const profit = outValue + inValue; // inValue is negative for debits
  const roi = allocation > 0 ? (profit / allocation) * 100 : 0;

  const reset = () => {
    setLegsIn([{ id: 1, contracts: 0, price: 0 }]);
    setLegsOut([{ id: 1, contracts: 0, price: 0 }]);
  };

  return (
    <div className="bg-card border border-card-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Weighted Price Calculator</h3>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={calcType}
            onChange={e => setCalcType(e.target.value as "OPTIONS" | "STOCKS")}
            className="h-7 px-2 text-[11px] bg-background border border-card-border rounded-md text-foreground"
          >
            <option value="OPTIONS">Options</option>
            <option value="STOCKS">Stocks / ETF</option>
          </select>
          <button onClick={reset} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Legs In */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Legs In</span>
            <button onClick={() => addLeg(setLegsIn)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
              <Plus className="h-3 w-3" />
            </button>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_28px] gap-2">
              <span className="text-[10px] text-muted-foreground font-semibold"># {calcType === "OPTIONS" ? "Contracts" : "Shares"}</span>
              <span className="text-[10px] text-muted-foreground font-semibold">Price</span>
              <span></span>
            </div>
            {legsIn.map(leg => (
              <div key={leg.id} className="grid grid-cols-[1fr_1fr_28px] gap-2">
                <input type="number" value={leg.contracts || ""} onChange={e => updateLeg(setLegsIn, leg.id, "contracts", parseInt(e.target.value) || 0)}
                  className="h-7 px-2 text-xs bg-background border border-card-border rounded text-foreground tabular-nums" placeholder="0" />
                <input type="number" step="0.01" value={leg.price || ""} onChange={e => updateLeg(setLegsIn, leg.id, "price", parseFloat(e.target.value) || 0)}
                  className="h-7 px-2 text-xs bg-background border border-card-border rounded text-foreground tabular-nums" placeholder="0.00" />
                {legsIn.length > 1 && (
                  <button onClick={() => removeLeg(setLegsIn, leg.id)} className="p-1 rounded hover:bg-red-500/15 text-muted-foreground hover:text-red-400">
                    <Minus className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
            <div className="flex justify-between text-xs pt-1 border-t border-card-border/50">
              <span className="text-muted-foreground">Total: <span className="text-foreground font-semibold tabular-nums">{inTotal}</span></span>
              <span className="text-muted-foreground">Wgt. Price: <span className="text-foreground font-semibold tabular-nums">${inWeighted.toFixed(2)}</span></span>
            </div>
          </div>
        </div>

        {/* Legs Out */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Legs Out</span>
            <button onClick={() => addLeg(setLegsOut)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
              <Plus className="h-3 w-3" />
            </button>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_28px] gap-2">
              <span className="text-[10px] text-muted-foreground font-semibold"># {calcType === "OPTIONS" ? "Contracts" : "Shares"}</span>
              <span className="text-[10px] text-muted-foreground font-semibold">Price</span>
              <span></span>
            </div>
            {legsOut.map(leg => (
              <div key={leg.id} className="grid grid-cols-[1fr_1fr_28px] gap-2">
                <input type="number" value={leg.contracts || ""} onChange={e => updateLeg(setLegsOut, leg.id, "contracts", parseInt(e.target.value) || 0)}
                  className="h-7 px-2 text-xs bg-background border border-card-border rounded text-foreground tabular-nums" placeholder="0" />
                <input type="number" step="0.01" value={leg.price || ""} onChange={e => updateLeg(setLegsOut, leg.id, "price", parseFloat(e.target.value) || 0)}
                  className="h-7 px-2 text-xs bg-background border border-card-border rounded text-foreground tabular-nums" placeholder="0.00" />
                {legsOut.length > 1 && (
                  <button onClick={() => removeLeg(setLegsOut, leg.id)} className="p-1 rounded hover:bg-red-500/15 text-muted-foreground hover:text-red-400">
                    <Minus className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
            <div className="flex justify-between text-xs pt-1 border-t border-card-border/50">
              <span className="text-muted-foreground">Total: <span className="text-foreground font-semibold tabular-nums">{outTotal}</span></span>
              <span className="text-muted-foreground">Wgt. Price: <span className="text-foreground font-semibold tabular-nums">${outWeighted.toFixed(2)}</span></span>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Row */}
      <div className="grid grid-cols-3 gap-3 mt-4">
        <ResultCard label="Allocation" value={`$${allocation.toFixed(2)}`} color="text-foreground" />
        <ResultCard label="Profit / Loss" value={`$${profit.toFixed(2)}`} color={profit >= 0 ? "text-green-400" : "text-red-400"} />
        <ResultCard label="ROI" value={`${roi.toFixed(2)}%`} color={roi >= 0 ? "text-green-400" : "text-red-400"} />
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OptionsCalculator() {
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1200px] mx-auto" data-testid="options-calculator-page">
      <h1 className="text-lg font-bold text-foreground">Options Calculator</h1>
      <p className="text-xs text-muted-foreground -mt-4">Risk analysis, expectancy calculations, and weighted price tools for options trading.</p>

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
