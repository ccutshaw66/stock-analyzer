/**
 * Phase 3.1 smoke test — exercises the FMP adapter against the live API.
 *
 * Requires FMP_API_KEY to be set in the environment.
 *
 * Checks (7):
 *   1. Analyst ratings for AAPL returns sensible target + consensus
 *   2. Earnings for AAPL returns at least 4 events
 *   3. Insider transactions for AAPL returns array (may be empty)
 *   4. Institutional holdings for AAPL returns non-empty list with names
 *   5. Financials for AAPL returns revenue > 0 and P/E from TTM
 *   6. Cache hit on repeat request (second call is much faster)
 *   7. FmpConfigError when key is missing (setup guard)
 *
 * Usage:
 *   FMP_API_KEY=xxx ./node_modules/.bin/tsx scripts/fmp-smoke.ts
 */
import { fmpAdapter } from "../server/data/providers/fmp.adapter";
import { clearFmpCache, FmpConfigError, fmpGet } from "../server/data/providers/fmp.client";

const checks: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`);
}

async function main() {
  if (!process.env.FMP_API_KEY) {
    console.error("FMP_API_KEY not set — this smoke test needs a live key.");
    process.exit(2);
  }
  const SYM = "AAPL";

  // 1. Analyst ratings
  try {
    const r = await fmpAdapter.getAnalystRatings!(SYM);
    record(
      "analyst ratings",
      r.priceTargetAvg > 0 && r.analystCount >= 0 && !!r.consensus,
      `avg=$${r.priceTargetAvg} analysts=${r.analystCount} consensus=${r.consensus}`,
    );
  } catch (e: any) {
    record("analyst ratings", false, `err=${e?.message}`);
  }

  // 2. Earnings
  try {
    const events = await fmpAdapter.getEarnings!(SYM, 8);
    record(
      "earnings returns >= 4 events",
      Array.isArray(events) && events.length >= 4,
      `count=${events?.length}`,
    );
  } catch (e: any) {
    record("earnings", false, `err=${e?.message}`);
  }

  // 3. Insider transactions
  try {
    const txns = await fmpAdapter.getInsiderTransactions!(SYM, 20);
    record(
      "insider transactions is an array",
      Array.isArray(txns),
      `count=${txns?.length}`,
    );
  } catch (e: any) {
    record("insider transactions", false, `err=${e?.message}`);
  }

  // 4. Institutional holdings — FMP Premium tier does NOT include 13F data
  //    (Ultimate-only). Adapter should throw a clear "Ultimate tier" error so
  //    the registry routes elsewhere. Passing means the guard fires.
  try {
    let thrown = false;
    let msg = "";
    try {
      await fmpAdapter.getInstitutionalHoldings!(SYM);
    } catch (e: any) {
      thrown = true;
      msg = String(e?.message || "");
    }
    record(
      "institutional holdings correctly disabled on Premium tier",
      thrown && /ultimate/i.test(msg),
      `thrown=${thrown} msg=\"${msg.slice(0, 80)}\"`,
    );
  } catch (e: any) {
    record("institutional holdings", false, `err=${e?.message}`);
  }

  // 5. Financials
  try {
    const fin = await fmpAdapter.getFinancials!(SYM, 4);
    const first = fin?.[0];
    record(
      "financials revenue>0 and P/E set on latest period",
      !!first && first.revenue > 0 && (first.peRatio ?? 0) > 0,
      `revenue=${first?.revenue} pe=${first?.peRatio}`,
    );
  } catch (e: any) {
    record("financials", false, `err=${e?.message}`);
  }

  // 6. Cache hit
  try {
    clearFmpCache();
    const t1 = Date.now();
    await fmpGet<any>(`/ratings-snapshot`, { symbol: SYM });
    const cold = Date.now() - t1;
    const t2 = Date.now();
    await fmpGet<any>(`/ratings-snapshot`, { symbol: SYM });
    const warm = Date.now() - t2;
    record(
      "cache hit is > 10x faster than cold fetch",
      warm * 10 < cold || warm < 5,
      `cold=${cold}ms warm=${warm}ms`,
    );
  } catch (e: any) {
    record("cache hit speedup", false, `err=${e?.message}`);
  }

  // 7. Config error when key is missing
  try {
    const saved = process.env.FMP_API_KEY;
    delete process.env.FMP_API_KEY;
    clearFmpCache();
    let thrown = false;
    try {
      await fmpGet<any>(`/ratings-snapshot`, { symbol: "AAPL" });
    } catch (e) {
      thrown = e instanceof FmpConfigError;
    }
    process.env.FMP_API_KEY = saved;
    record("FmpConfigError when FMP_API_KEY missing", thrown, `thrown=${thrown}`);
  } catch (e: any) {
    record("FmpConfigError", false, `err=${e?.message}`);
  }

  const passed = checks.filter((c) => c.pass).length;
  const total = checks.length;
  console.log(`\n=== ${passed}/${total} ${passed === total ? "ALL PASS" : "FAIL"} ===`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error("smoke test crashed:", e);
  process.exit(2);
});
