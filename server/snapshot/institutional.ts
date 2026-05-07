/**
 * Institutional ownership adapter for the snapshot pipeline.
 *
 * Provider chain (FMP_TIER=ultimate):
 *   - FMP Ultimate primary — `/institutional-ownership/symbol-positions-summary`
 *     + `/institutional-ownership/extract-analytics/holder` for current and
 *     prior quarter; QoQ deltas computed by diffing share counts by holder
 *     name. This populates institutionPct, institutionCount, top holders,
 *     top funds, AND a real flow score (the previous EDGAR+Yahoo chain
 *     could only get flow when Yahoo was alive — now neutered by the kill
 *     switch under Ultimate).
 *   - EDGAR fallback — same authoritative SEC source the legacy path used.
 *     Kept for resilience if FMP Ultimate returns null (plan downgrade or
 *     transient 5xx). EDGAR's response shape matches FMP's.
 *   - Yahoo last-ditch — neutered when Ultimate is set. Left in code for
 *     emergency manual override only.
 *
 * Flow scoring previously bottomed out at NEUTRAL whenever Yahoo was off,
 * because the QoQ deltas came from Yahoo's `pctChange` field. Now we
 * compute QoQ ourselves from two consecutive FMP 13F snapshots (this is
 * effectively the Phase 3.4b plan — pulled forward because the Phase 2
 * scoring requires real flow data to land).
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
import { getFmpInstitutional, isFmpUltimateEnabled } from "../data/providers/fmp-institutional";
import { fmpGet } from "../data/providers/fmp.client";

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

/** Most-recently-completed quarter (current_quarter - 1). */
function priorQuarter(): { year: number; quarter: number } {
  const now = new Date();
  // The "current" filing-eligible quarter trails the calendar by ~one quarter
  // because 13F filings have a 45-day window. We pull the quarter before that
  // (so two calendar quarters back) so we have a stable baseline.
  const cy = now.getUTCFullYear();
  const cq = Math.floor(now.getUTCMonth() / 3) + 1;
  let year = cy;
  let quarter = cq - 2;
  while (quarter <= 0) { quarter += 4; year -= 1; }
  return { year, quarter };
}

/** FMP holders for one specific quarter. Returns [] on any error. */
async function fmpHoldersForQuarter(symbol: string, q: { year: number; quarter: number }): Promise<any[]> {
  try {
    const rows = await fmpGet<any[]>("/institutional-ownership/extract-analytics/holder", {
      symbol, year: q.year, quarter: q.quarter, page: 0, limit: 100,
    });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function getOwnershipSnapshot(
  ticker: string,
  getYahooOwnership: GetYahooOwnership,
): Promise<FieldHealth<CompanyOwnership>> {
  const T = ticker.toUpperCase();
  const attempts: ProviderAttempt[] = [];

  // ─── FMP Ultimate (primary on FMP_TIER=ultimate) ─────────────────────────
  if (isFmpUltimateEnabled()) {
    const t0 = Date.now();
    try {
      const fmp = await getFmpInstitutional(T);
      const ms = Date.now() - t0;
      if (fmp && fmp.topHolders.length > 0) {
        attempts.push({ source: "fmp", ok: true, ms });

        // QoQ flow: pull the prior quarter and diff by holder name. Without
        // this, flow score sits at zero (NEUTRAL) for everyone.
        const priorRows = await fmpHoldersForQuarter(T, priorQuarter());
        const priorByName = new Map<string, number>();
        for (const ph of priorRows) {
          const k = normalizeOrgName(String(ph.investorName || ph.holder || ph.name || ""));
          if (!k) continue;
          const prevShares = Number(ph.sharesNumber || ph.shares || ph.position || 0);
          // Sum if multiple report rows per filer (e.g. amended filings)
          priorByName.set(k, (priorByName.get(k) ?? 0) + prevShares);
        }

        let instInflow = 0, instOutflow = 0;
        let instIncreased = 0, instDecreased = 0, instNew = 0, instSoldOut = 0;

        const topInstitutions: InstitutionalHolderRow[] = fmp.topHolders.map((h) => {
          const k = normalizeOrgName(h.name);
          const prev = priorByName.get(k) ?? 0;
          let chgFraction = 0;
          if (prev > 0 && h.shares > 0) chgFraction = (h.shares - prev) / prev;
          else if (prev === 0 && h.shares > 0) chgFraction = 1; // new position
          else if (prev > 0 && h.shares === 0) chgFraction = -1; // sold out

          if (chgFraction > 0.5) instNew++;
          else if (chgFraction > 0) instIncreased++;
          if (chgFraction < -0.9) instSoldOut++;
          else if (chgFraction < 0) instDecreased++;
          if (chgFraction > 0) instInflow += h.value * chgFraction;
          if (chgFraction < 0) instOutflow += Math.abs(h.value * chgFraction);

          return {
            name: h.name,
            shares: h.shares,
            value: h.value,
            pctHeld: h.pctHeld * 100, // FMP returns 0..1 (matches EDGAR shape); convert to percent
            changeQoQ: chgFraction * 100,
            reportDate: h.reportDate,
            cik: h.cik || undefined,
            accession: h.accession || undefined,
          };
        });

        const totalFlow = instInflow + instOutflow;
        const flowScore = totalFlow > 0
          ? Math.round(((instInflow - instOutflow) / totalFlow) * 100)
          : 0;

        const topFunds: FundHolderRow[] = fmp.topFunds.map((f) => ({
          name: f.name,
          shares: f.shares,
          value: f.value,
          pctHeld: f.pctHeld * 100,
          changeQoQ: f.changeQoQ,
          reportDate: f.reportDate,
        }));

        const value: CompanyOwnership = {
          institutionPct: fmp.institutionPct,
          institutionCount: fmp.institutionCount,
          sharesOutstanding: fmp.sharesOutstanding,
          asOf: fmp.asOf,
          topInstitutions,
          topFunds,
          insiderHolders: [], // FMP doesn't have an insider-holders endpoint; left empty
          insiderPct: 0,      // same — populate from EDGAR/Yahoo follow-up if needed
          flowScore,
          signal: signalFor(flowScore),
          instInflow: Math.round(instInflow),
          instOutflow: Math.round(instOutflow),
          instIncreased,
          instDecreased,
          instNew,
          instSoldOut,
        };

        return {
          value,
          source: "fmp",
          attempts,
          fetchedAt: Date.now(),
          ttlMs: OWNERSHIP_TTL_MS,
          cached: false,
        };
      } else {
        attempts.push({ source: "fmp", ok: true, ms, empty: true });
      }
    } catch (e: any) {
      attempts.push({ source: "fmp", ok: false, ms: Date.now() - t0, error: String(e?.message || e).substring(0, 200) });
    }
  }

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
  // Compute flow from raw QoQ data — no silent filtering. If a holder shows
  // a -52% drop, that drop is in the aggregate, full stop. The user sees
  // both the row and its impact on the score, and can judge for themselves
  // whether the underlying filing is real or an artifact.
  //
  // Single trust gate: when EDGAR is fully empty (Yahoo wholesale fallback),
  // there is NO authoritative cross-check on the entire holder list. In that
  // state we publish flowScore=0 / signal=NEUTRAL because we'd rather show
  // no signal than one we can't defend. Once EDGAR re-warms with real data,
  // the score reflects raw math from authoritative-list + Yahoo-QoQ.
  //
  // The proper long-term fix is to compute QoQ ourselves from two consecutive
  // EDGAR 13F filings (Phase 3.4b in the master plan). Until that lands,
  // Yahoo's name-matched QoQ is what we've got and we report it honestly.
  let instInflow = 0, instOutflow = 0;
  let instIncreased = 0, instDecreased = 0, instNew = 0, instSoldOut = 0;
  for (const inst of instOwnership) {
    const chg = num(inst.pctChange);
    const value = num(inst.value);
    if (chg > 0.5) instNew++;
    else if (chg > 0) instIncreased++;
    if (chg < -0.9) instSoldOut++;
    else if (chg < 0) instDecreased++;
    if (chg > 0) instInflow += value * chg;
    if (chg < 0) instOutflow += Math.abs(value * chg);
  }
  const totalFlow = instInflow + instOutflow;
  const rawFlowScore = totalFlow > 0
    ? Math.round(((instInflow - instOutflow) / totalFlow) * 100)
    : 0;
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
