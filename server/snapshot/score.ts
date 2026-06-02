/**
 * scoreSnapshot — single source of truth for the company score.
 *
 * Phase 2 of the architectural rebuild. Replaces the two divergent scoring
 * paths that existed before:
 *   - `computeScoring` (server/routes.ts:988) — fed /api/analyze and the
 *     trade-analysis header. 8 fundamental categories. **Structurally blind
 *     to institutional flow, insider activity, and analyst consensus.**
 *   - The verdict route's inline factor-blend (server/routes.ts:4305+) —
 *     fed /api/verdict only. Included institutional + insider but had a
 *     20% strategy factor wired to a hardcoded null (`stratRes`), and used
 *     a different weighting from computeScoring.
 *
 * Result: trade-analysis grade and verdict outlook computed by different
 * formulas with different inputs. Owner's "header grade doesn't match
 * outlook grade" complaint.
 *
 * scoreSnapshot consumes a CompanySnapshot (already provider-agnostic with
 * per-field provenance) and returns ONE canonical score. Both /api/analyze
 * and /api/verdict will eventually read from this function. Until then,
 * /api/diag/score/:ticker serves the new score side-by-side with the
 * legacy outputs so we can verify parity before any cutover.
 *
 * Score on the canonical 0-100 scale. The 0-10 form (legacy /api/analyze)
 * is just a /10 rescale and lives in the returned object as `score10` for
 * convenience.
 */

import type { CompanySnapshot, ProviderSource } from "./types";

export interface CategoryScore {
  /** Human-readable name (matches legacy category names where they overlap). */
  name: string;
  /** 0..10. Neutral fallback (5) when data is missing — see `populated`. */
  score: number;
  /** Weight as a fraction of 1.0. Sums to 1.0 across all categories. */
  weight: number;
  /** One-line plain-English explanation (uses the actual values). */
  reasoning: string;
  /** Which adapter contributed the input data, if any. */
  source: ProviderSource | null;
  /** false = data was missing, score is the neutral fallback (5). */
  populated: boolean;
}

export interface SnapshotScore {
  ticker: string;
  schemaVersion: number;
  /** 0..100 — the canonical score. */
  score100: number;
  /** 0..10 — same number, /10 rescale (legacy /api/analyze shape). */
  score10: number;
  /** Plain-English bucket. */
  verdict: "STRONG CONVICTION" | "INVESTMENT GRADE" | "SPECULATIVE" | "HIGH RISK";
  ruling: string;
  categories: CategoryScore[];
  /** How many categories had non-null source data. Helps the UI flag thin evidence. */
  factorsContributed: number;
  factorsTotal: number;
}

const SCORE_SCHEMA_VERSION = 1;

// ─── Helpers ────────────────────────────────────────────────────────────────

function clamp10(n: number): number {
  return Math.max(1, Math.min(10, n));
}

function num(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmt(n: number | null | undefined, digits = 1, suffix = ""): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "N/A";
  return `${n.toFixed(digits)}${suffix}`;
}

function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "N/A";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

// ─── Category scorers ───────────────────────────────────────────────────────

function scoreIncomeStrength(snap: CompanySnapshot): CategoryScore {
  const dy = num(snap.quote.value?.dividendYield);
  let score = 5;
  let populated = dy !== null;
  if (dy !== null) {
    if (dy > 4) score = 9;
    else if (dy > 2.5) score = 7;
    else if (dy > 1) score = 5;
    else if (dy > 0) score = 3;
    else score = 2;
  } else {
    score = 2; // legacy treats missing as "no dividend = 2"
    populated = false;
  }
  return {
    name: "Income Strength",
    score, weight: 0.08,
    reasoning: dy !== null ? `Dividend yield ${fmt(dy, 2, "%")}` : "No dividend",
    source: snap.quote.source,
    populated,
  };
}

function scoreIncomeQuality(snap: CompanySnapshot): CategoryScore {
  const pr = num(snap.fundamentals.value?.payoutRatio);
  let score = 5;
  if (pr !== null) {
    if (pr > 0 && pr < 50) score = 9;
    else if (pr >= 50 && pr < 75) score = 7;
    else if (pr >= 75 && pr < 100) score = 5;
    else if (pr >= 100) score = 3;
    else score = 4;
  }
  return {
    name: "Income Quality",
    score, weight: 0.07,
    reasoning: pr !== null ? `Payout ratio ${fmt(pr, 1, "%")}` : "No payout data",
    source: snap.fundamentals.source,
    populated: pr !== null,
  };
}

function scoreBusinessQuality(snap: CompanySnapshot): CategoryScore {
  const f = snap.fundamentals.value;
  const rg = num(f?.revenueGrowth);
  const gm = num(f?.grossMargin);
  let score = 5;
  if (rg !== null) {
    if (rg > 10) score += 2;
    else if (rg > 0) score += 1;
    else if (rg < -5) score -= 2;
  }
  if (gm !== null) {
    if (gm > 40) score += 2;
    else if (gm > 20) score += 1;
  }
  return {
    name: "Business Quality",
    score: clamp10(score), weight: 0.10,
    reasoning: `Rev growth ${fmt(rg, 1, "%")}, gross margin ${fmt(gm, 1, "%")}`,
    source: snap.fundamentals.source,
    populated: rg !== null || gm !== null,
  };
}

function scoreBalanceSheet(snap: CompanySnapshot): CategoryScore {
  const f = snap.fundamentals.value;
  const de = num(f?.debtToEquity);
  const cr = num(f?.currentRatio);
  let score = 5;
  if (de !== null) {
    if (de < 30) score += 2;
    else if (de < 80) score += 1;
    else if (de > 150) score -= 2;
    else if (de > 100) score -= 1;
  }
  if (cr !== null) {
    if (cr > 2) score += 1;
    else if (cr < 1) score -= 1;
  }
  return {
    name: "Balance Sheet Quality",
    score: clamp10(score), weight: 0.10,
    reasoning: `D/E ${fmt(de, 1, "%")}, current ratio ${fmt(cr, 2)}`,
    source: snap.fundamentals.source,
    populated: de !== null || cr !== null,
  };
}

function scorePerformance(snap: CompanySnapshot): CategoryScore {
  const r = snap.returns.value;
  const r1 = num(r?.oneYear);
  const r3 = num(r?.threeYear);
  let score = 5;
  if (r1 !== null) {
    if (r1 > 20) score += 2;
    else if (r1 > 5) score += 1;
    else if (r1 < -10) score -= 2;
    else if (r1 < 0) score -= 1;
  }
  if (r3 !== null) {
    if (r3 > 50) score += 1;
    else if (r3 < -10) score -= 1;
  }
  return {
    name: "Performance Quality",
    score: clamp10(score), weight: 0.10,
    reasoning: `1Y ${fmt(r1, 1, "%")}, 3Y ${fmt(r3, 1, "%")}`,
    source: snap.returns.source,
    populated: r1 !== null || r3 !== null,
  };
}

function scoreValuation(snap: CompanySnapshot): CategoryScore {
  const q = snap.quote.value;
  const pe = num(q?.trailingPE);
  const fpe = num(q?.forwardPE);
  const growth = num(snap.fundamentals.value?.earningsGrowth); // % YoY
  const dy = num(q?.dividendYield); // %

  // PEGY (Peter Lynch): P/E ÷ (earnings-growth% + dividend-yield%). Growth-adjusted
  // valuation — rewards cheap-for-growth names that a raw P/E can't see. Guarded:
  // only meaningful when earnings growth is solidly positive. With negative/near-zero
  // growth the ratio explodes or flips sign, so we fall back to the plain P/E ladder.
  const GROWTH_FLOOR = 2; // need >2% earnings growth for PEGY to be trustworthy
  if (pe !== null && pe > 0 && growth !== null && growth > GROWTH_FLOOR) {
    const pegy = pe / (growth + (dy ?? 0));
    let score: number;
    if (pegy < 1) score = 9;        // cheap for its growth + income
    else if (pegy < 2) score = 7;   // fair
    else if (pegy < 3) score = 5;   // fully valued
    else score = 3;                 // expensive even after growth + yield
    const yieldTxt = dy !== null ? fmt(dy, 1, "%") : "0%";
    return {
      name: "Valuation Sanity",
      score: clamp10(score), weight: 0.08,
      reasoning: `PEGY ${fmt(pegy, 2)} (P/E ${fmt(pe, 1)}, growth ${fmt(growth, 1, "%")}, yield ${yieldTxt})`,
      source: snap.quote.source,
      populated: true,
    };
  }

  // Fallback: plain P/E ladder (no usable growth) — original behavior preserved.
  let score = 5;
  if (pe !== null) {
    if (pe < 0) score = 3;
    else if (pe < 12) score = 9;
    else if (pe < 20) score = 7;
    else if (pe < 30) score = 5;
    else if (pe < 50) score = 4;
    else score = 2;
  }
  if (fpe !== null && pe !== null && fpe < pe) {
    score = Math.min(10, score + 1);
  }
  return {
    name: "Valuation Sanity",
    score: clamp10(score), weight: 0.08,
    reasoning: `P/E ${fmt(pe, 1)}, fwd P/E ${fmt(fpe, 1)}`,
    source: snap.quote.source,
    populated: pe !== null || fpe !== null,
  };
}

function scoreLiquidity(snap: CompanySnapshot): CategoryScore {
  const q = snap.quote.value;
  const mc = num(q?.marketCap);
  const av = num(q?.averageVolume);
  let score = 5;
  if (mc !== null) {
    if (mc > 100e9) score += 2;
    else if (mc > 10e9) score += 1;
    else if (mc < 300e6) score -= 2;
    else if (mc < 1e9) score -= 1;
  }
  if (av !== null) {
    if (av > 5e6) score += 1;
    else if (av < 100e3) score -= 1;
  }
  return {
    name: "Liquidity & Scale",
    score: clamp10(score), weight: 0.05,
    reasoning: `Market cap ${fmtCompact(mc)}`,
    source: snap.quote.source,
    populated: mc !== null,
  };
}

function scoreThesisDurability(snap: CompanySnapshot): CategoryScore {
  const q = snap.quote.value;
  const f = snap.fundamentals.value;
  const beta = num(q?.beta);
  const dy = num(q?.dividendYield);
  const rg = num(f?.revenueGrowth);
  const de = num(f?.debtToEquity);
  let score = 5;
  if (beta !== null) {
    if (beta < 0.8) score += 1;
    else if (beta > 1.5) score -= 1;
  }
  if (rg !== null && rg > 5) score += 1;
  if (de !== null && de < 50) score += 1;
  if (dy !== null && dy > 2) score += 1;
  return {
    name: "Thesis Durability",
    score: clamp10(score), weight: 0.07,
    reasoning: `Beta ${fmt(beta, 2)}`,
    source: snap.quote.source,
    populated: beta !== null,
  };
}

function scoreInstitutionalFlow(snap: CompanySnapshot): CategoryScore {
  const o = snap.ownership.value;
  // flowScore is on -100..+100; map to 1..10. 0 → 5, +100 → 10, -100 → 1.
  const flow = num(o?.flowScore);
  let score = 5;
  if (flow !== null) {
    score = 5 + (flow / 100) * 5;
  }
  return {
    name: "Institutional Flow",
    score: clamp10(score), weight: 0.15,
    reasoning: o?.signal ? `${o.signal} (flow ${flow !== null ? flow.toFixed(0) : "—"})` : "No flow data",
    source: snap.ownership.source,
    populated: flow !== null,
  };
}

function scoreInsiderConfidence(snap: CompanySnapshot): CategoryScore {
  const a = snap.insiderActivity.value;
  const buy = a?.buyCount ?? 0;
  const sell = a?.sellCount ?? 0;
  const total = buy + sell;

  // Calibration: most blue-chip executives sell quarterly under 10b5-1 plans.
  // Under the previous "1 + (buy/total)*9" formula, AAPL's "0 buys / 9 sells"
  // and a panic-selling micro-cap's "0 buys / 50 sells" both scored 1/10 —
  // identical, despite being categorically different signals. The new
  // calibration treats:
  //   - very thin activity (< 4 events)         → no signal, score 5 (neutral)
  //   - sell-only with low-medium volume        → mild negative (4)
  //   - sell-only with high volume (>15)        → moderate negative (3)
  //   - mostly sells (buy ratio < 25%)          → 4
  //   - balanced (25%–75% buys)                 → 5–7 (linear)
  //   - mostly buys (> 75%)                     → 8–10 (linear)
  //   - strong net buying (> 5 buys, no sells)  → 10
  let score = 5;
  let populated = total > 0;
  if (total < 4) {
    // Treat thin activity as no signal — it's not material either way.
    score = 5;
    populated = total > 0;
  } else if (buy === 0) {
    score = sell > 15 ? 3 : 4;
  } else {
    const buyRatio = buy / total;
    if (buyRatio >= 0.75) {
      score = 8 + (buyRatio - 0.75) * 8; // 75% → 8, 100% → 10
    } else if (buyRatio >= 0.25) {
      score = 5 + (buyRatio - 0.25) * 4; // 25% → 5, 75% → 7
    } else {
      score = 4 + buyRatio * 4; // 0% → 4, 25% → 5
    }
    if (sell === 0 && buy >= 5) score = 10;
  }
  return {
    name: "Insider Confidence",
    score: clamp10(score), weight: 0.10,
    reasoning: total > 0 ? `${buy} buys / ${sell} sells (last ${a?.windowDays ?? 180}d)` : "No insider activity",
    source: snap.insiderActivity.source,
    populated,
  };
}

function scoreAnalystConsensus(snap: CompanySnapshot): CategoryScore {
  const a = snap.analyst.value;
  const consensus = a?.consensus ?? null;
  const consensusScore: Record<string, number> = {
    "STRONG BUY": 10,
    "BUY": 8,
    "HOLD": 5,
    "SELL": 3,
    "STRONG SELL": 1,
  };
  const score = consensus ? (consensusScore[consensus] ?? 5) : 5;
  const count = a?.analystCount ?? 0;
  return {
    name: "Analyst Consensus",
    score, weight: 0.10,
    reasoning: consensus ? `${consensus} (${count} analysts)` : "No analyst coverage",
    source: snap.analyst.source,
    populated: consensus !== null,
  };
}

// ─── Public entry point ─────────────────────────────────────────────────────

export function scoreSnapshot(snap: CompanySnapshot): SnapshotScore {
  const categories: CategoryScore[] = [
    scoreIncomeStrength(snap),
    scoreIncomeQuality(snap),
    scoreBusinessQuality(snap),
    scoreBalanceSheet(snap),
    scorePerformance(snap),
    scoreValuation(snap),
    scoreLiquidity(snap),
    scoreThesisDurability(snap),
    scoreInstitutionalFlow(snap),
    scoreInsiderConfidence(snap),
    scoreAnalystConsensus(snap),
  ];

  // Re-normalize across populated categories only — a missing data source
  // shouldn't drag the score toward the neutral fallback.
  const populated = categories.filter(c => c.populated);
  const denom = populated.reduce((s, c) => s + c.weight, 0);

  let score10: number;
  if (denom > 0) {
    score10 = populated.reduce((s, c) => s + c.score * c.weight, 0) / denom;
  } else {
    score10 = 5;
  }

  const score100 = Math.round(score10 * 100) / 10; // one decimal of precision

  const { verdict, ruling } = bucketVerdict(score10);

  return {
    ticker: snap.ticker,
    schemaVersion: SCORE_SCHEMA_VERSION,
    score100,
    score10: Math.round(score10 * 100) / 100,
    verdict,
    ruling,
    categories,
    factorsContributed: populated.length,
    factorsTotal: categories.length,
  };
}

export function bucketVerdict(score10: number): { verdict: SnapshotScore["verdict"]; ruling: string } {
  if (score10 >= 8.5) return {
    verdict: "STRONG CONVICTION",
    ruling: "Strong long-term hold — fundamentals, flow, and confirming signals align.",
  };
  if (score10 >= 7.0) return {
    verdict: "INVESTMENT GRADE",
    ruling: "Solid long-term hold — good fundamentals with some areas to monitor.",
  };
  if (score10 >= 5.5) return {
    verdict: "SPECULATIVE",
    ruling: "Mixed evidence — needs improvement in key areas before committing.",
  };
  return {
    verdict: "HIGH RISK",
    ruling: "Significant concerns across multiple factors — not recommended for long-term holding.",
  };
}
