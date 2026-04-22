# Stock Otter — Master Pathway (MP)

**Owner:** Chris Cutshaw
**Last updated:** 2026-04-21
**Status:** Living document. Single reference point for next steps.

> **Mission:** Ship a foundationally reliable, commercially licensed, tier-gated
> SaaS that validates stock market claims with backtested confluence. The MP is
> the only document that answers "what do I work on next?"

---

## Guiding principles

1. **Foundation before features.** Every new feature lands on top of the compartmentalized architecture below.
2. **Swap-ability everywhere it matters.** Data providers, alert channels, billing, and indicators are isolated behind interfaces. No vendor-specific code in feature modules.
3. **One voice for signals.** Scanner, watchlist, verdict, gate cards, and trade analysis all call the same `signals/confluence.ts`. No more VER ↔ Gate 1 ↔ SOFI/TAL contradictions.
4. **Strangler migration, not big-bang.** Old code stays alive until the new code replaces its caller. No cutover weekends.
5. **Reliability before growth.** Backups, monitoring, error capture, and graceful degradation ship before marketing does.

---

## Architecture target (see README + scaffold)

```
server/
  data/          ← Layer 1: vendor-agnostic data access
  indicators/    ← Layer 2: pure calculations
  signals/       ← Layer 3: gates + confluence
  features/      ← Layer 4: page orchestration
  platform/      ← Layer 5: cross-cutting (tiers, alerts, jobs, billing, ...)
  api/           ← Layer 6: HTTP routes
```

**Dependency rule:** each layer imports only from layers below. `platform/*` callable from any layer; never imports upward.

---

## Validated positioning (from ideas thread)

- **Guru/hype detector** is the wedge. "Stop trusting gurus. Verify every call with backtested confluence."
- **Confluence over single indicators** is the moat.
- **Track record + 2y backtest** is the primary sales asset.
- **Alerts > Wheel.** Wheel is deferred until alerts ship.

---

## Data stack decisions (locked 2026-04-21)

| Provider | Role | Cost | Status |
|---|---|---|---|
| **Polygon Stocks Starter** | Quotes, aggregates, financials, search, dividends | $29/mo | ✅ Active |
| **Polygon Options Starter** | Options snapshots for MM Exposure + Wheel | $29/mo | ✅ Active |
| **FMP Premium** | Analyst ratings, earnings estimates, insider, institutional | $59/mo | ⬜ Subscribe |
| **Yahoo** | Legacy fallback for unmigrated pages | $0 | ⚠️ Deprecate by GA |
| **In-house beta calc** | Beta from Polygon vs SPY | $0 | ⬜ Build |
| **SEC EDGAR** | Future: institutional/insider direct source | $0 | 🅿️ Parking lot |

**Total data cost:** $117/mo. Upgrade FMP to commercial (Build/Enterprise tier) before paying customers are onboarded.

**Legal:** Yahoo is not licensed for redistribution. Remove Yahoo from user-facing paid pages before GA.

---

## Master execution pathway

### Phase 0 — Unblock (this week)

| # | Task | Est. hours | Owner | Status |
|---|---|---|---|---|
| 0.1 | Rotate Polygon API key; confirm dashboard matches `.env` | 0.5 | Chris | ⬜ |
| 0.2 | Move all secrets to `.env` (gitignored); delete any in-repo copies | 1 | Chris | ⬜ |
| 0.3 | Subscribe to FMP Premium; obtain API key | 0.25 | Chris | ⬜ |
| 0.4 | Install database backup cron (pg_dump → S3/B2 nightly) | 3–4 | Chris | ⬜ |
| 0.5 | Review Polygon coverage matrix decisions (institutional: EDGAR vs Fintel; verdict 25y history) | 1 | Chris | ⬜ |

### Phase 1 — Compartmentalize (weeks 1–2)

| # | Task | Est. hours | Depends on | Status |
|---|---|---|---|---|
| 1.1 | Drop scaffold into repo; wire TypeScript paths; baseline `tsc --noEmit` | 2 | 0.x | ⬜ |
| 1.2 | Implement `platform/config/` loader; remove all direct `process.env` reads | 2 | 1.1 | ⬜ |
| 1.3 | Implement `data/providers/polygon.adapter.ts` for quotes + aggregates + options + financials + search | 5–6 | 1.2 | ⬜ |
| 1.4 | Implement `data/providers/yahoo.adapter.ts` as thin wrapper around existing Yahoo client | 3–4 | 1.1 | ⬜ |
| 1.5 | Implement `data/providers/in-house.adapter.ts` for beta | 2 | 1.3 | ⬜ |
| 1.6 | Route **Profile** page through `data/` facade as proof-of-design | 2–3 | 1.3, 1.4 | ⬜ |
| 1.7 | Unify `indicators/rsi.ts` usage across scanner, verdict, watchlist | 3–4 | 1.1 | ⬜ |
| 1.8 | Diff script: compare RSI values from every code path; prove single source | 2 | 1.7 | ⬜ |
| 1.9 | Route `signals/confluence.ts` into Scanner page; retire inline gate code | 3 | 1.7 | ⬜ |
| 1.10 | Route `signals/confluence.ts` into Watchlist page (fixes SOFI drift) | 2 | 1.9 | ⬜ |
| 1.11 | Route `signals/confluence.ts` into Trade Analysis / Verdict signals | 2 | 1.9 | ⬜ |
| 1.12 | Implement `platform/tiers/` middleware; apply to MM Exposure + Institutional + exports | 3 | 1.1 | ⬜ |

### Phase 2 — Foundation reliability (week 3)

| # | Task | Est. hours | Status |
|---|---|---|---|
| 2.1 | Sentry integration via `platform/telemetry/captureException` | 2 | ⬜ |
| 2.2 | Structured logging via pino; request-id middleware | 2 | ⬜ |
| 2.3 | `/health` endpoint checking DB + Polygon + Stripe + FMP | 2 | ⬜ |
| 2.4 | UptimeRobot / BetterUptime pinging `/health` every 5m | 0.5 | ⬜ |
| 2.5 | `platform/jobs/scheduler.ts` wired; migrate existing crons | 3 | ⬜ |
| 2.6 | `backup-database` cron live with restore-test script | 3 | ⬜ |
| 2.7 | Zod request validation on all `/api/*` endpoints | 3–4 | ⬜ |
| 2.8 | Rate limiting via express-rate-limit per user + tier | 2 | ⬜ |
| 2.9 | Graceful-degradation policy: cached data + banner when Polygon down | 2 | ⬜ |
| 2.10 | GitHub Actions CI: `tsc --noEmit` + tests on every PR | 2 | ⬜ |

### Phase 3 — Data migration (weeks 4–5)

| # | Task | Est. hours | Status |
|---|---|---|---|
| 3.1 | Implement `fmp.adapter.ts` (analyst ratings, earnings, insider, institutional) | 6–8 | ⬜ |
| 3.2 | Migrate Analyst Ratings page through `data/` facade (Yahoo → FMP) | 2 | ⬜ |
| 3.3 | Migrate Earnings page (Polygon + FMP) | 3 | ⬜ |
| 3.4 | Migrate Institutional / Insider page (FMP, EDGAR parking-lotted) | 3 | ⬜ |
| 3.5 | Build Fundamental Screener on top of `/vX/reference/financials` | 8–10 | ⬜ |
| 3.6 | Wire MM Exposure to `/v3/snapshot/options/*` (Options Starter already active) | 4–5 | ⬜ |
| 3.7 | Compute Beta via in-house adapter; remove Yahoo dependency for beta | 3 | ⬜ |
| 3.8 | Decision + implementation: Verdict 25y history strategy (Polygon upgrade vs 5y compromise) | 2–6 | ⬜ |

### Phase 4 — Retention loop: Alerts (week 6)

| # | Task | Est. hours | Status |
|---|---|---|---|
| 4.1 | `platform/alerts/` email + webhook adapters | 4 | ⬜ |
| 4.2 | Alert trigger definitions: gate_passed, verdict_change, price_target_hit, unusual_options | 3 | ⬜ |
| 4.3 | `evaluate-alerts` cron every 30m market hours | 3 | ⬜ |
| 4.4 | User alert preferences UI (channels + triggers per ticker) | 4–6 | ⬜ |
| 4.5 | Dedupe + idempotency so repeated evaluations don't spam | 2 | ⬜ |

### Phase 5 — Conversion + Admin (week 7)

| # | Task | Est. hours | Status |
|---|---|---|---|
| 5.1 | Limit-reached page redesigned as conversion surface (feature-by-tier outline) | 3 | ⬜ |
| 5.2 | Free-tier pages show proper messaging instead of 403 / blank state | 2 | ⬜ |
| 5.3 | Admin panel: user table + tier dropdown + scan-count view | 5–6 | ⬜ |
| 5.4 | `platform/billing/stripe.adapter.ts` wrapper; idempotent webhooks | 4 | ⬜ |
| 5.5 | Gate box visual consistency + VER/AMC/BBTC card alignment | 2 | ⬜ |

### Phase 6 — Pre-GA hardening (week 8)

| # | Task | Est. hours | Status |
|---|---|---|---|
| 6.1 | Remove Yahoo from all user-facing paid pages (legal) | 3–4 | ⬜ |
| 6.2 | FMP upgrade to commercial tier (Build/Enterprise) | 1 | ⬜ |
| 6.3 | Terms of service + "not investment advice" disclaimer | 2 | ⬜ |
| 6.4 | Staging environment separate from prod (separate DB + keys) | 3–4 | ⬜ |
| 6.5 | Load test scanner + MM Exposure at 100 concurrent users | 3 | ⬜ |
| 6.6 | Restore-test database backups end-to-end | 2 | ⬜ |

### Phase 7 — Parking lot (not in current MP)

- Wheel Strategy re-activation (post-alerts)
- SEC EDGAR institutional/insider direct source
- Mobile app
- API for third-party integrations
- Accessibility audit
- Design system / shared component library
- Multi-region deployment
- Multi-tenancy for enterprise customers

---

## Decisions still open

1. **Institutional/insider source:** FMP Premium (included in current plan) vs SEC EDGAR (free but ~1 week build). Recommend FMP first, EDGAR as Phase 7.
2. **Verdict 25y history:** Polygon plan upgrade vs 5y stress-test compromise. Recommend 5y compromise.
3. **Production backup destination:** AWS S3, Backblaze B2, or Wasabi. All fine; pick on cost.

---

## KPIs for "kickass SaaS" readiness

You're ready for real paying users when every one of these is green:

- [ ] Zero `process.env` reads outside `platform/config`
- [ ] Single RSI function verified via diff script across all pages
- [ ] `signals/confluence.ts` is the only code that renders gate state
- [ ] All paid pages pass tier middleware
- [ ] `/health` green on UptimeRobot for 7 straight days
- [ ] Nightly backup proven with an end-to-end restore test
- [ ] Sentry receiving errors; alert wired to email
- [ ] Stripe webhooks idempotent (can replay any event safely)
- [ ] No Yahoo calls in user-facing paid paths
- [ ] FMP on a commercial-licensed tier
- [ ] CI blocks PRs that fail `tsc --noEmit`
- [ ] ToS + disclaimer published
- [ ] One full week using the app as a paying user would (dogfood)

---

## How to use this document

1. **Every working session:** open MP, pick the lowest-numbered unchecked task whose dependencies are all checked. Work only on that.
2. **When tempted by a new idea:** add it to Phase 7 (parking lot), not earlier phases.
3. **When blocked:** note the blocker next to the task. Don't silently stall.
4. **At the end of each phase:** re-read Phase 7 and promote/demote items based on what you learned.

The MP is the product roadmap, the engineering plan, and the focus tool. If work doesn't map to a line item here, it shouldn't be happening yet.
