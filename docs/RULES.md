# Project rules — single source of truth

Every rule that governs how Stock Otter is built, deployed, and worked
on lives in this file. The meta-rule: **one file, one location.** If
you find a rule duplicated somewhere else in the repo or in any
Claude-session memory file, that copy is wrong by definition and
should be replaced with a pointer to the relevant section here.

Sections:

1. Working with Chris (personal workflow rules)
2. Build & structure (how code is organized — non-negotiable)
3. Auto-deploy (how code gets to production)
4. Backups (what we keep and for how long)
5. Reference library (the trading books)

---

## 1. Working with Chris

These are the rules for how any agent (Claude or otherwise) interacts
with Chris while working on this project. They are non-negotiable.

### 1.1 Chris is not a coder

Chris is the product owner of Stock Otter, not a developer. He cannot
answer questions phrased in code or engineering terms.

- Never ask "FastAPI or Flask," "TypeScript or Python," "which query
  library." Pick the reasonable default and move on.
- When a real decision is needed — scope, money, what the feature
  should do for users — phrase it in plain English with concrete
  outcomes: "Do you want X or Y? X means [user-visible thing], Y
  means [user-visible thing]."
- Status updates: describe what works, what doesn't, and what's
  blocking — in terms of pages and features, not classes and types.

### 1.2 Cut-and-paste workflow — ONE step at a time

Chris's own words: *"I am not a coder and I do 1 step at a time and
acknowledge and move to the next step. Works best for me."* Also:
*"As I have told several Claudes, I do cut and paste. That is it."*

The rhythm:

1. Give him ONE command.
2. He pastes it, runs it, and acknowledges (output, "ok", or "next").
3. Give the next ONE command, adjusted to what came back.
4. Repeat.

Never:

- Hand him a six-step checklist.
- Bundle multiple commands in one block.
- Ask him to edit a config file by hand — give him a one-liner
  (`sudo tee`, `sed -i`, etc.) that does it for him.
- Ask him to troubleshoot output — if a step fails, the next thing
  you give him is the diagnostic command, not "check the logs."

### 1.3 Just do it — when it's safe and reversible

When the next step is safe and reversible (local edits, local
commits, adding files, UI tweaks), just do it. Don't queue a question
— act, then report in plain English. Chris's exact phrasing:
*"do it and don't break my shit."*

Still ask before:

- Deploys / pushes to production
- Destructive git ops: force-push, hard reset, branch deletion
- Money-affecting changes
- Anything visible to other users (sending email/Slack, opening PRs)
- Scope changes that could surprise him

### 1.4 Backup before deploys — never delete without explicit OK

Before any deploy (push to production, Railway deploy, db migration,
schema change, anything touching a live system), create a backup
first. Don't delete that backup without Chris saying so explicitly —
even if the deploy succeeded and even days later.

How to apply:

- Local git commits are a form of backup — make one before any push.
- Before a db migration: `pg_dump` the affected tables (or whole db)
  and save somewhere durable.
- Before overwriting a deployed config: copy it aside first.
- Don't `rm`, `git branch -D`, or `git push --force` against backup
  refs.
- Backups get deleted only when Chris asks: "clean up old backups."

---

## 2. Build & structure

How code is organized in this repo. Violating these rules creates the
drift that makes the site harder to maintain.

### 2.1 Universal-structure rule — one file, one location

Every piece of metadata that more than one place needs (page icon,
page title, page subtitle, route, group, tier-gating) lives in
**exactly one file**. Other places read from that file — they do not
keep their own copy.

The canonical example: `client/src/lib/page-registry.ts` is the
single source for every page's icon + label + route + group + tier.
The sidebar (`AppLayout.tsx`) reads it via `getNavGroups()`. The
`<PageHeader />` component reads it via `lookupPageByPath()`. Add a
new page by adding one row to the registry — the sidebar and the
header chrome pick it up automatically.

If you ever find yourself "also updating" a second file to mirror
the first, the architecture is wrong. Make one the source of truth
and have the other read from it.

### 2.2 Compartment contract — the four guarantees

Every user-facing feature is a self-contained "compartment" with the
same shape. (Origin: Phase 1B in `MASTER_PATHWAY.md`, locked
2026-05-14.)

A compartment must provide:

1. **One canonical data hook.** Pages, widgets, alerts, and API
   endpoints all read through the same hook — never raw fetch().
   Lives in `client/src/compartments/<name>/use<Name>.ts`.
2. **Pure logic layer.** Calculations are pure functions with no
   vendor calls. Preserves swap-ability of data providers.
3. **At minimum two presentation modes:** a Full view
   (`<Name>FullView.tsx`) used by the full-page route, and a Widget
   view (`<Name>Widget.tsx`) for the dashboard. Additional modes
   (mobile, embed, alert preview) compose without touching data or
   logic.
4. **Registry entry.** A manifest exporting
   `{ id, name, tier, defaultSize, WidgetComponent, fullPageRoute }`
   in `client/src/compartments/<name>/index.ts`, registered in
   `client/src/compartments/registry.ts`. Adding a new compartment is
   **one new folder + one registry line**.

The page file at `client/src/pages/<name>.tsx` is a thin wrapper:
`<PageTemplate>` with the Full view from the compartment dropped in.
No business logic in the page file.

Worked examples in the repo: `compartments/hermes/`,
`compartments/markov/`, `compartments/wheel/`.

### 2.3 Backend layer dependency rule

`server/` is organized in layers. Each layer imports only from layers
below it. (From `ARCHITECTURE.md`.)

```
api  →  features  →  signals  →  indicators  →  data
```

`platform/*` (auth, tiers, billing, alerts, jobs, config, telemetry)
is accessible from any layer but never imports upward.

Violating this rule creates circular deps and makes vendor swaps
impossible.

### 2.4 No vendor names below the data facade

Anything that hits Polygon, FMP, EDGAR, or any other provider goes
through the adapter in `server/data/providers/`. Code outside `data/`
must never reference a provider by name. This is what lets us swap
vendors (e.g. the Yahoo kill) without rewriting features.

---

## 3. Auto-deploy

How code gets from your laptop to the live site.

### 3.1 Stockotter app (the Node/Express + Vite frontend)

```
Chris pushes to main on GitHub
      ↓
GitHub webhook fires (HMAC-signed payload)
      ↓
imt-uv-helpdesk receives webhook → runs deploy script
      ↓
Server: git pull → npm ci → npm run build → pm2 restart stock-analyzer
      ↓
pm2 picks up the new dist/index.cjs; /api/health reports the new SHA
```

**Atomic main+tag push** — every ship tags a `safe/<timestamp>`
rollback ref AND pushes main in a single atomic `git push`. The two
must go together; pushing tag and main as separate operations created
a deploy race that briefly served the wrong SHA (see CHANGES.md
2026-05-15). The `ship` skill enforces this.

### 3.2 Markov service (Python FastAPI on the same LTS server)

```
Chris pushes to main on GitHub (Stockotter monorepo, python/markov/**)
      ↓
Same webhook fires
      ↓
Deploy script also runs: bash /opt/stock-analyzer/python/markov/deploy/markov-deploy.sh
      ↓
markov-deploy.sh: idempotent pip install if requirements changed → systemctl restart markov
      ↓
nginx routes https://stockotter.ai/markov-api/ → 127.0.0.1:8001
```

Setup files live in `python/markov/deploy/`. See that folder's
`README.md` for one-time setup steps. Frontend constant lives at
`client/src/compartments/markov/useMarkov.ts` (`MARKOV_API`).

### 3.3 HERMES service

Currently on Railway (temporary). Target: GitHub repo of its own +
deploy to the same LTS server (same webhook pattern as Markov).
Tracked in `docs/TODO.md`.

### 3.4 Branch policy

- `main` is the only deployable branch. Pushes to `main` deploy
  immediately.
- Feature work happens in worktree branches (`claude/...`,
  `feature/...`) and lands via merge or rebase to `main`.
- Never force-push `main`. Tags `safe/<timestamp>` are immutable —
  never delete them.

---

## 4. Backups

Full detail in `docs/BACKUP.md`. Short version:

- Nightly at 03:00 server time on `imt-uv-helpdesk`.
- Two artifacts per run: code tarball + `pg_dumpall` SQL dump.
- Stored at `/opt/backups/stock-analyzer/`.
- 7-day retention; older auto-pruned.
- Log: `/var/log/stock-analyzer/backup.log` (8-week retention).

See `BACKUP.md` for install, restore steps, and the on-disk layout.

---

## 5. Reference library

18 trading / quant PDFs live at `docs/books/`. See:

- `docs/books/README.md` — short in-repo table of contents.
- `~/.claude/projects/C--Stockotter/memory/trading_books.md` — the
  detailed index: per-book "when to consult this" notes and a
  feature-to-book cross-reference table.

**Privacy invariant:** these are commercial books. The Stockotter
repo MUST remain private. Flipping it public requires removing
`docs/books/` first.

---

## How to extend this document

If you discover a new rule (something Chris said, a constraint that
was implicit, a pattern that should now be load-bearing), add it
here. If you find a rule duplicated elsewhere in the repo or in any
Claude-session memory file, **replace that copy with a pointer to
this file's section** — that's how "one file, one location" stays
true over time.
