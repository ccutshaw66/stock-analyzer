/**
 * Phase 3.2 smoke — confirms /api/analyze returns FMP-sourced analyst data
 * for well-covered tickers, with proper buy/hold/sell counts and price targets.
 *
 * Run against local or production. Requires no auth.
 *
 * Usage:
 *   BASE_URL=https://stockotter.ai ./node_modules/.bin/tsx scripts/ratings-smoke.ts
 */
const BASE = process.env.BASE_URL || "http://localhost:5000";
const TICKERS = ["AAPL", "MSFT", "NVDA", "GOOGL", "TSLA"];

const checks: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`);
}

async function main() {
  for (const t of TICKERS) {
    try {
      const r = await fetch(`${BASE}/api/analyze?ticker=${t}`);
      if (!r.ok) {
        record(`${t} analyze returns 200`, false, `status=${r.status}`);
        continue;
      }
      const data = await r.json();
      const a = data.analystData || {};
      const total = (a.buy || 0) + (a.hold || 0) + (a.sell || 0);
      const hasTargets = a.targetMean != null && a.targetMean > 0;
      record(
        `${t} has FMP analyst data`,
        a.source === "fmp" && total > 0 && hasTargets,
        `source=${a.source} count=${total} tgt=$${a.targetMean} rec=${a.recommendation}`,
      );
    } catch (e: any) {
      record(`${t}`, false, `err=${e?.message}`);
    }
  }

  const passed = checks.filter((c) => c.pass).length;
  const total = checks.length;
  console.log(`\n=== ${passed}/${total} ${passed === total ? "ALL PASS" : "FAIL"} ===`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error("ratings smoke crashed:", e);
  process.exit(2);
});
