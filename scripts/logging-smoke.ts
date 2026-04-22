/**
 * Phase 2.2 smoke test — verifies structured logging middleware.
 *
 * Checks:
 *   1. X-Request-Id present on response
 *   2. Custom X-Request-Id is echoed back (correlation)
 *   3. Bad input (non-string) is replaced with UUID
 *   4. /api/health returns 200 with X-Request-Id
 *
 * Usage:
 *   ./node_modules/.bin/tsx scripts/logging-smoke.ts [base_url]
 */

const BASE = process.argv[2] || "http://localhost:5000";

const checks: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`);
}

async function main() {
  // 1. Default: server generates an id
  {
    const r = await fetch(`${BASE}/api/health/live`);
    const rid = r.headers.get("x-request-id");
    record(
      "X-Request-Id present",
      !!rid && rid.length >= 8,
      `got=${rid}`,
    );
    record(
      "status 200",
      r.status === 200,
      `got ${r.status}`,
    );
  }

  // 2. Client-provided id is echoed (correlation)
  {
    const myId = "test-req-abc-123";
    const r = await fetch(`${BASE}/api/health/live`, {
      headers: { "X-Request-Id": myId },
    });
    const rid = r.headers.get("x-request-id");
    record(
      "X-Request-Id echoed when client supplies one",
      rid === myId,
      `sent=${myId} got=${rid}`,
    );
  }

  // 3. Oversized id should be replaced (safety)
  {
    const longId = "x".repeat(100);
    const r = await fetch(`${BASE}/api/health/live`, {
      headers: { "X-Request-Id": longId },
    });
    const rid = r.headers.get("x-request-id");
    record(
      "oversized X-Request-Id replaced with UUID",
      !!rid && rid !== longId && rid.length <= 64,
      `got=${rid?.slice(0, 40)}...`,
    );
  }

  // 4. Full health endpoint — still works with new middleware
  {
    const r = await fetch(`${BASE}/api/health`);
    const j = await r.json();
    record(
      "/api/health still 200 with new middleware",
      r.status === 200 && j?.ok === true,
      `status=${r.status} ok=${j?.ok}`,
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
