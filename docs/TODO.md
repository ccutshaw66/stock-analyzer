# TODO

Plain-English running list of work items that aren't urgent enough to be
in flight, but shouldn't be lost. Each item: one paragraph in plain
English, plus a "why" so future-you knows it still matters.

Source of items: things you've flagged in CHANGES.md ("follow-up", "audit
finding"), open rows in `docs/MASTER_PATHWAY.md` (status ⬜), and stub
TODOs left in the code.

## Deployment

### Move HERMES code into GitHub, then onto our own server

**Where it is today.** The HERMES Python project lives on disk at
`C:/Hermes/hermes-trading/`. A copy is archived inside this repo at
`python/hermes/` for safekeeping, but neither location is actually
deployed from. The running HERMES service is on **Railway**, built from
whatever was last pushed there manually.

**Why move it.** Railway hosts the build but the *source of truth*
should be GitHub (same as Stockotter). Right now the local folder, the
archive copy, and what's deployed can all drift. Adding the HERMES
project to its own GitHub repo gives us: version history, a single place
to edit, and a clean path to redeploy.

**What to do, in order:**
1. Create a new GitHub repo (suggested name: `hermes-trading`).
2. Push `C:/Hermes/hermes-trading/` (excluding `.env`, `state/`,
   `__pycache__/`) to it as the initial commit.
3. Point Railway at that GitHub repo (Railway → "Deploy from GitHub" →
   pick the repo). Railway will rebuild on every push.
4. Later: move HERMES off Railway and onto our own server (same box as
   Stockotter, or a separate VM). At that point, update the
   `HERMES_API` constant inside
   `client/src/compartments/hermes/useHermes.ts` to the new URL.

**Status:** Not started.

### Deploy Markov to the LTS server (skip Railway)

The Markov backtest page is wired up. Python code + FastAPI wrapper +
Dockerfile + requirements all live in `python/markov/` (committed as
part of the Stockotter monorepo). Deployment target is the same LTS
server as Stockotter (`imt-uv-helpdesk`) — NOT Railway. The GitHub
webhook that already updates Stockotter should also pull and restart
the Markov service.

**What to do, in order:**
1. Pick the deploy layout on the LTS box. Suggested:
   - Code lives inside the existing Stockotter checkout
     (`/opt/stock-analyzer/python/markov/`) — keeps one git pull.
   - Python venv at `/opt/markov/venv/` so it's isolated from system Python.
   - systemd unit `markov.service` runs `uvicorn app:app --port 8001`
     out of `/opt/stock-analyzer/python/markov`.
   - nginx routes a path (e.g. `/markov-api/`) on the existing
     `stockotter.ai` host to `127.0.0.1:8001`. Avoids CORS entirely.
2. Extend the existing Stockotter deploy hook so a push that touches
   `python/markov/**` triggers `systemctl restart markov` (and a
   `pip install -r requirements.txt` when `requirements.txt` changes).
3. Set `MARKOV_ALLOWED_ORIGINS=https://stockotter.ai` in the service
   env file.
4. Once the service is live, change ONE line in
   `client/src/compartments/markov/useMarkov.ts`:
   ```ts
   export const MARKOV_API: string | null = "https://stockotter.ai/markov-api";
   ```
   The "Awaiting Python service deployment" warning disappears
   automatically.

**Status:** Wrapper written, awaiting server-side setup.

### Markov service: switch from yfinance to FMP

The current `python/markov/app.py` pulls price history via `yfinance`,
which contradicts the broader "kill Yahoo" stance. Acceptable temporarily
because Markov is research/experimental, but eventually rewrite the
download path to call FMP's `/historical-price-eod/full` endpoint
directly (plain `requests`, no Python SDK needed). Then drop `yfinance`
from `requirements.txt`.

**Status:** Not started.

## Compartment refactors (Phase 1B continuation)

`docs/MASTER_PATHWAY.md` Phase 1B locked the "every feature is a
compartment" contract on 2026-05-14. Three Experimental compartments
landed today (HERMES, Markov, Wheel). The original locked queue still
has these open:

- **Scanner v2 → compartment** (1B.4) — driven by Dashboard's "Best
  Opps" widget. Effort M.
- **Favorites / Watchlist → compartment** (1B.5) — also the *template
  compartment*. Effort S. (Note: a thin Favorites compartment with
  `WatchlistWidget` exists, but the full-page Favorites panel still
  uses the legacy component — finish the strangler migration.)
- **Trade Tracker → compartment** (1B.6) — biggest. Pre-decision
  needed: client vs server ownership of P/L computation. Effort L.
- **Subsequent compartments** (1B.7) — Earnings, Track Record, MM
  Exposure, Verdict, Dividend Finder, Sector Heatmap, Strategy Chart,
  Profile, Signal Pulse, Alerts, Admin. Each refactored on-demand when
  a widget round needs it.

## Quality & verification

### Add `npm run build` to the verify-work skill

Flagged in CHANGES.md 2026-05-15. The current `verify-work` runs
`npm run check` (TypeScript only) but not `npm run build`, which means
bundler-level errors (Vite import resolution, etc.) can ship. Adding
the build to the verify pass closes that gap.

### Sentry integration (Phase 2.1)

`server/platform/telemetry/index.ts` is a stub with `TODO: Sentry.init()`
and console fallbacks. `SENTRY_DSN` is wired into config but never
consumed. Without this, server errors don't aggregate anywhere.

### Zod request validation on all `/api/*` endpoints (Phase 2.7)

There is currently zero `z.` usage in `server/`. Drizzle-zod is wired at
the schema layer but request-body validation is not. Adds a uniform
input-validation layer so malformed POSTs return a clean 400 instead of
crashing inside a handler.

## GA blockers (Phase 6 in MASTER_PATHWAY)

These are listed in `docs/MASTER_PATHWAY.md` as gates to public launch.

- **FMP upgrade to commercial tier** (6.2) — current tier is hobby; GA
  load will breach rate limits.
- **Staging environment separate from prod** — separate DB and keys, so
  test data can't pollute production. (6.4)
- **Load test scanner + MM Exposure at 100 concurrent users** — the two
  heaviest endpoints; needs a baseline before opening signups. (6.5)

## Code cleanup (site-wide audit findings)

Flagged in CHANGES.md 2026-05-15 under "Site-wide audit findings (not in
this ship — surfaced for follow-up)":

- **Kill remaining Yahoo references** — ~369 in client + server code.
  Yahoo is slated for kill per memory; FMP + SEC EDGAR cover the same
  data.
- **Kill remaining Polygon references** — ~224 in client + server code.
  Same deal as Yahoo.
- **SEC N-PORT for fund holdings** — the work item that retires Yahoo
  for fund/ETF holdings refresh. Listed as ⬜ Not started in
  MASTER_PATHWAY.
- **Tailwind palette → semantic tokens** — ~608 raw palette classes
  (`text-green-400`, `bg-red-500/15`, etc.) used for signal colors
  instead of the new tokens (`text-bull`, `bg-bear/15`). Visually
  identical today but breaks the "single source" guarantee — a future
  palette change won't reach them.

## Mechanical migration sweeps

These are "go through and update call-sites" sweeps — none is hard,
each is just tedious.

- **Endpoints with embedded path params** — e.g. `/api/alerts/${id}/read`,
  `/api/alert-rules/${id}`. Catalog has path-builder helpers; call-site
  migration is mechanical. (Flagged in CHANGES.md 2026-05-15.)
- **Scanner page migration to `useScannerV2`** — the compartment hook
  exists; the full Scanner page still has its own sessionStorage code.
  (CHANGES.md Round 5 follow-up.)
- **Trade Tracker page migration to `shared/pnl/` + `useTrades`** —
  retires the duplicated `computeStockPL` / `computeOptionPL` /
  `aggregateOpenPositions` functions on the page. (CHANGES.md Round 5
  follow-up.)
- **SignalDot helper cleanup** — Trade Analysis still has the legacy
  `SignalDot` Recharts dot renderer in-file (unused after migration).
  Prune in a follow-up sweep along with the unused Recharts imports.

## Stub implementations (real, code-level TODOs)

Each of these is a file in `server/platform/*` or `server/signals/gates/*`
that has a `TODO` comment and currently does nothing — it returns a
placeholder. Worth knowing they exist before they get accidentally
relied on.

- **Email alert provider** — `server/platform/alerts/providers/email.adapter.ts`
  is empty (no SendGrid/SES integration).
- **Webhook alert provider** — `server/platform/alerts/providers/webhook.adapter.ts`
  is empty (no POST + retry loop).
- **Database backup job** — `server/platform/jobs/jobs/backup-database.ts`
  is empty (no `pg_dump → S3` pipeline).
- **`check-outcomes` job** — empty: should query `signal_log` for
  unfilled outcomes whose lookback has matured and compute returns.
- **`log-daily-signals` job** — empty: should iterate tracked tickers,
  call `signals.evaluateConfluence()`, persist to `signal_log`.
- **Stripe billing provider** — `server/platform/billing/index.ts` has
  `TODO: implement stripeProvider in ./stripe.adapter.ts and wire here`.
- **Gate 2 momentum thresholds** — `server/signals/gates/gate2-momentum.ts`
  has a starting spec but the actual thresholds are not formalized.
- **Gate 3 trend / MME alignment** — `server/signals/gates/gate3-trend.ts`
  has a `TODO` for the EMA-stack trend check and the MM-Exposure
  alignment check.
- **Redis-backed cache** — `server/data/cache.ts` is in-memory; the
  TODO says "replace with Redis-backed impl in platform/config.ts" for
  multi-instance deploys.

## From past sessions (re-captured 2026-05-23)

Items you raised in earlier chats that weren't on this list yet. Sources:
the May 5 institutions/Yahoo-kill session, and the May 23 menu-integration
session. Some of these may have been resolved since — verify before
working on, but I'd rather have them on the list than lose them.

### Wire up FMP Fund Holders endpoint

The Institutions page **Fund Holders** tab is empty because the legacy
Yahoo path was killed (commit `fb76f49`, 2026-05-05) but the FMP
equivalent was never wired in. Was explicitly called out as the next
day's task: "find the right FMP stable endpoints for fund holders…
and wire them up." Source: May 5 session, last message.

### Wire up FMP Insider roster (current holdings) endpoint

Same situation as Fund Holders — the **Insiders** tab on the
Institutions page (current holdings, not the recent-transactions list,
which already works via `/insider-trading/search`) is empty pending the
FMP roster endpoint. Source: May 5 session, last message.

### Institutional cache: every stock we cover, daily refresh

You explicitly asked for the institutional list to cover *all* tickers
(your phrasing: "I want all 3000 stocks in the cache if I have to") with
a once-a-day refresh — institutional data does not change second-by-second,
so a daily snapshot is fine and dramatically reduces FMP load. Today the
warmup is a fixed list (50 tickers).

### Vary the Institutions ticker set — stop hammering the same 50

Tied to the cache item above. Your complaint: "the same 50 tickers are
a waste of time. There are a hell of a lot of tickers that have major
institutional movement. Not just AAPL, NVDA, MSFT, JPM, etc."  Once the
all-stocks cache exists, the page surfaces variety automatically. In
the interim, even a top-30 + rotating-20 pattern would resolve the
complaint.

### Decide on Polygon vs FMP — possibly cancel Polygon

May 5 quote: "I pay for Polygon and FMP and they don't seem to be used.
… Is there not one service I can pay for that gives me all I need and
is reliable?"  Now that FMP Ultimate is paid and Yahoo is dead, the
question is whether Polygon's coverage overlaps enough with FMP to
cancel the Polygon subscription. Action: audit what each service is
actually used for, recommend keep/drop. (Related: the ~224 Polygon
references in the code-cleanup section above — they collapse to zero
if Polygon gets killed.)

### Permission bypass mode toggles on but still prompts

May 23 quote: "i need to know why i can't allow by pass permissions. I
turned it on already." UI flag flipped but Claude Code is still
prompting for permission on individual actions. Needs investigation —
likely a hooks/settings.json wiring issue rather than a real toggle
problem.

## Reference library

### Reference library is in place (2026-05-23)

All 18 trading PDFs are now copied into the repo at `docs/books/` and
fully indexed in
`~/.claude/projects/C--Stockotter/memory/trading_books.md`. Adds ~50MB
to the repo. **Status: 18 of 16 indexed** (over the target — Chris
said ~16, actual count was 18).

**Privacy invariant:** the repo MUST remain private from here on.
Flipping it public requires removing `docs/books/` first — these are
commercial books and the source pages (InfoLibros / InfoBooks) host
them under personal-study terms only.

### Migrate `docs/books/` to Git LFS

The 18 PDFs in `docs/books/` add ~54MB of binary content to the repo.
Regular git stores every version of every file forever — fine for text
diffs, expensive for binaries. Today the impact is mild (one-time
cost), but every future clone, fresh worktree, and CI checkout pays
that ~54MB toll, and any future replacement of a PDF doubles its slice
in the pack file.

**Git LFS** (Large File Storage) is the standard fix: the actual PDF
bytes live in a separate object store, the repo only carries small
pointer files. Clones get fast again; only `git lfs pull` downloads
the books, and only when needed.

**What to do, in order:**
1. Install Git LFS once on your machine: `git lfs install`.
2. From the repo root: `git lfs track "docs/books/*.pdf"` — this creates
   a `.gitattributes` rule that future PDFs auto-route to LFS.
3. Migrate the existing PDFs out of normal git history into LFS:
   `git lfs migrate import --include="docs/books/*.pdf"` (rewrites
   history — needs a force-push, but the repo is solo, so it's safe).
4. Push: `git push --force origin main` (or merge via PR first; same
   end state).
5. Verify with `git lfs ls-files` — you should see all 18 PDFs listed.
6. On the GitHub side: Settings → Storage and bandwidth — confirm LFS
   is enabled. The free tier covers 1 GB storage + 1 GB/month bandwidth,
   which is plenty for 54MB.

**Why not do it right now:** the migration rewrites git history. That's
safe on a solo private repo but takes a couple of minutes to push and
re-clone, and it's worth doing as its own focused task — not bolted
onto a feature ship.

**Status:** Not started.

## Resolved — keep for reference

Lessons learned that future-me should not have to rediscover.

### Claude Desktop does not allow bypassPermissions — use Auto mode instead (resolved 2026-05-23, take 2)

First attempt: set `defaultMode: "bypassPermissions"` +
`skipDangerousModePermissionPrompt: true`. On the CLI this works. On
**Claude Desktop** (`CLAUDE_CODE_ENTRYPOINT=claude-desktop`) it
silently rejects with a UI error: *"Permission mode couldn't be
changed. You can try again."* Desktop appears to restrict full bypass
mode for safety.

The right mode for Claude Desktop is **`auto`** — it uses a built-in
classifier to silently allow safe actions (reads, listings, edits in
the project tree) and only prompts for genuinely risky ones
(self-modification of Claude's own settings, force pushes, destructive
deletions). The acceptance flag is `skipAutoPermissionPrompt: true`,
mirroring the bypass-mode pattern.

Fix that actually works at user level (`~/.claude/settings.json`):
```json
{
  "permissions": { "defaultMode": "auto" },
  "skipAutoPermissionPrompt": true
}
```

Verification: every session start prints either
`[OK] Auto mode active...` or a `[WARN]` via the SessionStart hook in
the same file.

Two related schema fields worth knowing about:
- `disableAutoMode: "disable"` — can be set in managed settings to
  block auto mode (we don't want this).
- `disableBypassPermissionsMode: "disable"` — likely what Claude
  Desktop is enforcing internally; you can't override it from user
  settings.

## Deferred / parked

Things explicitly punted in past ships:

- **Strategy Chart regime bands** — Lightweight Charts has no native
  shaded-region API. Adding back the bullish/bearish background tint
  needs either a custom DOM overlay synced to the time axis or a
  semi-transparent series. (CHANGES.md 2026-05-15.)
- **Wheel page** — alerts shipped (PR #57); Wheel was the next surface
  to get them and was parked. Worth revisiting now that the Wheel
  compartment exists. (MASTER_PATHWAY line 59.)
- **New-holder QoQ surfacing on Institutions** — a brand-new holder
  with no prior-quarter baseline currently reports `changeQoQ = 0`
  (rather than +∞). If a holder is also < $100M they get filtered out.
  Flagged as a follow-up if we want new entrants surfaced as a class.
  (CHANGES.md 2026-05-06.)
