import React, { useState, useMemo, memo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { TRADE_TYPES, BEHAVIOR_TAGS, type TradeTypeCode } from "@shared/schema";
import { STRATEGY_REGISTRY, getStrategyManifest, type StrategyManifest, type StrategyTradeView, type DisplayPoint } from "@shared/strategies/registry";
import { useHtfScanner, type HtfSetupRow } from "@/compartments/htf-scanner";
import {
  Plus, Trash2, RefreshCw, X, ChevronDown, ChevronUp, Edit2,
  TrendingUp, TrendingDown, DollarSign, BarChart3, Target, Settings,
  CheckCircle2, Loader2, History, Clock, ClipboardList
} from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { HelpBlock } from "@/components/HelpBlock";
import { PageHeader } from "@/components/PageHeader";
import { useTimeframe } from "@/contexts/TimeframeContext";

// ─── Scanner Pip ──────────────────────────────────────────────────────────────
// Lightweight badge that calls /api/scanner-v2/quick/:ticker and shows
// the SAME 3-gate verdict as watchlist + trade analysis. 15min cache on server.
//
// Engine verdict language (from signal-engine.ts):
//   "GO ↑" / "GO ↓"         = 3 gates cleared (best)
//   "SET ↑" / "SET ↓"        = 2 gates cleared
//   "READY ↑" / "READY ↓"    = 1 gate cleared
//   "PULLBACK" (+ zone)      = prior setup in buyable pullback
//   "GATES CLOSED"           = conditions stale
//   "NO SETUP"               = nothing here
function classifyGateVerdict(verdict: string): { bg: string; text: string; label: string } {
  const v = verdict || "";
  if (v.startsWith("GO"))       return { bg: "bg-bull/20",  text: "text-bull-light",       label: v };
  if (v.startsWith("SET"))      return { bg: "bg-bull/10",  text: "text-bull-light",       label: v };
  if (v.startsWith("READY"))    return { bg: "bg-watch/15", text: "text-watch-light",      label: v };
  if (v.startsWith("PULLBACK")) return { bg: "bg-blue-500/15",   text: "text-blue-400",        label: v };
  if (v.startsWith("GATES"))    return { bg: "bg-muted",         text: "text-muted-foreground", label: "CLOSED" };
  return                          { bg: "bg-muted",         text: "text-muted-foreground", label: "NO SETUP" };
}

const ScannerPip = memo(function ScannerPip({ ticker }: { ticker: string }) {
  const { timeframe } = useTimeframe();
  const { data, isLoading } = useQuery<{ score: number | null; verdict: string | null }>({
    queryKey: ["/api/scanner-v2/quick", ticker, timeframe],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/scanner-v2/quick/${ticker}?timeframe=${timeframe}`);
      return res.json();
    },
    staleTime: 15 * 60 * 1000,
    retry: false,
  });
  if (isLoading) return <span className="ml-1.5 text-mini text-muted-foreground/50">…</span>;
  if (!data || data.verdict == null) return null;
  const { bg, text, label } = classifyGateVerdict(data.verdict);
  const gates = data.score ?? 0;
  return (
    <span className={`ml-1.5 text-mini font-bold px-1 py-0.5 rounded tabular-nums ${bg} ${text}`}
      title={`Scanner 2.0: ${data.verdict} (${gates}/3 gates)`}>
      {gates}·{label}
    </span>
  );
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface Trade {
  id: number; pilotOrAdd: string; tradeDate: string; expiration: string | null;
  contractsShares: number; symbol: string; currentPrice: number | null;
  target: number | null; tradeType: string; tradeCategory: string;
  strikes: string | null; openPrice: number; commIn: number | null;
  allocation: number | null; maxProfit: number | null; closeDate: string | null;
  closePrice: number | null; commOut: number | null; spreadWidth: number | null;
  creditDebit: string | null; tradePlanNotes: string | null;
  behaviorTag: string | null;
  // Which strategy opened the trade — drives Current Positions grouping +
  // strategy-specific lifecycle alerts. See shared/strategies/registry.ts.
  strategy: string;
  strategyReason: string | null;
  strategyData: Record<string, any> | null;
  createdAt: string;
}

interface Summary {
  totalTrades: number; openTrades: number; totalProfit: number;
  totalWins: number; winRate: number; openPL: number;
  cashBalance?: number; openPositionMarketValue?: number; totalPortfolioValue?: number;
  allocated: number; allocatedPct: number;
  byType: Record<string, { profit: number; loss: number; count: number; wins: number; investment: number }>;
  equityCurve: { date: string; value: number }[];
  behaviorCounts: Record<string, number>; settings: any;
}

interface AccountSettings {
  id: number; startingAccountValue: number; commPerSharesTrade: number;
  commPerOptionContract: number; maxAllocationPerTrade: number; totalAllocatedLimit: number;
  cashBalance?: number;
}

type FilterTab = "open" | "closed" | "stocks" | "options";
type SortField = "tradeDate" | "symbol" | "tradeType" | "openPrice" | "profit";

// ─── Position aggregation ─────────────────────────────────────────────────────
// An open position groups one or more "lots" (individual trade rows) that share
// the same strategy + symbol + tradeType + strikes + expiration. Strategy is
// part of the key because the same symbol opened under two strategies (e.g.
// manual then later HTF) needs to be tracked separately — each strategy has
// its own lifecycle rules and alert conditions. Closed trades are never
// grouped — they render as flat rows.
interface OpenPosition {
  kind: "group";
  key: string;
  symbol: string;
  tradeType: string;
  tradeCategory: string;
  strikes: string | null;
  expiration: string | null;
  creditDebit: string | null;
  totalQty: number;
  avgOpenPrice: number;       // weighted by qty
  totalCommIn: number;
  firstTradeDate: string;     // oldest lot
  lots: Trade[];
  totalOpenPL: number;        // sum of computeStockPL / computeOptionPL per lot
  currentPrice: number | null;
  totalAllocation: number;
  /** Strategy id of the first lot — all lots share this since strategy is in the key. */
  strategy: string;
}

/**
 * Group open trades by (strategy, symbol, tradeType, strikes, expiration).
 * Closed trades pass through as single-lot pseudo-groups so the table
 * renders uniformly.
 */
function aggregateOpenPositions(trades: Trade[]): OpenPosition[] {
  const openMap = new Map<string, Trade[]>();
  const closedRows: Trade[] = [];
  for (const t of trades) {
    if (t.closeDate) { closedRows.push(t); continue; }
    const key = [
      t.strategy || "manual",
      t.symbol.toUpperCase(),
      t.tradeType,
      (t.strikes || "").trim(),
      (t.expiration || "").trim(),
    ].join("|");
    const arr = openMap.get(key) ?? [];
    arr.push(t);
    openMap.set(key, arr);
  }
  const groups: OpenPosition[] = [];
  openMap.forEach((lots, key) => {
    lots.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
    const totalQty = lots.reduce((s, l) => s + l.contractsShares, 0);
    const weighted = lots.reduce((s, l) => s + l.openPrice * l.contractsShares, 0);
    const avgOpenPrice = totalQty > 0 ? weighted / totalQty : 0;
    const totalCommIn = lots.reduce((s, l) => s + (l.commIn || 0), 0);
    const totalAllocation = lots.reduce((s, l) => s + (l.allocation || 0), 0);
    // Use most-recent known currentPrice across lots (Refresh P/L writes it to each lot)
    const currentPrice = lots.reduce<number | null>((acc, l) => (l.currentPrice ?? acc), null);
    const totalOpenPL = lots.reduce((s, l) => s + (l.tradeCategory === "Stock" ? computeStockPL(l) : computeOptionPL(l)), 0);
    const first = lots[0];
    groups.push({
      kind: "group",
      key,
      symbol: first.symbol,
      tradeType: first.tradeType,
      tradeCategory: first.tradeCategory,
      strikes: first.strikes,
      expiration: first.expiration,
      creditDebit: first.creditDebit,
      totalQty,
      avgOpenPrice,
      totalCommIn,
      firstTradeDate: first.tradeDate,
      lots,
      totalOpenPL,
      currentPrice,
      totalAllocation,
      strategy: first.strategy || "manual",
    });
  });
  return groups;
}

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
  // Strategy is required on every new trade. Pre-existing rows default to
  // 'manual' (or whatever was saved). 'other' reveals the reason text input.
  const [strategy, setStrategy] = useState<string>(initial?.strategy || "manual");
  const [strategyReason, setStrategyReason] = useState<string>(initial?.strategyReason || "");

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
      // HTF surfaces depend on trade rows too — Portfolio counts HTF-tagged
      // open positions; the live scanner gates new entries against the same
      // portfolio. Invalidate both so saved strategyData (stop/target etc.)
      // reflects immediately on /htf without a manual refresh.
      queryClient.invalidateQueries({ queryKey: ["/api/htf/portfolio"] });
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === "string" && k.startsWith("/api/htf/setups");
        },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/htf/sizing-recommendation"] });
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
    // Target math:
    //   - Stocks: targetROI is "% gain target", so price target = entry × (1 + ROI/100).
    //     Old code computed entry × (ROI/100) = 25% OF entry, producing $0.89
    //     target on a $3.55 stock (75% drawdown). Bug.
    //   - Options: targetROI is "% of premium" target (e.g. 100% = double the
    //     premium). The legacy `rawPrice × ROI/100` works for that case because
    //     premium starts small.
    // For stocks where strategyData provides a real target (HTF auto-fill from
    // Live setup), we DON'T compute one here — initial?.strategyData wins on
    // the read side. This computation only feeds the trades.target column for
    // legacy non-strategy display.
    const target = targetROI > 0
      ? (category === "Stock" ? rawPrice * (1 + targetROI / 100) : rawPrice * (targetROI / 100))
      : null;

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
      strategy,
      strategyReason: strategy === "other" ? (strategyReason.trim() || null) : null,
      // strategyData is purely from the strategy source (e.g. /htf Live row
      // auto-fill populates pole/flag/stop/target). Manual edits don't touch
      // it here — if the user needs a stop where the strategy didn't supply
      // one, the right fix is to (a) create the trade from the strategy's
      // entry surface (/htf Live + button) which carries the full snapshot,
      // or (b) wire that strategy's entry flow if it doesn't have one yet.
      strategyData: initial?.strategyData ?? null,
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

          {/* Strategy — REQUIRED. Drives Current Positions grouping + lifecycle alerts. */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Strategy <span className="text-bear-light">*</span>
            </label>
            <select value={strategy} onChange={e => setStrategy(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground"
              data-testid="select-strategy" required>
              {Object.values(STRATEGY_REGISTRY).map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <div className="text-2xs text-muted-foreground mt-1">
              {getStrategyManifest(strategy).description}
            </div>
            {getStrategyManifest(strategy).requiresReason && (
              <input
                type="text"
                value={strategyReason}
                onChange={e => setStrategyReason(e.target.value)}
                placeholder="Why this trade? (e.g. 'Steve recommended', 'FOMO on news')"
                className="w-full h-9 px-3 mt-2 text-sm bg-background border border-card-border rounded-md text-foreground"
                data-testid="input-strategy-reason"
                required={getStrategyManifest(strategy).requiresReason}
              />
            )}
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
              <label className={`text-xs font-medium mb-1 block ${isCredit ? "text-bull-light" : "text-bear-light"}`}>
                {isCredit ? "Credit Received" : "Debit Paid"} <span className="text-micro text-muted-foreground">(enter as positive)</span>
              </label>
              <div className="relative">
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold ${isCredit ? "text-bull-light" : "text-bear-light"}`}>
                  {isCredit ? "+" : "−"}
                </span>
                <input type="number" step="0.01" value={openPrice} onChange={e => setOpenPrice(e.target.value)} placeholder="1.50"
                  className={`w-full h-9 pl-7 pr-3 text-sm bg-background border rounded-md font-mono text-foreground ${
                    isCredit ? "border-bull/30" : "border-bear/30"
                  }`} required />
              </div>
            </div>
            {category === "Option" && numLegs >= 1 && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Strike(s) <span className="text-micro">{numLegs >= 3 ? "e.g. 55/60/65" : numLegs >= 2 ? "e.g. 55/60" : "e.g. 55"}</span>
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
                  <label className="text-xs font-medium text-bear-light mb-1 block">Buy Spread (Debit Leg)</label>
                  <input type="text" value={ctvBuyStrikes} onChange={e => setCtvBuyStrikes(e.target.value)}
                    placeholder="65/70" className="w-full h-8 px-3 text-xs bg-background border border-bear/30 rounded-md font-mono text-foreground mb-1" />
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-bold text-bear-light">−$</span>
                    <input type="number" step="0.01" value={ctvBuyPrice} onChange={e => setCtvBuyPrice(e.target.value)}
                      placeholder="1.50" className="w-full h-8 pl-7 pr-3 text-xs bg-background border border-bear/30 rounded-md font-mono text-foreground" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-bull-light mb-1 block">Sell Spread (Credit Leg)</label>
                  <input type="text" value={ctvSellStrikes} onChange={e => setCtvSellStrikes(e.target.value)}
                    placeholder="70/75" className="w-full h-8 px-3 text-xs bg-background border border-bull/30 rounded-md font-mono text-foreground mb-1" />
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-bold text-bull-light">+$</span>
                    <input type="number" step="0.01" value={ctvSellPrice} onChange={e => setCtvSellPrice(e.target.value)}
                      placeholder="2.50" className="w-full h-8 pl-7 pr-3 text-xs bg-background border border-bull/30 rounded-md font-mono text-foreground" />
                  </div>
                </div>
              </div>
              {ctvBuyPrice && ctvSellPrice && (
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground">Net:</span>
                  <span className={`font-bold tabular-nums ${(parseFloat(ctvSellPrice) || 0) > (parseFloat(ctvBuyPrice) || 0) ? "text-bull-light" : "text-bear-light"}`}>
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
              <p className="text-xs font-semibold text-watch-light mb-3 flex items-center gap-1"><Clock className="h-3 w-3" />Close Information</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Close Date</label>
                  <DatePicker value={closeDate} onChange={setCloseDate} placeholder="Close date" required />
                </div>
                <div>
                  <label className={`text-xs font-medium mb-1 block ${isCredit ? "text-bear-light" : "text-bull-light"}`}>
                    {isCredit ? "Cost to Close (Debit)" : "Proceeds (Credit)"} <span className="text-micro text-muted-foreground">(positive)</span>
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
            <span className={`text-2xs px-2 py-1 rounded-md font-semibold ${isCredit ? "bg-bull/15 text-bull-light" : "bg-bear/15 text-bear-light"}`}>
              {isCredit ? "CREDIT" : "DEBIT"}
            </span>
            <span className="text-2xs px-2 py-1 rounded-md bg-muted text-muted-foreground">
              {numLegs} leg{numLegs !== 1 ? "s" : ""}
            </span>
            {typeDef?.targetROI > 0 && (
              <span className="text-2xs px-2 py-1 rounded-md bg-primary/15 text-primary">Target ROI: {typeDef.targetROI}%</span>
            )}
            {isHistorical && <span className="text-2xs px-2 py-1 rounded-md bg-watch/15 text-watch-light">Historical Entry</span>}
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

function CloseTradeModal({ trade, defaultQty, onClose, settings }: {
  trade: Trade;
  /** Pre-fill qty input. Strategy manifests pass `actionShares` so a "Sell 3 (1/3)" button opens this modal with qty=3 already typed. */
  defaultQty?: number;
  onClose: () => void;
  // Settings can be undefined if the query hasn't resolved when the button is
  // clicked. The modal MUST still open — commission falls back to the schema
  // defaults (0 for stock, $0.65 per option contract). Previously the page
  // gated the modal on `settings &&` which made the action button look broken
  // when the query was momentarily empty (e.g., right after a session refresh).
  settings?: AccountSettings;
}) {
  const [closeDate, setCloseDate] = useState(new Date().toISOString().split("T")[0]);
  const [closePrice, setClosePrice] = useState("");
  const initialQty = (() => {
    if (defaultQty != null && defaultQty > 0 && defaultQty <= trade.contractsShares) {
      return String(defaultQty);
    }
    return String(trade.contractsShares);
  })();
  const [qty, setQty] = useState(initialQty);
  const typeDef = TRADE_TYPES[trade.tradeType as TradeTypeCode];
  const isCredit = typeDef?.isCredit ?? trade.creditDebit === "CREDIT";
  const qtyNum = Math.max(1, Math.min(trade.contractsShares, parseInt(qty) || 0));
  const isPartial = qtyNum > 0 && qtyNum < trade.contractsShares;

  const closeMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/trades/${trade.id}/close`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/summary"] });
      // HTF surfaces depend on trade rows too — Portfolio counts HTF-tagged
      // open positions; the live scanner gates new entries against the same
      // portfolio. Invalidate both so saved strategyData (stop/target etc.)
      // reflects immediately on /htf without a manual refresh.
      queryClient.invalidateQueries({ queryKey: ["/api/htf/portfolio"] });
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === "string" && k.startsWith("/api/htf/setups");
        },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/htf/sizing-recommendation"] });
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
      commOut = qtyNum * numLegs * (settings?.commPerOptionContract ?? 0.65);
    } else {
      commOut = settings?.commPerSharesTrade ?? 0;
    }
    closeMutation.mutate({ closeDate, closePrice: signedClose, commOut, qty: qtyNum });
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
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Quantity to Close <span className="text-micro text-muted-foreground">(of {trade.contractsShares} {trade.tradeCategory === "Option" ? "contracts" : "shares"})</span>
            </label>
            <div className="flex items-center gap-2">
              <input type="number" min={1} max={trade.contractsShares} step={1} value={qty}
                onChange={e => setQty(e.target.value)}
                className="flex-1 h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground" required />
              <button type="button" onClick={() => setQty(String(trade.contractsShares))}
                className="h-9 px-3 text-2xs font-medium rounded-md bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80">All</button>
              <button type="button" onClick={() => setQty(String(Math.max(1, Math.floor(trade.contractsShares / 2))))}
                className="h-9 px-3 text-2xs font-medium rounded-md bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80">½</button>
            </div>
            {isPartial && (
              <p className="text-micro text-amber-400 mt-1">Partial close: {qtyNum} will close, {trade.contractsShares - qtyNum} stays open.</p>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Close Date</label>
            <DatePicker value={closeDate} onChange={setCloseDate} placeholder="Close date" required />
          </div>
          <div>
            <label className={`text-xs font-medium mb-1 block ${isCredit ? "text-bear-light" : "text-bull-light"}`}>
              {isCredit ? "Cost to Close (Debit)" : "Proceeds (Credit)"} <span className="text-micro text-muted-foreground">(enter positive)</span>
            </label>
            <input type="number" step="0.01" value={closePrice} onChange={e => setClosePrice(e.target.value)}
              placeholder={isCredit ? "0.50" : "2.00"}
              className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground" required />
            <p className="text-micro text-muted-foreground mt-1">{isCredit ? "Enter 0 if expired worthless (full profit)" : "Enter 0 if expired worthless (full loss)"}</p>
          </div>
          <button type="submit" disabled={closeMutation.isPending}
            className="w-full py-2.5 rounded-lg bg-watch text-white font-semibold text-sm hover:bg-watch disabled:opacity-50 flex items-center justify-center gap-2">
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
            ["cashBalance", "Brokerage Cash ($) — set this to whatever your broker shows right now"],
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
  const [addSeed, setAddSeed] = useState<Partial<Trade> | null>(null);

  // Cross-page handoff from /htf Live row "+" button. The setup row drops a
  // full Partial<Trade> seed into sessionStorage; we open the Add Trade modal
  // pre-filled, then clear the storage so a refresh doesn't re-open. This is
  // the foundation-first answer to "the scanner already has all this data" —
  // no manual re-entry of stop / target / pole / flag / sector.
  useEffect(() => {
    const raw = sessionStorage.getItem("htf-add-seed");
    if (!raw) return;
    try {
      const seed = JSON.parse(raw) as Partial<Trade>;
      setAddSeed(seed);
      setShowAddModal(true);
    } catch {
      // Bad JSON — silently ignore; not worth alerting the user.
    } finally {
      sessionStorage.removeItem("htf-add-seed");
    }
  }, []);

  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  // When the user clicks an action button driven by a strategy alert
  // (e.g. "Sell 3"), we want the Close Trade modal to open with qty
  // pre-filled to that action's recommended shares. closingQty carries
  // that hint until consumed.
  const [closingTrade, setClosingTrade] = useState<Trade | null>(null);
  const [closingQty, setClosingQty] = useState<number | undefined>(undefined);
  const openClose = (trade: Trade, qty?: number) => {
    setClosingTrade(trade);
    setClosingQty(qty);
  };
  const [showSettings, setShowSettings] = useState(false);
  const [filterTab, setFilterTab] = useState<FilterTab>("open");
  const [sortField, setSortField] = useState<SortField>("tradeDate");
  const [sortAsc, setSortAsc] = useState(false);
  // Expanded-state for aggregated open positions. Closed trades always render flat.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/summary"] });
      // HTF-tagged trade changes also affect portfolio cap + sizing.
      queryClient.invalidateQueries({ queryKey: ["/api/htf/portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/htf/sizing-recommendation"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/trades/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/summary"] });
      // HTF-tagged trade changes also affect portfolio cap + sizing.
      queryClient.invalidateQueries({ queryKey: ["/api/htf/portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/htf/sizing-recommendation"] });
    },
    onError: (err: any) => {
      const msg = err.message || "";
      // Extract readable message from "403: {"error":"..."}"
      try { const parsed = JSON.parse(msg.replace(/^\d+:\s*/, "")); alert(parsed.error); } catch { alert(msg); }
    },
  });

  // Live HTF scan — used to backfill empty strategyData on pre-auto-fill
  // HTF-tagged trades. Pre-2026-05-21 HTF trades (entered manually, before
  // the + button auto-fill flow) have strategy='htf' but no strategyData.
  // We pull the live scan once and look up by symbol to enrich them at
  // render time — no schema change, no persisted backfill, just derivation.
  const htfScan = useHtfScanner();
  const htfScanBySymbol = useMemo(() => {
    const map = new Map<string, HtfSetupRow>();
    for (const r of htfScan.data?.rows ?? []) map.set(r.symbol.toUpperCase(), r);
    return map;
  }, [htfScan.data]);

  // Filter first, then split open vs closed so we can aggregate open.
  const { openGroups, closedFlat } = useMemo(() => {
    let list = [...trades];
    if (filterTab === "open") list = list.filter(t => !t.closeDate);
    else if (filterTab === "closed") list = list.filter(t => !!t.closeDate);
    else if (filterTab === "stocks") list = list.filter(t => t.tradeCategory === "Stock");
    else if (filterTab === "options") list = list.filter(t => t.tradeCategory === "Option");

    const openOnly = list.filter(t => !t.closeDate);
    const closedOnly = list.filter(t => !!t.closeDate);

    const groups = aggregateOpenPositions(openOnly);
    // Sort by strategy priority FIRST so same-strategy positions render together
    // under one header, then by the user's chosen sort within each strategy.
    // Strategies the user actively trades go on top; manual/other sink to bottom.
    const strategyOrder: Record<string, number> = {
      htf: 1, "bbtc-ver": 2, amc: 3, "tft-40w": 4, "tft-60w": 5, "tft-cat": 6, manual: 7, other: 8,
    };
    groups.sort((a, b) => {
      const sa = strategyOrder[a.strategy] ?? 99;
      const sb = strategyOrder[b.strategy] ?? 99;
      if (sa !== sb) return sa - sb;
      let cmp = 0;
      if (sortField === "tradeDate") cmp = a.firstTradeDate.localeCompare(b.firstTradeDate);
      else if (sortField === "symbol") cmp = a.symbol.localeCompare(b.symbol);
      else if (sortField === "tradeType") cmp = a.tradeType.localeCompare(b.tradeType);
      else if (sortField === "openPrice") cmp = a.avgOpenPrice - b.avgOpenPrice;
      else if (sortField === "profit") cmp = a.totalOpenPL - b.totalOpenPL;
      return sortAsc ? cmp : -cmp;
    });

    closedOnly.sort((a, b) => {
      let cmp = 0;
      if (sortField === "tradeDate") cmp = a.tradeDate.localeCompare(b.tradeDate);
      else if (sortField === "symbol") cmp = a.symbol.localeCompare(b.symbol);
      else if (sortField === "tradeType") cmp = a.tradeType.localeCompare(b.tradeType);
      else if (sortField === "openPrice") cmp = a.openPrice - b.openPrice;
      else if (sortField === "profit") cmp = computeTradeProfit(a) - computeTradeProfit(b);
      return sortAsc ? cmp : -cmp;
    });

    return { openGroups: groups, closedFlat: closedOnly };
  }, [trades, filterTab, sortField, sortAsc]);

  const totalRowsInView = openGroups.length + closedFlat.length;

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  };

  const SortBtn = ({ field, label }: { field: SortField; label: string }) => (
    <button onClick={() => handleSort(field)}
      className={`flex items-center gap-1 text-2xs font-semibold uppercase tracking-wider hover:text-foreground ${
        sortField === field ? "text-primary" : "text-muted-foreground"
      }`}>
      {label}
      {sortField === field && (sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
    </button>
  );

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto" data-testid="trade-tracker-page">
      {/* Title */}
      <PageHeader
        icon={ClipboardList}
        title="Current Positions"
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}
              className="h-8 px-3 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 flex items-center gap-1.5" data-testid="button-refresh-prices">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />Refresh P/L
            </button>
            <button onClick={() => setShowSettings(true)}
              className="h-8 px-3 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 flex items-center gap-1.5">
              <Settings className="h-3.5 w-3.5" />Settings
            </button>
            <button onClick={() => { setAddSeed(null); setShowAddModal(true); }}
              className="h-8 px-4 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5" data-testid="button-add-trade">
              <Plus className="h-3.5 w-3.5" />Add Trade
            </button>
          </div>
        }
      />

      {/* How It Works */}
      <HelpBlock title="How the Trade Tracker Works">
        <p>Track every trade from entry to exit with automatic P/L calculations, commission tracking, and behavioral analysis.</p>

        <p className="font-semibold text-foreground mt-2">Adding a Trade:</p>
        <p><strong className="text-foreground">Pilot vs. Add</strong> — <strong className="text-foreground">Pilot</strong> = initial entry into a new position. <strong className="text-foreground">Add</strong> = scaling into an existing position. This helps you track how averaging in affects your overall cost basis.</p>
        <p><strong className="text-foreground">Open Price</strong> — Enter a <span className="text-bull-light font-semibold">positive number always</span>. The app automatically determines the sign based on trade type. Credit trades (PCS, CCS, SC, SP) show green "Credit Received" label. Debit trades (CDS, PDS, C, P) show red "Debit Paid" label.</p>
        <p><strong className="text-foreground">CTV (Call/Put Vertical)</strong> — For dual-vertical entries (buying one spread, selling another), the form shows two separate leg inputs. The net credit/debit is calculated automatically.</p>

        <p className="font-semibold text-foreground mt-2">Closing a Trade:</p>
        <p>Click the checkmark icon on any open trade. Enter the close date and close price (positive number). The app calculates your net P/L including commissions in and out.</p>
        <p><strong className="text-foreground">Partial closes</strong> — the close modal has a <strong className="text-foreground">Qty</strong> field with All/½ helpers. Close part of a position and the tracker creates a closed child row with prorated commissions, allocation, and max profit while keeping the rest open at the original cost basis.</p>
        <p><strong className="text-foreground">Expired worthless?</strong> Enter close price = 0. For credit spreads expiring OTM, this means full profit. For debit spreads, full loss.</p>

        <p className="font-semibold text-foreground mt-2">Scanner Pip:</p>
        <p>Each ticker row shows a <strong className="text-foreground">colored pip</strong> next to the symbol with the live Scanner 2.0 verdict (<span className="text-bull-light">GO ↑</span>, <span className="text-bear-light">GO ↓</span>, <span className="text-bull-light">SET ↑</span>, <span className="text-bear-light">SET ↓</span>, <span className="text-bull-light">READY ↑</span>, <span className="text-bear-light">READY ↓</span>, <span className="text-amber-400">PULLBACK</span>, GATES CLOSED, NO SETUP). These match the Scanner, Trade Analysis, and Watchlist exactly — one signal engine, one answer everywhere.</p>

        <p className="font-semibold text-foreground mt-2">Summary Cards:</p>
        <p><strong className="text-foreground">Total Portfolio</strong> — Brokerage Cash + Open Positions. Always live, always = cash + positions.</p>
        <p><strong className="text-foreground">Brokerage Cash</strong> — Auto-tracks every trade's open/close cash flow. Doesn't match your broker? Open Settings and type in the current cash value — the system re-anchors and stays in sync from there.</p>
        <p><strong className="text-foreground">Open Positions</strong> — Market value of everything currently open (stocks at live price, options at allocation).</p>
        <p><strong className="text-foreground">Total P/L</strong> — Sum of all closed trade profits and losses after commissions.</p>
        <p><strong className="text-foreground">Open P/L</strong> — Unrealized P/L on open trades based on last refreshed prices. Click "Refresh P/L" to update live.</p>
        <p><strong className="text-foreground">Win Rate</strong> — Percentage of profitable closed trades. Target: above 55%. Color coded: <span className="text-bull-light">green 55%+</span>, <span className="text-watch-light">yellow 45–54%</span>, <span className="text-bear-light">red below 45%</span>.</p>
        <p><strong className="text-foreground">Allocated</strong> — What percentage of your portfolio is at risk in open trades. Goes red when exceeding your limit (default 30%, adjustable in Settings).</p>

        <p className="font-semibold text-foreground mt-2">Behavior Tags:</p>
        <p>Track your trading psychology by tagging each closed trade:</p>
        <p><span className="text-bull-light font-semibold">All to Plan</span> — Followed your rules exactly. <span className="text-bear-light font-semibold">Fear/Panic</span> — Closed too early from fear. <span className="text-bear-light font-semibold">Greed/FOMO</span> — Chased a trade. <span className="text-watch-light font-semibold">Bias/Stubborn</span> — Held too long. <span className="text-watch-light font-semibold">Feed the Pigeons</span> — Took small gains instead of letting winners run.</p>
      </HelpBlock>

      {/* Summary Cards */}
      {summary && (
        <>
          {/* Top row — broker-matching figures (cash + open positions = total) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <SC label="Total Portfolio" value={formatCurrency(summary.totalPortfolioValue ?? 0)} icon={<DollarSign className="h-4 w-4" />} color="text-primary" />
            <SC label="Brokerage Cash" value={formatCurrency(summary.cashBalance ?? 0)} icon={<DollarSign className="h-4 w-4" />} color="text-foreground" />
            <SC label="Open Positions" value={formatCurrency(summary.openPositionMarketValue ?? 0)} icon={<BarChart3 className="h-4 w-4" />} color="text-foreground" />
          </div>
          {/* Bottom row — performance + activity */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <SC label="Total P/L" value={formatCurrency(summary.totalProfit)} icon={summary.totalProfit >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />} color={summary.totalProfit >= 0 ? "text-bull-light" : "text-bear-light"} />
            <SC label="Open P/L" value={formatCurrency(summary.openPL)} icon={<BarChart3 className="h-4 w-4" />} color={summary.openPL >= 0 ? "text-bull-light" : "text-bear-light"} />
            <SC label="Win Rate" value={`${(summary.winRate * 100).toFixed(1)}%`} icon={<Target className="h-4 w-4" />} color={summary.winRate >= 0.55 ? "text-bull-light" : summary.winRate >= 0.45 ? "text-watch-light" : "text-bear-light"} />
            <SC label="Open Trades" value={String(summary.openTrades)} icon={<BarChart3 className="h-4 w-4" />} color="text-primary" />
            <SC label="Allocated" value={`${(summary.allocatedPct * 100).toFixed(1)}%`} icon={<DollarSign className="h-4 w-4" />} color={summary.allocatedPct > (summary.settings?.totalAllocatedLimit || 0.3) ? "text-bear-light" : "text-foreground"} />
          </div>
        </>
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
                    <td className={`text-right px-3 font-semibold tabular-nums ${winPct >= 55 ? "text-bull-light" : winPct >= 45 ? "text-watch-light" : "text-bear-light"}`}>{winPct.toFixed(1)}%</td>
                    <td className="text-right px-3 text-bull-light tabular-nums">{formatCurrency(d.profit)}</td>
                    <td className="text-right px-3 text-bear-light tabular-nums">{formatCurrency(d.loss)}</td>
                    <td className={`text-right px-3 font-semibold tabular-nums ${net >= 0 ? "text-bull-light" : "text-bear-light"}`}>{formatCurrency(net)}</td>
                    <td className={`text-right px-3 font-semibold tabular-nums ${roi >= 0 ? "text-bull-light" : "text-bear-light"}`}>{roi.toFixed(1)}%</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["open", "stocks", "options", "closed"] as FilterTab[]).map(tab => (
          <button key={tab} onClick={() => setFilterTab(tab)}
            className={`h-7 px-3 text-xs font-medium rounded-md transition-colors ${
              filterTab === tab ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
            }`}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {` (${
              tab === "open" ? trades.filter(t => !t.closeDate).length :
              tab === "closed" ? trades.filter(t => !!t.closeDate).length :
              tab === "stocks" ? trades.filter(t => t.tradeCategory === "Stock").length :
              trades.filter(t => t.tradeCategory === "Option").length
            })`}
          </button>
        ))}
      </div>

      {/* Open positions — one table PER STRATEGY. Each strategy's manifest
          owns its column set (manifest.columnOrder) so HTF surfaces Stop /
          Take 1/3 / Trail 20-MA / Target as REAL columns; BBTC surfaces
          Stop (EXIT) / Exit Trigger / Target; etc. No more one-size-fits-all
          table. The Total column is gone — running cumulative P&L on a
          per-row basis was confusing and doesn't recompute. */}
      {(() => {
        // Tailwind class set per manifest color (visual stripe + header tint).
        const strategyHeaderClass = (color: StrategyManifest["color"]): string => {
          switch (color) {
            case "bull":    return "bg-bull/10 border-bull text-bull-light";
            case "watch":   return "bg-watch/10 border-watch text-watch-light";
            case "bear":    return "bg-bear/10 border-bear text-bear-light";
            case "info":    return "bg-primary/10 border-primary text-primary";
            case "neutral": return "bg-muted/30 border-muted-foreground/40 text-muted-foreground";
            default:        return "bg-muted/30 border-muted-foreground/40 text-muted-foreground";
          }
        };
        // Color the strategy-specific cell value based on the manifest's
        // assessment of that lifecycle point's state.
        const pointStateClass = (state: DisplayPoint["state"]): string => {
          switch (state) {
            case "triggered": return "text-bear-light font-bold";
            case "armed":     return "text-watch-light font-semibold";
            case "past":      return "text-muted-foreground";
            case "pending":   return "text-foreground";
            default:          return "text-foreground";
          }
        };

        const sevOrder = { critical: 4, warn: 3, watch: 2, info: 1 } as const;

        // Bucket open groups by strategy in the same order they were sorted.
        const groupsByStrategy = new Map<string, OpenPosition[]>();
        for (const g of openGroups) {
          const arr = groupsByStrategy.get(g.strategy) ?? [];
          arr.push(g);
          groupsByStrategy.set(g.strategy, arr);
        }

        if (openGroups.length === 0 && closedFlat.length === 0) {
          return (
            <div className="bg-card border border-card-border rounded-lg overflow-hidden">
              <div className="text-center py-12 text-muted-foreground text-sm">
                No trades yet. Click "Add Trade" or pull a setup from /htf to get started.
              </div>
            </div>
          );
        }

        const sections: React.ReactNode[] = [];

        // ─── One table per strategy ──────────────────────────────────────
        // `Array.from(...)` avoids the downlevel-iteration TS gripe; we want
        // the same insertion-ordered list of [stratId, groups] either way.
        for (const [stratId, groups] of Array.from(groupsByStrategy.entries())) {
          const manifest = getStrategyManifest(stratId);
          const columnLabels = manifest.columnOrder;

          sections.push(
            <div
              key={`section-${stratId}`}
              className={`rounded-lg border-l-4 ${strategyHeaderClass(manifest.color)} bg-card border-y border-r border-card-border overflow-hidden`}
            >
              {/* Strategy header bar */}
              <div className="px-3 py-2 flex items-center justify-between gap-3 flex-wrap border-b border-card-border/40">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold tracking-tight">{manifest.name}</span>
                  <span className="text-2xs opacity-70">· {groups.length} position{groups.length !== 1 ? "s" : ""}</span>
                </div>
                <span className="text-2xs opacity-70 italic">{manifest.description}</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs" data-testid={`trades-table-${stratId}`}>
                  <thead>
                    <tr className="bg-muted/30 border-b border-card-border">
                      <th className="text-left py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-2xs">Date</th>
                      <th className="text-left py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-2xs">Symbol</th>
                      <th className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-2xs">Pos</th>
                      <th className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-2xs">Current</th>
                      {columnLabels.map(label => (
                        <th key={label} className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-2xs">{label}</th>
                      ))}
                      <th className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-2xs">P/L</th>
                      <th className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-2xs">Days</th>
                      <th className="text-center py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-2xs">Action</th>
                      <th className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-2xs">Edit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g: OpenPosition) => {
                      const isSingleLot = g.lots.length === 1;
                      const isExpanded = expandedGroups.has(g.key) || isSingleLot;
                      const days = Math.max(0, Math.ceil((Date.now() - new Date(g.firstTradeDate).getTime()) / 86400000));
                      const isWin = g.totalOpenPL >= 0;
                      const profitPct = g.totalAllocation > 0 ? (g.totalOpenPL / g.totalAllocation * 100) : 0;

                      // Backfill empty strategyData from the live HTF scan
                      // for HTF-tagged trades. Pre-auto-fill trades have
                      // strategy='htf' but no snapshot — if the scanner
                      // currently sees the symbol, use its data so the
                      // manifest can fill in Stop/Target/Pole/Flag columns
                      // instead of showing "—" everywhere.
                      let effectiveStrategyData = g.lots[0].strategyData;
                      const hasRealStrategyData =
                        effectiveStrategyData && Object.keys(effectiveStrategyData).length > 0;
                      if (!hasRealStrategyData && g.strategy === "htf") {
                        const scanRow = htfScanBySymbol.get(g.symbol.toUpperCase());
                        if (scanRow) {
                          effectiveStrategyData = {
                            stopPrice: scanRow.stopPrice,
                            targetPrice: scanRow.targetPrice,
                            poleGainPct: scanRow.poleGainPct,
                            poleDays: scanRow.poleDays,
                            flagDays: scanRow.flagDays,
                            flagPullbackPct: scanRow.flagPullbackPct,
                            breakoutVolRatio: scanRow.breakoutVolRatio,
                            qualityScore: scanRow.qualityScore,
                            sector: scanRow.sector ?? "Unknown",
                          };
                        }
                      }

                      const evalLot: StrategyTradeView = {
                        symbol: g.symbol,
                        openPrice: g.avgOpenPrice,
                        currentPrice: g.currentPrice,
                        target: g.lots[0].target,
                        closeDate: null,
                        tradeDate: g.firstTradeDate,
                        strategy: g.strategy,
                        strategyReason: g.lots[0].strategyReason,
                        strategyData: effectiveStrategyData,
                        contractsShares: g.totalQty,
                      };
                      const evalResult = manifest.evaluate(evalLot);
                      const pointByLabel = new Map(evalResult.displayPoints.map(p => [p.label, p]));
                      const topAlert = evalResult.alerts.slice().sort((a, b) => sevOrder[b.severity] - sevOrder[a.severity])[0];

                      const statusBadge = (
                        <span className={`text-micro font-semibold px-2 py-0.5 rounded ${
                          topAlert
                            ? topAlert.severity === "critical" ? "bg-bear text-bear-foreground"
                            : topAlert.severity === "warn"     ? "bg-bear/40 text-bear-light"
                            : topAlert.severity === "watch"    ? "bg-watch/30 text-watch-light"
                            :                                    "bg-primary/20 text-primary"
                            : "bg-bull/15 text-bull-light"
                        }`}>
                          {topAlert ? (
                            topAlert.action === "dump"          ? "DUMP NOW"
                            : topAlert.action === "exit"        ? "EXIT"
                            : topAlert.action === "take-partial" ? "TAKE PARTIAL"
                            :                                     "WATCH"
                          ) : "HOLD"}
                        </span>
                      );

                      const mainRow = (
                        <tr
                          key={`grp-${g.key}`}
                          className={`border-b border-card-border/30 transition-colors ${isSingleLot ? "hover:bg-muted/20" : "bg-muted/10 hover:bg-muted/25 cursor-pointer"}`}
                          onClick={isSingleLot ? undefined : () => toggleGroup(g.key)}
                          data-testid={`position-row-${g.key}`}
                        >
                          <td className="py-2 px-3 text-foreground tabular-nums">
                            <div className="flex items-center gap-1.5">
                              {!isSingleLot && (isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronUp className="h-3 w-3 text-muted-foreground rotate-180" />)}
                              <span>{g.firstTradeDate}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3 font-mono font-bold text-foreground">
                            {g.symbol}
                            <ScannerPip ticker={g.symbol} />
                            {!isSingleLot && <span className="ml-1.5 text-mini font-semibold px-1 py-0.5 rounded bg-primary/15 text-primary">{g.lots.length} lots</span>}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums font-mono text-foreground">
                            <span className="font-semibold">{g.totalQty}</span>
                            <span className="text-muted-foreground"> @ ${Math.abs(g.avgOpenPrice).toFixed(2)}</span>
                            {!isSingleLot && <span className="block text-mini opacity-60">avg</span>}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums font-mono text-foreground">
                            {g.currentPrice != null ? `$${g.currentPrice.toFixed(2)}` : "—"}
                          </td>
                          {columnLabels.map(label => {
                            const p = pointByLabel.get(label);
                            return (
                              <td key={label} className={`py-2 px-3 text-right tabular-nums font-mono ${p ? pointStateClass(p.state) : "text-muted-foreground"}`}>
                                {p?.value ?? "—"}
                              </td>
                            );
                          })}
                          <td className={`py-2 px-3 text-right font-semibold tabular-nums ${g.totalOpenPL !== 0 ? (isWin ? "text-bull-light" : "text-bear-light") : "text-muted-foreground"}`}>
                            {g.totalOpenPL !== 0 ? formatCurrency(g.totalOpenPL) : "—"}
                            {profitPct !== 0 && <span className="text-micro ml-1 opacity-70">({profitPct.toFixed(0)}%)</span>}
                          </td>
                          <td className="py-2 px-3 text-right text-muted-foreground tabular-nums">{days}d</td>
                          <td className="py-2 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <div className="flex flex-col items-center gap-1 min-w-[140px]">
                              {topAlert && topAlert.actionShares != null && topAlert.actionShares > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    // Always actionable now. Multi-lot groups
                                    // close from the oldest lot first; the
                                    // modal caps qty at that lot's shares.
                                    // If the manifest's actionShares exceeds
                                    // the oldest lot, the user closes more
                                    // from subsequent lots after this trade.
                                    const lot = g.lots[0];
                                    const qty = Math.min(topAlert.actionShares!, lot.contractsShares);
                                    openClose(lot, qty);
                                  }}
                                  title={topAlert.message}
                                  data-testid={`act-${topAlert.action}-${g.symbol}`}
                                  className={`w-full px-3 py-1.5 rounded text-xs font-bold transition-colors ${
                                    topAlert.action === "dump"          ? "bg-bear text-bear-foreground hover:brightness-110 animate-pulse"
                                    : topAlert.action === "exit"        ? "bg-bear/80 text-bear-foreground hover:bg-bear"
                                    : topAlert.action === "take-partial" ? "bg-watch text-background hover:brightness-110"
                                    :                                     "bg-primary text-primary-foreground hover:brightness-110"
                                  }`}
                                >
                                  {topAlert.actionLabel}
                                  {!isSingleLot && g.lots[0].contractsShares < topAlert.actionShares! && (
                                    <span className="block text-2xs opacity-80 font-normal">
                                      (from oldest lot — close more after)
                                    </span>
                                  )}
                                </button>
                              ) : (
                                statusBadge
                              )}
                              {topAlert && (
                                <span
                                  className={`text-2xs leading-tight max-w-[200px] ${
                                    topAlert.severity === "critical" ? "text-bear-light font-semibold"
                                    : topAlert.severity === "warn"   ? "text-bear-light"
                                    : topAlert.severity === "watch"  ? "text-watch-light"
                                    :                                  "text-muted-foreground"
                                  }`}
                                >
                                  {topAlert.message}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => {
                                  setAddSeed({ symbol: g.symbol, tradeType: g.tradeType, tradeCategory: g.tradeCategory, strikes: g.strikes, expiration: g.expiration, creditDebit: g.creditDebit, pilotOrAdd: "Add" });
                                  setShowAddModal(true);
                                }}
                                className="p-1 rounded hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors"
                                title="Add to this position"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                              {isSingleLot && (
                                <>
                                  <button onClick={() => setEditingTrade(g.lots[0])} className="p-1 rounded hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors" title="Edit trade"><Edit2 className="h-3.5 w-3.5" /></button>
                                  <button onClick={() => openClose(g.lots[0])} className="p-1 rounded hover:bg-watch/15 text-muted-foreground hover:text-watch-light transition-colors" title="Close full position"><CheckCircle2 className="h-3.5 w-3.5" /></button>
                                  <button onClick={() => deleteMutation.mutate(g.lots[0].id)} className="p-1 rounded hover:bg-bear/15 text-muted-foreground hover:text-bear-light transition-colors" title="Delete trade"><Trash2 className="h-3.5 w-3.5" /></button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );

                      const lotRows = !isSingleLot && isExpanded
                        ? g.lots.map(t => {
                            const profit = t.tradeCategory === "Stock" ? computeStockPL(t) : computeOptionPL(t);
                            const lotDays = daysInTrade(t);
                            const lotPct = t.allocation && t.allocation > 0 ? (profit / t.allocation * 100) : 0;
                            return (
                              <tr key={`lot-${t.id}`} className="border-b border-card-border/20 bg-background/40 text-muted-foreground" data-testid={`lot-row-${t.id}`}>
                                <td className="py-1.5 px-3 pl-10 tabular-nums text-2xs">└ {t.tradeDate}</td>
                                <td className="py-1.5 px-3 text-2xs opacity-60">—</td>
                                <td className="py-1.5 px-3 text-right tabular-nums">{t.contractsShares} @ ${Math.abs(t.openPrice).toFixed(2)}</td>
                                <td className="py-1.5 px-3 text-right tabular-nums">{t.currentPrice != null ? `$${t.currentPrice.toFixed(2)}` : "—"}</td>
                                {columnLabels.map(label => <td key={label} className="py-1.5 px-3"></td>)}
                                <td className={`py-1.5 px-3 text-right tabular-nums text-2xs ${profit >= 0 ? "text-bull-light/80" : "text-bear-light/80"}`}>
                                  {profit !== 0 ? formatCurrency(profit) : "—"}
                                  {lotPct !== 0 && <span className="text-mini ml-1 opacity-70">({lotPct.toFixed(0)}%)</span>}
                                </td>
                                <td className="py-1.5 px-3 text-right tabular-nums text-2xs">{lotDays}d</td>
                                <td className="py-1.5 px-3"></td>
                                <td className="py-1.5 px-3 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <button onClick={() => setEditingTrade(t)} className="p-1 rounded hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors" title="Edit lot"><Edit2 className="h-3 w-3" /></button>
                                    <button onClick={() => openClose(t)} className="p-1 rounded hover:bg-watch/15 text-muted-foreground hover:text-watch-light transition-colors" title="Close lot"><CheckCircle2 className="h-3 w-3" /></button>
                                    <button onClick={() => deleteMutation.mutate(t.id)} className="p-1 rounded hover:bg-bear/15 text-muted-foreground hover:text-bear-light transition-colors" title="Delete lot"><Trash2 className="h-3 w-3" /></button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        : [];

                      return (
                        <React.Fragment key={`row-frag-${g.key}`}>
                          {mainRow}
                          {lotRows}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }

        // ─── Closed trades — separate flat table at the bottom ──────────
        if (closedFlat.length > 0) {
          sections.push(
            <div key="closed-section" className="bg-card border border-card-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-card-border/40 flex items-center justify-between">
                <span className="text-sm font-bold text-muted-foreground tracking-tight">Closed Trades</span>
                <span className="text-2xs opacity-60 italic">{closedFlat.length} closed · realized P/L visible per row</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" data-testid="trades-table-closed">
                  <thead>
                    <tr className="bg-muted/30 border-b border-card-border">
                      <th className="text-left py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-2xs">Date</th>
                      <th className="text-left py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-2xs">Symbol</th>
                      <th className="text-left py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-2xs">Strategy</th>
                      <th className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-2xs">Qty @ Open</th>
                      <th className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-2xs">Close</th>
                      <th className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-2xs">P/L</th>
                      <th className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-2xs">Days</th>
                      <th className="text-center py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-2xs">Status</th>
                      <th className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-2xs">Edit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedFlat.map((t: Trade) => {
                      const profit = computeTradeProfit(t);
                      const days = daysInTrade(t);
                      const profitPct = t.allocation && t.allocation > 0 ? (profit / t.allocation * 100) : 0;
                      const isWin = profit >= 0;
                      const manifest = getStrategyManifest(t.strategy);
                      return (
                        <tr key={`closed-${t.id}`} className="border-b border-card-border/30 hover:bg-muted/20" data-testid={`closed-row-${t.id}`}>
                          <td className="py-2 px-3 text-foreground tabular-nums">{t.tradeDate}</td>
                          <td className="py-2 px-3 font-mono font-bold text-foreground">{t.symbol}</td>
                          <td className="py-2 px-3 text-2xs text-muted-foreground">{manifest.shortName}</td>
                          <td className="py-2 px-3 text-right tabular-nums font-mono text-foreground">
                            {t.contractsShares} @ ${Math.abs(t.openPrice).toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums font-mono text-foreground">
                            {t.closePrice != null ? `$${Math.abs(t.closePrice).toFixed(2)}` : "—"}
                            <span className="block text-mini opacity-60">{t.closeDate}</span>
                          </td>
                          <td className={`py-2 px-3 text-right font-semibold tabular-nums ${profit !== 0 ? (isWin ? "text-bull-light" : "text-bear-light") : "text-muted-foreground"}`}>
                            {profit !== 0 ? formatCurrency(profit) : "—"}
                            {profitPct !== 0 && <span className="text-micro ml-1 opacity-70">({profitPct.toFixed(0)}%)</span>}
                          </td>
                          <td className="py-2 px-3 text-right text-muted-foreground tabular-nums">{days}d</td>
                          <td className="py-2 px-3 text-center">
                            <span className={`text-micro font-semibold px-2 py-0.5 rounded ${isWin ? "bg-bull/15 text-bull-light" : "bg-bear/15 text-bear-light"}`}>
                              {isWin ? "WIN" : "LOSS"}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => setEditingTrade(t)} className="p-1 rounded hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors" title="Edit trade">
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => deleteMutation.mutate(t.id)} className="p-1 rounded hover:bg-bear/15 text-muted-foreground hover:text-bear-light transition-colors" title="Delete trade">
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
          );
        }

        return <div className="space-y-4">{sections}</div>;
      })()}

      {/* Behavior */}
      {summary && Object.keys(summary.behaviorCounts).length > 0 && (
        <div className="bg-card border border-card-border rounded-lg p-4">
          <h3 className="text-sm font-bold text-foreground mb-3">Behavior Analysis</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary.behaviorCounts).map(([tag, count]) => (
              <span key={tag} className={`text-xs px-3 py-1.5 rounded-md font-medium ${
                tag === "All to Plan" ? "bg-bull/15 text-bull-light" :
                tag.includes("Panic") || tag.includes("FOMO") ? "bg-bear/15 text-bear-light" : "bg-watch/15 text-watch-light"
              }`}>{tag}: {count}</span>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {showAddModal && settings && <TradeForm mode="add" initial={addSeed as any} settings={settings} onClose={() => { setShowAddModal(false); setAddSeed(null); }} />}

      {editingTrade && settings && <TradeForm mode="edit" initial={editingTrade} settings={settings} onClose={() => setEditingTrade(null)} />}
      {closingTrade && (
        <CloseTradeModal
          trade={closingTrade}
          defaultQty={closingQty}
          onClose={() => { setClosingTrade(null); setClosingQty(undefined); }}
          settings={settings ?? undefined}
        />
      )}
      {showSettings && settings && <SettingsPanel settings={settings} onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function SC({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <span className={`text-base font-bold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}
