# Stock Otter — Production Readiness & Strategy Tuning Plan

Owner: Chris Cutshaw. Generated 2026-06-10 from a full read-only assessment.
Agents: work top-down. Snapshot before changes, run the QA gate, don't push until QA passes.

## Top 5 to do first (~12–15 hrs)
1. **Fix the Track Record page** — blank ~1 month; the daily cron isn't writing. Diagnose (cron erroring? rows missing? query filter wrong?) in `server/conviction/tracker.ts` + `server/cron.ts`; add explicit success/row-count logging.
2. **FMP circuit breaker** — `server/data/providers/fmp.client.ts` + routes in `server/routes.ts`. External outage must degrade to partial data, not 500 the page.
3. **Polygon timeout + retry** — `server/polygon.ts`, `server/data/providers/polygon.adapter.ts`. Raw `fetch()` can hang forever; match FMP's 15s timeout + 3 retries.
4. **Input validation** — `server/routes.ts`. Validate `:symbol` / `q` (regex allowlist) to close injection/XSS vectors.
5. **Hide unvalidated strategies** — `shared/strategies/registry.ts`. Mark Insider Trigger, AMC, Rounding Bottom, Wyckoff Spring, VER as `experimental: true` + `liveScan.ownerOnly: true`. One-line changes, big trust win. **Safest first task.**

## Part A — Strategy / indicator tuning
- **HTF** has no out-of-sample SPY-relative test on the real $5–75 universe (only WFE + a mega-cap comparison). Re-test forward-only on the right universe; keep owner-only unless it clears >+1% OOS excess.
- **VER / AMC / Rounding Bottom** failed OOS; **Wyckoff / Insider Trigger** unproven → demote (see #5).
- **Trend-Ride bot** blends 18 months of backtest into "live" P&L — verify `seedMonths: 0` and reset the prod bot once to flush stale seed.
- **BBTC** magic numbers (`server/signals/strategies/bbtc.ts:91–101`) need a parameter-sensitivity sweep + revalidation comments. (RSI ceiling 65 is already validated — just document it.)
- Add a **lookahead-bias test** (`scripts/validate-lookahead.ts`) and a **regime-performance** breakdown for trend strategies.

## Part B — Production readiness
- **Reliability:** circuit breaker (FMP) + timeouts/retries (Polygon, EDGAR `server/data/providers/edgar.client.ts`).
- **Security:** input validation; verify Stripe webhook signature (`server/routes.ts` webhook); confirm bot routes require owner tier (`server/bot-routes.ts`); confirm `.env`/`env.txt` never committed (rotate keys if they were).
- **Scale:** rate-limit scan/analyze routes; set a sane PG connection-pool `max` (`server/storage.ts`); check for N+1 in trade endpoints (enforce one-source-of-truth + caching).
- **Ops:** clear success/failure logging in every `server/cron.ts` job; enrich `/api/health` with cron last-run, cache, and circuit status; verify backups restore.

## Ground rules (Chris's)
Keep it simple · one canonical fetch path per fact + long-TTL cache · snapshot before changes · verify, don't assume · cheap check (typecheck) before behavior before ship · plain-English reporting. A change that works but breaks these is a FAIL.
