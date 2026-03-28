import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { TRADE_TYPES, BEHAVIOR_TAGS, type TradeTypeCode } from "@shared/schema";
import {
  Plus, Trash2, RefreshCw, X, ChevronDown, ChevronUp, Edit2,
  TrendingUp, TrendingDown, DollarSign, BarChart3, Target, Settings,
  CheckCircle2, Loader2, History, Clock
} from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { HelpBlock } from "@/components/HelpBlock";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Trade {
  id: number; pilotOrAdd: string; tradeDate: string; expiration: string | null;
  contractsShares: number; symbol: string; currentPrice: number | null;
  target: number | null; tradeType: string; tradeCategory: string;
  strikes: string | null; openPrice: number; commIn: number | null;
  allocation: number | null; maxProfit: number | null; closeDate: string | null;
  closePrice: number | null; commOut: number | null; spreadWidth: number | null;
  creditDebit: string | null; tradePlanNotes: string | null;
  behaviorTag: string | null; createdAt: string;
}

interface Summary {
  totalTrades: number; openTrades: number; totalProfit: number;
  totalWins: number; winRate: number; accountValue: number; openPL: number;
  allocated: number; allocatedPct: number;
  byType: Record<string, { profit: number; loss: number; count: number; wins: number; investment: number }>;
  equityCurve: { date: string; value: number }[];
  behaviorCounts: Record<string, number>; settings: any;
}

interface AccountSettings {
  id: number; startingAccountValue: number; commPerSharesTrade: number;
  commPerOptionContract: number; maxAllocationPerTrade: number; totalAllocatedLimit: number;
}

type FilterTab = "all" | "open" | "closed" | "stocks" | "options";
type SortField = "tradeDate" | "symbol" | "tradeType" | "openPrice" | "profit";

const STOCK_TYPES: TradeTypeCode[] = ["LONG", "SHORT", "DTS"];
const OPTION_TYPES = Object.keys(TRADE_TYPES).filter(k => !STOCK_TYPES.includes(k as TradeTypeCode)) as TradeTypeCode[];

function computeTradeProfit(t: Trade): number {
  if (!t.closeDate) return 0;
  const mult = t.tradeCategory === "Option" ? 100 : 1;
  const open = t.openPrice * t.contractsShares * mult;
  const close = (t.closePrice || 0) * t.contractsShares * mult;
  return open + close - (t.commIn || 0) - (t.commOut || 0);
}

function computeStockPL(t: Trade): number {
  if (!t.currentPrice || t.closeDate) return 0;
  if (t.tradeCategory !== "Stock") return 0;
  const isShort = t.creditDebit === "CREDIT" || t.tradeType === "SHORT";
  if (isShort) return (Math.abs(t.openPrice) - t.currentPrice) * t.contractsShares;
  return (t.currentPrice - Math.abs(t.openPrice)) * t.contractsShares;
}

// Estimate open option P/L using underlying stock price
// For spreads: compare stock vs short strike to estimate if winning or losing
// For naked options: estimate based on intrinsic value approximation
function computeOptionPL(t: Trade): number {
  if (!t.currentPrice || t.closeDate) return 0;
  if (t.tradeCategory !== "Option") return 0;

  const stock = t.currentPrice; // current stock price
  const contracts = t.contractsShares;
  const premium = Math.abs(t.openPrice); // what was paid/received
  const isCredit = t.creditDebit === "CREDIT";
  const sw = t.spreadWidth || 0;

  // Parse strikes
  const strikeParts = (t.strikes || "").replace(/\|/g, "/").split("/").map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
  if (strikeParts.length === 0) return 0;

  const shortStrike = strikeParts[0]; // first strike is typically the short leg
  const type = t.tradeType;

  // --- Credit Spreads (PCS, CCS, SP, SC) ---
  // Max profit = premium received. Max loss = (spread width - premium) * 100 * contracts
  // Estimate: if OTM (winning), approach max profit. If ITM (losing), estimate loss.
  if (type === "PCS" || type === "SP") {
    // Bullish: profit if stock stays ABOVE short strike
    if (stock >= shortStrike) {
      // Winning — estimate near max profit (closer to expiry = closer to max)
      return premium * contracts * 100 * 0.8 - (t.commIn || 0);
    } else {
      // Losing — estimate based on how far ITM
      const itm = shortStrike - stock;
      const loss = Math.min(itm, sw || itm) * contracts * 100;
      return premium * contracts * 100 - loss - (t.commIn || 0);
    }
  }

  if (type === "CCS" || type === "SC") {
    // Bearish: profit if stock stays BELOW short strike
    if (stock <= shortStrike) {
      return premium * contracts * 100 * 0.8 - (t.commIn || 0);
    } else {
      const itm = stock - shortStrike;
      const loss = Math.min(itm, sw || itm) * contracts * 100;
      return premium * contracts * 100 - loss - (t.commIn || 0);
    }
  }

  // --- Debit Spreads (CDS, PDS) ---
  if (type === "CDS") {
    // Bullish: profit if stock moves ABOVE long strike
    const longStrike = shortStrike; // first strike for CDS is the bought strike
    if (stock > longStrike) {
      const intrinsic = Math.min(stock - longStrike, sw || (stock - longStrike));
      return (intrinsic - premium) * contracts * 100 - (t.commIn || 0);
    } else {
      return -premium * contracts * 100 * 0.8 - (t.commIn || 0);
    }
  }

  if (type === "PDS") {
    const longStrike = shortStrike;
    if (stock < longStrike) {
      const intrinsic = Math.min(longStrike - stock, sw || (longStrike - stock));
      return (intrinsic - premium) * contracts * 100 - (t.commIn || 0);
    } else {
      return -premium * contracts * 100 * 0.8 - (t.commIn || 0);
    }
  }

  // --- Naked Calls (C, DTC) ---
  if (type === "C" || type === "DTC") {
    const strike = shortStrike;
    if (stock > strike) {
      const intrinsic = stock - strike;
      return (intrinsic - premium) * contracts * 100 - (t.commIn || 0);
    } else {
      // OTM — losing time value
      return -premium * contracts * 100 * 0.5 - (t.commIn || 0);
    }
  }

  // --- Naked Puts (P, DTP) ---
  if (type === "P" || type === "DTP") {
    const strike = shortStrike;
    if (stock < strike) {
      const intrinsic = strike - stock;
      return (intrinsic - premium) * contracts * 100 - (t.commIn || 0);
    } else {
      return -premium * contracts * 100 * 0.5 - (t.commIn || 0);
    }
  }

  // --- Butterflies & CTVs: rough estimate based on proximity to center ---
  if (type.includes("BFLY") || type.includes("CTV")) {
    // For butterflies, best at center strike. Rough: if near center, positive; if far, losing.
    if (strikeParts.length >= 2) {
      const center = (strikeParts[0] + strikeParts[strikeParts.length - 1]) / 2;
      const dist = Math.abs(stock - center);
      const halfWidth = sw ? sw / 2 : Math.abs(strikeParts[strikeParts.length - 1] - strikeParts[0]) / 2;
      if (dist < halfWidth) {
        // Near center — winning
        const pctToCenter = 1 - (dist / halfWidth);
        return (isCredit ? premium : (sw - premium)) * pctToCenter * contracts * 100 * 0.5 - (t.commIn || 0);
      } else {
        return isCredit ? premium * contracts * 100 * 0.3 - (t.commIn || 0) : -premium * contracts * 100 * 0.7 - (t.commIn || 0);
      }
    }
  }

  return 0;
}

function daysInTrade(t: Trade): number {
  const start = new Date(t.tradeDate);
  const end = t.closeDate ? new Date(t.closeDate) : new Date();
  return Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86400000));
}

// ─── Trade Form (shared by Add, Edit, Historical) ─────────────────────────────

function TradeForm({ mode, initial, settings, onClose }: {
  mode: "add" | "edit" | "historical";
  initial?: Trade;
  settings: AccountSettings;
  onClose: () => void;
}) {
  const isEdit = mode === "edit";
  const isHistorical = mode === "historical";

  const [category, setCategory] = useState<"Stock" | "Option">(initial?.tradeCategory as any || "Option");
  const [tradeType, setTradeType] = useState<TradeTypeCode>((initial?.tradeType as TradeTypeCode) || "C");
  const [pilotOrAdd, setPilotOrAdd] = useState(initial?.pilotOrAdd || "Pilot");
  const [symbol, setSymbol] = useState(initial?.symbol || "");
  const [tradeDate, setTradeDate] = useState(initial?.tradeDate || new Date().toISOString().split("T")[0]);
  const [expiration, setExpiration] = useState(initial?.expiration || "");
  const [contractsShares, setContractsShares] = useState(initial?.contractsShares || 1);
  const [openPrice, setOpenPrice] = useState(initial ? String(Math.abs(initial.openPrice)) : "");
  const [strikes, setStrikes] = useState(initial?.strikes || "");
  const [spreadWidth, setSpreadWidth] = useState(initial?.spreadWidth ? String(initial.spreadWidth) : "");
  const [allocation, setAllocation] = useState(initial?.allocation ? String(initial.allocation) : "");
  const [notes, setNotes] = useState(initial?.tradePlanNotes || "");
  const [behaviorTag, setBehaviorTag] = useState(initial?.behaviorTag || "");

  // CTV dual-vertical fields
  const [ctvBuyStrikes, setCtvBuyStrikes] = useState(""); // e.g. "65/70"
  const [ctvBuyPrice, setCtvBuyPrice] = useState(""); // debit leg price
  const [ctvSellStrikes, setCtvSellStrikes] = useState(""); // e.g. "70/75"
  const [ctvSellPrice, setCtvSellPrice] = useState(""); // credit leg price

  const typeDef = TRADE_TYPES[tradeType];
  const isCredit = typeDef?.isCredit ?? false;
  const isDualVertical = (typeDef as any)?.isDualVertical ?? false;
  const numLegs = typeDef?.legs || 0;

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      if (isEdit && initial) {
        const res = await apiRequest("PATCH", `/api/trades/${initial.id}`, data);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/trades", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/summary"] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let rawPrice = parseFloat(openPrice) || 0;
    // CTV: calculate net from two legs
    if (isDualVertical && ctvBuyPrice && ctvSellPrice) {
      const buyP = parseFloat(ctvBuyPrice) || 0;
      const sellP = parseFloat(ctvSellPrice) || 0;
      rawPrice = sellP - buyP; // positive = net credit, negative = net debit
    }
    // Auto-apply sign: credit = positive, debit = negative
    const signedPrice = isDualVertical
      ? rawPrice // CTV already has correct sign from net calculation
      : (isCredit ? Math.abs(rawPrice) : -Math.abs(rawPrice));
    const sw = parseFloat(spreadWidth) || null;
    const alloc = parseFloat(allocation) || null;

    let commIn = 0;
    if (category === "Option") {
      commIn = contractsShares * numLegs * (settings.commPerOptionContract || 0.65);
    } else {
      commIn = settings.commPerSharesTrade || 0;
    }

    let maxProfit: number | null = null;
    if (sw && numLegs >= 2) {
      if (isCredit) maxProfit = rawPrice * contractsShares * 100;
      else maxProfit = (sw - rawPrice) * contractsShares * 100;
    }

    const targetROI = typeDef?.targetROI || 0;
    const target = targetROI > 0 ? rawPrice * (targetROI / 100) : null;

    const tradeData: any = {
      pilotOrAdd,
      tradeDate,
      expiration: expiration || null,
      contractsShares,
      symbol: symbol.toUpperCase(),
      tradeType,
      tradeCategory: category,
      strikes: isDualVertical ? `${ctvBuyStrikes}|${ctvSellStrikes}` : (strikes || null),
      openPrice: signedPrice,
      commIn,
      allocation: alloc,
      maxProfit,
      target,
      spreadWidth: sw,
      creditDebit: isCredit ? "CREDIT" : "DEBIT",
      tradePlanNotes: notes || null,
      behaviorTag: behaviorTag || null,
    };

    // Historical: include close data
    if (isHistorical && closeDate) {
      const rawClose = parseFloat(closePrice) || 0;
      // Close price sign is opposite: closing a credit = debit (negative), closing a debit = credit (positive)
      const signedClose = isCredit ? -Math.abs(rawClose) : Math.abs(rawClose);
      let commOut = 0;
      if (category === "Option") {
        commOut = contractsShares * numLegs * (settings.commPerOptionContract || 0.65);
      } else {
        commOut = settings.commPerSharesTrade || 0;
      }
      tradeData.closeDate = closeDate;
      tradeData.closePrice = signedClose;
      tradeData.commOut = commOut;
    }

    createMutation.mutate(tradeData);
  };

  const filteredTypes = category === "Stock" ? STOCK_TYPES : OPTION_TYPES;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-card-border rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-card-border">
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            {isHistorical && <History className="h-4 w-4" />}
            {isEdit ? "Edit Trade" : isHistorical ? "Add Historical Trade" : "Add Trade"}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Category Toggle */}
          <div className="flex gap-2">
            {(["Stock", "Option"] as const).map(cat => (
              <button key={cat} type="button"
                onClick={() => { setCategory(cat); setTradeType(cat === "Stock" ? "LONG" : "C"); }}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  category === cat ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                }`}>{cat}</button>
            ))}
          </div>

          {/* Type + Pilot/Add */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Trade Type</label>
              <select value={tradeType} onChange={e => setTradeType(e.target.value as TradeTypeCode)}
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground" data-testid="select-trade-type">
                {filteredTypes.map(code => (
                  <option key={code} value={code}>{code} - {TRADE_TYPES[code].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Pilot / Add</label>
              <select value={pilotOrAdd} onChange={e => setPilotOrAdd(e.target.value)}
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground">
                <option value="Pilot">Pilot</option>
                <option value="Add">Add</option>
              </select>
            </div>
          </div>

          {/* Symbol + Contracts */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Symbol</label>
              <input type="text" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="AAPL"
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground"
                required data-testid="input-trade-symbol" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{category === "Option" ? "Contracts" : "Shares"}</label>
              <input type="number" value={contractsShares} onChange={e => setContractsShares(parseInt(e.target.value) || 1)} min={1}
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground" />
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Trade Date</label>
              <DatePicker value={tradeDate} onChange={setTradeDate} placeholder="Trade date" required />
            </div>
            {category === "Option" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Expiration</label>
                <DatePicker value={expiration} onChange={setExpiration} placeholder="Expiration" />
              </div>
            )}
          </div>

          {/* Price — auto credit/debit label */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`text-xs font-medium mb-1 block ${isCredit ? "text-green-400" : "text-red-400"}`}>
                {isCredit ? "Credit Received" : "Debit Paid"} <span className="text-[10px] text-muted-foreground">(enter as positive)</span>
              </label>
              <div className="relative">
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold ${isCredit ? "text-green-400" : "text-red-400"}`}>
                  {isCredit ? "+" : "−"}
                </span>
                <input type="number" step="0.01" value={openPrice} onChange={e => setOpenPrice(e.target.value)} placeholder="1.50"
                  className={`w-full h-9 pl-7 pr-3 text-sm bg-background border rounded-md font-mono text-foreground ${
                    isCredit ? "border-green-500/30" : "border-red-500/30"
                  }`} required />
              </div>
            </div>
            {category === "Option" && numLegs >= 1 && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Strike(s) <span className="text-[10px]">{numLegs >= 3 ? "e.g. 55/60/65" : numLegs >= 2 ? "e.g. 55/60" : "e.g. 55"}</span>
                </label>
                <input type="text" value={strikes} onChange={e => setStrikes(e.target.value)}
                  className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground" />
              </div>
            )}
          </div>

          {/* CTV Dual Vertical Entry */}
          {isDualVertical && (
            <div className="border border-primary/20 bg-primary/5 rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold text-primary">Dual Vertical Entry (2 spreads = butterfly)</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-red-400 mb-1 block">Buy Spread (Debit Leg)</label>
                  <input type="text" value={ctvBuyStrikes} onChange={e => setCtvBuyStrikes(e.target.value)}
                    placeholder="65/70" className="w-full h-8 px-3 text-xs bg-background border border-red-500/30 rounded-md font-mono text-foreground mb-1" />
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-bold text-red-400">−$</span>
                    <input type="number" step="0.01" value={ctvBuyPrice} onChange={e => setCtvBuyPrice(e.target.value)}
                      placeholder="1.50" className="w-full h-8 pl-7 pr-3 text-xs bg-background border border-red-500/30 rounded-md font-mono text-foreground" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-green-400 mb-1 block">Sell Spread (Credit Leg)</label>
                  <input type="text" value={ctvSellStrikes} onChange={e => setCtvSellStrikes(e.target.value)}
                    placeholder="70/75" className="w-full h-8 px-3 text-xs bg-background border border-green-500/30 rounded-md font-mono text-foreground mb-1" />
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-bold text-green-400">+$</span>
                    <input type="number" step="0.01" value={ctvSellPrice} onChange={e => setCtvSellPrice(e.target.value)}
                      placeholder="2.50" className="w-full h-8 pl-7 pr-3 text-xs bg-background border border-green-500/30 rounded-md font-mono text-foreground" />
                  </div>
                </div>
              </div>
              {ctvBuyPrice && ctvSellPrice && (
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground">Net:</span>
                  <span className={`font-bold tabular-nums ${(parseFloat(ctvSellPrice) || 0) > (parseFloat(ctvBuyPrice) || 0) ? "text-green-400" : "text-red-400"}`}>
                    {(parseFloat(ctvSellPrice) || 0) > (parseFloat(ctvBuyPrice) || 0) ? "+" : "-"}${Math.abs((parseFloat(ctvSellPrice) || 0) - (parseFloat(ctvBuyPrice) || 0)).toFixed(2)} {(parseFloat(ctvSellPrice) || 0) > (parseFloat(ctvBuyPrice) || 0) ? "credit" : "debit"}
                  </span>
                  <span className="text-muted-foreground">Strikes: {ctvBuyStrikes}/{ctvSellStrikes}</span>
                </div>
              )}
            </div>
          )}

          {/* Spread Width + Allocation */}
          <div className="grid grid-cols-2 gap-3">
            {numLegs >= 2 && !isDualVertical && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Spread Width</label>
                <input type="number" step="0.5" value={spreadWidth} onChange={e => setSpreadWidth(e.target.value)} placeholder="5"
                  className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground" />
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Allocation / Risk $</label>
              <input type="number" step="0.01" value={allocation} onChange={e => setAllocation(e.target.value)} placeholder="500"
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground" />
            </div>
          </div>

          {/* Historical: Close fields */}
          {isHistorical && (
            <div className="border-t border-card-border pt-4">
              <p className="text-xs font-semibold text-yellow-400 mb-3 flex items-center gap-1"><Clock className="h-3 w-3" />Close Information</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Close Date</label>
                  <DatePicker value={closeDate} onChange={setCloseDate} placeholder="Close date" required />
                </div>
                <div>
                  <label className={`text-xs font-medium mb-1 block ${isCredit ? "text-red-400" : "text-green-400"}`}>
                    {isCredit ? "Cost to Close (Debit)" : "Proceeds (Credit)"} <span className="text-[10px] text-muted-foreground">(positive)</span>
                  </label>
                  <input type="number" step="0.01" value={closePrice} onChange={e => setClosePrice(e.target.value)} placeholder="0.50"
                    className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground" required />
                </div>
              </div>
            </div>
          )}

          {/* Behavior + Notes */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Behavior Tag</label>
            <select value={behaviorTag} onChange={e => setBehaviorTag(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground">
              <option value="">None</option>
              {BEHAVIOR_TAGS.map(tag => <option key={tag} value={tag}>{tag}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Trade Plan Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full px-3 py-2 text-sm bg-background border border-card-border rounded-md text-foreground resize-none"
              placeholder="Entry rule, catalyst, setup..." />
          </div>

          {/* Info badges */}
          <div className="flex flex-wrap gap-2">
            <span className={`text-[11px] px-2 py-1 rounded-md font-semibold ${isCredit ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
              {isCredit ? "CREDIT" : "DEBIT"}
            </span>
            <span className="text-[11px] px-2 py-1 rounded-md bg-muted text-muted-foreground">
              {numLegs} leg{numLegs !== 1 ? "s" : ""}
            </span>
            {typeDef?.targetROI > 0 && (
              <span className="text-[11px] px-2 py-1 rounded-md bg-primary/15 text-primary">Target ROI: {typeDef.targetROI}%</span>
            )}
            {isHistorical && <span className="text-[11px] px-2 py-1 rounded-md bg-yellow-500/15 text-yellow-400">Historical Entry</span>}
          </div>

          <button type="submit" disabled={createMutation.isPending || !symbol}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
            data-testid="button-submit-trade">
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : isEdit ? <Edit2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {isEdit ? "Save Changes" : isHistorical ? "Add Historical Trade" : "Add Trade"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Close Trade Modal ────────────────────────────────────────────────────────

function CloseTradeModal({ trade, onClose, settings }: { trade: Trade; onClose: () => void; settings: AccountSettings }) {
  const [closeDate, setCloseDate] = useState(new Date().toISOString().split("T")[0]);
  const [closePrice, setClosePrice] = useState("");
  const typeDef = TRADE_TYPES[trade.tradeType as TradeTypeCode];
  const isCredit = typeDef?.isCredit ?? trade.creditDebit === "CREDIT";

  const closeMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/trades/${trade.id}/close`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/summary"] });
      onClose();
    },
  });

  const handleClose = (e: React.FormEvent) => {
    e.preventDefault();
    const rawClose = parseFloat(closePrice) || 0;
    // Closing a credit trade = paying debit (negative). Closing a debit trade = receiving credit (positive)
    const signedClose = isCredit ? -Math.abs(rawClose) : Math.abs(rawClose);
    const numLegs = typeDef?.legs || 0;
    let commOut = 0;
    if (trade.tradeCategory === "Option") {
      commOut = trade.contractsShares * numLegs * (settings.commPerOptionContract || 0.65);
    } else {
      commOut = settings.commPerSharesTrade || 0;
    }
    closeMutation.mutate({ closeDate, closePrice: signedClose, commOut });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-card-border rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-card-border">
          <h2 className="text-base font-bold text-foreground">Close: {trade.symbol} ({trade.tradeType})</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleClose} className="p-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Close Date</label>
            <DatePicker value={closeDate} onChange={setCloseDate} placeholder="Close date" required />
          </div>
          <div>
            <label className={`text-xs font-medium mb-1 block ${isCredit ? "text-red-400" : "text-green-400"}`}>
              {isCredit ? "Cost to Close (Debit)" : "Proceeds (Credit)"} <span className="text-[10px] text-muted-foreground">(enter positive)</span>
            </label>
            <input type="number" step="0.01" value={closePrice} onChange={e => setClosePrice(e.target.value)}
              placeholder={isCredit ? "0.50" : "2.00"}
              className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground" required />
            <p className="text-[10px] text-muted-foreground mt-1">{isCredit ? "Enter 0 if expired worthless (full profit)" : "Enter 0 if expired worthless (full loss)"}</p>
          </div>
          <button type="submit" disabled={closeMutation.isPending}
            className="w-full py-2.5 rounded-lg bg-yellow-600 text-white font-semibold text-sm hover:bg-yellow-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {closeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Close Trade
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

function SettingsPanel({ settings, onClose }: { settings: AccountSettings; onClose: () => void }) {
  const [vals, setVals] = useState(settings);
  const saveMutation = useMutation({
    mutationFn: async (data: any) => { const res = await apiRequest("PATCH", "/api/account/settings", data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/account/settings"] }); queryClient.invalidateQueries({ queryKey: ["/api/trades/summary"] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-card-border rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-card-border">
          <h2 className="text-base font-bold text-foreground">Account Settings</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-4 space-y-3">
          {([
            ["startingAccountValue", "Starting Account Value ($)"],
            ["commPerSharesTrade", "Commission per Stock Trade ($)"],
            ["commPerOptionContract", "Commission per Option Contract ($)"],
            ["maxAllocationPerTrade", "Max Allocation per Trade ($)"],
            ["totalAllocatedLimit", "Total Allocated Limit (decimal)"],
          ] as const).map(([key, label]) => (
            <div key={key}>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
              <input type="number" step="0.01" value={vals[key] ?? ""}
                onChange={e => setVals(v => ({ ...v, [key]: parseFloat(e.target.value) || 0 }))}
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground" />
            </div>
          ))}
          <button onClick={() => saveMutation.mutate(vals)} disabled={saveMutation.isPending}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
            {saveMutation.isPending ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TradeTracker() {
  const [showAddModal, setShowAddModal] = useState(false);

  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [closingTrade, setClosingTrade] = useState<Trade | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [sortField, setSortField] = useState<SortField>("tradeDate");
  const [sortAsc, setSortAsc] = useState(false);

  const { data: trades = [], isLoading } = useQuery<Trade[]>({
    queryKey: ["/api/trades"],
    queryFn: async () => { const r = await apiRequest("GET", "/api/trades"); return r.json(); },
  });
  const { data: summary } = useQuery<Summary>({
    queryKey: ["/api/trades/summary"],
    queryFn: async () => { const r = await apiRequest("GET", "/api/trades/summary"); return r.json(); },
  });
  const { data: settings } = useQuery<AccountSettings>({
    queryKey: ["/api/account/settings"],
    queryFn: async () => { const r = await apiRequest("GET", "/api/account/settings"); return r.json(); },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => { const r = await apiRequest("POST", "/api/trades/refresh-prices"); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/trades"] }); queryClient.invalidateQueries({ queryKey: ["/api/trades/summary"] }); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/trades/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/trades"] }); queryClient.invalidateQueries({ queryKey: ["/api/trades/summary"] }); },
    onError: (err: any) => {
      const msg = err.message || "";
      // Extract readable message from "403: {"error":"..."}"
      try { const parsed = JSON.parse(msg.replace(/^\d+:\s*/, "")); alert(parsed.error); } catch { alert(msg); }
    },
  });

  const filtered = useMemo(() => {
    let list = [...trades];
    if (filterTab === "open") list = list.filter(t => !t.closeDate);
    else if (filterTab === "closed") list = list.filter(t => !!t.closeDate);
    else if (filterTab === "stocks") list = list.filter(t => t.tradeCategory === "Stock");
    else if (filterTab === "options") list = list.filter(t => t.tradeCategory === "Option");
    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === "tradeDate") cmp = a.tradeDate.localeCompare(b.tradeDate);
      else if (sortField === "symbol") cmp = a.symbol.localeCompare(b.symbol);
      else if (sortField === "tradeType") cmp = a.tradeType.localeCompare(b.tradeType);
      else if (sortField === "openPrice") cmp = a.openPrice - b.openPrice;
      else if (sortField === "profit") cmp = computeTradeProfit(a) - computeTradeProfit(b);
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [trades, filterTab, sortField, sortAsc]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  };

  const SortBtn = ({ field, label }: { field: SortField; label: string }) => (
    <button onClick={() => handleSort(field)}
      className={`flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider hover:text-foreground ${
        sortField === field ? "text-primary" : "text-muted-foreground"
      }`}>
      {label}
      {sortField === field && (sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
    </button>
  );

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto" data-testid="trade-tracker-page">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-lg font-bold text-foreground">Trade Tracker</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}
            className="h-8 px-3 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 flex items-center gap-1.5" data-testid="button-refresh-prices">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />Refresh P/L
          </button>
          <button onClick={() => setShowSettings(true)}
            className="h-8 px-3 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 flex items-center gap-1.5">
            <Settings className="h-3.5 w-3.5" />Settings
          </button>

          <button onClick={() => setShowAddModal(true)}
            className="h-8 px-4 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5" data-testid="button-add-trade">
            <Plus className="h-3.5 w-3.5" />Add Trade
          </button>
        </div>
      </div>

      {/* FAQ / How It Works */}
      <HelpBlock title="How the Trade Tracker Works">
        <p>Track every trade from entry to exit with automatic P/L calculations, commission tracking, and behavioral analysis.</p>

        <p className="font-semibold text-foreground mt-2">Adding a Trade:</p>
        <p><strong className="text-foreground">Pilot vs. Add</strong> — <strong className="text-foreground">Pilot</strong> = initial entry into a new position. <strong className="text-foreground">Add</strong> = scaling into an existing position. This helps you track how averaging in affects your overall cost basis.</p>
        <p><strong className="text-foreground">Open Price</strong> — Enter a <span className="text-green-400 font-semibold">positive number always</span>. The app automatically determines the sign based on trade type. Credit trades (PCS, CCS, SC, SP) show green "Credit Received" label. Debit trades (CDS, PDS, C, P) show red "Debit Paid" label.</p>
        <p><strong className="text-foreground">CTV (Call/Put Vertical)</strong> — For dual-vertical entries (buying one spread, selling another), the form shows two separate leg inputs. The net credit/debit is calculated automatically.</p>

        <p className="font-semibold text-foreground mt-2">Closing a Trade:</p>
        <p>Click the checkmark icon on any open trade. Enter the close date and close price (positive number). The app calculates your net P/L including commissions in and out.</p>
        <p><strong className="text-foreground">Expired worthless?</strong> Enter close price = 0. For credit spreads expiring OTM, this means full profit. For debit spreads, full loss.</p>

        <p className="font-semibold text-foreground mt-2">Summary Cards:</p>
        <p><strong className="text-foreground">Account Value</strong> — Starting balance + all closed P/L + deposits/withdrawals. Set your starting balance in Settings.</p>
        <p><strong className="text-foreground">Total P/L</strong> — Sum of all closed trade profits and losses after commissions.</p>
        <p><strong className="text-foreground">Open P/L</strong> — Unrealized P/L on open trades based on last refreshed prices. Click "Refresh P/L" to update live.</p>
        <p><strong className="text-foreground">Win Rate</strong> — Percentage of profitable closed trades. Target: above 55%. Color coded: <span className="text-green-400">green 55%+</span>, <span className="text-yellow-400">yellow 45–54%</span>, <span className="text-red-400">red below 45%</span>.</p>
        <p><strong className="text-foreground">Allocated</strong> — What percentage of your account is at risk in open trades. Goes red when exceeding your limit (default 30%, adjustable in Settings).</p>

        <p className="font-semibold text-foreground mt-2">Behavior Tags:</p>
        <p>Track your trading psychology by tagging each closed trade:</p>
        <p><span className="text-green-400 font-semibold">All to Plan</span> — Followed your rules exactly. <span className="text-red-400 font-semibold">Fear/Panic</span> — Closed too early from fear. <span className="text-red-400 font-semibold">Greed/FOMO</span> — Chased a trade. <span className="text-yellow-400 font-semibold">Bias/Stubborn</span> — Held too long. <span className="text-yellow-400 font-semibold">Feed the Pigeons</span> — Took small gains instead of letting winners run.</p>
      </HelpBlock>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <SC label="Account Value" value={formatCurrency(summary.accountValue)} icon={<DollarSign className="h-4 w-4" />} color="text-foreground" />
          <SC label="Total P/L" value={formatCurrency(summary.totalProfit)} icon={summary.totalProfit >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />} color={summary.totalProfit >= 0 ? "text-green-400" : "text-red-400"} />
          <SC label="Open P/L" value={formatCurrency(summary.openPL)} icon={<BarChart3 className="h-4 w-4" />} color={summary.openPL >= 0 ? "text-green-400" : "text-red-400"} />
          <SC label="Win Rate" value={`${(summary.winRate * 100).toFixed(1)}%`} icon={<Target className="h-4 w-4" />} color={summary.winRate >= 0.55 ? "text-green-400" : summary.winRate >= 0.45 ? "text-yellow-400" : "text-red-400"} />
          <SC label="Open Trades" value={String(summary.openTrades)} icon={<BarChart3 className="h-4 w-4" />} color="text-primary" />
          <SC label="Allocated" value={`${(summary.allocatedPct * 100).toFixed(1)}%`} icon={<DollarSign className="h-4 w-4" />} color={summary.allocatedPct > (summary.settings?.totalAllocatedLimit || 0.3) ? "text-red-400" : "text-foreground"} />
        </div>
      )}

      {/* Performance by Type */}
      {summary && Object.keys(summary.byType).length > 0 && (
        <div className="bg-card border border-card-border rounded-lg p-4">
          <h3 className="text-sm font-bold text-foreground mb-3">Performance by Type</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground border-b border-card-border">
                <th className="text-left pb-2 pr-4">Type</th><th className="text-right pb-2 px-3">Trades</th><th className="text-right pb-2 px-3">Win %</th>
                <th className="text-right pb-2 px-3">Profit</th><th className="text-right pb-2 px-3">Loss</th><th className="text-right pb-2 px-3">Net</th><th className="text-right pb-2 px-3">ROI</th>
              </tr></thead>
              <tbody>{Object.entries(summary.byType).map(([type, d]) => {
                const net = d.profit + d.loss;
                const winPct = d.count > 0 ? (d.wins / d.count * 100) : 0;
                const roi = d.investment > 0 ? (net / d.investment * 100) : 0;
                return (
                  <tr key={type} className="border-b border-card-border/50">
                    <td className="py-1.5 pr-4 font-semibold text-foreground">{TRADE_TYPES[type as TradeTypeCode]?.label || type}</td>
                    <td className="text-right px-3 tabular-nums">{d.count}</td>
                    <td className={`text-right px-3 font-semibold tabular-nums ${winPct >= 55 ? "text-green-400" : winPct >= 45 ? "text-yellow-400" : "text-red-400"}`}>{winPct.toFixed(1)}%</td>
                    <td className="text-right px-3 text-green-400 tabular-nums">{formatCurrency(d.profit)}</td>
                    <td className="text-right px-3 text-red-400 tabular-nums">{formatCurrency(d.loss)}</td>
                    <td className={`text-right px-3 font-semibold tabular-nums ${net >= 0 ? "text-green-400" : "text-red-400"}`}>{formatCurrency(net)}</td>
                    <td className={`text-right px-3 font-semibold tabular-nums ${roi >= 0 ? "text-green-400" : "text-red-400"}`}>{roi.toFixed(1)}%</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "open", "closed", "stocks", "options"] as FilterTab[]).map(tab => (
          <button key={tab} onClick={() => setFilterTab(tab)}
            className={`h-7 px-3 text-xs font-medium rounded-md transition-colors ${
              filterTab === tab ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
            }`}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab !== "all" && ` (${
              tab === "open" ? trades.filter(t => !t.closeDate).length :
              tab === "closed" ? trades.filter(t => !!t.closeDate).length :
              tab === "stocks" ? trades.filter(t => t.tradeCategory === "Stock").length :
              trades.filter(t => t.tradeCategory === "Option").length
            })`}
          </button>
        ))}
      </div>

      {/* Trades Table */}
      <div className="bg-card border border-card-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="trades-table">
            <thead><tr className="bg-muted/30 border-b border-card-border">
              <th className="text-left py-2.5 px-3"><SortBtn field="tradeDate" label="Date" /></th>
              <th className="text-left py-2.5 px-3"><SortBtn field="symbol" label="Symbol" /></th>
              <th className="text-left py-2.5 px-3"><SortBtn field="tradeType" label="Type" /></th>
              <th className="text-left py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">P/A</th>
              <th className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">Qty</th>
              <th className="text-left py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">Strikes</th>
              <th className="text-right py-2.5 px-3"><SortBtn field="openPrice" label="Open" /></th>
              <th className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">Close</th>
              <th className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">Price</th>
              <th className="text-right py-2.5 px-3"><SortBtn field="profit" label="P/L" /></th>
              <th className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">Days</th>
              <th className="text-center py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">Status</th>
              <th className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">Actions</th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={13} className="text-center py-12 text-muted-foreground">No trades yet. Click "Add Trade" to get started.</td></tr>
              ) : filtered.map(t => {
                const profit = t.closeDate ? computeTradeProfit(t) : (t.tradeCategory === "Stock" ? computeStockPL(t) : computeOptionPL(t));
                const isOpen = !t.closeDate;
                const days = daysInTrade(t);
                const profitPct = t.allocation && t.allocation > 0 ? (profit / t.allocation * 100) : 0;
                const isWin = profit >= 0;
                const typeDef = TRADE_TYPES[t.tradeType as TradeTypeCode];

                return (
                  <tr key={t.id} className="border-b border-card-border/30 hover:bg-muted/20 transition-colors" data-testid={`trade-row-${t.id}`}>
                    <td className="py-2 px-3 text-foreground tabular-nums">{t.tradeDate}</td>
                    <td className="py-2 px-3 font-mono font-bold text-foreground">{t.symbol}</td>
                    <td className="py-2 px-3">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        t.creditDebit === "CREDIT" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
                      }`}>{t.tradeType}</span>
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">{t.pilotOrAdd === "Pilot" ? "P" : "A"}</td>
                    <td className="py-2 px-3 text-right text-foreground tabular-nums">{t.contractsShares}</td>
                    <td className="py-2 px-3 font-mono text-muted-foreground">{t.strikes || "—"}</td>
                    <td className={`py-2 px-3 text-right tabular-nums font-mono ${t.openPrice > 0 ? "text-green-400" : "text-red-400"}`}>
                      {t.openPrice > 0 ? "+" : ""}{t.openPrice.toFixed(2)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums font-mono text-foreground">
                      {t.closePrice !== null ? t.closePrice.toFixed(2) : "—"}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums font-mono text-muted-foreground">
                      {t.currentPrice ? `$${t.currentPrice.toFixed(2)}` : "—"}
                    </td>
                    <td className={`py-2 px-3 text-right font-semibold tabular-nums ${profit !== 0 ? (isWin ? "text-green-400" : "text-red-400") : "text-muted-foreground"}`}>
                      {profit !== 0 ? formatCurrency(profit) : "—"}
                      {profitPct !== 0 && <span className="text-[10px] ml-1 opacity-70">({profitPct.toFixed(0)}%)</span>}
                      {isOpen && t.tradeCategory === "Option" && profit !== 0 && <span className="text-[9px] ml-0.5 opacity-50">est</span>}
                    </td>
                    <td className="py-2 px-3 text-right text-muted-foreground tabular-nums">{days}</td>
                    <td className="py-2 px-3 text-center">
                      {isOpen ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-yellow-500/15 text-yellow-400">OPEN</span>
                      ) : (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${isWin ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                          {isWin ? "WIN" : "LOSS"}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setEditingTrade(t)} className="p-1 rounded hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors" title="Edit trade">
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        {isOpen && (
                          <button onClick={() => setClosingTrade(t)} className="p-1 rounded hover:bg-yellow-500/15 text-muted-foreground hover:text-yellow-400 transition-colors" title="Close trade">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button onClick={() => deleteMutation.mutate(t.id)} className="p-1 rounded hover:bg-red-500/15 text-muted-foreground hover:text-red-400 transition-colors" title="Delete trade">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Behavior */}
      {summary && Object.keys(summary.behaviorCounts).length > 0 && (
        <div className="bg-card border border-card-border rounded-lg p-4">
          <h3 className="text-sm font-bold text-foreground mb-3">Behavior Analysis</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary.behaviorCounts).map(([tag, count]) => (
              <span key={tag} className={`text-xs px-3 py-1.5 rounded-md font-medium ${
                tag === "All to Plan" ? "bg-green-500/15 text-green-400" :
                tag.includes("Panic") || tag.includes("FOMO") ? "bg-red-500/15 text-red-400" : "bg-yellow-500/15 text-yellow-400"
              }`}>{tag}: {count}</span>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {showAddModal && settings && <TradeForm mode="add" settings={settings} onClose={() => setShowAddModal(false)} />}

      {editingTrade && settings && <TradeForm mode="edit" initial={editingTrade} settings={settings} onClose={() => setEditingTrade(null)} />}
      {closingTrade && settings && <CloseTradeModal trade={closingTrade} onClose={() => setClosingTrade(null)} settings={settings} />}
      {showSettings && settings && <SettingsPanel settings={settings} onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function SC({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <span className={`text-base font-bold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}
