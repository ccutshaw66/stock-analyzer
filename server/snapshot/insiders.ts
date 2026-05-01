/**
 * Insider transactions adapter for the snapshot pipeline.
 *
 * Provider chain: FMP /insider-trading/search → (future) EDGAR Form 4.
 *
 * Output shape is normalized via translateInsiderCode so the same translated
 * label/meaningful/direction fields land on every consumer regardless of
 * which provider answered. Window is the most recent 50 reports.
 *
 * Phase 7 follow-up: replace FMP primary with EDGAR Form 4 aggregation. The
 * tryProviders chain below makes that a one-line change at that point.
 */

import type { CompanyInsiderActivity, FieldHealth, InsiderTxnRow } from "./types";
import { tryProviders } from "./fallback";
import { translateInsiderCode } from "./insider-codes";
import { fmpGet } from "../data/providers/fmp.client";

const INSIDER_TTL_MS = 60 * 60 * 1000; // 1h
const INSIDER_LIMIT = 50;
const INSIDER_WINDOW_DAYS = 180;

function num(v: any): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmpRowsToInsiderActivity(rows: any[]): CompanyInsiderActivity | null {
  if (!Array.isArray(rows)) return null;

  const recent: InsiderTxnRow[] = rows.slice(0, INSIDER_LIMIT).map(r => {
    const rawType = r.transactionType ?? r.acquistionOrDisposition ?? "";
    const translated = translateInsiderCode(rawType);
    const shares = num(r.securitiesTransacted ?? r.shares);
    const pricePer = num(r.price);
    return {
      insider: r.reportingName || r.name || "Unknown",
      relation: r.typeOfOwner || r.relation || "",
      type: translated.label,
      typeCode: String(rawType).toUpperCase(),
      meaningful: translated.meaningful,
      direction: translated.direction,
      explain: translated.explain,
      shares,
      value: pricePer * shares,
      date: r.transactionDate || r.filingDate || null,
    };
  });

  let buyCount = 0, sellCount = 0, buyShares = 0, sellShares = 0;
  for (const tx of recent) {
    if (tx.direction === "buy") {
      buyCount++;
      buyShares += tx.shares;
    } else if (tx.direction === "sell") {
      sellCount++;
      sellShares += tx.shares;
    }
  }

  return {
    recentTransactions: recent,
    buyCount,
    sellCount,
    buyShares,
    sellShares,
    netShares: buyShares - sellShares,
    windowDays: INSIDER_WINDOW_DAYS,
  };
}

export async function getInsiderActivitySnapshot(
  ticker: string,
): Promise<FieldHealth<CompanyInsiderActivity>> {
  const T = ticker.toUpperCase();
  return tryProviders<CompanyInsiderActivity>(
    [
      {
        source: "fmp",
        fetch: async () => {
          const rows: any[] = await fmpGet<any[]>(`/insider-trading/search`, { symbol: T, page: 0, limit: INSIDER_LIMIT });
          return fmpRowsToInsiderActivity(rows);
        },
      },
      // Future: EDGAR Form 4 primary goes here.
    ],
    {
      ttlMs: INSIDER_TTL_MS,
      isEmpty: (a) => a.recentTransactions.length === 0,
    },
  );
}
