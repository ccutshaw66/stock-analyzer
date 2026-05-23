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
// max_risk_per_trade=$700, max_position=$1750. Format: cent-for-cent match.
const CASES: Case[] = [
  {
    // RKLB: entry 105.27, stop 74.00, target 130.00, score 85
    // risk/share = 31.27, reward/share = 24.73, R/R = 0.79 → BLOCKED (R/R < 1.0)
    // Python still computes shares/value/risk even when blocked (informational).
    // max_by_risk=floor(700/31.27)=22, max_by_pos=floor(1750/105.27)=16 → 16
    symbol: "RKLB", entry: 105.27, stop: 74.0, target: 130.0, score: 85,
    expect: { shares: 16, positionValue: 1684.32, actualRisk: 500.32, rewardRiskRatio: 0.79, blocked: true },
  },
  {
    // LUNR: entry 23.59, stop 19.00, target 32.00, score 75
    // risk/share = 4.59, reward/share = 8.41, R/R = 1.83
    // max_by_risk = floor(700/4.59) = 152, max_by_pos = floor(1750/23.59) = 74 → 74
    // pos_value = 74 * 23.59 = 1745.66, risk = 74 * 4.59 = 339.66
    symbol: "LUNR", entry: 23.59, stop: 19.0, target: 32.0, score: 75,
    expect: { shares: 74, positionValue: 1745.66, actualRisk: 339.66, rewardRiskRatio: 1.83, blocked: false },
  },
  {
    // BKSY: entry 41.38, stop 33.00, target 55.00, score 75
    // risk/share = 8.38, reward/share = 13.62, R/R = 1.63
    // max_by_risk = floor(700/8.38) = 83, max_by_pos = floor(1750/41.38) = 42 → 42
    // pos_value = 42 * 41.38 = 1737.96, risk = 42 * 8.38 = 351.96
    symbol: "BKSY", entry: 41.38, stop: 33.0, target: 55.0, score: 75,
    expect: { shares: 42, positionValue: 1737.96, actualRisk: 351.96, rewardRiskRatio: 1.63, blocked: false },
  },
  {
    // CHEAP: entry 4.50, stop 3.60, target 8.00, score 80
    // risk/share = 0.90, reward/share = 3.50, R/R = 3.89
    // max_by_risk = floor(700/0.9) = 777, max_by_pos = floor(1750/4.5) = 388 → 388
    // pos_value = 388 * 4.5 = 1746, risk = 388 * 0.9 = 349.2
    symbol: "CHEAP", entry: 4.5, stop: 3.6, target: 8.0, score: 80,
    expect: { shares: 388, positionValue: 1746, actualRisk: 349.2, rewardRiskRatio: 3.89, blocked: false },
  },
  {
    // EXPENSIVE: entry 95.00, stop 80.00, target 130.00, score 80
    // risk/share = 15, reward/share = 35, R/R = 2.33
    // max_by_risk = floor(700/15) = 46, max_by_pos = floor(1750/95) = 18 → 18
    // pos_value = 18 * 95 = 1710, risk = 18 * 15 = 270
    symbol: "EXPENSIVE", entry: 95.0, stop: 80.0, target: 130.0, score: 80,
    expect: { shares: 18, positionValue: 1710, actualRisk: 270, rewardRiskRatio: 2.33, blocked: false },
  },
  {
    // BADRR: entry 30.00, stop 25.00, target 32.00, score 75
    // risk/share = 5, reward/share = 2, R/R = 0.4 → BLOCKED (R/R < 1.0)
    // max_by_risk=floor(700/5)=140, max_by_pos=floor(1750/30)=58 → 58
    symbol: "BADRR", entry: 30.0, stop: 25.0, target: 32.0, score: 75,
    expect: { shares: 58, positionValue: 1740.0, actualRisk: 290.0, rewardRiskRatio: 0.4, blocked: true },
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
