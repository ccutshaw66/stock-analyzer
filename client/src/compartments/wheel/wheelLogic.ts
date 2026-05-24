/**
 * Pure logic layer for the Wheel compartment.
 *
 * No React, no fetch, no vendor calls. All wheel math lives here so the
 * Full view, Widget, and any future caller (alert preview, share image,
 * future API endpoint) compute identically. Per the compartment contract
 * (Phase 1B), this is the "pure logic layer" guarantee.
 */

export interface WheelInputs {
  stockPrice: number;
  putStrike: number;
  putPremium: number;
  callStrike: number;
  callPremium: number;
  dte: number;
  contracts: number;
  accountValue: number;
}

export interface WheelMetrics {
  shares: number;
  capitalAtRisk: number;
  assignmentCostBasis: number;
  putReturnPct: number;
  putAnnualized: number;
  callCycleReturn: number;
  callAnnualized: number;
  breakEven: number;
  maxLossPerShare: number;
  maxLossTotal: number;
  premiumIncomePerCycle: number;
  fullCycleReturn: number;
  fullCycleAnnualized: number;
  percentOfAccount: number;
}

export interface WheelChartPoint {
  price: number;
  putPL: number;
  wheelPL: number;
}

export interface WheelHealthFlag {
  label: string;
  ok: boolean;
  detail: string;
}

export interface WheelHealth {
  flags: WheelHealthFlag[];
  score: number;
}

export function calcWheelMetrics(i: WheelInputs): WheelMetrics {
  const shares = i.contracts * 100;
  const capitalAtRisk = i.putStrike * shares;
  const assignmentCostBasis = i.putStrike - i.putPremium;

  const putReturnPct = (i.putPremium / i.putStrike) * 100;
  const putAnnualized = i.dte > 0 ? (putReturnPct * 365) / i.dte : 0;

  const callCycleReturn =
    ((i.callPremium + (i.callStrike - assignmentCostBasis)) / assignmentCostBasis) * 100;
  const callAnnualized = i.dte > 0 ? (callCycleReturn * 365) / i.dte : 0;

  const breakEven = assignmentCostBasis;
  const maxLossPerShare = assignmentCostBasis;
  const maxLossTotal = maxLossPerShare * shares;

  const premiumIncomePerCycle = (i.putPremium + i.callPremium) * shares;
  const cycleDays = i.dte * 2;
  const fullCycleReturn =
    ((i.callPremium * shares + i.putPremium * shares + (i.callStrike - i.putStrike) * shares) /
      capitalAtRisk) *
    100;
  const fullCycleAnnualized = cycleDays > 0 ? (fullCycleReturn * 365) / cycleDays : 0;

  const percentOfAccount = i.accountValue > 0 ? (capitalAtRisk / i.accountValue) * 100 : 0;

  return {
    shares, capitalAtRisk, assignmentCostBasis,
    putReturnPct, putAnnualized,
    callCycleReturn, callAnnualized,
    breakEven, maxLossPerShare, maxLossTotal,
    premiumIncomePerCycle, fullCycleReturn, fullCycleAnnualized,
    percentOfAccount,
  };
}

export function calcWheelChart(i: WheelInputs, metrics: WheelMetrics): WheelChartPoint[] {
  const points: WheelChartPoint[] = [];
  const low = Math.max(0, i.stockPrice * 0.6);
  const high = i.stockPrice * 1.4;
  const steps = 60;
  const shares = metrics.shares;
  const cb = metrics.assignmentCostBasis;

  for (let k = 0; k <= steps; k++) {
    const price = low + ((high - low) * k) / steps;

    // CSP leg only
    const putPL = price >= i.putStrike
      ? i.putPremium * shares
      : (price - i.putStrike + i.putPremium) * shares;

    // Full wheel (post-assignment, covered call phase)
    const wheelPL = price >= i.callStrike
      ? ((i.callStrike - cb) + i.callPremium) * shares
      : ((price - cb) + i.callPremium) * shares;

    points.push({
      price: Math.round(price * 100) / 100,
      putPL: Math.round(putPL * 100) / 100,
      wheelPL: Math.round(wheelPL * 100) / 100,
    });
  }
  return points;
}

export function calcWheelHealth(i: WheelInputs, metrics: WheelMetrics): WheelHealth {
  const flags: WheelHealthFlag[] = [];

  flags.push({
    label: "Put strike below stock price",
    ok: i.putStrike < i.stockPrice,
    detail: i.putStrike < i.stockPrice
      ? `Strike $${i.putStrike} is ${(((i.stockPrice - i.putStrike) / i.stockPrice) * 100).toFixed(1)}% OTM`
      : `Strike $${i.putStrike} is at or above $${i.stockPrice} — not a cash-secured put`,
  });

  flags.push({
    label: "Call strike above cost basis",
    ok: i.callStrike > metrics.assignmentCostBasis,
    detail: i.callStrike > metrics.assignmentCostBasis
      ? `$${i.callStrike} > cost basis $${metrics.assignmentCostBasis.toFixed(2)} → guaranteed profit if called`
      : `$${i.callStrike} ≤ cost basis $${metrics.assignmentCostBasis.toFixed(2)} → you'd lock in a loss if called away`,
  });

  flags.push({
    label: "Put annualized yield > 10%",
    ok: metrics.putAnnualized > 10,
    detail: `${metrics.putAnnualized.toFixed(1)}% annualized (${metrics.putReturnPct.toFixed(2)}% over ${i.dte}d)`,
  });

  flags.push({
    label: "Capital at risk < 25% of account",
    ok: metrics.percentOfAccount < 25,
    detail: `Using $${metrics.capitalAtRisk.toLocaleString()} (${metrics.percentOfAccount.toFixed(1)}% of account)`,
  });

  flags.push({
    label: "Days to expiration in sweet spot (21–45)",
    ok: i.dte >= 21 && i.dte <= 45,
    detail: i.dte < 21
      ? `${i.dte} DTE is short — gamma risk is high`
      : i.dte > 45
        ? `${i.dte} DTE is long — theta decay slow, capital tied up`
        : `${i.dte} DTE — good theta/gamma balance`,
  });

  const pass = flags.filter(f => f.ok).length;
  const score = Math.round((pass / flags.length) * 100);
  return { flags, score };
}

/** Default sample setup — used by the widget and by the page's initial state. */
export const DEFAULT_WHEEL_INPUTS: WheelInputs = {
  stockPrice: 100,
  putStrike: 95,
  putPremium: 1.5,
  callStrike: 105,
  callPremium: 1.5,
  dte: 30,
  contracts: 1,
  accountValue: 25000,
};
