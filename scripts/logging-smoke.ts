/**
 * Phase 2.2 smoke test — verifies structured logging middleware.
 *
 * Checks (6):
 *   1. X-Request-Id header present on default request
 *   2. /api/health/live status 200
 *   3. Client-supplied X-Request-Id is echoed (correlation)
 *   4. Oversized id (>64 chars) is replaced with a safe UUID
 *   5. /api/health still works with middleware in place
 *   6. req_id is unique across two concurrent requests
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
  // 1 + 2
  {
    const r = await fetch(`${BASE}/api/health/live`);
    const rid = r.headers.get("x-request-id");
    record("X-Request-Id present", !!rid && rid.length >= 8, `got=${rid}`);
    record("liveness status 200", r.status === 200, `got ${r.status}`);
  }

  // 3. echoed
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

  // 4. oversized replaced
  {
    const longId = "x".repeat(100);
    const r = await fetch(`${BASE}/api/health/live`, {
      headers: { "X-Request-Id": longId },
    });
    const rid = r.headers.get("x-request-id");
    record(
      "oversized X-Request-Id replaced",
      !!rid && rid !== longId && rid.length <= 64,
      `got=${rid?.slice(0, 40)}...`,
    );
  }

  // 5. full health endpoint
  {
    const r = await fetch(`${BASE}/api/health`);
    const j: any = await r.json();
    record(
      "/api/health still 200 with middleware",
      r.status === 200 && j?.ok === true,
      `status=${r.status} ok=${j?.ok}`,
    );
  }

  // 6. unique ids across concurrent requests
  {
    const [a, b] = await Promise.all([
      fetch(`${BASE}/api/health/live`),
      fetch(`${BASE}/api/health/live`),
    ]);
    const ra = a.headers.get("x-request-id");
    const rb = b.headers.get("x-request-id");
    record(
      "unique req_ids across concurrent requests",
      !!ra && !!rb && ra !== rb,
      `a=${ra?.slice(0,8)}... b=${rb?.slice(0,8)}...`,
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
