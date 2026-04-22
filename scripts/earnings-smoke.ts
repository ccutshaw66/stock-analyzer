/**
 * Phase 3.3 smoke — validates the FMP earnings adapter returns a sane shape
 * for well-covered tickers. Runs against the FMP API directly (no auth needed).
 *
 * Usage:
 *   FMP_API_KEY=xxx ./node_modules/.bin/tsx scripts/earnings-smoke.ts
 */
import { getFmpEarningsRow } from "../server/fmp-earnings";

const TICKERS = ["AAPL", "MSFT", "NVDA", "GOOGL", "TSLA"];

const checks: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`);
}

async function main() {
  if (!process.env.FMP_API_KEY) {
    console.error("FMP_API_KEY not set");
    process.exit(2);
  }

  for (const t of TICKERS) {
    try {
      const row = await getFmpEarningsRow(t);
      if (!row) {
        record(`${t}`, false, "null row");
        continue;
      }
      const historyOk = Array.isArray(row.history) && row.history.length >= 4;
      const estOk = row.history.some((h) => h.estimate != null);
      // companyName should come from /profile; allow fallback to ticker
      const nameOk = !!row.companyName;
      record(
        t,
        historyOk && estOk && nameOk,
        `name=${row.companyName} date=${row.earningsDate} hist=${row.history.length} estRows=${row.history.filter(h => h.estimate != null).length}`,
      );
    } catch (e: any) {
      record(t, false, `err=${e?.message}`);
    }
  }

  const passed = checks.filter((c) => c.pass).length;
  const total = checks.length;
  console.log(`\n=== ${passed}/${total} ${passed === total ? "ALL PASS" : "FAIL"} ===`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
