/**
 * SEC Form 4 sweep — pulls latest Atom feed, parses each filing's XML, and
 * upserts non-derivative transactions into the `insider_form4` table.
 *
 * Designed for cron use (~hourly). Each call:
 *   1. Lists the most recent 100 Form 4 filings from the EDGAR Atom feed.
 *   2. Filters out filings we already have (dedupe on accession number).
 *   3. For each new filing: fetches the directory index, locates the
 *      primary XML, parses it, extracts non-derivative transactions, and
 *      writes them.
 *
 * Throttled by the existing edgar.client (4 req/sec sustained). 100
 * filings × 2 requests each ≈ 50 seconds best case. Cron timeout cap
 * is 5 min.
 *
 * Circuit-breaker awareness: if the EDGAR client trips its 1h cooldown,
 * the sweep stops early and waits for the next tick.
 */
import { db } from "../../storage";
import { insiderForm4, type InsertInsiderForm4 } from "@shared/schema";
import { eq, inArray, sql } from "drizzle-orm";
import {
  listRecentForm4Filings,
  fetchAndParseForm4,
  type Form4FeedEntry,
} from "./edgar-form4";
import { isEdgarCircuitOpen, EdgarBlockedError } from "./edgar.client";

export interface Form4SweepResult {
  feedSize: number;
  alreadyHave: number;
  newlyParsed: number;
  txInserted: number;
  errors: number;
  durationMs: number;
  blockedEarly: boolean;
}

async function existingAccessions(accessions: string[]): Promise<Set<string>> {
  if (accessions.length === 0) return new Set();
  const rows = await db
    .select({ acc: insiderForm4.filingAccessionNo })
    .from(insiderForm4)
    .where(inArray(insiderForm4.filingAccessionNo, accessions));
  return new Set(rows.map((r: any) => r.acc));
}

export async function runForm4Sweep(): Promise<Form4SweepResult> {
  const start = Date.now();
  if (isEdgarCircuitOpen()) {
    return {
      feedSize: 0, alreadyHave: 0, newlyParsed: 0, txInserted: 0,
      errors: 0, durationMs: 0, blockedEarly: true,
    };
  }

  let feed: Form4FeedEntry[];
  try {
    feed = await listRecentForm4Filings();
  } catch (err: any) {
    console.error("[form4-sweep] feed fetch failed:", err?.message || err);
    return {
      feedSize: 0, alreadyHave: 0, newlyParsed: 0, txInserted: 0,
      errors: 1, durationMs: Date.now() - start,
      blockedEarly: !!err?.isEdgarBlock,
    };
  }

  const accessions = feed.map(e => e.accessionNo);
  const have = await existingAccessions(accessions);
  const todo = feed.filter(e => !have.has(e.accessionNo));

  let newlyParsed = 0;
  let txInserted = 0;
  let errors = 0;
  let blockedEarly = false;

  for (const entry of todo) {
    if (isEdgarCircuitOpen()) {
      blockedEarly = true;
      break;
    }
    try {
      const parsed = await fetchAndParseForm4(entry);
      if (!parsed) continue;
      newlyParsed++;

      const rows: InsertInsiderForm4[] = parsed.transactions.map(tx => ({
        filingAccessionNo: parsed.filingAccessionNo,
        txIndex: tx.txIndex,
        filingDate: parsed.filingDate,
        transactionDate: tx.transactionDate,
        ticker: parsed.ticker,
        issuerCik: parsed.issuerCik,
        reportingOwnerCik: parsed.reportingOwnerCik,
        reportingOwnerName: parsed.reportingOwnerName,
        reportingOwnerRelation: parsed.reportingOwnerRelation,
        transactionCode: tx.transactionCode,
        direction: tx.direction,
        shares: tx.shares,
        pricePerShare: tx.pricePerShare,
        totalValue: tx.totalValue,
        rule10b5_1: tx.rule10b5_1,
        footnotes: tx.footnotes || null,
        filingUrl: entry.filingIndexUrl,
      }));

      if (rows.length > 0) {
        // Idempotent insert: ON CONFLICT (accession, txIndex) DO NOTHING.
        // Drizzle doesn't have a direct .onConflictDoNothing chainable here
        // for compound keys without a named constraint, so use raw SQL.
        for (const row of rows) {
          try {
            await db.insert(insiderForm4).values(row);
            txInserted++;
          } catch (e: any) {
            if (String(e?.code) === "23505") continue; // unique violation, ignore
            throw e;
          }
        }
      }
    } catch (err: any) {
      errors++;
      if (err?.isEdgarBlock) {
        blockedEarly = true;
        break;
      }
      console.warn("[form4-sweep] filing failed:", entry.accessionNo, err?.message || err);
    }
  }

  const durationMs = Date.now() - start;
  console.log(
    `[form4-sweep] feed=${feed.length} have=${have.size} parsed=${newlyParsed} ` +
    `tx_inserted=${txInserted} errors=${errors} ${blockedEarly ? "(blocked early) " : ""}` +
    `in ${(durationMs / 1000).toFixed(1)}s`
  );

  return {
    feedSize: feed.length,
    alreadyHave: have.size,
    newlyParsed,
    txInserted,
    errors,
    durationMs,
    blockedEarly,
  };
}

// Suppress unused warning for unused import; kept for future use cases.
void EdgarBlockedError;
void sql;
void eq;
