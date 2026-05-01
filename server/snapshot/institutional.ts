/**
 * Institutional ownership adapter for the snapshot pipeline.
 *
 * Provider chain:
 *   - EDGAR primary for the AUTHORITATIVE 13F holder list, institutionPct,
 *     institutionCount, sharesOutstanding.
 *   - Yahoo buffer for QoQ change deltas, fund holders, insider holders,
 *     and the major-holders insiderPct. We MERGE Yahoo's QoQ into EDGAR's
 *     authoritative shares/value rows by normalized name.
 *   - FMP not currently used as an institutional source (Premium plan returns
 *     402 on the 13F endpoints), but the registry leaves the door open.
 *
 * On Yahoo failure we still return a populated EDGAR-only result. On EDGAR
 * failure we still return Yahoo's institutionOwnership list as a fallback
 * top-holder list rather than an empty page.
 */

import type {
  CompanyOwnership,
  FieldHealth,
  InstitutionalHolderRow,
  FundHolderRow,
  InsiderHolderRow,
  FlowSignal,
  ProviderAttempt,
} from "./types";
import { getInstitutionalSummaryStaleOk } from "../data/providers/edgar.adapter";

const OWNERSHIP_TTL_MS = 6 * 60 * 60 * 1000; // 6h — 13F filings are quarterly

function normalizeOrgName(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[.,&'/]/g, " ")
    .replace(/\b(inc|incorporated|corp|corporation|ltd|limited|llc|lp|llp|plc|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function num(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "object" && v.raw !== undefined) v = v.raw;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function signalFor(flowScore: number): FlowSignal {
  if (flowScore >= 40) return "STRONG INFLOW";
  if (flowScore >= 15) return "ACCUMULATING";
  if (flowScore <= -40) return "STRONG OUTFLOW";
  if (flowScore <= -15) return "DISTRIBUTING";
  return "NEUTRAL";
}

interface YahooOwnership {
  institutionOwnership: any | null;
  fundOwnership: any | null;
  majorHoldersBreakdown: any | null;
  insiderHolders: any | null;
}

export type GetYahooOwnership = (ticker: string) => Promise<YahooOwnership>;

export async function getOwnershipSnapshot(
  ticker: string,
  getYahooOwnership: GetYahooOwnership,
): Promise<FieldHealth<CompanyOwnership>> {
  const T = ticker.toUpperCase();
  const attempts: ProviderAttempt[] = [];

  // ─── EDGAR (primary, authoritative for 13F summary) ──────────────────────
  let edgar: Awaited<ReturnType<typeof getInstitutionalSummaryStaleOk>> = null;
  let edgarMs = 0;
  {
    const t0 = Date.now();
    try {
      edgar = await getInstitutionalSummaryStaleOk(T, 25);
      edgarMs = Date.now() - t0;
      if (!edgar || (edgar.topHolders?.length ?? 0) === 0) {
        attempts.push({ source: "edgar", ok: true, ms: edgarMs, empty: true });
      } else {
        attempts.push({ source: "edgar", ok: true, ms: edgarMs });
      }
    } catch (e: any) {
      edgarMs = Date.now() - t0;
      attempts.push({ source: "edgar", ok: false, ms: edgarMs, error: String(e?.message || e).substring(0, 200) });
    }
  }

  // ─── Yahoo (buffer for QoQ + funds + insider holders) ────────────────────
  let yahoo: YahooOwnership = { institutionOwnership: null, fundOwnership: null, majorHoldersBreakdown: null, insiderHolders: null };
  {
    const t0 = Date.now();
    try {
      yahoo = await getYahooOwnership(T);
      const ms = Date.now() - t0;
      const empty =
        !yahoo.institutionOwnership && !yahoo.fundOwnership &&
        !yahoo.majorHoldersBreakdown && !yahoo.insiderHolders;
      attempts.push({ source: "yahoo", ok: true, ms, empty });
    } catch (e: any) {
      const ms = Date.now() - t0;
      attempts.push({ source: "yahoo", ok: false, ms, error: String(e?.message || e).substring(0, 200) });
    }
  }

  // ─── If both providers came up empty, return null ────────────────────────
  const hasEdgar = !!edgar && (edgar.topHolders?.length ?? 0) > 0;
  const hasYahoo =
    !!yahoo.institutionOwnership?.ownershipList?.length ||
    !!yahoo.fundOwnership?.ownershipList?.length ||
    !!yahoo.insiderHolders?.holders?.length;

  if (!hasEdgar && !hasYahoo) {
    return {
      value: null,
      source: null,
      attempts,
      fetchedAt: Date.now(),
      ttlMs: OWNERSHIP_TTL_MS,
      cached: false,
    };
  }

  // ─── Merge Yahoo QoQ deltas into EDGAR holders ───────────────────────────
  const yahooQoQByName = new Map<string, number>();
  const instOwnership: any[] = yahoo.institutionOwnership?.ownershipList ?? [];
  for (const inst of instOwnership) {
    const key = normalizeOrgName(inst.organization || "");
    if (!key) continue;
    const pct = num(inst.pctChange);
    if (pct !== 0) yahooQoQByName.set(key, pct);
  }

  let topInstitutions: InstitutionalHolderRow[] = [];
  if (hasEdgar && edgar) {
    topInstitutions = edgar.topHolders.map((h: any) => ({
      name: h.name,
      shares: h.shares,
      value: h.value,
      pctHeld: h.pctHeld * 100, // EDGAR returns 0..1; convert to percent
      changeQoQ: (yahooQoQByName.get(normalizeOrgName(h.name)) ?? 0) * 100,
      reportDate: h.reportDate,
      cik: h.cik,
      accession: h.accession,
    }));
  } else if (instOwnership.length) {
    // Fallback: if EDGAR has no data, surface Yahoo's institutionOwnership list
    // directly. Less authoritative but keeps the page populated.
    topInstitutions = instOwnership.slice(0, 25).map((inst: any) => ({
      name: inst.organization || "Unknown",
      shares: num(inst.position),
      value: num(inst.value),
      pctHeld: num(inst.pctHeld) * 100,
      changeQoQ: num(inst.pctChange) * 100,
      reportDate: inst.reportDate?.fmt ?? null,
    }));
  }

  // ─── Top funds (Yahoo only — N-PORT in Phase 7) ──────────────────────────
  const fundOwnership: any[] = yahoo.fundOwnership?.ownershipList ?? [];
  const topFunds: FundHolderRow[] = fundOwnership.slice(0, 15).map((fund: any) => ({
    name: fund.organization || "Unknown",
    shares: num(fund.position),
    value: num(fund.value),
    pctHeld: num(fund.pctHeld) * 100, // snapshot canonical = percent (0..100)
    changeQoQ: num(fund.pctChange) * 100,
    reportDate: fund.reportDate?.fmt ?? null,
  }));

  // ─── Insider holders (Yahoo) ─────────────────────────────────────────────
  const yInsiders: any[] = yahoo.insiderHolders?.holders ?? [];
  const insiderHolders: InsiderHolderRow[] = yInsiders.map((h: any) => ({
    name: h.name || "Unknown",
    relation: h.relation || "Unknown",
    sharesDirect: num(h.positionDirect),
    sharesIndirect: num(h.positionIndirect),
    latestTransaction: h.transactionDescription || null,
    latestDate: h.latestTransDate?.fmt ?? null,
  }));

  const insiderPct = num(yahoo.majorHoldersBreakdown?.insidersPercentHeld) * 100;

  // ─── Flow score (institutional inflow vs outflow QoQ) ────────────────────
  //
  // Trust gate: the QoQ deltas come from Yahoo's institutionOwnership.pctChange
  // field, which uses NAME-MATCHING to align this quarter's holders with last
  // quarter's. That math is unreliable for filers with multiple subsidiary
  // CIKs (e.g. JPMorgan Chase + JPM Investment Management). When one
  // subsidiary skips a quarter or files under a different name, Yahoo reads
  // the gap as "the holder dumped ~50% of the position." We confirmed this
  // signature on AAPL/PLTR/MSFT — JPM showed exactly -52% on all three.
  //
  // Two protections:
  //   1. Per-holder filter: ignore drops <= -50% on positions > $1B. Real
  //      half-position exits by megacap holders are rare and newsworthy;
  //      the artifact is common and silent. Filtering gets a closer-to-truth
  //      flow estimate even when EDGAR is helping.
  //   2. Provider gate: when EDGAR is fully empty (Yahoo wholesale fallback),
  //      we have NO authoritative cross-check at all. Suppress flow score
  //      entirely instead of publishing a number we can't defend. Better
  //      to render NEUTRAL than fake STRONG OUTFLOW.
  let instInflow = 0, instOutflow = 0;
  let instIncreased = 0, instDecreased = 0, instNew = 0, instSoldOut = 0;
  let suppressedSuspect = 0;
  for (const inst of instOwnership) {
    const chg = num(inst.pctChange);
    const value = num(inst.value);
    if (chg > 0.5) instNew++;
    else if (chg > 0) instIncreased++;
    if (chg < -0.9) instSoldOut++;
    else if (chg < 0) instDecreased++;
    // Suspect-drop filter: -50%+ drop on a position bigger than $1B.
    const isSuspectDrop = chg <= -0.5 && value > 1e9;
    if (isSuspectDrop) {
      suppressedSuspect++;
      continue;
    }
    if (chg > 0) instInflow += value * chg;
    if (chg < 0) instOutflow += Math.abs(value * chg);
  }
  const totalFlow = instInflow + instOutflow;
  const rawFlowScore = totalFlow > 0
    ? Math.round(((instInflow - instOutflow) / totalFlow) * 100)
    : 0;
  // When we don't have EDGAR backing, even the per-holder filter isn't
  // enough — the entire holder list is Yahoo-sourced and the QoQ math is
  // suspect across the board. Render NEUTRAL until EDGAR re-warms.
  const flowScore = hasEdgar ? rawFlowScore : 0;

  // institutionPct: EDGAR is authoritative when present. When EDGAR is empty
  // and we're falling back to Yahoo, derive the percent from Yahoo's
  // majorHoldersBreakdown.institutionsPercentHeld (the same number Yahoo
  // shows on its own holders page). Without this, the summary card displays
  // 0.0% even when the table below clearly has ~70% of float in the visible
  // holders — exactly the inconsistency we're trying to kill.
  const yahooInstPct = num(yahoo.majorHoldersBreakdown?.institutionsPercentHeld) * 100;
  const institutionPct = hasEdgar
    ? (edgar?.institutionPct ?? 0)
    : yahooInstPct;

  const value: CompanyOwnership = {
    institutionPct,
    institutionCount: edgar?.institutionCount ?? topInstitutions.length,
    sharesOutstanding: edgar?.sharesOutstanding ?? null,
    asOf: edgar?.asOf ?? null,
    topInstitutions,
    topFunds,
    insiderHolders,
    insiderPct,
    flowScore,
    signal: signalFor(flowScore),
    instInflow: Math.round(instInflow),
    instOutflow: Math.round(instOutflow),
    instIncreased,
    instDecreased,
    instNew,
    instSoldOut,
  };

  // Tag the dominant source: EDGAR if it gave us holders, otherwise Yahoo.
  const dominantSource = hasEdgar ? "edgar" : "yahoo";

  return {
    value,
    source: dominantSource,
    attempts,
    fetchedAt: Date.now(),
    ttlMs: OWNERSHIP_TTL_MS,
    cached: false,
  };
}
