/**
 * Ask Otter routes — paid AI Q&A agent (Anthropic Claude).
 *
 * v1 status: SHELL ONLY. The route is wired but returns 503 unless BOTH:
 *   1. ANTHROPIC_API_KEY is set in env
 *   2. The user has `askOtterEnabled: true` on their account row
 *
 * Per Chris's "free-tier path" decision (interview 2026-05-21): widget exists,
 * placeholder UI tells the user "enable in Settings to use real Claude." No
 * paid Anthropic calls fire until both gates are satisfied. Same code path
 * goes live when the switch is flipped — no rewrite needed.
 *
 * Guardrails when active (designed, not yet enforced live since no calls fire
 * in v1; will be checked on the first real conversation):
 *   - 20 messages per conversation (truncate older)
 *   - 50 messages per user per day (rate limit by userId, in-memory counter)
 *   - System prompt: refuse buy/sell calls, reframe as education
 *   - System context: user's open tickers + Conviction Compass verdicts
 *   - Disclaimer baked into responses: "Educational discussion — not investment advice"
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import { db } from "../storage";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface AskOtterStatus {
  enabled: boolean;
  reason: "ready" | "no-api-key" | "account-disabled" | "unauthenticated";
}

async function checkEnabled(userId: number): Promise<AskOtterStatus> {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  if (!hasKey) return { enabled: false, reason: "no-api-key" };
  const rows = await db.select({ flag: users.askOtterEnabled }).from(users).where(eq(users.id, userId)).limit(1);
  const flag = rows[0]?.flag ?? false;
  if (!flag) return { enabled: false, reason: "account-disabled" };
  return { enabled: true, reason: "ready" };
}

export function registerAskOtterRoutes(app: Express): void {
  // Status — client polls this to decide which UI state to render.
  app.get("/api/dashboard/ask-otter/status", requireAuth, async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ enabled: false, reason: "unauthenticated" });
    try {
      const status = await checkEnabled(userId);
      res.json(status);
    } catch {
      res.status(500).json({ enabled: false, reason: "no-api-key" });
    }
  });

  // Chat — v1 returns 503 with a friendly enable hint unless both gates pass.
  // When live, this will POST { messages: [...] } and stream Claude's response.
  app.post("/api/dashboard/ask-otter/chat", requireAuth, async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthenticated" });

    const status = await checkEnabled(userId);
    if (!status.enabled) {
      return res.status(503).json({
        error: "ask_otter_disabled",
        reason: status.reason,
        message:
          status.reason === "no-api-key"
            ? "Ask Otter is not configured on this server."
            : "Ask Otter is disabled for your account. Open Settings → Ask Otter to enable.",
      });
    }

    // ─── ENABLED PATH ───────────────────────────────────────────────────────
    // When @anthropic-ai/sdk is wired up and the env key is set, the live
    // call goes here. Skeleton kept minimal in v1 so the route's wired but
    // doesn't import a missing package — flip on at activation time.
    //
    // Reference implementation when activating:
    //   import Anthropic from "@anthropic-ai/sdk";
    //   const client = new Anthropic();
    //   const stream = await client.messages.stream({
    //     model: "claude-haiku-4-5-20251001",
    //     max_tokens: 1024,
    //     system: SYSTEM_PROMPT,
    //     messages: req.body.messages,
    //   });
    //   for await (const event of stream) { res.write(...) }
    //   res.end();
    res.status(503).json({
      error: "ask_otter_activation_pending",
      message:
        "Ask Otter is enabled for your account but the @anthropic-ai/sdk integration hasn't been activated server-side. Reach out to support.",
    });
  });
}
