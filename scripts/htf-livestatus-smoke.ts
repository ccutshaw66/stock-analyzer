/**
 * htfLiveStatus smoke — pure-function checks for the shared "is this fired HTF
 * still actionable RIGHT NOW?" predicate. Guards the exact regression that put a
 * months-stale GO on the Trigger Check (target already passed, price chased,
 * stopped out, or breakout too old to be a fresh trigger).
 *
 * No network — synthetic hits only. Exit 0 = all assertions pass, 1 = any fail.
 * Usage: npm run htf:live:smoke   or   npx tsx scripts/htf-livestatus-smoke.ts
 */
import { htfLiveStatus, HTF_MAX_CHASE_PCT, type HtfHit } from "../server/signals/strategies/htf";

function makeHit(partial: Partial<HtfHit> = {}): HtfHit {
  return {
    symbol: "TEST",
    pattern: "HTF_Givens",
    direction: "long",
    breakoutDate: new Date("2026-06-01"),
    breakoutPrice: 10,
    targetPrice: 13,
    stopPrice: 9,
    qualityScore: 80,
    patternStart: new Date("2026-05-01"),
    patternEnd: new Date("2026-06-01"),
    extras: {
      poleStartPrice: 7, poleEndPrice: 10, poleGainPct: 42, poleDays: 20,
      flagDays: 8, flagHigh: 10, flagLow: 9.2, flagPullbackPct: 8,
      breakoutVolRatio: 1.5, hasOverheadResistance: false, nearestResistancePct: null,
    },
    ...partial,
  };
}

const NOW = new Date("2026-06-02"); // 1 calendar day after the default breakout
let failures = 0;

function expect(name: string, hit: HtfHit, price: number, maxDays: number, want: string) {
  const s = htfLiveStatus(hit, price, NOW, maxDays);
  const got = s.live ? "live" : s.reason;
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}: got "${got}", want "${want}"`);
}

console.log("=".repeat(70));
console.log("htfLiveStatus SMOKE");
console.log("=".repeat(70));

const hit = makeHit();
// Fresh breakout, price inside the [stop, target] band → tradeable.
expect("fresh, inside band", hit, 11, 14, "live");
// Trade already resolved — these must win over staleness so the copy is informative.
expect("price at target", hit, 13, 14, "target-hit");
expect("price above target", hit, 15, 14, "target-hit");
expect("price at stop", hit, 9, 14, "stopped");
expect("price below stop", hit, 8, 14, "stopped");
// Price ran > breakout * (1 + chase) but still below target → too late to enter cleanly.
expect("chased past breakout", hit, hit.breakoutPrice * (1 + HTF_MAX_CHASE_PCT) + 0.5, 14, "chased");
// Old breakout, price still inside band → stale, not a fresh trigger.
expect("stale (32d old)", makeHit({ breakoutDate: new Date("2026-05-01") }), 11, 14, "stale");
// The original SLSR bug: months-old breakout AND price ran past target → "target-hit"
// (resolved beats stale), NOT a GO.
expect(
  "SLSR-style (old + past target)",
  makeHit({ breakoutDate: new Date("2026-03-01"), breakoutPrice: 7, targetPrice: 8.1, stopPrice: 5.09 }),
  10.88,
  14,
  "target-hit",
);

console.log("-".repeat(70));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
