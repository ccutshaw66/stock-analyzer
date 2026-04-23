/**
 * Smoke test for FMP fundamental screener.
 *
 *   tsx /opt/stock-analyzer/scripts/screener-smoke.ts
 *
 * Verifies:
 *   - FMP screener returns non-empty US tickers
 *   - Sector filter actually narrows results
 *   - Market-cap tier filters produce correctly-sized rows
 *   - Price range filters are honored
 */
import "dotenv/config";
import { fmpScreener } from "../server/data/providers/fmp.adapter";

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
  console.log("\nFMP Fundamental Screener smoke test\n");

  // 1) Baseline (no sector, $5-$10k, mcap > $500M)
  console.log("1) Baseline screen (no sector)");
  const base = await fmpScreener({
    minPrice: 5,
    maxPrice: 10000,
    minMarketCap: 500_000_000,
    count: 50,
  });
  check("baseline:count", base.length >= 20, `${base.length} tickers`);
  check(
    "baseline:us-only",
    base.every((r) => ["NYSE", "NASDAQ", "AMEX", "BATS"].includes(r.exchangeShortName.toUpperCase())),
    `exchanges: ${[...new Set(base.map((r) => r.exchangeShortName))].join(",")}`,
  );
  check(
    "baseline:price-range",
    base.every((r) => r.price >= 5 && r.price <= 10000),
    `min=$${Math.min(...base.map((r) => r.price)).toFixed(2)} max=$${Math.max(...base.map((r) => r.price)).toFixed(2)}`,
  );
  check(
    "baseline:mcap-floor",
    base.every((r) => r.marketCap >= 500_000_000),
    `min=$${(Math.min(...base.map((r) => r.marketCap)) / 1e9).toFixed(2)}B`,
  );

  // 2) Sector filter: Technology
  console.log("\n2) Sector=Technology");
  const tech = await fmpScreener({
    minPrice: 5,
    maxPrice: 10000,
    sector: "Technology",
    minMarketCap: 1_000_000_000,
    count: 30,
  });
  check("tech:count", tech.length >= 10, `${tech.length} tickers`);
  check(
    "tech:sector-pure",
    tech.every((r) => r.sector === "Technology"),
    `sectors: ${[...new Set(tech.map((r) => r.sector))].join(",")}`,
  );
  const techSample = tech.slice(0, 5).map((r) => `${r.symbol}(${r.industry})`).join(", ");
  check("tech:sample", true, techSample);

  // 3) Market cap tier: Mega ($200B+)
  console.log("\n3) Mega cap ($200B+)");
  const mega = await fmpScreener({
    minPrice: 5,
    maxPrice: 10000,
    minMarketCap: 200_000_000_000,
    count: 30,
  });
  check("mega:count", mega.length >= 5, `${mega.length} tickers`);
  check(
    "mega:cap-floor",
    mega.every((r) => r.marketCap >= 200_000_000_000),
    `min=$${(Math.min(...mega.map((r) => r.marketCap)) / 1e9).toFixed(0)}B`,
  );
  const megaSample = mega.slice(0, 5).map((r) => `${r.symbol}($${(r.marketCap / 1e9).toFixed(0)}B)`).join(", ");
  check("mega:sample", true, megaSample);

  // 4) Small cap with price range
  console.log("\n4) Small cap ($300M-$2B), price $10-$50");
  const small = await fmpScreener({
    minPrice: 10,
    maxPrice: 50,
    minMarketCap: 300_000_000,
    maxMarketCap: 2_000_000_000,
    count: 30,
  });
  check("small:count", small.length >= 5, `${small.length} tickers`);
  check(
    "small:cap-range",
    small.every((r) => r.marketCap >= 300_000_000 && r.marketCap <= 2_000_000_000),
    "caps within $300M-$2B",
  );
  check(
    "small:price-range",
    small.every((r) => r.price >= 10 && r.price <= 50),
    "prices within $10-$50",
  );

  // 5) Healthcare + large cap
  console.log("\n5) Sector=Healthcare, large cap");
  const health = await fmpScreener({
    minPrice: 5,
    maxPrice: 10000,
    sector: "Healthcare",
    minMarketCap: 10_000_000_000,
    count: 20,
  });
  check("health:count", health.length >= 5, `${health.length} tickers`);
  check(
    "health:sector-pure",
    health.every((r) => r.sector === "Healthcare"),
    `sectors: ${[...new Set(health.map((r) => r.sector))].join(",")}`,
  );

  console.log(`\n${pass}/${pass + fail} checks passed\n`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
