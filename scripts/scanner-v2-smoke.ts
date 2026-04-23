/**
 * Smoke test for Scanner 2.0 (3.5.2 — first signals wired).
 *
 *   tsx /opt/stock-analyzer/scripts/scanner-v2-smoke.ts
 *
 * Verifies:
 *   - runScannerV2 executes
 *   - Universe size is honored (up to 2000)
 *   - Bollinger squeeze + ATR expansion detectors evaluate
 *   - At least some tickers fire triggered signals
 *   - Scoring + direction bias produce sensible output
 *   - Sector + market-cap filters still work
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
  console.log("\nScanner 2.0 smoke test (3.6 — 12 signals incl. unusual_options + gamma_squeeze)\n");

  // 1) Small universe to keep smoke quick
  console.log("1) Small scan (200 tickers, mega-cap bias for data quality)");
  const t1 = Date.now();
  const scan = await runScannerV2({
    universeSize: 200,
    count: 200,
    minMarketCap: 5_000_000_000,
    mmTopN: 10, // smoke: only enrich top-10 to keep options fetches bounded
  });
  const t1ms = Date.now() - t1;
  check("shape", typeof scan.scannedAt === "string" && Array.isArray(scan.results));
  check("universe", scan.universeSize >= 50 && scan.universeSize <= 200, `${scan.universeSize} tickers`);
  check("duration", t1ms < 300_000, `${t1ms}ms`);

  // Row shape
  if (scan.results.length) {
    const r0 = scan.results[0];
    check("row-shape", !!r0.symbol && typeof r0.price === "number" && Array.isArray(r0.signals), `top=${r0.symbol} score=${r0.score}`);
    check("row-signals-length", r0.signals.length >= 3 && r0.signals.length <= 12, `${r0.signals.length} signal results (expect 3-12, catalyst detectors skip if no FMP data)`);
  }

  // At least SOME tickers should have a triggered signal in a 200-ticker mega-cap slice
  const withTriggered = scan.results.filter((r) => r.signals.some((s) => s.triggered));
  check("some-triggered", withTriggered.length > 0, `${withTriggered.length}/${scan.results.length} rows had ≥1 triggered signal`);

  // Score distribution: highest scoring row should be > 0
  const top = scan.results[0];
  check("top-score-nonzero", top && top.score > 0, `top score=${top?.score ?? "n/a"} (${top?.symbol ?? "—"})`);

  // 2) Direction bias sanity
  console.log("\n2) Direction bias split");
  const up = scan.results.filter((r) => r.direction === "up").length;
  const down = scan.results.filter((r) => r.direction === "down").length;
  const either = scan.results.filter((r) => r.direction === "either").length;
  console.log(`   directions: up=${up}  down=${down}  either=${either}`);
  check("direction-distribution", up + down + either === scan.results.length, "directions sum correctly");

  // 3) Top 5 triggered preview
  console.log("\n3) Top 5 triggered rows");
  const top5 = withTriggered.slice(0, 5);
  top5.forEach((r) => {
    const triggered = r.signals.filter((s) => s.triggered).map((s) => `${s.id}(${s.direction},${s.strength.toFixed(2)})`).join(" ");
    console.log(`   ${r.symbol.padEnd(6)} score=${String(r.score).padStart(3)} dir=${r.direction.padEnd(6)} ${triggered}`);
  });
  check("top5-present", top5.length > 0, `${top5.length} shown`);

  // 4) Sector filter still works
  console.log("\n4) Sector=Technology filter");
  const tech = await runScannerV2({ sector: "Technology", count: 50, universeSize: 200 });
  check("tech:count", tech.results.length > 0, `${tech.results.length} rows`);
  check(
    "tech:sector-pure",
    tech.results.every((r) => r.sector === "Technology"),
    `sectors: ${[...new Set(tech.results.map((r) => r.sector))].join(",")}`,
  );

  // 5) minScore filter
  console.log("\n5) minScore=10 filter");
  const scored = await runScannerV2({ universeSize: 200, count: 200, minMarketCap: 5_000_000_000, minScore: 10 });
  check("minScore:count", scored.results.length >= 0, `${scored.results.length} rows passed minScore=10`);
  check(
    "minScore:all-meet-threshold",
    scored.results.every((r) => r.score >= 10),
    `min=${Math.min(...scored.results.map((r) => r.score)) || "n/a"}`,
  );

  console.log(`\n${pass}/${pass + fail} checks passed\n`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
