/**
 * In-house Black-Scholes options greeks engine.
 *
 * WHY this exists: our Polygon Options Starter plan ($29, 15-min delayed) returns
 * option prices + open interest + snapshots but NO greeks and NO implied vol
 * (verified: /v3/snapshot/options/SPY returns an empty `greeks: {}` block on
 * every contract). MM Exposure / dealer-gamma (server/mm-exposure.ts,
 * server/gamma-tracker.ts) read gamma/delta/iv straight off the contract, so
 * without computed greeks the whole feature is dead. We compute them ourselves.
 *
 * Model: European Black-Scholes (Black-Scholes-Merton with continuous dividend
 * yield q). This is an APPROXIMATION for American equity options — for gamma /
 * GEX and at/near-the-money delta it is more than accurate enough (early-exercise
 * premium is negligible there). It loses precision deep in-the-money, especially
 * for puts near ex-dividend.
 *
 * TODO: a Cox-Ross-Rubinstein binomial model would improve deep-ITM American
 * precision (and dividend/early-exercise handling). Not needed for GEX, which is
 * dominated by near-the-money gamma. Revisit if we ever surface per-contract
 * deep-ITM greeks to users.
 *
 * Conventions:
 *   S     = underlying spot price
 *   K     = strike
 *   T     = time to expiry in YEARS (e.g. 7 calendar days = 7/365)
 *   r     = continuously-compounded risk-free rate (decimal, e.g. 0.045)
 *   sigma = implied volatility (decimal, e.g. 0.20 = 20% annualized)
 *   type  = "call" | "put"
 *   q     = continuous dividend yield (decimal, default 0)
 *
 * Greeks returned use standard per-1-unit conventions:
 *   delta  — d(price)/d(S)              (calls 0..1, puts -1..0)
 *   gamma  — d^2(price)/d(S)^2          (per $1 of S; same for calls & puts)
 *   vega   — d(price)/d(sigma) per 1.00 vol  (divide by 100 for "per 1% vol")
 *   theta  — d(price)/d(T) per YEAR     (negative for long options; /365 = per day)
 */

/** Risk-free rate fallback when no live treasury rate is available (~3-month
 *  T-bill territory). Single named constant so it's trivial to change. */
export const DEFAULT_RISK_FREE_RATE = 0.045;

/** Sane IV solver bounds. Anything outside this is treated as non-convergent. */
const IV_MIN = 0.01;   // 1% annualized
const IV_MAX = 5.0;    // 500% annualized (junk/illiquid)

export type OptionType = "call" | "put";

export interface Greeks {
  delta: number;
  gamma: number;
  vega: number;  // per 1.00 change in vol
  theta: number; // per year
  iv: number;    // the sigma used (echoed back for convenience)
}

// ─── Standard normal helpers ──────────────────────────────────────────────────

/** Standard normal PDF. */
function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Standard normal CDF via Abramowitz & Stegun 7.1.26 (max abs error ~7.5e-8). */
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = normPdf(x);
  const p =
    d *
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

function d1d2(S: number, K: number, T: number, r: number, sigma: number, q: number): [number, number] {
  const vsqrtT = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / vsqrtT;
  const d2 = d1 - vsqrtT;
  return [d1, d2];
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

/**
 * Black-Scholes-Merton theoretical price. Returns null on degenerate inputs.
 */
export function blackScholesPrice(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  type: OptionType,
  q = 0,
): number | null {
  if (!(S > 0) || !(K > 0) || !(T > 0) || !(sigma > 0)) return null;
  const [d1, d2] = d1d2(S, K, T, r, sigma, q);
  const dfQ = Math.exp(-q * T);
  const dfR = Math.exp(-r * T);
  if (type === "call") {
    return S * dfQ * normCdf(d1) - K * dfR * normCdf(d2);
  }
  return K * dfR * normCdf(-d2) - S * dfQ * normCdf(-d1);
}

// ─── Greeks (given sigma) ──────────────────────────────────────────────────────

/**
 * Black-Scholes greeks for a known sigma. Returns null on degenerate inputs.
 */
export function blackScholesGreeks(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  type: OptionType,
  q = 0,
): Greeks | null {
  if (!(S > 0) || !(K > 0) || !(T > 0) || !(sigma > 0)) return null;
  const [d1, d2] = d1d2(S, K, T, r, sigma, q);
  const dfQ = Math.exp(-q * T);
  const dfR = Math.exp(-r * T);
  const pdfD1 = normPdf(d1);
  const sqrtT = Math.sqrt(T);

  // Gamma is identical for calls and puts.
  const gamma = (dfQ * pdfD1) / (S * sigma * sqrtT);
  // Vega per 1.00 vol move (identical calls/puts).
  const vega = S * dfQ * pdfD1 * sqrtT;

  let delta: number;
  let theta: number;
  if (type === "call") {
    delta = dfQ * normCdf(d1);
    theta =
      -(S * dfQ * pdfD1 * sigma) / (2 * sqrtT) -
      r * K * dfR * normCdf(d2) +
      q * S * dfQ * normCdf(d1);
  } else {
    delta = -dfQ * normCdf(-d1);
    theta =
      -(S * dfQ * pdfD1 * sigma) / (2 * sqrtT) +
      r * K * dfR * normCdf(-d2) -
      q * S * dfQ * normCdf(-d1);
  }

  if (![delta, gamma, vega, theta].every(Number.isFinite)) return null;
  return { delta, gamma, vega, theta, iv: sigma };
}

// ─── Implied vol (invert BS for sigma given a market price) ─────────────────────

/**
 * Solve for implied volatility from an observed option price.
 *
 * Newton-Raphson (fast) with a bisection fallback (robust). Returns null if the
 * inputs are degenerate, the price is below intrinsic (arbitrage / stale quote),
 * or the solver can't land inside [IV_MIN, IV_MAX].
 */
export function impliedVolFromPrice(
  optionPrice: number,
  S: number,
  K: number,
  T: number,
  r: number,
  type: OptionType,
  q = 0,
): number | null {
  if (!(optionPrice > 0) || !(S > 0) || !(K > 0) || !(T > 0)) return null;

  // Reject prices below intrinsic value (no real sigma can produce them — the
  // quote is stale or crossed). Use forward intrinsic with discounting.
  const dfQ = Math.exp(-q * T);
  const dfR = Math.exp(-r * T);
  const intrinsic =
    type === "call"
      ? Math.max(0, S * dfQ - K * dfR)
      : Math.max(0, K * dfR - S * dfQ);
  if (optionPrice < intrinsic - 1e-6) return null;
  // Above the no-arb upper bound is also junk (call <= S, put <= K discounted).
  const upperBound = type === "call" ? S * dfQ : K * dfR;
  if (optionPrice > upperBound + 1e-6) return null;

  const priceAt = (sigma: number) => blackScholesPrice(S, K, T, r, sigma, type, q);

  // ── Newton-Raphson from a vol-of-vol seed ──
  let sigma = Math.min(IV_MAX, Math.max(IV_MIN,
    // Brenner-Subrahmanyam ATM seed: sigma ≈ price/S * sqrt(2π/T)
    (optionPrice / S) * Math.sqrt((2 * Math.PI) / T)));
  for (let i = 0; i < 50; i++) {
    const p = priceAt(sigma);
    if (p === null) break;
    const g = blackScholesGreeks(S, K, T, r, sigma, type, q);
    const vega = g?.vega ?? 0;
    const diff = p - optionPrice;
    if (Math.abs(diff) < 1e-6) {
      return sigma >= IV_MIN && sigma <= IV_MAX ? sigma : null;
    }
    if (!(Math.abs(vega) > 1e-8)) break; // vega too small — bail to bisection
    let next = sigma - diff / vega;
    if (!Number.isFinite(next)) break;
    // Keep the iterate inside bounds so it can't run away.
    next = Math.min(IV_MAX, Math.max(IV_MIN, next));
    if (Math.abs(next - sigma) < 1e-7) {
      sigma = next;
      const pf = priceAt(sigma);
      if (pf !== null && Math.abs(pf - optionPrice) < 1e-4) return sigma;
      break;
    }
    sigma = next;
  }

  // ── Bisection fallback over [IV_MIN, IV_MAX] ──
  let lo = IV_MIN;
  let hi = IV_MAX;
  const pLo = priceAt(lo);
  const pHi = priceAt(hi);
  if (pLo === null || pHi === null) return null;
  // Price is monotonically increasing in sigma; if target is outside, no root.
  if (optionPrice < pLo - 1e-6 || optionPrice > pHi + 1e-6) return null;
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi);
    const pm = priceAt(mid);
    if (pm === null) return null;
    const diff = pm - optionPrice;
    if (Math.abs(diff) < 1e-6 || hi - lo < 1e-7) {
      return mid >= IV_MIN && mid <= IV_MAX ? mid : null;
    }
    if (diff > 0) hi = mid;
    else lo = mid;
  }
  const result = 0.5 * (lo + hi);
  return result >= IV_MIN && result <= IV_MAX ? result : null;
}

/**
 * One-shot convenience: solve IV from price, then return the full greek set.
 * Returns null if IV can't be recovered (illiquid / stale / arbitrage price).
 */
export function greeksFromPrice(
  optionPrice: number,
  S: number,
  K: number,
  T: number,
  r: number,
  type: OptionType,
  q = 0,
): Greeks | null {
  const iv = impliedVolFromPrice(optionPrice, S, K, T, r, type, q);
  if (iv === null) return null;
  return blackScholesGreeks(S, K, T, r, iv, type, q);
}
