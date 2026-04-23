/**
 * Smoke test for Scanner 2.0 scaffold (3.5.1).
 *
 *   tsx /opt/stock-analyzer/scripts/scanner-v2-smoke.ts
 *
 * Verifies:
 *   - runScannerV2 executes without errors
 *   - Universe size matches request
 *   - Response shape is valid (scannedAt, results, etc.)
 *   - Scoring pipeline returns score=0 with empty signals (scaffold behavior)
 *   - Sector filter narrows universe
 *   - Direction filter is respected
 */
import "dotenv/config";
import { runScannerV2 } from "../server/scanner-v2";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  PASS ${name}${detail ? " — " + detail : ""}`);
    pass++;
  } else {
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
    fail++;
  }
}

async function main() {
  console.log("\nScanner 2.0 scaffold smoke test\n");

  // 1) Default scan
  console.log("1) Default scan (2000 ticker universe)");
  const t1 = Date.now();
  const def = await runScannerV2({ count: 50 });
  const t1ms = Date.now() - t1;
  check("default:shape", typeof def.scannedAt === "string" && Array.isArray(def.results));
  check("default:universe", def.universeSize >= 500, `${def.universeSize} tickers`);
  check("default:count", def.results.length === 50 || def.results.length === def.universeSize, `${def.results.length} rows`);
  check("default:duration", t1ms < 60_000, `${t1ms}ms`);
  check(
    "default:scaffold-zero-score",
    def.results.every((r) => r.score === 0 && r.signals.length === 0),
    "all score=0 (expected — no detectors yet)",
  );
  if (def.results.length) {
    const r0 = def.results[0];
    check("default:row-shape", !!r0.symbol && typeof r0.price === "number" && typeof r0.marketCap === "number", `first=${r0.symbol}`);
  }

  // 2) Sector filter
  console.log("\n2) Sector=Technology");
  const tech = await runScannerV2({ sector: "Technology", count: 30, universeSize: 500 });
  check("tech:count", tech.results.length > 0, `${tech.results.length} rows`);
  check(
    "tech:sector-pure",
    tech.results.every((r) => r.sector === "Technology"),
    `sectors: ${[...new Set(tech.results.map((r) => r.sector))].join(",")}`,
  );

  // 3) Market-cap tier (large)
  console.log("\n3) Large cap ($10B-$200B)");
  const large = await runScannerV2({
    minMarketCap: 10_000_000_000,
    maxMarketCap: 200_000_000_000,
    count: 30,
    universeSize: 500,
  });
  check("large:count", large.results.length > 0, `${large.results.length} rows`);
  check(
    "large:cap-range",
    large.results.every((r) => r.marketCap >= 10e9 && r.marketCap <= 200e9),
    "caps within $10B-$200B",
  );

  // 4) Direction filter (scaffold: everyone is "either", so "up" should keep all)
  console.log("\n4) Direction=up (scaffold: all either, so pass-through)");
  const dirUp = await runScannerV2({ direction: "up", count: 20, universeSize: 500 });
  check("dir:count", dirUp.results.length > 0, `${dirUp.results.length} rows`);

  // 5) Scan duration
  console.log("\n5) Timing profile");
  check("scaffold:fast", t1ms < 30_000, `full 2000-ticker scan in ${t1ms}ms (scaffold should be <30s)`);

  console.log(`\n${pass}/${pass + fail} checks passed\n`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
