/**
 * Projector: CompanySnapshot → InstitutionalData
 *
 * Maps the unified snapshot into the legacy InstitutionalData shape that
 * client/src/pages/institutional.tsx already expects, so the institutional
 * page can be cut over to the snapshot pipeline WITHOUT touching the
 * frontend.
 *
 * Why this matters: the snapshot's ownership adapter has provider fallback
 * (EDGAR fallback). The legacy parseInstitutionalData has none — when EDGAR
 * returns empty (poisoned cache, circuit breaker, or genuine miss), the
 * page renders blank. Routing through the snapshot fixes that for AAPL,
 * PLTR, MSFT and everyone else.
 */

import type { CompanySnapshot } from "./types";

export interface LegacyInstitutionalData {
  ticker: string;
  companyName: string;
  currentPrice: number;
  marketCap: number;
  volume: number;
  avgVolume: number;

  insiderPct: number;
  institutionPct: number;
  institutionCount: number;
  floatPct: number;
  sharesOutstanding: number | null;
  institutionalAsOf: string | null;
  institutionalSource: string;

  flowScore: number;
  signal: string;
  instInflow: number;
  instOutflow: number;
  instIncreased: number;
  instDecreased: number;
  instNew: number;
  instSoldOut: number;

  insiderBuyCount: number;
  insiderSellCount: number;
  insiderBuyShares: number;
  insiderSellShares: number;
  netInsiderShares: number;
  insiderBuyPct: number;
  insiderSellPct: number;

  topInstitutions: Array<{
    name: string; shares: number; value: number; pctHeld: number;
    changeQoQ: number; reportDate: string | null; cik?: string; accession?: string;
  }>;
  topFunds: Array<{
    name: string; shares: number; value: number; pctHeld: number;
    changeQoQ: number; reportDate: string | null;
  }>;
  insiders: Array<{
    name: string; relation: string; shares: number; sharesIndirect: number;
    latestTransaction: string | null; latestDate: string | null;
  }>;
  recentInsiderTxns: Array<{
    insider: string; relation: string; type: string; typeCode: string;
    meaningful: boolean; direction: "buy" | "sell" | "neutral"; explain: string;
    shares: number; value: number; date: string | null;
  }>;

  // Provenance — extra fields the frontend can ignore today, useful for diag.
  _provenance: {
    quote: string | null;
    ownership: string | null;
    insiderActivity: string | null;
    ownershipFallbackUsed: boolean;
  };
}

export function projectInstitutional(snap: CompanySnapshot): LegacyInstitutionalData | null {
  const quote = snap.quote.value;
  const ownership = snap.ownership.value;
  const insider = snap.insiderActivity.value;

  // We can render the page if we have ANY of the three. Quote alone gives the
  // header; ownership alone gives the holder lists; insider alone gives the
  // recent-transactions tab. All three null means truly nothing → 404.
  if (!quote && !ownership && !insider) return null;

  const fallbackUsed =
    snap.ownership.attempts.length > 1 &&
    snap.ownership.source !== null &&
    snap.ownership.attempts[0]?.source !== snap.ownership.source;

  return {
    ticker: snap.ticker,
    companyName: quote?.longName ?? quote?.shortName ?? snap.ticker,
    currentPrice: quote?.price ?? 0,
    marketCap: quote?.marketCap ?? 0,
    volume: quote?.volume ?? 0,
    avgVolume: quote?.averageVolume ?? 0,

    insiderPct: ownership?.insiderPct ?? 0,
    institutionPct: ownership?.institutionPct ?? 0,
    institutionCount: ownership?.institutionCount ?? 0,
    floatPct: ownership?.institutionPct ?? 0,
    sharesOutstanding: ownership?.sharesOutstanding ?? null,
    institutionalAsOf: ownership?.asOf ?? null,
    institutionalSource: snap.ownership.source ?? "none",

    flowScore: ownership?.flowScore ?? 0,
    signal: ownership?.signal ?? "NEUTRAL",
    instInflow: ownership?.instInflow ?? 0,
    instOutflow: ownership?.instOutflow ?? 0,
    instIncreased: ownership?.instIncreased ?? 0,
    instDecreased: ownership?.instDecreased ?? 0,
    instNew: ownership?.instNew ?? 0,
    instSoldOut: ownership?.instSoldOut ?? 0,

    insiderBuyCount: insider?.buyCount ?? 0,
    insiderSellCount: insider?.sellCount ?? 0,
    insiderBuyShares: insider?.buyShares ?? 0,
    insiderSellShares: insider?.sellShares ?? 0,
    netInsiderShares: insider?.netShares ?? 0,
    insiderBuyPct: 0,
    insiderSellPct: 0,

    // Snapshot canonical = percent (0..100). Legacy institutional.tsx
    // expects a fraction (0..1) for pctHeld and multiplies by 100 in the
    // render. Convert here so we don't end up displaying "972%".
    topInstitutions: (ownership?.topInstitutions ?? []).map(i => ({
      ...i,
      pctHeld: i.pctHeld / 100,
    })),
    topFunds: (ownership?.topFunds ?? []).map(f => ({
      ...f,
      pctHeld: f.pctHeld / 100,
    })),
    insiders: (ownership?.insiderHolders ?? []).map(h => ({
      name: h.name,
      relation: h.relation,
      shares: h.sharesDirect,
      sharesIndirect: h.sharesIndirect,
      latestTransaction: h.latestTransaction,
      latestDate: h.latestDate,
    })),
    recentInsiderTxns: insider?.recentTransactions ?? [],

    _provenance: {
      quote: snap.quote.source,
      ownership: snap.ownership.source,
      insiderActivity: snap.insiderActivity.source,
      ownershipFallbackUsed: fallbackUsed,
    },
  };
}
