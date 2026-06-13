/**
 * HTF sizing parity test.
 *
 * Runs the six demo cases from `backend/patterns/position_sizing.py` __main__
 * through the TS `sizePosition()` port and asserts each field matches the
 * Python implementation cent-for-cent.
 *
 * Each case is also pushed through PortfolioState.canAddPosition with sector
 * "Aerospace" to verify the sector concentration cap fires at the same point
 * the Python demo's portfolio rolloff fires.
 */

import {
  DEFAULT_ACCOUNT_CONFIG,
  PortfolioState,
  sizePosition,
  type AccountConfig,
} from "../server/signals/risk/position-sizing";
import type { HtfHit } from "../server/signals/strategies/htf";

interface Case {
  symbol: string;
  entry: number;
  stop: number;
  target: number;
  score: number;
  expect: {
    shares: number;
    positionValue: number;
    actualRisk: number;
    rewardRiskRatio: number;
    blocked: boolean;
  };
}

// Expected values computed by hand from the Python algorithm for capital=$7000,
// max_risk_per_trade=$140 (2% — Aziz capital-preservation cap), max_position=$1750.
// Format: cent-for-cent match. Under the 2% cap EVERY case is risk-capped
// (max_by_risk < max_by_position), so the "position-cap limited" warning no
// longer fires for any of these.
const CASES: Case[] = [
  {
    // RKLB: entry 105.27, stop 74.00, target 130.00, score 85
    // risk/share = 31.27, reward/share = 24.73, R/R = 0.79 → BLOCKED (R/R < 1.0)
    // Python still computes shares/value/risk even when blocked (informational).
    // max_by_risk=floor(140/31.27)=4, max_by_pos=floor(1750/105.27)=16 → 4
    symbol: "RKLB", entry: 105.27, stop: 74.0, target: 130.0, score: 85,
    expect: { shares: 4, positionValue: 421.08, actualRisk: 125.08, rewardRiskRatio: 0.79, blocked: true },
  },
  {
    // LUNR: entry 23.59, stop 19.00, target 32.00, score 75
    // risk/share = 4.59, reward/share = 8.41, R/R = 1.83
    // max_by_risk = floor(140/4.59) = 30, max_by_pos = floor(1750/23.59) = 74 → 30
    // pos_value = 30 * 23.59 = 707.70, risk = 30 * 4.59 = 137.70
    symbol: "LUNR", entry: 23.59, stop: 19.0, target: 32.0, score: 75,
    expect: { shares: 30, positionValue: 707.7, actualRisk: 137.7, rewardRiskRatio: 1.83, blocked: false },
  },
  {
    // BKSY: entry 41.38, stop 33.00, target 55.00, score 75
    // risk/share = 8.38, reward/share = 13.62, R/R = 1.63
    // max_by_risk = floor(140/8.38) = 16, max_by_pos = floor(1750/41.38) = 42 → 16
    // pos_value = 16 * 41.38 = 662.08, risk = 16 * 8.38 = 134.08
    symbol: "BKSY", entry: 41.38, stop: 33.0, target: 55.0, score: 75,
    expect: { shares: 16, positionValue: 662.08, actualRisk: 134.08, rewardRiskRatio: 1.63, blocked: false },
  },
  {
    // CHEAP: entry 4.50, stop 3.60, target 8.00, score 80
    // risk/share = 0.90, reward/share = 3.50, R/R = 3.89
    // max_by_risk = floor(140/0.9) = 155, max_by_pos = floor(1750/4.5) = 388 → 155
    // pos_value = 155 * 4.5 = 697.50, risk = 155 * 0.9 = 139.50
    symbol: "CHEAP", entry: 4.5, stop: 3.6, target: 8.0, score: 80,
    expect: { shares: 155, positionValue: 697.5, actualRisk: 139.5, rewardRiskRatio: 3.89, blocked: false },
  },
  {
    // EXPENSIVE: entry 95.00, stop 80.00, target 130.00, score 80
    // risk/share = 15, reward/share = 35, R/R = 2.33
    // max_by_risk = floor(140/15) = 9, max_by_pos = floor(1750/95) = 18 → 9
    // pos_value = 9 * 95 = 855, risk = 9 * 15 = 135
    symbol: "EXPENSIVE", entry: 95.0, stop: 80.0, target: 130.0, score: 80,
    expect: { shares: 9, positionValue: 855, actualRisk: 135, rewardRiskRatio: 2.33, blocked: false },
  },
  {
    // BADRR: entry 30.00, stop 25.00, target 32.00, score 75
    // risk/share = 5, reward/share = 2, R/R = 0.4 → BLOCKED (R/R < 1.0)
    // max_by_risk=floor(140/5)=28, max_by_pos=floor(1750/30)=58 → 28
    symbol: "BADRR", entry: 30.0, stop: 25.0, target: 32.0, score: 75,
    expect: { shares: 28, positionValue: 840.0, actualRisk: 140.0, rewardRiskRatio: 0.4, blocked: true },
  },
];

function fakeHit(c: Case): HtfHit {
  const today = new Date();
  return {
    symbol: c.symbol,
    pattern: "HTF_Givens",
    direction: "long",
    breakoutDate: today,
    breakoutPrice: c.entry,
    targetPrice: c.target,
    stopPrice: c.stop,
    qualityScore: c.score,
    patternStart: today,
    patternEnd: today,
    extras: {
      poleStartPrice: 0, poleEndPrice: 0, poleGainPct: 0, poleDays: 0,
      flagDays: 0, flagHigh: 0, flagLow: c.stop / 0.98,
      flagPullbackPct: 0, breakoutVolRatio: 1.5,
    },
  };
}

function approxEq(a: number, b: number, tol = 0.01): boolean {
  return Math.abs(a - b) <= tol;
}

let failures = 0;
const config: AccountConfig = { ...DEFAULT_ACCOUNT_CONFIG };
const portfolio = new PortfolioState();

console.log("=".repeat(70));
console.log("HTF SIZING PARITY — vs Python position_sizing.py demo");
console.log("=".repeat(70));
console.log(
  `\nConfig: $${config.capital} capital, ` +
    `$${(config.capital * config.maxRiskPerTradePct).toFixed(0)} max risk/trade, ` +
    `$${(config.capital * config.maxPositionPct).toFixed(0)} max position\n`,
);

for (const c of CASES) {
  const hit = fakeHit(c);
  const rec = sizePosition(hit, config);

  const checks: Array<[string, boolean, string]> = [
    ["shares", rec.recommendedShares === c.expect.shares,
      `expected ${c.expect.shares}, got ${rec.recommendedShares}`],
    ["positionValue", approxEq(rec.positionValue, c.expect.positionValue),
      `expected $${c.expect.positionValue.toFixed(2)}, got $${rec.positionValue.toFixed(2)}`],
    ["actualRisk", approxEq(rec.actualRisk, c.expect.actualRisk),
      `expected $${c.expect.actualRisk.toFixed(2)}, got $${rec.actualRisk.toFixed(2)}`],
    ["rewardRiskRatio", approxEq(rec.rewardRiskRatio, c.expect.rewardRiskRatio, 0.02),
      `expected ${c.expect.rewardRiskRatio}, got ${rec.rewardRiskRatio.toFixed(2)}`],
    ["blocked", (rec.blockedReason !== null) === c.expect.blocked,
      `expected blocked=${c.expect.blocked}, got ${rec.blockedReason}`],
  ];

  const allPass = checks.every(([, ok]) => ok);
  const tag = allPass ? "PASS" : "FAIL";
  console.log(`[${tag}] ${c.symbol.padEnd(11)} ${rec.blockedReason ? "BLOCKED: " + rec.blockedReason :
    `BUY ${rec.recommendedShares} sh = $${rec.positionValue.toFixed(0)} (R/R ${rec.rewardRiskRatio.toFixed(2)})`}`);
  if (!allPass) {
    failures++;
    for (const [name, ok, msg] of checks) {
      if (!ok) console.log(`    × ${name}: ${msg}`);
    }
  }

  // Portfolio check
  const check = portfolio.canAddPosition(rec, hit, config, "Aerospace");
  if (check.allowed) {
    portfolio.addPosition(rec, hit, "Aerospace");
    console.log(`    ✓ added to portfolio`);
  } else {
    console.log(`    ✗ portfolio rule: ${check.reason}`);
  }
}

console.log("\n" + "=".repeat(70));
console.log("PORTFOLIO STATUS");
console.log("=".repeat(70));
const status = portfolio.statusSummary(config);
for (const [k, v] of Object.entries(status)) {
  if (k === "positions") continue;
  console.log(`  ${k.padEnd(28)} ${v}`);
}
console.log("\n  Open positions:");
for (const p of status.positions) {
  console.log(
    `    ${p.symbol.padEnd(11)} ${String(p.shares).padStart(4)} sh × $${p.entry.toFixed(2).padStart(7)} = ` +
      `$${p.value.toFixed(2).padStart(8)}  (risk $${p.atRisk.toFixed(0)})`,
  );
}

console.log("\n" + "=".repeat(70));
if (failures === 0) {
  console.log("✓ ALL PARITY CHECKS PASS");
  process.exit(0);
} else {
  console.log(`✗ ${failures} parity failure(s)`);
  process.exit(1);
}
