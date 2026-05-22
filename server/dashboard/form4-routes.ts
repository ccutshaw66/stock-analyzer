/**
 * Form 4 routes — diag (manual sweep trigger) + query (recent transactions
 * with 10b5-1 detection) for the /insiders page.
 *
 * The diag endpoint lets Chris trigger a sweep on demand without waiting
 * for the hourly cron. Useful for first backfill + after any edgar-client
 * unblock.
 *
 * The query endpoint returns recent Form 4 transactions joined to the
 * existing FMP-based insider ratio. /insiders prefers the Form 4 data
 * where available, falls back to FMP per-ticker, and uses the rule10b5_1
 * flag to separate discretionary from planned sales.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import { db } from "../storage";
import { insiderForm4 } from "@shared/schema";
import { and, eq, gte, sql } from "drizzle-orm";

export interface Form4LatestParams {
  /** Optional ticker filter (UPPER). */
  ticker?: string;
  /** Lookback window in days (default 30). */
  days?: number;
  /** Max rows (default 200, cap 1000). */
  limit?: number;
  /** "buy" / "sell" filter. */
  direction?: "buy" | "sell";
  /** If true, exclude rows where rule10b5_1 = true (filters planned sales). */
  excludePlanned?: boolean;
}

export interface Form4Row {
  ticker: string;
  filingDate: string;
  transactionDate: string;
  reportingOwnerName: string;
  reportingOwnerRelation: string | null;
  transactionCode: string;
  direction: string;
  shares: number;
  pricePerShare: number | null;
  totalValue: number | null;
  rule10b5_1: boolean;
  footnotes: string | null;
  filingUrl: string;
}

export interface Form4LatestResponse {
  rows: Form4Row[];
  totalRows: number;
  windowDays: number;
}

export function registerForm4Routes(app: Express): void {
  // GET /api/dashboard/form4/latest — recent insider transactions.
  app.get(
    "/api/dashboard/form4/latest",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
        const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
        const ticker = typeof req.query.ticker === "string" ? req.query.ticker.toUpperCase() : null;
        const direction = req.query.direction === "buy" || req.query.direction === "sell"
          ? req.query.direction : null;
        const excludePlanned = req.query.excludePlanned === "true";

        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        const conditions = [gte(insiderForm4.filingDate, cutoff)];
        if (ticker) conditions.push(eq(insiderForm4.ticker, ticker));
        if (direction) conditions.push(eq(insiderForm4.direction, direction));
        if (excludePlanned) conditions.push(eq(insiderForm4.rule10b5_1, false));

        const rows = await db
          .select()
          .from(insiderForm4)
          .where(and(...conditions))
          .orderBy(sql`${insiderForm4.transactionDate} DESC`)
          .limit(limit);

        const out: Form4Row[] = rows.map((r: any) => ({
          ticker: r.ticker,
          filingDate: r.filingDate,
          transactionDate: r.transactionDate,
          reportingOwnerName: r.reportingOwnerName,
          reportingOwnerRelation: r.reportingOwnerRelation,
          transactionCode: r.transactionCode,
          direction: r.direction,
          shares: r.shares,
          pricePerShare: r.pricePerShare,
          totalValue: r.totalValue,
          rule10b5_1: r.rule10b5_1,
          footnotes: r.footnotes,
          filingUrl: r.filingUrl,
        }));

        res.json({
          rows: out,
          totalRows: out.length,
          windowDays: days,
        } satisfies Form4LatestResponse);
      } catch (err: any) {
        console.error("[dashboard] form4/latest failed:", err?.message || err);
        res.status(500).json({ error: "form4_latest_failed", message: String(err?.message || err) });
      }
    },
  );

  // POST /api/diag/form4/sweep — manual trigger for the hourly sweep.
  // Useful for first backfill + after any edgar-client unblock. Returns
  // sweep stats inline so you can see what was fetched/inserted.
  app.post(
    "/api/diag/form4/sweep",
    requireAuth,
    async (_req: Request, res: Response) => {
      try {
        const { runForm4Sweep } = await import("../data/providers/edgar-form4-sweep");
        const result = await runForm4Sweep();
        res.json(result);
      } catch (err: any) {
        console.error("[diag] form4/sweep failed:", err?.message || err);
        res.status(500).json({ error: "form4_sweep_failed", message: String(err?.message || err) });
      }
    },
  );

  // Repair endpoint — re-applies the ADR detector to already-stored rows
  // using their saved footnote text. Fixes the SVRE-style "$6B fake
  // insider buy" rows that were inserted before the ADR-ratio parser
  // shipped. Idempotent: rows whose ratio is 1 (US common stock) are
  // never touched.
  app.post(
    "/api/diag/form4/repair-adrs",
    requireAuth,
    async (_req: Request, res: Response) => {
      try {
        const { detectAdrRatio } = await import("../data/providers/edgar-form4");
        // Pull every row that has footnote text (cheap; ~few thousand rows
        // total). We only touch the rows where detectAdrRatio returns >1.
        const allRows = await db
          .select({
            filingAccessionNo: insiderForm4.filingAccessionNo,
            txIndex: insiderForm4.txIndex,
            ticker: insiderForm4.ticker,
            shares: insiderForm4.shares,
            pricePerShare: insiderForm4.pricePerShare,
            footnotes: insiderForm4.footnotes,
          })
          .from(insiderForm4);

        let scanned = 0;
        let normalized = 0;
        const examples: Array<{
          ticker: string;
          accession: string;
          ratio: number;
          beforeShares: number;
          afterShares: number;
          beforeValue: number;
          afterValue: number;
        }> = [];

        for (const r of allRows) {
          scanned++;
          if (!r.footnotes) continue;
          const ratio = detectAdrRatio(r.footnotes);
          if (ratio <= 1) continue;
          const newShares = r.shares > 0 ? r.shares / ratio : r.shares;
          const newTotalValue =
            r.pricePerShare != null && newShares > 0 ? newShares * r.pricePerShare : null;

          if (examples.length < 10) {
            examples.push({
              ticker: r.ticker,
              accession: r.filingAccessionNo,
              ratio,
              beforeShares: r.shares,
              afterShares: newShares,
              beforeValue:
                r.pricePerShare != null && r.shares > 0 ? r.shares * r.pricePerShare : 0,
              afterValue: newTotalValue ?? 0,
            });
          }

          await db
            .update(insiderForm4)
            .set({ shares: newShares, totalValue: newTotalValue })
            .where(
              and(
                eq(insiderForm4.filingAccessionNo, r.filingAccessionNo),
                eq(insiderForm4.txIndex, r.txIndex),
              ),
            );
          normalized++;
        }

        res.json({
          scanned,
          normalized,
          examples,
          message:
            normalized > 0
              ? `Fixed ${normalized} ADR rows (e.g. ${examples[0].ticker}: $${(examples[0].beforeValue / 1e9).toFixed(2)}B → $${examples[0].afterValue.toLocaleString()}).`
              : "No ADR rows needed repair — DB is already clean.",
        });
      } catch (err: any) {
        console.error("[diag] form4/repair-adrs failed:", err?.message || err);
        res.status(500).json({ error: "form4_repair_failed", message: String(err?.message || err) });
      }
    },
  );

  // Silence unused-import warning for sql when it's not used in this build.
  void sql;
}
