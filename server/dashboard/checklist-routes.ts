/**
 * Morning Checklist routes — submit today's check + read history.
 *
 * Schema lives in `shared/schema.ts` as `morning_checklist_log`. One row per
 * user per calendar day; resubmitting the same day overwrites.
 *
 * History endpoint powers the "Last 7 days" expansion on the widget.
 *
 * Phase-2: the "force lock" gate that prevents site access until the check
 * is complete will read `getTodayChecklist(userId)` from this module. That
 * helper exists for the gate even though it's not enforced yet.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import { db } from "../db";
import { morningChecklistLog } from "@shared/schema";
import { and, eq, desc, sql } from "drizzle-orm";

export interface ChecklistSubmission {
  date: string;                          // YYYY-MM-DD (user-local)
  items: Record<string, boolean>;        // itemId → checked
  focusNote?: string;
}

export async function getTodayChecklist(userId: number, date: string): Promise<{
  date: string;
  items: Record<string, boolean>;
  focusNote: string | null;
  completedAt: string;
} | null> {
  const rows = await db
    .select()
    .from(morningChecklistLog)
    .where(and(eq(morningChecklistLog.userId, userId), eq(morningChecklistLog.date, date)))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    date: r.date,
    items: (r.items as Record<string, boolean>) ?? {},
    focusNote: r.focusNote,
    completedAt: r.completedAt.toISOString(),
  };
}

async function getRecentHistory(
  userId: number,
  limit: number,
): Promise<Array<{ date: string; items: Record<string, boolean>; focusNote: string | null; completedAt: string }>> {
  const rows = await db
    .select()
    .from(morningChecklistLog)
    .where(eq(morningChecklistLog.userId, userId))
    .orderBy(desc(morningChecklistLog.date))
    .limit(limit);
  return rows.map((r: any) => ({
    date: r.date,
    items: (r.items as Record<string, boolean>) ?? {},
    focusNote: r.focusNote,
    completedAt: r.completedAt.toISOString(),
  }));
}

/** Streak = consecutive days back from today with a completed checklist. */
function computeStreak(history: Array<{ date: string }>): number {
  if (history.length === 0) return 0;
  const dates = new Set(history.map(h => h.date));
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  // Skip weekends — if today's a non-trading day, look back to Friday.
  for (let i = 0; i < 30; i++) {
    const iso = cursor.toISOString().slice(0, 10);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      if (!dates.has(iso)) break;
      streak++;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function registerChecklistRoutes(app: Express): void {
  app.get(
    "/api/dashboard/checklist/today",
    requireAuth,
    async (req: Request, res: Response) => {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "unauthenticated" });
      const date = new Date().toISOString().slice(0, 10);
      try {
        const today = await getTodayChecklist(userId, date);
        const recent = await getRecentHistory(userId, 14);
        res.json({
          today,
          streak: computeStreak(recent),
        });
      } catch (err: any) {
        console.error("[dashboard] checklist GET today failed:", err?.message || err);
        res.status(500).json({ error: "checklist_read_failed" });
      }
    },
  );

  app.get(
    "/api/dashboard/checklist/history",
    requireAuth,
    async (req: Request, res: Response) => {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "unauthenticated" });
      const limit = Math.min(Math.max(Number(req.query.limit) || 7, 1), 90);
      try {
        const items = await getRecentHistory(userId, limit);
        res.json({ items });
      } catch (err: any) {
        console.error("[dashboard] checklist history failed:", err?.message || err);
        res.status(500).json({ error: "checklist_history_failed" });
      }
    },
  );

  app.post(
    "/api/dashboard/checklist/submit",
    requireAuth,
    async (req: Request, res: Response) => {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "unauthenticated" });
      const body = req.body as Partial<ChecklistSubmission>;
      if (!body?.date || !body?.items || typeof body.items !== "object") {
        return res.status(400).json({ error: "invalid_body", message: "date + items required" });
      }
      try {
        // Upsert: if a row already exists for (userId, date), overwrite it.
        const existing = await getTodayChecklist(userId, body.date);
        if (existing) {
          await db
            .update(morningChecklistLog)
            .set({
              items: body.items as any,
              focusNote: body.focusNote ?? null,
              completedAt: sql`NOW()`,
            })
            .where(
              and(
                eq(morningChecklistLog.userId, userId),
                eq(morningChecklistLog.date, body.date),
              ),
            );
        } else {
          await db.insert(morningChecklistLog).values({
            userId,
            date: body.date,
            items: body.items as any,
            focusNote: body.focusNote ?? null,
          });
        }
        const today = await getTodayChecklist(userId, body.date);
        const recent = await getRecentHistory(userId, 14);
        res.json({ today, streak: computeStreak(recent) });
      } catch (err: any) {
        console.error("[dashboard] checklist submit failed:", err?.message || err);
        res.status(500).json({ error: "checklist_submit_failed", message: String(err?.message || err) });
      }
    },
  );
}
