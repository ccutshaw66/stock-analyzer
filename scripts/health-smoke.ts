/**
 * Phase 2.1 smoke test — verifies the health endpoints are live and correct.
 *
 * Hits:
 *   GET /api/health/live    → 200, ok:true
 *   GET /api/health         → 200, ok:true, checks.db.ok:true
 *
 * Usage:
 *   ./node_modules/.bin/tsx scripts/health-smoke.ts [base_url]
 *
 * Default base_url = http://localhost:5000
 */

const BASE = process.argv[2] || "http://localhost:5000";

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  const marker = pass ? "PASS" : "FAIL";
  console.log(`[${marker}] ${name} — ${detail}`);
}

async function get(path: string) {
  const r = await fetch(`${BASE}${path}`);
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

async function main() {
  // 1. Liveness
  {
    const { status, json } = await get("/api/health/live");
    record(
      "liveness status 200",
      status === 200,
      `got ${status}`,
    );
    record(
      "liveness ok:true",
      json?.ok === true,
      `ok=${json?.ok}`,
    );
    record(
      "liveness has uptime_s",
      typeof json?.uptime_s === "number" && json.uptime_s >= 0,
      `uptime_s=${json?.uptime_s}`,
    );
  }

  // 2. Full health
  {
    const { status, json } = await get("/api/health");
    record(
      "health status 200",
      status === 200,
      `got ${status}`,
    );
    record(
      "health ok:true",
      json?.ok === true,
      `ok=${json?.ok}`,
    );
    record(
      "health db check ok",
      json?.checks?.db?.ok === true,
      `db.ok=${json?.checks?.db?.ok} latency=${json?.checks?.db?.latency_ms}ms`,
    );
    record(
      "health has version",
      typeof json?.version === "string" && json.version !== "",
      `version=${json?.version}`,
    );
    record(
      "health unauthenticated (no 401/403)",
      status !== 401 && status !== 403,
      `status=${status}`,
    );
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
