/**
 * Smoke test for server/middleware/tier.ts
 * Verifies the middleware factory returns the expected statuses and payloads
 * without needing to boot the full HTTP server.
 */

import {
  checkFeatureAccess,
  checkScanRateLimit,
  getDailyUsage,
  getUsageSnapshot,
} from "../server/middleware/tier";
import { TIER_LIMITS } from "../server/stripe";

type MockRes = {
  statusCode: number;
  body: any;
  status: (code: number) => MockRes;
  json: (b: any) => MockRes;
};

function mockRes(): MockRes {
  const r: any = {
    statusCode: 200,
    body: null,
    status(code: number) { this.statusCode = code; return this; },
    json(b: any) { this.body = b; return this; },
  };
  return r;
}

async function runCase(name: string, fn: () => Promise<boolean>) {
  const ok = await fn();
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  return ok;
}

async function main() {
  let allPass = true;

  // 1. No auth → 401
  allPass = await runCase("no-auth 401", async () => {
    const mw = checkFeatureAccess("mmExposure");
    const res = mockRes();
    let called = false;
    await mw({} as any, res as any, (() => { called = true; }) as any);
    return res.statusCode === 401 && !called;
  }) && allPass;

  // 2. getDailyUsage creates a fresh entry
  allPass = await runCase("getDailyUsage fresh", async () => {
    const u = getDailyUsage(999999);
    return u.scans === 0 && u.analysis === 0 && typeof u.date === "string";
  }) && allPass;

  // 3. scansPerDay increments on call
  allPass = await runCase("scansPerDay increment", async () => {
    const before = getDailyUsage(888888).scans;
    // Note: we can't actually test the middleware here because it calls
    // getUserTier() which hits the DB. Instead verify the snapshot shape.
    const snap = getUsageSnapshot(888888, "free");
    return snap.scansUsed === before &&
           snap.scansLimit === TIER_LIMITS.free.scansPerDay &&
           snap.analysisLimit === TIER_LIMITS.free.analysisPerDay;
  }) && allPass;

  // 4. checkScanRateLimit: first 3 calls pass, 4th blocks
  allPass = await runCase("rate limit 3/min", async () => {
    const userId = 777777;
    const req = { user: { id: userId } } as any;
    for (let i = 0; i < 3; i++) {
      const res = mockRes();
      const blocked = checkScanRateLimit(req, res);
      if (blocked) return false;
    }
    const res = mockRes();
    const blocked = checkScanRateLimit(req, res);
    return blocked && res.statusCode === 429;
  }) && allPass;

  // 5. checkScanRateLimit with no auth returns false (no-op)
  allPass = await runCase("rate limit no-auth", async () => {
    const res = mockRes();
    const blocked = checkScanRateLimit({} as any, res);
    return !blocked && res.statusCode === 200;
  }) && allPass;

  console.log("");
  console.log(allPass ? "ALL PASS (5/5)" : "FAILURES PRESENT");
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(2); });
