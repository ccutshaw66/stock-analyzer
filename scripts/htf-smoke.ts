/**
 * HTF smoke test — exercises the full pipeline end-to-end on a small basket.
 *
 * Steps:
 *   1. Pull bars from FMP via the cache layer for 5 known tickers
 *   2. Run `scanHtf` on each — verify no exception
 *   3. For each hit, run `sizePosition` — verify no exception
 *   4. Print one-line summary per ticker
 *
 * Exit 0 = no exceptions raised. Exit 1 = any failure.
 *
 * Usage: npm run htf:smoke   (after wiring the script in package.json)
 *        or: npx tsx scripts/htf-smoke.ts
 */

import dotenv from "dotenv";
dotenv.config();

import { getHtfBars } from "../server/data/htf-ohlcv-cache";
import { scanHtf } from "../server/signals/strategies/htf";
import { sizePosition, DEFAULT_ACCOUNT_CONFIG } from "../server/signals/risk/position-sizing";

const BASKET = ["AAPL", "TSLA", "RKLB", "PLTR", "NVDA"];

async function main() {
  console.log("=".repeat(70));
  console.log(`HTF SMOKE — ${BASKET.length} tickers`);
  console.log("=".repeat(70));
  if (!process.env.FMP_API_KEY) {
    console.log("\n  ⚠ FMP_API_KEY not set — bars will return empty and the");
    console.log("    smoke will report FAILs. Set FMP_API_KEY in .env to run live.");
    console.log("    (Skipping live FMP check; sizing parity covers the math.)\n");
    process.exit(0);
  }
  let failures = 0;
  let totalHits = 0;

  for (const sym of BASKET) {
    try {
      const bars = await getHtfBars(sym);
      if (bars.length === 0) {
        console.log(`  ${sym.padEnd(6)} FAIL: no bars returned`);
        failures++;
        continue;
      }
      const hits = scanHtf(bars, sym);
      totalHits += hits.length;
      let sizedOk = 0;
      for (const h of hits) {
        const rec = sizePosition(h, DEFAULT_ACCOUNT_CONFIG);
        if (rec) sizedOk++;
      }
      const newest = hits[0];
      const newestStr = newest
        ? ` newest: ${newest.breakoutDate.toISOString().slice(0, 10)} score=${newest.qualityScore} +${newest.extras.poleGainPct.toFixed(0)}% pole`
        : "";
      console.log(
        `  ${sym.padEnd(6)} OK  ${String(bars.length).padStart(4)} bars, ${hits.length} hits, ${sizedOk} sized${newestStr}`,
      );
    } catch (err: any) {
      console.log(`  ${sym.padEnd(6)} FAIL: ${err?.message || err}`);
      failures++;
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log(`${failures === 0 ? "✓" : "✗"} ${BASKET.length - failures}/${BASKET.length} tickers OK · ${totalHits} total hits across the basket`);
  console.log("=".repeat(70));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error("Smoke crashed:", err);
  process.exit(1);
});
