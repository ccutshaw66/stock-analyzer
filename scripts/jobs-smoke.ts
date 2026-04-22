/**
 * Phase 2.5 smoke test — exercises the scheduler module in isolation.
 *
 * Checks (7):
 *   1. registerJob accepts a valid cron string
 *   2. listJobStatus surfaces the registered job
 *   3. runJobNow executes the handler and records lastRunMs + totalRuns
 *   4. runJobNow on a throwing handler records lastError + totalErrors
 *   5. Overrun protection: runJobNow doesn't double-invoke while running
 *   6. Timeout is enforced
 *   7. Re-registering the same id replaces cleanly
 *
 * No server needed — directly imports the scheduler module.
 *
 * Usage:
 *   ./node_modules/.bin/tsx scripts/jobs-smoke.ts
 */
import {
  registerJob,
  listJobStatus,
  runJobNow,
  stopAll,
} from "../server/platform/jobs/scheduler";

const checks: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // Give the async node-cron import a moment to resolve
  await sleep(100);

  // 1. Register a simple job
  let calls = 0;
  registerJob({
    id: "smoke-simple",
    description: "simple test job",
    cron: "*/10 * * * *",
    handler: async () => {
      calls++;
      await sleep(20);
    },
  });
  const statusAfterRegister = listJobStatus().find((j) => j.id === "smoke-simple");
  record(
    "registerJob scheduled",
    !!statusAfterRegister && statusAfterRegister.scheduled,
    `scheduled=${statusAfterRegister?.scheduled}`,
  );

  // 2. listJobStatus
  record(
    "listJobStatus includes job",
    !!statusAfterRegister && statusAfterRegister.id === "smoke-simple",
    `id=${statusAfterRegister?.id}`,
  );

  // 3. runJobNow
  const r1 = (await runJobNow("smoke-simple")) as any;
  record(
    "runJobNow executes handler and records run",
    r1?.totalRuns === 1 && typeof r1?.lastRunMs === "number" && calls === 1,
    `totalRuns=${r1?.totalRuns} lastRunMs=${r1?.lastRunMs} calls=${calls}`,
  );

  // 4. Error tracking
  registerJob({
    id: "smoke-error",
    description: "throwing handler",
    cron: "*/10 * * * *",
    handler: async () => {
      throw new Error("boom");
    },
  });
  const r2 = (await runJobNow("smoke-error")) as any;
  record(
    "runJobNow records error",
    r2?.totalErrors === 1 && r2?.lastError?.includes("boom"),
    `totalErrors=${r2?.totalErrors} lastError=${r2?.lastError}`,
  );

  // 5. Overrun protection
  let slowCalls = 0;
  registerJob({
    id: "smoke-slow",
    description: "slow handler",
    cron: "*/10 * * * *",
    preventOverrun: true,
    handler: async () => {
      slowCalls++;
      await sleep(400);
    },
  });
  // Fire two runs "concurrently": first will run, second should be skipped
  const [a, b] = await Promise.all([runJobNow("smoke-slow"), runJobNow("smoke-slow")]);
  record(
    "overrun prevented (2 concurrent runJobNow → 1 actual invoke)",
    slowCalls === 1,
    `slowCalls=${slowCalls}`,
  );

  // 6. Timeout
  registerJob({
    id: "smoke-timeout",
    description: "times out",
    cron: "*/10 * * * *",
    timeoutMs: 100,
    handler: async () => {
      await sleep(1000);
    },
  });
  const r3 = (await runJobNow("smoke-timeout")) as any;
  record(
    "timeout enforced",
    r3?.totalErrors === 1 && r3?.lastError?.toLowerCase().includes("timed out"),
    `lastError=${r3?.lastError}`,
  );

  // 7. Re-register replaces cleanly
  registerJob({
    id: "smoke-simple",
    description: "simple test job REPLACED",
    cron: "*/15 * * * *",
    handler: async () => { calls++; },
  });
  const replaced = listJobStatus().find((j) => j.id === "smoke-simple");
  record(
    "re-register replaces cleanly",
    replaced?.cron === "*/15 * * * *" && replaced?.totalRuns === 0,
    `cron=${replaced?.cron} totalRuns=${replaced?.totalRuns}`,
  );

  stopAll();

  const passed = checks.filter((c) => c.pass).length;
  const total = checks.length;
  console.log(`\n=== ${passed}/${total} ${passed === total ? "ALL PASS" : "FAIL"} ===`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error("smoke test crashed:", e);
  process.exit(2);
});
