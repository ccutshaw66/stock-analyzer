/**
 * Conviction Compass forward-tracking.
 *
 * Two cron entry points:
 *   snapshotConvictionForUniverse() — take today's compass reading for every
 *     ticker in the tracked universe and write it to compass_snapshots,
 *     plus a single SPY baseline row for the same date.
 *   updateForwardReturns() — for every snapshot whose forward window has
 *     just closed, compute (today_close − snapshot_close) / snapshot_close
 *     and persist it to the matching return_Nd column.
 *
 * Goal: build a real-world performance dataset. After ~30 days we have
 * 1d/5d/30d returns per verdict class; after ~90 we have everything.
 */

import { eq, sql, and, isNull, lte, gte } from "drizzle-orm";
import { db } from "../storage";
import { compassSnapshots, spyBaselineReturns } from "@shared/schema";
import { getConvictionCompass } from "./pipeline";
import { getPolygonChart } from "../polygon";
import type { GetCompanySnapshotOpts } from "../snapshot";

// ─── Tracked universe ──────────────────────────────────────────────────────
//
// V1: hardcoded ~100 megacaps spanning sectors. Tickers were picked for
// liquidity, options coverage, and broad sector representation — the
// compass needs all four axes to be meaningful, and these all have it.
// Future: read from a configurable settings row or a user-curated list.
export const TRACKED_UNIVERSE: ReadonlyArray<string> = [
  // Mega-cap tech
  "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "AVGO", "ORCL", "ADBE",
  "CRM", "AMD", "INTC", "CSCO", "QCOM", "TXN", "IBM", "MU", "AMAT", "LRCX",
  // Financials
  "JPM", "BAC", "WFC", "GS", "MS", "C", "BLK", "SCHW", "AXP", "USB",
  "V", "MA", "PYPL", "COIN", "BRK.B",
  // Healthcare
  "UNH", "JNJ", "LLY", "PFE", "ABBV", "MRK", "TMO", "ABT", "DHR", "BMY",
  "AMGN", "CVS", "ELV",
  // Consumer
  "WMT", "COST", "HD", "LOW", "MCD", "SBUX", "NKE", "TJX", "DIS", "NFLX",
  "PG", "KO", "PEP", "PM", "MO", "MDLZ",
  // Industrials & energy
  "CAT", "BA", "GE", "HON", "UPS", "RTX", "LMT", "DE", "MMM",
  "XOM", "CVX", "COP", "SLB",
  // Real estate / utilities / materials
  "PLD", "AMT", "NEE", "DUK", "SO",
  "LIN", "FCX",
  // Misc large caps with options coverage and varied profiles
  "PLTR", "SHOP", "SQ", "UBER", "ABNB", "SNOW", "ZM", "ROKU", "DDOG", "NET",
  "F", "GM", "GE", "T", "VZ",
];

const SPY_TICKER = "SPY";

// ─── Helpers ──────────────────────────────────────────────────────────────

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(earlier: Date, later: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / (24 * 60 * 60 * 1000));
}

/** Look up the close price for a ticker at a specific YYYY-MM-DD via the
 *  long-cached Polygon chart. Returns null if no bar that day (weekends,
 *  holidays, or pre-IPO). Falls back to the nearest trading day within ±3. */
async function getCloseOnDate(ticker: string, dateStr: string, span: "3mo" | "1y" = "3mo"): Promise<number | null> {
  try {
    const chart: any = await getPolygonChart(ticker, span as any, "1d" as any);
    const ts: number[] = chart?.timestamp ?? [];
    const closes: number[] = chart?.indicators?.quote?.[0]?.close ?? [];
    if (!ts.length) return null;
    const target = new Date(dateStr + "T00:00:00Z").getTime() / 1000;
    // Find closest bar within 3 days
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < ts.length; i++) {
      const dist = Math.abs(ts[i] - target);
      if (dist < bestDist && dist < 3 * 24 * 3600) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) return null;
    const c = closes[bestIdx];
    return Number.isFinite(c) ? Number(c) : null;
  } catch {
    return null;
  }
}

// ─── Public: take a daily snapshot ────────────────────────────────────────

export async function snapshotConvictionForUniverse(opts: GetCompanySnapshotOpts): Promise<{
  written: number;
  errors: number;
  skipped: number;
}> {
  const today = new Date();
  const todayStr = ymd(today);
  let written = 0, errors = 0, skipped = 0;

  // Avoid double-snapshotting the same ticker on the same date — if a row
  // already exists for (ticker, takenDate), skip.
  const existing = await db
    .select({ ticker: compassSnapshots.ticker })
    .from(compassSnapshots)
    .where(eq(compassSnapshots.takenDate, todayStr));
  const seen = new Set(existing.map(r => r.ticker.toUpperCase()));

  for (const t of TRACKED_UNIVERSE) {
    const T = t.toUpperCase();
    if (seen.has(T)) { skipped++; continue; }
    try {
      const c = await getConvictionCompass(T, opts);
      const axesAvailable =
        (c.smartMoneyFlow.weight > 0 ? 1 : 0) +
        (c.dealerPositioning.weight > 0 ? 1 : 0) +
        (c.technicalMomentum.weight > 0 ? 1 : 0) +
        (c.fundamentalQuality.weight > 0 ? 1 : 0);

      // Anchor spot from technicals' last-bar close, or from snapshot quote.
      const spot =
        c.technicalMomentum.components.find(x => x.label === "RSI(14)")?.value !== null
          ? null // we don't surface spot directly via compass; pull from chart fallback
          : null;
      const spotPrice = spot ?? await getCloseOnDate(T, todayStr, "3mo");

      await db.insert(compassSnapshots).values({
        ticker: T,
        takenDate: todayStr,
        spotPrice,
        verdict: c.verdict,
        confidence: c.confidence,
        confluence: c.confluence,
        alignment: c.alignment,
        smartMoneyFlow: c.smartMoneyFlow.weight > 0 ? c.smartMoneyFlow.score : null,
        dealerPositioning: c.dealerPositioning.weight > 0 ? c.dealerPositioning.score : null,
        technicalMomentum: c.technicalMomentum.weight > 0 ? c.technicalMomentum.score : null,
        fundamentalQuality: c.fundamentalQuality.weight > 0 ? c.fundamentalQuality.score : null,
        axesAvailable,
        compassJson: c as any,
      });
      written++;
    } catch (e: any) {
      console.error(`[compass-tracker] ${T}: ${String(e?.message || e).substring(0, 200)}`);
      errors++;
    }
    // Inter-call delay so we don't burst the snapshot adapters
    await new Promise(r => setTimeout(r, 150));
  }

  // SPY baseline row for the same date (idempotent)
  try {
    const spyExisting = await db
      .select({ takenDate: spyBaselineReturns.takenDate })
      .from(spyBaselineReturns)
      .where(eq(spyBaselineReturns.takenDate, todayStr))
      .limit(1);
    if (spyExisting.length === 0) {
      const spyClose = await getCloseOnDate(SPY_TICKER, todayStr, "3mo");
      if (spyClose) {
        await db.insert(spyBaselineReturns).values({ takenDate: todayStr, spotPrice: spyClose });
      }
    }
  } catch (e: any) {
    console.error(`[compass-tracker] SPY baseline: ${String(e?.message || e).substring(0, 200)}`);
  }

  return { written, errors, skipped };
}

// ─── Public: update forward returns ───────────────────────────────────────

interface ForwardWindowSpec {
  days: number;
  column: keyof typeof compassSnapshots.$inferInsert;
}

const FORWARD_WINDOWS: ForwardWindowSpec[] = [
  { days: 1, column: "return1d" },
  { days: 5, column: "return5d" },
  { days: 30, column: "return30d" },
  { days: 90, column: "return90d" },
];

/** For every snapshot row whose forward window has just closed (or hasn't
 *  been filled yet), compute the forward return and persist it. */
export async function updateForwardReturns(): Promise<{ updated: number; errors: number }> {
  let updated = 0, errors = 0;
  const today = new Date();
  const todayStr = ymd(today);

  for (const win of FORWARD_WINDOWS) {
    // Anchor date that is exactly N days in the past — those rows' forward
    // window has just closed and is ready to be measured.
    const anchorDate = new Date(today);
    anchorDate.setUTCDate(anchorDate.getUTCDate() - win.days);
    const anchorStr = ymd(anchorDate);

    // Pull all rows from that date that don't yet have this column filled.
    const colName = String(win.column);
    const rows = await db.execute(sql`
      SELECT id, ticker, spot_price
      FROM compass_snapshots
      WHERE taken_date = ${anchorStr}
        AND ${sql.raw(camelToSnake(colName))} IS NULL
        AND spot_price IS NOT NULL
    `);

    for (const r of (rows as any).rows ?? []) {
      try {
        const close = await getCloseOnDate(r.ticker, todayStr, "1y");
        if (close === null || !r.spot_price) continue;
        const ret = ((close - Number(r.spot_price)) / Number(r.spot_price)) * 100;
        await db.execute(sql`
          UPDATE compass_snapshots
          SET ${sql.raw(camelToSnake(colName))} = ${ret}
          WHERE id = ${r.id}
        `);
        updated++;
      } catch (e: any) {
        console.error(`[compass-tracker] forward-return ${r.ticker} ${win.days}d: ${String(e?.message || e).substring(0, 120)}`);
        errors++;
      }
    }

    // Same for SPY baseline
    const spyRows = await db.execute(sql`
      SELECT taken_date, spot_price
      FROM spy_baseline_returns
      WHERE taken_date = ${anchorStr}
        AND ${sql.raw(camelToSnake(colName))} IS NULL
        AND spot_price IS NOT NULL
    `);
    for (const r of (spyRows as any).rows ?? []) {
      try {
        const close = await getCloseOnDate(SPY_TICKER, todayStr, "1y");
        if (close === null || !r.spot_price) continue;
        const ret = ((close - Number(r.spot_price)) / Number(r.spot_price)) * 100;
        await db.execute(sql`
          UPDATE spy_baseline_returns
          SET ${sql.raw(camelToSnake(colName))} = ${ret}
          WHERE taken_date = ${r.taken_date}
        `);
      } catch { /* swallow */ }
    }
  }

  return { updated, errors };
}

// camelCase → snake_case for a small column-name list. Avoids pulling in a lib.
function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, m => "_" + m.toLowerCase());
}
