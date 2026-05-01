/**
 * Conviction Compass — a pure compute function that fuses four orthogonal
 * signal categories into a single readable conviction score.
 *
 * Why this exists (and why it's not a "yet another TA stack"):
 *   The popular 2026 indicator stacks all combine TA components — MACD +
 *   RSI + Bollinger + ATR. That's still just one signal category
 *   (price/volume momentum). Confluence research consistently finds the
 *   real edge comes from agreement ACROSS orthogonal sources: smart money
 *   flow, dealer positioning, technical momentum, and fundamental quality.
 *
 *   Retail tools rarely have access to all four streams in one product.
 *   We do — EDGAR for institutional + insider, Polygon Options for
 *   gamma/dex, our own technicals, and the existing 8-factor verdict for
 *   fundamentals.
 *
 *   This module compresses those four categories into a single signal.
 *   The math deliberately penalizes divergence: high conviction requires
 *   the four axes to agree in sign AND magnitude. Three-out-of-four
 *   agreement is a softer signal than "everyone aligned."
 *
 * Pure function — takes already-fetched inputs, returns the compass.
 * No I/O. The pipeline file in this directory handles the fetching.
 */

import type { CompanySnapshot } from "../snapshot/types";

// ─── Inputs ────────────────────────────────────────────────────────────────

export interface MmExposureInput {
  gex: number | null;            // dollar gamma per 1% move (positive = vol-dampening)
  dex: number | null;            // dealer net delta in shares
  putCallOi: number | null;      // put/call OI ratio (low = bullish)
  putCallVol: number | null;     // put/call volume ratio (low = bullish)
  spotPrice: number | null;
  callWall: number | null;       // strike with max + GEX
  putWall: number | null;        // strike with max - GEX
}

export interface TechnicalInput {
  rsi14: number | null;          // 0..100
  macdHistogram: number | null;  // negative through positive
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  bollingerPctB: number | null;  // %B: 0 = lower band, 1 = upper band
  spotPrice: number | null;
}

export interface ConvictionInputs {
  snapshot: CompanySnapshot;
  mm: MmExposureInput | null;
  tech: TechnicalInput | null;
  fundamentalScore0to10: number | null;  // existing 8-factor weighted score
}

// ─── Outputs ───────────────────────────────────────────────────────────────

export interface AxisComponent {
  label: string;
  value: number | null;
  contribution: number;          // -100..+100 contribution to this axis
  direction: "bullish" | "bearish" | "neutral";
}

export interface AxisScore {
  score: number;                 // -100..+100
  weight: number;                // 0..1, "how much to trust this axis given the data we had"
  components: AxisComponent[];
  notes: string[];
}

export type ConvictionVerdict =
  | "ALL_ALIGNED_BULLISH"
  | "MOSTLY_BULLISH"
  | "DIVERGENT"
  | "MOSTLY_BEARISH"
  | "ALL_ALIGNED_BEARISH"
  | "WEAK_SIGNAL";

export interface ConvictionCompass {
  ticker: string;
  asOf: number;
  schemaVersion: 1;

  smartMoneyFlow: AxisScore;
  dealerPositioning: AxisScore;
  technicalMomentum: AxisScore;
  fundamentalQuality: AxisScore;

  /**
   * -100..+100. Magnitude reflects strength of confluence; sign reflects
   * net direction. Constructed so divergence (axes disagreeing in sign)
   * pulls the score toward 0 even when individual axes are extreme.
   */
  confluence: number;

  /**
   * 0..1. Pure measure of "how aligned are the four axes." 1.0 means all
   * four point the same direction with similar magnitudes; 0 means they
   * cancel out or split evenly. Independent of overall direction.
   */
  alignment: number;

  /**
   * Plain-language verdict for the UI badge.
   */
  verdict: ConvictionVerdict;

  /**
   * Reflects data completeness — if any axis had to be guessed because its
   * inputs were missing, confidence drops.
   */
  confidence: "HIGH" | "MODERATE" | "LOW";
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Round a number to at most 2 decimal places, preserving null. We send
 *  pre-rounded values so the UI layer never has to deal with full-precision
 *  doubles cluttering the table cells. */
function r2(n: number | null | undefined): number | null {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return null;
  return Number(Number(n).toFixed(2));
}

function dirOf(score: number): "bullish" | "bearish" | "neutral" {
  if (score >= 15) return "bullish";
  if (score <= -15) return "bearish";
  return "neutral";
}

function weightedAvg(parts: Array<{ value: number; weight: number }>): number {
  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  if (totalWeight === 0) return 0;
  return parts.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight;
}

// ─── Axis: Smart Money Flow ────────────────────────────────────────────────

function computeSmartMoneyFlow(snap: CompanySnapshot): AxisScore {
  const ownership = snap.ownership.value;
  const ownershipSource = snap.ownership.source;
  const insider = snap.insiderActivity.value;
  const components: AxisComponent[] = [];
  const notes: string[] = [];
  const parts: Array<{ value: number; weight: number }> = [];

  // Institutional QoQ flow score is only trustworthy when EDGAR is the
  // authoritative source. On Yahoo fallback the snapshot suppresses
  // flowScore to 0 to avoid publishing fake STRONG OUTFLOW signals from
  // Yahoo's name-matching artifacts — so the value is meaningless to the
  // compass as well. Drop the component from the weighted average
  // entirely instead of letting a suppressed-zero dilute the axis toward
  // neutral. This way an insider-driven signal of -90 reads as -90, not
  // as -36 (60% diluted with a fake zero).
  const qoqAuthoritative = ownershipSource === "edgar";
  if (qoqAuthoritative && ownership && typeof ownership.flowScore === "number") {
    const v = clamp(ownership.flowScore, -100, 100);
    components.push({
      label: "Institutional QoQ flow",
      value: ownership.flowScore,
      contribution: v,
      direction: dirOf(v),
    });
    parts.push({ value: v, weight: 0.6 });
  } else {
    components.push({ label: "Institutional QoQ flow", value: null, contribution: 0, direction: "neutral" });
    if (ownership && ownershipSource && ownershipSource !== "edgar") {
      notes.push(`QoQ flow unavailable while EDGAR re-warms (currently via ${ownershipSource}) — axis based on insider activity only.`);
    } else {
      notes.push("Institutional flow unavailable — axis weight reduced.");
    }
  }

  // Insider net activity, normalized: each net buy/sell action ±10, capped ±100
  if (insider) {
    const net = (insider.buyCount || 0) - (insider.sellCount || 0);
    const v = clamp(net * 10, -100, 100);
    components.push({
      label: "Insider net buys − sells (180d)",
      value: net,
      contribution: v,
      direction: dirOf(v),
    });
    parts.push({ value: v, weight: 0.4 });
  } else {
    components.push({ label: "Insider net activity", value: null, contribution: 0, direction: "neutral" });
    notes.push("Insider activity unavailable — axis weight reduced.");
  }

  const score = parts.length ? weightedAvg(parts) : 0;
  const weight = parts.reduce((s, p) => s + p.weight, 0); // 0..1.0
  return { score: Math.round(score), weight, components, notes };
}

// ─── Axis: Dealer Positioning ──────────────────────────────────────────────

function computeDealerPositioning(mm: MmExposureInput | null): AxisScore {
  const components: AxisComponent[] = [];
  const notes: string[] = [];
  const parts: Array<{ value: number; weight: number }> = [];

  if (!mm || (mm.gex === null && mm.dex === null && mm.putCallOi === null)) {
    return {
      score: 0, weight: 0,
      components: [
        { label: "Gamma exposure (GEX)", value: null, contribution: 0, direction: "neutral" },
        { label: "Distance to gamma walls", value: null, contribution: 0, direction: "neutral" },
        { label: "Put/Call OI ratio", value: null, contribution: 0, direction: "neutral" },
      ],
      notes: ["No options data available — dealer positioning unscored."],
    };
  }

  // GEX regime: positive gamma → dealers dampening volatility (bullish for
  // grind-up trends); negative gamma → amplifying (volatility expansion,
  // bearish bias for trend-followers).
  if (mm.gex !== null) {
    const v = mm.gex > 0 ? 30 : -30;
    components.push({
      label: "Gamma exposure regime",
      value: mm.gex,
      contribution: v,
      direction: dirOf(v),
    });
    parts.push({ value: v, weight: 0.35 });
  }

  // Distance to walls: spot near call wall = pinned bullish, near put wall = bearish
  if (mm.spotPrice && mm.callWall && mm.putWall) {
    const distToCall = Math.abs(mm.spotPrice - mm.callWall);
    const distToPut = Math.abs(mm.spotPrice - mm.putWall);
    // -100 if at put wall, +100 if at call wall, 0 in middle
    const range = (mm.callWall - mm.putWall) || 1;
    const v = clamp(((mm.spotPrice - (mm.callWall + mm.putWall) / 2) / range) * 200, -100, 100);
    components.push({
      label: "Spot vs gamma walls",
      value: r2(v),
      contribution: Math.round(v),
      direction: dirOf(v),
    });
    parts.push({ value: v, weight: 0.35 });
    if (distToCall < distToPut * 0.3) notes.push("Spot pinned near call wall — squeeze risk if breached.");
    if (distToPut < distToCall * 0.3) notes.push("Spot pinned near put wall — break risk if broken.");
  }

  // Put/Call OI: 1.0 = balanced, <0.7 = bullish skew, >1.3 = bearish skew
  if (mm.putCallOi !== null) {
    // Map: 0.5 → +60, 1.0 → 0, 1.5 → -60, 2.0 → -100
    const v = clamp((1.0 - mm.putCallOi) * 120, -100, 100);
    components.push({
      label: "Put/Call OI ratio",
      value: r2(mm.putCallOi),
      contribution: Math.round(v),
      direction: dirOf(v),
    });
    parts.push({ value: v, weight: 0.3 });
  }

  const score = parts.length ? weightedAvg(parts) : 0;
  const weight = parts.reduce((s, p) => s + p.weight, 0);
  return { score: Math.round(score), weight, components, notes };
}

// ─── Axis: Technical Momentum ──────────────────────────────────────────────

function computeTechnicalMomentum(tech: TechnicalInput | null): AxisScore {
  const components: AxisComponent[] = [];
  const notes: string[] = [];
  const parts: Array<{ value: number; weight: number }> = [];

  if (!tech) {
    return {
      score: 0, weight: 0,
      components: [
        { label: "RSI(14)", value: null, contribution: 0, direction: "neutral" },
        { label: "MACD histogram", value: null, contribution: 0, direction: "neutral" },
        { label: "EMA stack alignment", value: null, contribution: 0, direction: "neutral" },
        { label: "Bollinger %B", value: null, contribution: 0, direction: "neutral" },
      ],
      notes: ["No chart available — technical momentum unscored."],
    };
  }

  // RSI distance from 50 — overbought zones still count as bullish momentum
  // until confirmed reversal; we let RSI > 80 / < 20 stay extreme.
  if (tech.rsi14 !== null) {
    const v = clamp((tech.rsi14 - 50) * 2, -100, 100);
    components.push({
      label: "RSI(14)",
      value: r2(tech.rsi14),
      contribution: Math.round(v),
      direction: dirOf(v),
    });
    parts.push({ value: v, weight: 0.25 });
  }

  // MACD histogram sign — positive = trend up, negative = trend down
  if (tech.macdHistogram !== null && tech.spotPrice) {
    // Normalize as % of spot — typical values are <1% of price
    const pct = (tech.macdHistogram / tech.spotPrice) * 100;
    const v = clamp(pct * 50, -100, 100); // 2% histogram → ±100
    components.push({
      label: "MACD histogram",
      value: r2(tech.macdHistogram),
      contribution: Math.round(v),
      direction: dirOf(v),
    });
    parts.push({ value: v, weight: 0.3 });
  }

  // EMA stack: 9 > 21 > 50 (perfect bullish stack) = +75, reverse = -75
  if (tech.ema9 !== null && tech.ema21 !== null && tech.ema50 !== null) {
    const stackBull = tech.ema9 > tech.ema21 && tech.ema21 > tech.ema50;
    const stackBear = tech.ema9 < tech.ema21 && tech.ema21 < tech.ema50;
    const v = stackBull ? 75 : stackBear ? -75 : 0;
    components.push({
      label: "EMA(9/21/50) stack",
      value: stackBull ? 1 : stackBear ? -1 : 0,
      contribution: v,
      direction: dirOf(v),
    });
    parts.push({ value: v, weight: 0.25 });
  }

  // Bollinger %B: above 1 = breakout, below 0 = breakdown, 0.5 = mid
  if (tech.bollingerPctB !== null) {
    const v = clamp((tech.bollingerPctB - 0.5) * 200, -100, 100);
    components.push({
      label: "Bollinger %B",
      value: r2(tech.bollingerPctB),
      contribution: Math.round(v),
      direction: dirOf(v),
    });
    parts.push({ value: v, weight: 0.2 });
  }

  const score = parts.length ? weightedAvg(parts) : 0;
  const weight = parts.reduce((s, p) => s + p.weight, 0);
  return { score: Math.round(score), weight, components, notes };
}

// ─── Axis: Fundamental Quality ─────────────────────────────────────────────

function computeFundamentalQuality(score0to10: number | null): AxisScore {
  if (score0to10 === null) {
    return {
      score: 0, weight: 0,
      components: [{ label: "8-factor verdict score", value: null, contribution: 0, direction: "neutral" }],
      notes: ["Verdict score unavailable."],
    };
  }
  // Map 0..10 verdict scale to -100..+100 conviction scale.
  // 5.5 (the SPECULATIVE/HIGH-RISK boundary) anchors at 0.
  // 8.5 (STRONG CONVICTION threshold) → +75.
  // 4.0 → -50, 2.0 → -100, 9.5 → +100.
  const score = clamp((score0to10 - 5.5) * 25, -100, 100);
  return {
    score: Math.round(score),
    weight: 1.0,
    components: [{
      label: "8-factor verdict score (0–10)",
      value: score0to10,
      contribution: Math.round(score),
      direction: dirOf(score),
    }],
    notes: [],
  };
}

// ─── Confluence aggregator ─────────────────────────────────────────────────

function computeConfluence(axes: AxisScore[]): { confluence: number; alignment: number } {
  // Use only axes with non-zero data weight
  const live = axes.filter(a => a.weight > 0);
  if (live.length === 0) return { confluence: 0, alignment: 0 };

  // Sign agreement: +1 / 0 / -1 per axis
  const signs = live.map(a => (a.score >= 15 ? 1 : a.score <= -15 ? -1 : 0));
  const nonNeutral = signs.filter(s => s !== 0);
  const netSign = signs.reduce((s, v) => s + v, 0); // -4..+4

  // Alignment: 1 if all non-neutral axes agree in sign, 0 if they cancel.
  let alignment = 0;
  if (nonNeutral.length > 0) {
    const dominant = Math.abs(netSign);
    const total = nonNeutral.length;
    alignment = dominant / total; // 0..1
  }

  // Magnitude: weighted average of |score| across live axes
  const magnitude = weightedAvg(live.map(a => ({ value: Math.abs(a.score), weight: a.weight })));

  // Confluence: alignment-penalized magnitude, signed by net direction.
  // - alignment=1 (all agree) → magnitude passes through
  // - alignment=0.5 (split) → magnitude halved
  // - alignment=0 (fully canceled) → 0
  const direction = netSign === 0 ? 0 : Math.sign(netSign);
  const confluence = clamp(direction * magnitude * alignment, -100, 100);

  return { confluence: Math.round(confluence), alignment: Number(alignment.toFixed(2)) };
}

function classifyVerdict(axes: AxisScore[], confluence: number): ConvictionVerdict {
  const live = axes.filter(a => a.weight > 0);
  if (live.length === 0) return "WEAK_SIGNAL";

  const bullish = live.filter(a => a.score >= 15).length;
  const bearish = live.filter(a => a.score <= -15).length;
  const total = live.length;

  if (bullish === total && confluence >= 50) return "ALL_ALIGNED_BULLISH";
  if (bearish === total && confluence <= -50) return "ALL_ALIGNED_BEARISH";
  if (bullish >= Math.max(2, total - 1) && bearish === 0) return "MOSTLY_BULLISH";
  if (bearish >= Math.max(2, total - 1) && bullish === 0) return "MOSTLY_BEARISH";
  if (bullish > 0 && bearish > 0) return "DIVERGENT";
  return "WEAK_SIGNAL";
}

function classifyConfidence(axes: AxisScore[]): "HIGH" | "MODERATE" | "LOW" {
  const live = axes.filter(a => a.weight > 0).length;
  if (live === 4) return "HIGH";
  if (live >= 2) return "MODERATE";
  return "LOW";
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export function computeConvictionCompass(inputs: ConvictionInputs): ConvictionCompass {
  const smartMoneyFlow = computeSmartMoneyFlow(inputs.snapshot);
  const dealerPositioning = computeDealerPositioning(inputs.mm);
  const technicalMomentum = computeTechnicalMomentum(inputs.tech);
  const fundamentalQuality = computeFundamentalQuality(inputs.fundamentalScore0to10);

  const axes = [smartMoneyFlow, dealerPositioning, technicalMomentum, fundamentalQuality];
  const { confluence, alignment } = computeConfluence(axes);
  const verdict = classifyVerdict(axes, confluence);
  const confidence = classifyConfidence(axes);

  return {
    ticker: inputs.snapshot.ticker,
    asOf: Date.now(),
    schemaVersion: 1,
    smartMoneyFlow,
    dealerPositioning,
    technicalMomentum,
    fundamentalQuality,
    confluence,
    alignment,
    verdict,
    confidence,
  };
}
