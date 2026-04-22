/**
 * SEC EDGAR 13F smoke test.
 *
 * Usage (on server):
 *   ./node_modules/.bin/tsx scripts/edgar-smoke.ts
 *
 * Verifies:
 *   1. Ticker -> CIK lookup works
 *   2. Company basics (shares outstanding) resolved
 *   3. 13F search returns filings
 *   4. Institutional summary has institutionPct in [0, 100]
 *   5. CAR no longer returns 147%
 */

import {
  tickerToCik,
  getCompanyBasics,
  getInstitutionalSummary,
  searchThirteenFFilings,
} from "../server/data/providers/edgar.adapter";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

const results: Check[] = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  const tag = pass ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
  console.log(`  ${tag} ${name} ${DIM}— ${detail}${RESET}`);
}

async function run() {
  console.log(`\n${YELLOW}SEC EDGAR 13F smoke test${RESET}\n`);

  // 1. Ticker -> CIK
  console.log("1) Ticker -> CIK resolution");
  for (const t of ["AAPL", "MSFT", "CAR"]) {
    try {
      const r = await tickerToCik(t);
      record(`cik:${t}`, !!r?.cik, r ? `CIK=${r.cik} (${r.title})` : "not found");
    } catch (e: any) {
      record(`cik:${t}`, false, e?.message ?? "error");
    }
  }

  // 2. Company basics
  console.log("\n2) Company basics (shares outstanding)");
  for (const t of ["AAPL", "CAR"]) {
    try {
      const b = await getCompanyBasics(t);
      const pass = !!b && !!b.sharesOutstanding && b.sharesOutstanding > 0;
      record(
        `basics:${t}`,
        pass,
        b ? `shares=${b.sharesOutstanding?.toLocaleString()} asOf=${b.sharesAsOf}` : "null"
      );
    } catch (e: any) {
      record(`basics:${t}`, false, e?.message ?? "error");
    }
  }

  // 3. 13F search
  console.log("\n3) 13F-HR filing search");
  try {
    const refs = await searchThirteenFFilings("Apple", 20);
    record("search:Apple", refs.length > 0, `${refs.length} filings`);
  } catch (e: any) {
    record("search:Apple", false, e?.message ?? "error");
  }

  // 4. Institutional summary — institutionPct sanity
  console.log("\n4) Institutional summary — institutionPct sanity");
  for (const t of ["AAPL", "MSFT", "CAR"]) {
    try {
      console.log(`   ${DIM}fetching ${t} (slow)...${RESET}`);
      const s = await getInstitutionalSummary(t, 10);
      if (!s) {
        record(`inst:${t}`, false, "null summary");
        continue;
      }
      const okPct = s.institutionPct >= 0 && s.institutionPct <= 100;
      const detail = `pct=${s.institutionPct.toFixed(2)}% holders=${s.institutionCount} top=${s.topHolders.length} asOf=${s.asOf}`;
      record(`inst:${t}`, okPct, detail);
      if (t === "CAR" && s.institutionPct > 100) {
        console.log(`   ${RED}!! CAR still >100% — bug not fixed${RESET}`);
      }
    } catch (e: any) {
      record(`inst:${t}`, false, e?.message ?? "error");
    }
  }

  // Summary
  const passed = results.filter(r => r.pass).length;
  const failed = results.length - passed;
  console.log(
    `\n${passed === results.length ? GREEN : RED}${passed}/${results.length} checks passed${RESET}` +
    (failed ? ` (${failed} failed)` : "")
  );
  process.exit(failed ? 1 : 0);
}

run().catch(e => {
  console.error(`${RED}Smoke crashed:${RESET}`, e);
  process.exit(1);
});
