/**
 * Strangle / Volatility Scanner — finds vol trades to express as a strangle.
 *
 * A strangle (OTM call + OTM put) is a pure volatility bet. This ranks the
 * liquid options basket by whether vol is rich (SELL the strangle, collect
 * premium) or cheap (BUY the strangle, pay for a move), using the SAME dealer-
 * gamma + IV data the gamma collector already pulls — one source of truth, no
 * new Polygon calls. Reads the latest gamma snapshot (data/gamma-snapshots/).
 *
 * Verdict logic (variance-risk-premium thesis — see gamma research memo):
 *   - SELL strangle: IV rich (high cross-sectional rank) AND dealers LONG gamma
 *     (GEX>0, vol suppressed) → vol likely to contract, you keep the premium.
 *     This is the validated lean (selling vol on positive gamma).
 *   - BUY strangle: IV cheap (low rank) AND dealers SHORT gamma (GEX<0, vol
 *     amplified) → vol likely to expand, the move pays for the premium.
 *   - else: no clear edge.
 *
 * Per name we price an ≈1-σ strangle (BS at the ATM IV) so the output is real:
 * strikes, total premium, break-evens, and probability the price stays inside
 * them (the short-strangle win zone).
 */
import { readAllGammaSnapshots, type GammaSnapshotRow } from "./gamma-tracker";

const HORIZON_DAYS = 30; // strangle tenor used for expected move + pricing

// ── Black-Scholes (same engine as the Strategy Lab / vol calc) ──────────────
function erf(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const N = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
function d1d2(S: number, K: number, T: number, sig: number) {
  const d1 = (Math.log(S / K) + 0.5 * sig * sig * T) / (sig * Math.sqrt(T));
  return [d1, d1 - sig * Math.sqrt(T)];
}
function bsPrice(S: number, K: number, T: number, sig: number, call: boolean) {
  if (T <= 0 || sig <= 0 || S <= 0 || K <= 0) return Math.max(0, call ? S - K : K - S);
  const [d1, d2] = d1d2(S, K, T, sig);
  return call ? S * N(d1) - K * N(d2) : K * N(-d2) - S * N(-d1);
}
// round a strike to a sensible increment for the price level
const roundStrike = (x: number) => x >= 200 ? Math.round(x / 5) * 5 : x >= 50 ? Math.round(x) : Math.round(x * 2) / 2;

export type StrangleVerdict = "SELL VOL" | "BUY VOL" | "—";

export interface StrangleRow {
  ticker: string;
  spot: number;
  atmIvPct: number;        // ATM implied vol, %
  ivRankPos: number;       // 1 = cheapest IV in the basket
  ivRankPct: number;       // 0..1 cross-sectional percentile
  basketN: number;
  regime: "long-γ" | "short-γ";
  expMoveDollar: number;   // ±1σ move over the horizon, $
  expMovePct: number;      // ±1σ move, %
  putStrike: number;
  callStrike: number;
  premium: number;         // total strangle debit/credit per share (call + put)
  lowerBreakeven: number;
  upperBreakeven: number;
  popInsidePct: number;    // P(price stays between strikes±premium) — short-strangle win zone
  verdict: StrangleVerdict;
  score: number;           // signal strength, 0..100
}

export interface StrangleScan {
  asOf: string | null;
  basketN: number;
  rows: StrangleRow[];
  note?: string;
}

export function getStrangleScan(): StrangleScan {
  const all = readAllGammaSnapshots().filter(s => (s.atmIV ?? 0) > 0 && (s.spot ?? 0) > 0);
  if (all.length === 0) {
    return { asOf: null, basketN: 0, rows: [], note: "No gamma snapshots yet — the gamma collector needs to run (it feeds this scanner)." };
  }
  // latest day only
  const latestDate = all.reduce((a, b) => (b.takenDate > a ? b.takenDate : a), all[0].takenDate);
  const day = all.filter(s => s.takenDate === latestDate);

  // cross-sectional IV rank within the day's basket
  const ivs = day.map(s => s.atmIV as number).sort((a, b) => a - b);
  const n = ivs.length;
  const rankPct = (iv: number) => ivs.filter(x => x <= iv).length / n;
  const rankPos = (iv: number) => ivs.filter(x => x < iv).length + 1;

  const T = HORIZON_DAYS / 365;
  const rows: StrangleRow[] = day.map((s: GammaSnapshotRow) => {
    const spot = s.spot as number;
    const iv = s.atmIV as number;
    const gex = s.totalGEX;
    const ivPct = rankPct(iv);
    const expMove = spot * iv * Math.sqrt(T);
    const callStrike = roundStrike(spot + expMove);
    const putStrike = roundStrike(spot - expMove);
    const premium = bsPrice(spot, callStrike, T, iv, true) + bsPrice(spot, putStrike, T, iv, false);
    const upperBE = callStrike + premium;
    const lowerBE = putStrike - premium;
    // P(price ends between the break-evens) under lognormal — the short-strangle win zone
    const v = iv * Math.sqrt(T);
    const cdf = (P: number) => N((Math.log(P / spot) + 0.5 * v * v) / v);
    const popInside = Math.max(0, Math.min(1, cdf(upperBE) - cdf(lowerBE)));

    // verdict + score
    let verdict: StrangleVerdict = "—";
    let score = 0;
    if (ivPct >= 0.7 && gex > 0) {
      verdict = "SELL VOL";
      score = Math.round((ivPct * 0.7 + 0.3) * 100);           // richer IV → higher
    } else if (ivPct <= 0.3 && gex < 0) {
      verdict = "BUY VOL";
      score = Math.round(((1 - ivPct) * 0.7 + 0.3) * 100);     // cheaper IV → higher
    } else {
      score = Math.round(Math.abs(ivPct - 0.5) * 60);          // weak/no-edge ranking
    }

    return {
      ticker: s.ticker.toUpperCase(),
      spot: +spot.toFixed(2),
      atmIvPct: +(iv * 100).toFixed(1),
      ivRankPos: rankPos(iv),
      ivRankPct: +ivPct.toFixed(2),
      basketN: n,
      regime: gex > 0 ? "long-γ" : "short-γ",
      expMoveDollar: +expMove.toFixed(2),
      expMovePct: +(expMove / spot * 100).toFixed(1),
      putStrike, callStrike,
      premium: +premium.toFixed(2),
      lowerBreakeven: +lowerBE.toFixed(2),
      upperBreakeven: +upperBE.toFixed(2),
      popInsidePct: +(popInside * 100).toFixed(0),
      verdict, score,
    };
  });

  // tradeable verdicts first (by score), then the rest
  rows.sort((a, b) => {
    const rank = (v: StrangleVerdict) => (v === "—" ? 0 : 1);
    if (rank(b.verdict) !== rank(a.verdict)) return rank(b.verdict) - rank(a.verdict);
    return b.score - a.score;
  });

  return { asOf: latestDate, basketN: n, rows };
}
