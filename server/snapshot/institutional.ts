/**
 * Institutional ownership adapter for the snapshot pipeline.
 *
 * Provider chain (FMP_TIER=ultimate):
 *   - FMP Ultimate primary — `/institutional-ownership/symbol-positions-summary`
 *     + `/institutional-ownership/extract-analytics/holder` for current and
 *     prior quarter; QoQ deltas computed by diffing share counts by holder
 *     name. This populates institutionPct, institutionCount, top holders,
 *     top funds, AND a real flow score (the previous EDGAR-only chain
 *     could not compute flow without per-holder QoQ — now solved by the FMP
 *     switch under Ultimate).
 *   - EDGAR fallback — same authoritative SEC source the legacy path used.
 *     Kept for resilience if FMP Ultimate returns null (plan downgrade or
 *     transient 5xx). EDGAR's response shape matches FMP's.
 *
 * Flow scoring is computed from two consecutive FMP 13F snapshots (this is
 * effectively the Phase 3.4b plan — pulled forward because the Phase 2
 * scoring requires real flow data to land). On the EDGAR-only fallback path
 * we publish flowScore=0 / NEUTRAL because EDGAR's summary has no per-holder
 * QoQ to score from.
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

/** One quarter before the supplied current quarter. */
function quarterBefore(q: { year: number; quarter: number }): { year: number; quarter: number } {
  let year = q.year;
  let quarter = q.quarter - 1;
  if (quarter < 1) { quarter = 4; year -= 1; }
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

        // QoQ flow: pull the quarter BEFORE the one fmp.topHolders is from
        // (fmp.usedQuarter) and diff by holder name. Using the calendar-based
        // priorQuarter() was buggy — when the in-progress quarter's 13F
        // filings haven't aggregated yet, getFmpInstitutional walks back to
        // the same quarter the calendar-based prior would have picked, and
        // we end up comparing a quarter to itself. Pulling fmp.usedQuarter - 1
        // guarantees a real QoQ comparison.
        const priorQ = fmp.usedQuarter
          ? quarterBefore(fmp.usedQuarter)
          : null;
        const priorRows = priorQ ? await fmpHoldersForQuarter(T, priorQ) : [];
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
          insiderPct: 0,      // same — populate from EDGAR follow-up if needed
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

  // ─── If EDGAR came up empty, return null ─────────────────────────────────
  const hasEdgar = !!edgar && (edgar.topHolders?.length ?? 0) > 0;

  if (!hasEdgar) {
    return {
      value: null,
      source: null,
      attempts,
      fetchedAt: Date.now(),
      ttlMs: OWNERSHIP_TTL_MS,
      cached: false,
    };
  }

  // ─── EDGAR holders ───────────────────────────────────────────────────────
  // EDGAR's 13F summary has no per-holder QoQ, so changeQoQ is 0 on this
  // fallback path. The FMP-primary path above computes real QoQ; this branch
  // only runs when FMP Ultimate is unavailable.
  const topInstitutions: InstitutionalHolderRow[] = edgar!.topHolders.map((h: any) => ({
    name: h.name,
    shares: h.shares,
    value: h.value,
    pctHeld: h.pctHeld * 100, // EDGAR returns 0..1; convert to percent
    changeQoQ: 0,
    reportDate: h.reportDate,
    cik: h.cik,
    accession: h.accession,
  }));

  // Top funds + insider holders are not available on the EDGAR-only fallback
  // (FMP Ultimate supplies both on the primary path).
  const topFunds: FundHolderRow[] = [];
  const insiderHolders: InsiderHolderRow[] = [];
  const insiderPct = 0;

  // ─── Flow score ──────────────────────────────────────────────────────────
  // EDGAR's summary has no per-holder QoQ to score from, so we publish
  // flowScore=0 / NEUTRAL rather than a signal we can't defend.
  const flowScore = 0;

  const value: CompanyOwnership = {
    institutionPct: edgar?.institutionPct ?? 0,
    institutionCount: edgar?.institutionCount ?? topInstitutions.length,
    sharesOutstanding: edgar?.sharesOutstanding ?? null,
    asOf: edgar?.asOf ?? null,
    topInstitutions,
    topFunds,
    insiderHolders,
    insiderPct,
    flowScore,
    signal: signalFor(flowScore),
    instInflow: 0,
    instOutflow: 0,
    instIncreased: 0,
    instDecreased: 0,
    instNew: 0,
    instSoldOut: 0,
  };

  return {
    value,
    source: "edgar",
    attempts,
    fetchedAt: Date.now(),
    ttlMs: OWNERSHIP_TTL_MS,
    cached: false,
  };
}
