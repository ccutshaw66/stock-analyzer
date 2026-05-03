# Stock Otter — Changes Log

This file is the running history of meaningful changes to the project.
Newest entries on top. Each entry should describe **what** changed,
**why**, and which files were touched, so that any human or AI picking
up the project later has the context to keep moving.

For pre-2026-04-25 history, see `FEATURE_CHANGES.md` (focused log of the
Dividend Finder + Position Duration Analysis features that were added
during the prior Perplexity/Claude session).

---

## 2026-05-03 — Verdict snapshot card: Avg Volume + Beta restored

**Symptoms users were seeing:**
- Verdict page Snapshot card displayed `Avg Volume: 0` with a Caution flag
- `Beta: N/A` with a Neutral flag, on every ticker

**Root causes (both pre-existing bugs, not caused by this session):**

1. `server/polygon.ts` had a `null // filled below if possible` placeholder
   on `averageDailyVolume3Month` from the prior AI's Phase 3.7 Polygon
   migration. The implementation was never finished; the field was
   permanently null. Downstream `safeNum()` then converted null to 0.

2. `server/polygon.ts` also hardcoded `beta: null` because Polygon does not
   sell beta data on any tier (verified 2026-04). The original Yahoo
   `defaultKeyStatistics.beta` source path was retired during the same
   migration and never replaced.

**Fixes:**

- **`server/polygon.ts`** — promoted the avg-volume calculation into the
  same try-block as the existing 52-week range computation. Both averages
  (3-month / 10-day) now derive from the daily bars already being fetched.
  Zero additional HTTP calls; just mining the existing payload.
  - 3-month avg = mean of last 63 trading days' volume (US trading sessions ≈ 1 quarter)
  - 10-day avg = mean of last 10 days' volume

- **`server/data/providers/fmp.adapter.ts`** — added a new exported
  function `getFmpProfileBeta(symbol)`. Calls FMP `/profile/{symbol}`,
  reads the `beta` field, returns null gracefully on missing data /
  micro-caps / API errors.

- **`server/routes.ts`** — added `getFmpProfileBeta` to the FMP imports.
  In both `/api/analyze/:ticker` (analyze route) and
  `/api/verdict/:ticker` (verdict route), inserted a beta-fallback block
  immediately after `extractQuoteData()`: if `quote.beta == null`, try
  FMP and overlay the value. Wrapped in try/catch so a transient FMP
  failure does not crash the page; UI tolerates null and renders N/A.

**Cost impact:** zero recurring. Avg Volume reuses bars already fetched.
Beta adds at most one FMP `/profile` call per first-time ticker view
(cached upstream by `fmpGet`). FMP Premium plan budget is unaffected.

**Architectural note:** beta now permanently lives on FMP. If the FMP
plan is ever downgraded or swapped, beta will go back to N/A. Eventually
this should be replaced with a Yahoo-backed cache-refresh agent (same
pattern as `yahoo-ownership-warmup.ts`) for resilience.

**Files touched:**
- `server/polygon.ts`
- `server/routes.ts`
- `server/data/providers/fmp.adapter.ts`

---

## 2026-04-29 — SEC EDGAR Akamai block resolved

**Symptoms:**
- `[inst-warmup] EDGAR 403 Forbidden` spamming the logs (60+ tickers in a row)
- Top Institutions table showing only tiny RIAs (4–21 holders) instead of the
  expected hundreds for popular tickers like AAPL/NVDA/GE
- Institutional Ownership % computing to ~0.0% (effectively zero) because
  the cache had only fragments of the 13F data

**Root cause:**
SEC's CDN (Akamai) auto-blocks IPs that sustain too-aggressive request
patterns. The previous AI's panic-loop debugging session hammered EDGAR
hard enough to trip the block; the existing 8 req/sec rate limit had no
jitter and was shared across multiple concurrent crons, occasionally
producing visible bursts.

**Resolution path:**
1. Filed an unblock request to `webmaster@sec.gov` with our IP
   (68.171.198.222), explaining the new mitigations we'd just deployed.
2. SEC acknowledged the same day; full unblock confirmed within 24 hours.
3. Verified: `curl -m 10 -s -o /dev/null -w "%{http_code}\n" -H 'User-Agent: StockOtter SaaS superotter@stockotter.ai' https://www.sec.gov/files/company_tickers.json` returns 200.

**Code hardening (deployed before sending the email):**

- **`server/data/providers/edgar.client.ts`** — rate dropped from 8 req/sec
  flat → 4 req/sec with random 0–50ms jitter (intentionally well below
  SEC's 10/sec cap). Added a circuit breaker: 3 consecutive 403s opens
  the circuit for 1 hour, during which all EDGAR calls short-circuit
  with a new `EdgarBlockedError` instead of hitting the wire. Counter
  resets on any success. Default User-Agent updated from broken
  `contact@stockotter.ai` mailbox to `superotter@stockotter.ai`.

- **`server/institutional-warmup.ts`** — pre-flight circuit check skips
  the warmup entirely when the breaker is open. Mid-loop check aborts
  the iteration immediately when the breaker trips during a run, so a
  partially-lifted-then-retripped block can't burn through 250 tickers
  generating more pressure.

**Files touched:**
- `server/data/providers/edgar.client.ts`
- `server/institutional-warmup.ts`

---

## 2026-04-25 — Institutional page restored (Yahoo as cache-refresh agent)

**Symptoms:**
- Fund Holders tab showed "Fund holder breakdown not available"
- Insiders tab showed "Insider roster not available"
- Insider Ownership % showed 0.0%
- INCREASING / DECREASING / NEW / SOLD-OUT counts all showed 0
- Money Flow Score scored only insider activity (institutional flow had
  been silently zeroed out)

**Root cause:**
The previous AI's "Phase 3.7 — fully migrated off Yahoo" sweep ripped
out Yahoo data sources from `server/routes.ts` and replaced them with
hardcoded empty stubs:
```ts
const instOwnership: any[] = [];
const fundOwnership: any[] = [];
const majorBreakdown: any = {};
insiderHolders: { holders: [] }
```
The `// Phase 3.4b will populate` comments were placeholder IOUs that
never came back.

**Decision:**
Restore Yahoo as the source for these fields, but architecturally as a
**background cache-refresh agent** rather than a request-path dependency.
This matches the original "Yahoo as buffer, never on the request path"
rule. A nightly cron warms the cache before market open; live requests
read from the cache 23 hours / day.

**Implementation:**

- **`server/routes.ts`** — added `getYahooOwnership(ticker)` helper that
  fetches `fundOwnership`, `institutionOwnership`, `majorHoldersBreakdown`,
  and `insiderHolders` from Yahoo's quoteSummary endpoint in a single
  call. 23-hour cache TTL (slightly under the warmup cadence so the cron
  always refreshes before expiry). Wired into the institutional data
  pipeline alongside the EDGAR-sourced topInstitutions. Also added a
  name normalizer that joins EDGAR's legal-entity names ("BRITISH
  COLUMBIA INVESTMENT MANAGEMENT Corp") with Yahoo's trimmed names
  ("British Columbia Investment Management") so QoQ change deltas can
  be merged onto the EDGAR rows where Yahoo has them.

- **`server/yahoo-ownership-warmup.ts`** (new file) — mirrors the
  existing `institutional-warmup.ts` pattern. Walks ~250 always-warm
  symbols (mega-caps, sector ETFs, popular dividend names) plus every
  symbol that appears in any user's open trades. Serial execution with
  400ms delay between calls to stay well under Yahoo's per-IP rate limit.

- **`server/cron.ts`** — registered the new warmup at `30 8 * * *`
  (4:30am ET / 08:30 UTC). Sits between the existing long-range chart
  warmup at 3:30am ET and the EDGAR institutional warmup at 5am ET.
  30-min timeout, no overlap protection.

**Architectural rule preserved:**
Yahoo is still off the request path 99% of the time. The
`getYahooOwnership()` helper is a fallback for cache-miss tickers; the
warmup agent ensures cache hits for the symbols users actually look at.

**TODO (Phase 3.4b / N-PORT):** replace Yahoo dependency entirely with
SEC N-PORT filings (mutual fund / ETF holdings) plus 13F QoQ deltas
computed from EDGAR history. Multi-week project; deferred.

**Files touched:**
- `server/routes.ts`
- `server/cron.ts`
- `server/yahoo-ownership-warmup.ts` (new)

---

## Backlog — items identified but not yet addressed

Priority order based on user-impact, not difficulty:

1. **Frontend crash on Institutional page** — `TypeError: Cannot read
   properties of undefined (reading 'length')`. Hits when partial data
   is returned. Fix is defensive `?? []` guards in
   `client/src/pages/institutional.tsx` around lines 195, 212, 247, 282.
   ~4 lines of code.

2. **RSI / score consistency** — owner's "header grade doesn't match
   outlook grade" complaint. Scanner, verdict page, and gate logic each
   compute RSI on potentially different lookback windows / candle sources.
   Need to diff values across 20 tickers and reconcile. Files:
   `server/signal-engine.ts`, `server/scanner-v2.ts`,
   `server/signals/gates/`. This is the most strategically important
   item — the "verify the gurus" pitch dies if the same ticker shows
   different RSI on different pages.

3. **Stress comparison missing** — Long-term Outlook page no longer
   renders the historical stress event comparison.

4. **Gold/silver display** — PR #75 from the prior AI session
   ("Permanent metals fix: swap Yahoo GC=F/SI=F to FMP GCUSD/SIUSD")
   may not be fully working. Verify quotes and 25-year history actually
   render on the page.

5. **Explosion detector / Scanner v2 broken** — unspecified breakage in
   the scanner UI per owner. Investigate `server/scanner-v2.ts` and
   the `ExplosionCard` component.

6. **Admin cache visibility** — Admin panel shows "no cached
   information" even when caches exist. Likely a diagnostics endpoint
   wiring issue.

7. **SMTP credentials broken** — `[EMAIL] SMTP connection failed:
   Invalid login: 535 5.7.139` in logs. Probably needs a Microsoft 365
   App Password instead of the regular account password. Until fixed:
   no alert emails, no password resets, no Phase 4 notifications.

8. **`.env.bak*` cleanup** — multiple backup `.env` files lying around
   in `/opt/stock-analyzer/` from prior AI's edit-and-backup pattern.
   Delete the older ones; add `.env.bak*` to `.gitignore` so future
   backups don't accidentally get committed.

9. **Bot probes** — `URIError: Failed to decode param '%c0'` errors in
   logs from external scanners probing the site for vulnerabilities.
   Add Express error middleware to catch malformed URIs and return 400
   instead of letting them throw.

10. **Dead code** — `server/signals/gates/gate3-trend.ts` is an unused
    placeholder; the live gate logic is in `signal-engine.ts`. Remove
    or wire up.

11. **`package.json` local drift** — server has uncommitted local edits
    moving `tsx` from deps → devDeps. Currently in `git stash`. Either
    commit the change or discard the stash cleanly.

12. **FMP Personal → Commercial license** — owner is on FMP's Personal
    Use plan. Required to switch to Commercial Use before going wider
    with users (current setup is fine for pre-launch / small user base).

---

## Notes on the deploy workflow

- Repo: `ccutshaw66/stock-analyzer` on GitHub
- Server: self-hosted at `/opt/stock-analyzer/` on `imt-uv-helpdesk`
  (IP `68.171.198.222`)
- Process manager: pm2, app name `stock-analyzer`
- Auto-deploy: GitHub webhook fires on push to `main`, server pulls,
  pm2 auto-restarts
- Owner deploys via GitHub web UI (not git CLI). Two folders ⇒ two
  commits when changes span paths.

## Notes on data sources

- **Polygon Stocks Starter** ($29/mo) + **Polygon Options Starter** ($29/mo)
  — end-of-day data, sufficient for current pre-launch needs
- **FMP Premium** ($69/mo, Personal Use) — analyst data, insider Form 4,
  earnings, ratios, beta, gold/silver quotes
- **SEC EDGAR** — free, primary for 13F holdings; rate-limited per their
  fair-access policy (must include working contact email in User-Agent)
- **Yahoo Finance** — free unofficial API, used ONLY as background
  cache-refresh agent for fund holders, insider rosters, long-range
  charts (per architectural rule)

Total recurring data cost: ~$130/month. Stripe is wired in but not
actively monetizing yet.
