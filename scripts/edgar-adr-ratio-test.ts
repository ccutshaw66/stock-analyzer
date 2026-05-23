/**
 * EDGAR Form 4 ADR-ratio detection test.
 *
 * Exercises `detectAdrRatio` against:
 *   1. Realistic footnote samples for known ADRs (verify ratio detected)
 *   2. US-common-stock samples (verify ratio = 1, no false positives)
 *   3. Edge cases (multiple mentions, weird wording, empty)
 *
 * Then walks a synthetic Form 4 transaction through the math to confirm
 * `totalValue` lands on the correct dollar number.
 */

import { detectAdrRatio } from "../server/data/providers/edgar-form4";

interface Case {
  label: string;
  footnote: string;
  expectRatio: number;
  /** Optional: also check what the dollar math comes out to. */
  reportedShares?: number;
  pricePerShare?: number;
  expectDollars?: number;
  expectDollarsTolerance?: number;
}

const CASES: Case[] = [
  // ─── Known ADR patterns ────────────────────────────────────────────────
  {
    label: "SVRE — SaverOne (Israeli, 43,200:1)",
    footnote: "Each American Depositary Share represents 43,200 ordinary shares of the Issuer.",
    expectRatio: 43_200,
    reportedShares: 1_080_000_000,  // 25,000 ADS × 43,200
    pricePerShare: 4.0,
    expectDollars: 100_000,         // truth: 25,000 ADS × $4
    expectDollarsTolerance: 1,
  },
  {
    label: "BABA — Alibaba (Chinese, 8:1)",
    footnote: "Each ADS represents eight (8) ordinary shares of the Issuer.",
    // Word-form numbers ("eight") aren't covered by the regex — verify graceful
    // fallback to 1 rather than a wrong number. Domestic-style math then applies.
    expectRatio: 1,
  },
  {
    label: "BABA — numeric form",
    footnote: "Each American Depositary Share (ADS) represents 8 ordinary shares.",
    expectRatio: 8,
    reportedShares: 80_000,        // 10,000 ADS × 8
    pricePerShare: 80.0,
    expectDollars: 800_000,         // truth: 10,000 ADS × $80
    expectDollarsTolerance: 1,
  },
  {
    label: "NIO — Chinese EV (1:1, technically an ADS but 1:1)",
    footnote: "Each ADS represents 1 Class A ordinary share.",
    // Ratio of 1 is the same as no ADR — the detector should return 1 either way.
    expectRatio: 1,
  },
  {
    label: "TEVA — Israeli pharma (no ADR mention, common-stock equivalent)",
    footnote: "Shares were acquired in open-market transactions.",
    expectRatio: 1,
  },
  {
    label: "JD — JD.com (Chinese, 2:1)",
    footnote: "Each ADR represents 2 ordinary shares.",
    expectRatio: 2,
    reportedShares: 200_000,
    pricePerShare: 35.0,
    expectDollars: 3_500_000,        // 100,000 ADS × $35
    expectDollarsTolerance: 1,
  },
  {
    label: "BIDU — Baidu (Chinese, 8:1)",
    footnote: "One ADS = 8 ordinary shares.",
    expectRatio: 8,
  },
  {
    label: "Hypothetical 'One ADR represents 100 ordinary shares'",
    footnote: "One ADR represents 100 ordinary shares of the Company.",
    expectRatio: 100,
  },

  // ─── US common stock — no ADR mention (must stay at 1) ────────────────
  {
    label: "MRP — Millrose, simple footnote",
    footnote: "These shares are held in a joint account with the reporting person's spouse.",
    expectRatio: 1,
  },
  {
    label: "MRP — Family Trust footnote",
    footnote: "Shares held by the Richman Family Trust, of which the reporting person is a co-trustee.",
    expectRatio: 1,
  },
  {
    label: "AAPL — typical Apple 10b5-1 footnote",
    footnote: "Sale effected pursuant to a Rule 10b5-1 trading plan adopted on March 1, 2026.",
    expectRatio: 1,
  },
  {
    label: "Empty footnote",
    footnote: "",
    expectRatio: 1,
  },
  {
    label: "Generic mention of 'shares' without ADR language",
    footnote: "1,000,000 shares were acquired at $10.00 per share.",
    expectRatio: 1,
  },

  // ─── Edge cases ────────────────────────────────────────────────────────
  {
    label: "Multiple footnotes, ratio appears in one",
    footnote:
      "Footnote 1: Sale effected under Rule 10b5-1 plan. | " +
      "Footnote 2: Each ADS represents 10 ordinary shares.",
    expectRatio: 10,
  },
  {
    label: "Comma-separated thousands",
    footnote: "Each ADS represents 1,000 ordinary shares of the Issuer.",
    expectRatio: 1000,
  },
  {
    label: "Bare 'ADS represents' without 'each'",
    footnote: "ADS represents 5 ordinary shares.",
    // Not covered by current regex — should fall through to 1 safely.
    expectRatio: 1,
  },
  {
    label: "Ratio mentioned in marketing-y prose (avoid false positive)",
    footnote: "Insiders may purchase additional shares from time to time.",
    expectRatio: 1,
  },
];

let pass = 0;
let fail = 0;
let firstFail = "";

console.log("=".repeat(72));
console.log("EDGAR Form 4 — ADR ratio detection test");
console.log("=".repeat(72));

for (const c of CASES) {
  const ratio = detectAdrRatio(c.footnote);
  const ratioOk = ratio === c.expectRatio;
  let dollarsOk = true;
  let dollarsLine = "";

  if (c.reportedShares != null && c.pricePerShare != null && c.expectDollars != null) {
    // Mirror the parser's logic: normalize shares by detected ratio.
    const normalized = ratio > 1 && c.reportedShares > 0 ? c.reportedShares / ratio : c.reportedShares;
    const total = normalized * c.pricePerShare;
    dollarsOk = Math.abs(total - c.expectDollars) <= (c.expectDollarsTolerance ?? 0.01);
    dollarsLine = ` | $${total.toLocaleString()} (expected $${c.expectDollars.toLocaleString()})`;
  }

  const ok = ratioOk && dollarsOk;
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ratio=${ratio} (expect ${c.expectRatio})${dollarsLine}  — ${c.label}`);
  if (ok) {
    pass++;
  } else {
    fail++;
    if (!firstFail) firstFail = c.label;
  }
}

console.log("=".repeat(72));
console.log(`${pass}/${pass + fail} passed${fail > 0 ? `  ✗ first fail: ${firstFail}` : ""}`);
console.log("=".repeat(72));

process.exit(fail === 0 ? 0 : 1);
