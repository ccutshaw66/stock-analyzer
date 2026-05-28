/**
 * Trigger Check pipeline — replaces the old Conviction Compass entry point.
 *
 * Brief: `~/.claude/projects/C--dev/memory/brief_trigger_check.md`.
 *
 * Flow:
 *   1. Fetch context once: CompanySnapshot, 1y daily bars, MM exposure,
 *      market regime. Each call is fail-soft.
 *   2. Run every check in the registry against the same context.
 *   3. Aggregate the results into a verdict (`GO` / `CAUTION` / `NO`) and
 *      a single biggest-reason headline.
 *   4. Return the full payload — the page renders the checklist verbatim.
 */
import type { OHLCV } from "../data/types";
import { getCompanySnapshot } from "../snapshot";
import type { GetCompanySnapshotOpts } from "../snapshot";
import { getChartSnapshot } from "../snapshot/chart";
import { computeMMExposure } from "../mm-exposure";
import { TRIGGER_CHECKS } from "./checks/registry";
import type {
  CheckResult,
  CheckContext,
  TriggerCheckResponse,
  Verdict,
  CheckCategory,
} from "./checks/types";

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: TriggerCheckResponse; expiresAt: number }>();

// ─── Chart shape adapter ───────────────────────────────────────────────────

function yahooChartToOhlcv(chart: any): OHLCV[] {
  const ts: number[] = chart?.timestamp ?? [];
  const q = chart?.indicators?.quote?.[0] ?? {};
  const opens: number[] = q.open ?? [];
  const highs: number[] = q.high ?? [];
  const lows: number[] = q.low ?? [];
  const closes: number[] = q.close ?? [];
  const volumes: number[] = q.volume ?? [];

  const out: OHLCV[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = Number(closes[i]);
    if (!Number.isFinite(c)) continue;
    out.push({
      t: new Date(ts[i] * 1000),
      o: Number(opens[i]) || c,
      h: Number(highs[i]) || c,
      l: Number(lows[i]) || c,
      c,
      v: Number(volumes[i]) || 0,
    });
  }
  return out;
}

// ─── Market regime ─────────────────────────────────────────────────────────

async function fetchMarketRegime(): Promise<CheckContext["marketRegime"]> {
  try {
    const { readIntraday, readBreadth } = await import("../market-pulse-cache");
    const { computeRegime } = await import("../data/providers/market-pulse.adapter");
    const intraday = readIntraday();
    if (!intraday) return null;
    const breadth =
      readBreadth() ?? {
        pctAbove50d: null,
        pctAbove200d: null,
        newHighs: null,
        newLows: null,
        universeSize: null,
        asOf: 0,
      };
    const regime = computeRegime(intraday.volatility, breadth, intraday.riskAppetite);
    if (!regime?.tier) return null;
    return { tier: regime.tier, score: regime.score ?? null };
  } catch {
    return null;
  }
}

// ─── Verdict aggregator ────────────────────────────────────────────────────

interface AggregatorOpts {
  results: CheckResult[];
}

interface VerdictDecision {
  verdict: Verdict;
  reason: string;
  summary: { pass: number; warn: number; fail: number; skip: number };
}

function aggregateVerdict({ results }: AggregatorOpts): VerdictDecision {
  const counted = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const r of results) counted[r.status]++;

  // Insufficient data: nothing actually scored.
  if (counted.pass + counted.warn + counted.fail === 0) {
    return {
      verdict: "INSUFFICIENT_DATA",
      reason: "Not enough data on this ticker to make a call yet.",
      summary: counted,
    };
  }

  const fails = results.filter((r) => r.status === "fail");
  const passes = results.filter((r) => r.status === "pass");
  const warns = results.filter((r) => r.status === "warn");

  // NO verdict: any single fail with weight 3, OR fail count strictly greater
  // than pass count.
  const heaviestFail = fails.reduce<CheckResult | null>(
    (acc, r) => (acc == null || (r.weight ?? 1) > (acc.weight ?? 1) ? r : acc),
    null,
  );
  const heaviestPass = passes.reduce<CheckResult | null>(
    (acc, r) => (acc == null || (r.weight ?? 1) > (acc.weight ?? 1) ? r : acc),
    null,
  );

  if (heaviestFail && (heaviestFail.weight ?? 1) >= 3) {
    return { verdict: "NO", reason: heaviestFail.reason, summary: counted };
  }
  if (fails.length > passes.length) {
    return {
      verdict: "NO",
      reason: heaviestFail?.reason ?? "Multiple bearish signals — sit this one out.",
      summary: counted,
    };
  }

  // CAUTION: any fail at all, or warns outnumber passes.
  if (fails.length >= 1) {
    return {
      verdict: "CAUTION",
      reason: heaviestFail!.reason,
      summary: counted,
    };
  }
  if (warns.length >= passes.length && passes.length > 0) {
    const heaviestWarn = warns.reduce<CheckResult | null>(
      (acc, r) => (acc == null || (r.weight ?? 1) > (acc.weight ?? 1) ? r : acc),
      null,
    );
    return {
      verdict: "CAUTION",
      reason:
        heaviestWarn?.reason ?? "Several signals are mixed — wait for a cleaner setup.",
      summary: counted,
    };
  }

  // GO: passes outweigh warns, no fails.
  return {
    verdict: "GO",
    reason:
      heaviestPass?.reason ??
      "Multiple signals lined up in your favor — setup looks clean for an entry.",
    summary: counted,
  };
}

// ─── Ordering ───────────────────────────────────────────────────────────────

const CATEGORY_ORDER: ReadonlyArray<CheckCategory> = [
  "Trend",
  "Momentum",
  "Setup",
  "Smart Money",
  "Dealer Flow",
  "Catalysts",
  "Fundamentals",
  "Market Regime",
];

function sortChecks(results: CheckResult[]): CheckResult[] {
  return [...results].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.category);
    const bi = CATEGORY_ORDER.indexOf(b.category);
    if (ai !== bi) return ai - bi;
    return (b.weight ?? 1) - (a.weight ?? 1);
  });
}

// ─── Public entry ──────────────────────────────────────────────────────────

export interface GetTriggerCheckOpts extends GetCompanySnapshotOpts {}

export async function getTriggerCheck(
  ticker: string,
  opts: GetTriggerCheckOpts,
): Promise<TriggerCheckResponse> {
  const T = ticker.toUpperCase();

  if (!opts.forceRefresh) {
    const cached = cache.get(T);
    if (cached && Date.now() < cached.expiresAt) return cached.value;
  }

  // Fetch context — every source is fail-soft.
  const [snapshot, mmRaw, chart, marketRegime] = await Promise.all([
    getCompanySnapshot(T, opts),
    computeMMExposure(T).catch(() => null),
    getChartSnapshot(T, "1y", "1d", opts.yahooFetch).catch(() => null),
    fetchMarketRegime(),
  ]);

  const bars = chart?.value ? yahooChartToOhlcv(chart.value) : [];

  const ctx: CheckContext = {
    ticker: T,
    snapshot,
    bars,
    mm: mmRaw,
    marketRegime,
  };

  // Run every check; null returns mean the check didn't apply or had no data.
  const raw = TRIGGER_CHECKS.map((check) => {
    try {
      return check(ctx);
    } catch (err: any) {
      // Don't surface internals — quiet skip on check error.
      console.log(`[trigger-check] check failed for ${T}: ${err?.message || err}`);
      return null;
    }
  });
  const results = raw.filter((r): r is CheckResult => r !== null);
  const ordered = sortChecks(results);

  const { verdict, reason, summary } = aggregateVerdict({ results: ordered });

  const response: TriggerCheckResponse = {
    ticker: T,
    verdict,
    reason,
    summary,
    checks: ordered,
    generatedAt: new Date().toISOString(),
  };

  cache.set(T, { value: response, expiresAt: Date.now() + CACHE_TTL_MS });
  return response;
}
