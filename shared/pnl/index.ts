/**
 * Shared P/L pure functions — single source of truth for trade math.
 *
 * Imported by both server endpoints (`server/routes.ts` `/api/trades/summary`)
 * and client widgets (`client/src/compartments/trades/*`). Per Q-C3 lock
 * (`docs/DASHBOARD_PLAN.md`): one canonical implementation, not duplicated.
 *
 * Pure functions only — no fetches, no side effects, no React, no Express.
 * Add new P/L primitives here and call from anywhere.
 *
 * History: ported verbatim from
 *   - `server/routes.ts:5874-5934` (closed-trade profit + open stock P/L)
 *   - `client/src/pages/trade-tracker.tsx:171-297` (option P/L + position aggregation)
 * Existing `trade-tracker.tsx` page keeps its own copy during strangler
 * migration (Round 6 ships the shared module; page migrates in a later round).
 */
import type { Trade } from "../schema";

// ─── Closed-trade realized profit ────────────────────────────────────────────

/**
 * Realized P/L for a closed trade. Returns 0 if the trade is still open.
 *
 * The "open + close" formula relies on `openPrice` and `closePrice` being
 * stored signed by cash-flow direction (debit/buy = negative, credit/sell =
 * positive), so the same formula works for longs, shorts, debits, and credits.
 */
export function computeClosedTradeProfit(t: Trade): number {
  if (!t.closeDate) return 0;
  const mult = t.tradeCategory === "Option" ? 100 : 1;
  const open = t.openPrice * t.contractsShares * mult;
  const close = (t.closePrice ?? 0) * t.contractsShares * mult;
  return open + close - (t.commIn ?? 0) - (t.commOut ?? 0);
}

// ─── Open-position unrealized P/L ────────────────────────────────────────────

/**
 * Unrealized P/L for an open stock position (long or short). Returns 0 if
 * the trade is closed, an option, or has no current price. Subtracts the
 * open commission (`commIn`) — matches the server's `/api/trades/summary`
 * behavior used in the canonical summary numbers.
 */
export function computeOpenStockPL(t: Trade): number {
  if (!t.currentPrice || t.closeDate) return 0;
  if (t.tradeCategory !== "Stock") return 0;
  const isShort = t.creditDebit === "CREDIT" || t.tradeType === "SHORT";
  const pl = isShort
    ? (Math.abs(t.openPrice) - t.currentPrice) * t.contractsShares
    : (t.currentPrice - Math.abs(t.openPrice)) * t.contractsShares;
  return pl - (t.commIn ?? 0);
}

/**
 * Estimated unrealized P/L for an open options position using current
 * underlying stock price. Strike-based estimation — best-effort because
 * we don't have live option premium quotes.
 *
 * Covers: credit spreads (PCS/CCS/SP/SC), debit spreads (CDS/PDS),
 * naked calls/puts (C/DTC/P/DTP), and butterflies/CTVs (rough estimate).
 * Other types fall through to 0.
 */
export function computeOpenOptionPL(t: Trade): number {
  if (!t.currentPrice || t.closeDate) return 0;
  if (t.tradeCategory !== "Option") return 0;

  const stock = t.currentPrice;
  const contracts = t.contractsShares;
  const premium = Math.abs(t.openPrice);
  const isCredit = t.creditDebit === "CREDIT";
  const sw = t.spreadWidth ?? 0;

  const strikeParts = (t.strikes ?? "")
    .replace(/\|/g, "/")
    .split("/")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => !isNaN(n));
  if (strikeParts.length === 0) return 0;

  const shortStrike = strikeParts[0];
  const type = t.tradeType;
  const commIn = t.commIn ?? 0;

  // Credit spreads
  if (type === "PCS" || type === "SP") {
    if (stock >= shortStrike) {
      return premium * contracts * 100 * 0.8 - commIn;
    }
    const itm = shortStrike - stock;
    const loss = Math.min(itm, sw || itm) * contracts * 100;
    return premium * contracts * 100 - loss - commIn;
  }
  if (type === "CCS" || type === "SC") {
    if (stock <= shortStrike) {
      return premium * contracts * 100 * 0.8 - commIn;
    }
    const itm = stock - shortStrike;
    const loss = Math.min(itm, sw || itm) * contracts * 100;
    return premium * contracts * 100 - loss - commIn;
  }

  // Debit spreads
  if (type === "CDS") {
    const longStrike = shortStrike;
    if (stock > longStrike) {
      const intrinsic = Math.min(stock - longStrike, sw || (stock - longStrike));
      return (intrinsic - premium) * contracts * 100 - commIn;
    }
    return -premium * contracts * 100 * 0.8 - commIn;
  }
  if (type === "PDS") {
    const longStrike = shortStrike;
    if (stock < longStrike) {
      const intrinsic = Math.min(longStrike - stock, sw || (longStrike - stock));
      return (intrinsic - premium) * contracts * 100 - commIn;
    }
    return -premium * contracts * 100 * 0.8 - commIn;
  }

  // Naked calls
  if (type === "C" || type === "DTC") {
    if (stock > shortStrike) {
      const intrinsic = stock - shortStrike;
      return (intrinsic - premium) * contracts * 100 - commIn;
    }
    return -premium * contracts * 100 * 0.5 - commIn;
  }
  // Naked puts
  if (type === "P" || type === "DTP") {
    if (stock < shortStrike) {
      const intrinsic = shortStrike - stock;
      return (intrinsic - premium) * contracts * 100 - commIn;
    }
    return -premium * contracts * 100 * 0.5 - commIn;
  }

  // Butterflies / CTVs — rough proximity-to-center estimate
  if (type.includes("BFLY") || type.includes("CTV")) {
    if (strikeParts.length >= 2) {
      const center = (strikeParts[0] + strikeParts[strikeParts.length - 1]) / 2;
      const dist = Math.abs(stock - center);
      const halfWidth = sw ? sw / 2 : Math.abs(strikeParts[strikeParts.length - 1] - strikeParts[0]) / 2;
      if (dist < halfWidth) {
        const pctToCenter = 1 - dist / halfWidth;
        return (isCredit ? premium : sw - premium) * pctToCenter * contracts * 100 * 0.5 - commIn;
      }
      return isCredit
        ? premium * contracts * 100 * 0.3 - commIn
        : -premium * contracts * 100 * 0.7 - commIn;
    }
  }

  return 0;
}

/**
 * Unrealized P/L for any open trade (dispatches by `tradeCategory`).
 */
export function computeOpenPL(t: Trade): number {
  if (t.tradeCategory === "Stock") return computeOpenStockPL(t);
  if (t.tradeCategory === "Option") return computeOpenOptionPL(t);
  return 0;
}

// ─── Position aggregation ────────────────────────────────────────────────────

export interface OpenPosition {
  key: string;
  symbol: string;
  tradeType: string;
  tradeCategory: string;
  strikes: string | null;
  expiration: string | null;
  creditDebit: string | null;
  /** Total contracts/shares across all lots. */
  totalQty: number;
  /** Quantity-weighted average open price across lots. */
  avgOpenPrice: number;
  totalCommIn: number;
  /** Oldest lot's tradeDate. */
  firstTradeDate: string;
  lots: Trade[];
  /** Sum of `computeOpenPL` across lots. */
  totalOpenPL: number;
  /** Most-recent known currentPrice across lots. */
  currentPrice: number | null;
  totalAllocation: number;
}

/**
 * Group open trades by `(symbol, tradeType, strikes, expiration)`. Closed
 * trades are ignored — caller handles them separately.
 */
export function aggregateOpenPositions(trades: Trade[]): OpenPosition[] {
  const openMap = new Map<string, Trade[]>();
  for (const t of trades) {
    if (t.closeDate) continue;
    const key = [
      t.symbol.toUpperCase(),
      t.tradeType,
      (t.strikes ?? "").trim(),
      (t.expiration ?? "").trim(),
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
    const totalCommIn = lots.reduce((s, l) => s + (l.commIn ?? 0), 0);
    const totalAllocation = lots.reduce((s, l) => s + (l.allocation ?? 0), 0);
    const currentPrice = lots.reduce<number | null>((acc, l) => l.currentPrice ?? acc, null);
    const totalOpenPL = lots.reduce((s, l) => s + computeOpenPL(l), 0);
    const first = lots[0];
    groups.push({
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
    });
  });
  return groups;
}
