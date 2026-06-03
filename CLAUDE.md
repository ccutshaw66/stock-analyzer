# StockOtter — Project Rules

**First, follow the global operating rules in `~/.claude/CLAUDE.md`** (simple > complex;
ONE source of truth — pull once, cache, reuse; one approval covers the whole job, never
re-ask mid-task; snapshot before executing, never ask; verify before claiming done;
sanity-check before shipping; report once, plainly). Everything below is ADDITIONAL and
stockotter-specific.

Owner: Chris Cutshaw — owns stockotter.ai. Cut-and-paste coder: give exact CLI steps in
order with what to expect.

## Deploy / shipping
- **Verbal approval = ship directly to `origin/main`.** No PR branch, no manual-merge
  ceremony. `main` is production — pushing it auto-deploys via GitHub webhook → pm2 on
  imt-uv-helpdesk.
- **Always snapshot first:** tag the current HEAD `safe/<timestamp>` BEFORE committing, and
  push `main` + that tag in ONE `git push` (one webhook = one deploy). Use the `ship` skill.
- **Every code change ships with a `CHANGES.md` entry** (one entry per completed change, not
  per commit — newest on top, with **why** + **what**). Use the `changes-entry` skill.
- **Sanity-check before every ship:** `npm run build` (the real deploy gate) must pass, plus
  verify the actual user-facing behavior of what changed. Use the `verify-work` skill. Never
  push red or unverified.
- Name files explicitly when staging. Never `git add -A`/`.`, never `--no-verify`.

## One source of truth — pull once, cache, reuse (PRIMARY — see global rule #2)
- A given fact (P/E, price, a fundamental, a ratio) has ONE canonical fetch path. If it shows
  on 10 pages/widgets, it is fetched ONCE and reused — never pulled 10 times from 10 places.
- Read shared data through the existing compartment / shared hook / snapshot layer that
  already owns it. Do NOT add a second, parallel fetch for the same number — that causes
  cross-page drift (the same value disagreeing between pages) and wastes API calls.
- This data is essentially static for a while, so the first call should serve everything for
  a long time. New widget needs a number that already exists somewhere? Reuse that source.

## Data providers
- **FMP is the data source.** Yahoo and Polygon are being killed — do NOT add new callers to
  either. Find FMP endpoints/field names with the `fmp-endpoint` skill instead of guessing.
- Cache aggressively (quarterly/historical data on a quarterly/earnings cadence, not per
  request). Splits/corporate actions: long TTLs.

## How features must be built (no independent builds)
- Everything plugs into the existing structure: compartments / widgets / registries / shared
  design tokens. No parallel structures, no hard-coded forks, additive schemas. A new thing
  should make the next thing easier.
- Widgets must be moveable — work anywhere on the site, not just one page.
- UI clears a professional fintech bar (TradingView/Webull standard): brand discipline,
  typography hierarchy, and branded empty / loading / error states. Use design tokens, not
  raw hex/Tailwind palette.

## Strategy / indicator work
- Backtests and sanity tests use Chris's HTF universe ($5–$75 price band) — a ~$7K account
  can't trade mega-caps, so mega-cap numbers mislead.
- No indicator carries weight in a score until it's validated out-of-sample, SPY-relative
  (use the `quant-validator` agent / validation harness).

## Memory
- Persistent project memory lives in `~/.claude/projects/I--stockotter/memory/`. `MEMORY.md`
  is the index, loaded each session. Read it; keep it updated when you learn something
  non-obvious that isn't already in the code/CHANGES.md/git history.
