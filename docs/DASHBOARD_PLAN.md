# Stockotter — Custom Dashboard Plan

**Owner:** Chris Cutshaw
**Started:** 2026-05-14
**Status:** Planning — no code yet. Decisions locked one round at a time.
**Approach:** AskUserQuestion rounds (3–4 per round). After each round, this doc is updated. Nothing is built until the round-by-round design is complete and Chris approves the build phase.

> **Goal:** A trading dashboard at `/dashboard` that members can customize to make their own — starting with a fixed catalog they can show/hide/reorder, with a clear migration path to full drag-and-drop widget placement later.

## Guiding principles (override shortcuts)

Two principles override any "ship fast" instinct in this plan. Every round is evaluated against both.

### P1 — Better foundation for the future
Pick the option that makes the *next* thing easier, not the one that's fastest to type now.

- Persistence schemas must be additive (new fields ship without rewriting old data).
- Widget contracts must be self-contained even when v1 doesn't require it.
- "We'll fix it later" is acceptable only when the fix is genuinely cheap; when it's not, pay the cost up front.
- Anywhere we'd otherwise hard-code a value, evaluate whether it should be config from day 1.

### P2 — Always innovating, always updatable
Stockotter is never "done." Build the dashboard so widgets, tabs, signals, and layouts can keep evolving without an architectural rewrite each time.

- Plugin/registry catalogs over hardcoded lists. A new widget should be **one new file + one registry line**, not edits across call sites.
- Feature flags / config over forks. New variants toggle on; they don't branch a copy of the code.
- Frozen-but-fast loses to tweakable-and-slightly-more-work-now.
- Litmus test for any choice: *would a future Chris hate having to update this?* If yes, redesign.

### P3 — Compartment contract (locked R2.5, 2026-05-14)
Every feature on the site is a compartment with a defined contract — server module → one canonical data hook → at minimum a Full view and a Widget view → one registry entry. Dashboard widgets are not bespoke code; they are **compositions of existing compartments**. Adding a new compartment is **one new file + one registry line**.

Full Phase 1B definition lives in `docs/MASTER_PATHWAY.md` (locked). Audit findings (12 features scored against the 4-point contract) live in `~/.claude/plans/compartment-works-lock-it-velvet-pillow.md`. This principle gates the dashboard build: every v1 widget depends on its underlying feature being a compartment first.

**V1 refactor order (locked):**
1. **Favorites / Watchlist** (effort S) — already mostly compartment-shaped. Becomes the *template compartment* (worked example of the contract). Ships "Watchlist" widget.
2. **Scanner v2** (effort M) — extract `useScannerV2()` hook, retire `sessionStorage`, unify scan modes. Ships "Best Opps" widget.
3. **Trade Tracker** (effort L) — requires pre-decision on client vs server P/L ownership. Ships "My Trades" widget.

Per-widget rounds will design **both** the compartment refactor AND the widget UX in the same pass.

---

## Locked decisions

| # | Decision | Round |
|---|---|---|
| 1 | **Location:** new `/dashboard` route (alongside existing pages, no replacement) | R1 |
| 2 | **Audience:** logged-in members only — non-members do not see it | R1 |
| 3 | **v1 customization shape:** Option 2 — fixed widget catalog, members can show/hide and drag to reorder | R1 |
| 4 | **v1 size:** 2–3 widgets in v1. My Trades + Best Opps of the Day confirmed. Watchlist confirmed as third. Everything else captured as v2 backlog. | R1 / R2 |
| 5 | **Tab model:** Tabs at the top of the dashboard. Each tab is its own widget set (e.g. "Day Trade", "Swing", "Earnings"). Members create/name/reorder their own tabs. | R2 |
| 6 | **Inter-widget comms:** Shared "selected ticker" bus only. Any widget can read/write the currently selected ticker; no other cross-widget events in v1. | R2 |
| 7 | **Prerequisites:** Auth + DB infrastructure to be audited before Round 3 commits any persistence design. | R2 |
| 8 | **Watchlist data source:** reuse existing `favorites` table (`listType: "watchlist"`) — do NOT create a new model. | R2 audit |
| 9 | **Selected-ticker bus:** reuse existing `TickerContext.activeTicker` — do NOT build a new one. | R2 audit |
| 10 | **Auth contract:** server can assume `req.user = {id, email, displayName}` after `requireAuth` middleware. Dashboard routes will be mounted behind it. | R2 audit |

---

## Confirmed infrastructure (R2 audit, 2026-05-14)

The audit grounded the next rounds in reality. File:line citations included so future-us can verify before acting.

- **Auth is live.** JWT in HttpOnly cookie; `requireAuth` middleware sets `req.user = {id, email, displayName}` per request. `server/auth.ts:45-65`. Subscription tiers + Stripe IDs already on the users table (`shared/schema.ts:5-17`), so tier-gating the dashboard later is cheap.
- **DB: Postgres + Drizzle ORM.** Schema in `shared/schema.ts`. Migration tooling already in place (`drizzle.config.ts`).
- **No existing per-user JSON-blob pattern.** Closest precedent: `alertRules.config` text column at `shared/schema.ts:159` (JSON-encoded). Per P1/P2: persistence-schema round should propose a dedicated `dashboardLayouts` (or similar) table with a **JSONB** column (not text) so the layout shape can evolve additively without migrations.
- **Watchlist already exists.** `favorites` table at `shared/schema.ts:19-29` — `listType` is `"watchlist"` or `"portfolio"`, with per-ticker `verdict` and `score`. CRUD routes at `server/routes.ts:2984-3092`. **Watchlist widget reads from this.**
- **Selected-ticker bus already exists.** `TickerContext.activeTicker` at `client/src/contexts/TickerContext.tsx:21`. Already used by other pages. **Dashboard widgets read/write here — no new global state primitive.**
- **Frontend state mgmt:** React Context + TanStack Query v5. Pattern is dedicated contexts per concern (AuthContext, TickerContext, TimeframeContext). New dashboard state (visible widgets, current tab) follows the same pattern.

### Implications for the plan
- Two flagged problems are now resolved (Watchlist source of truth; bus implementation). See updated Problems list below.
- Persistence-schema round just got cheaper. Drizzle + JSONB is a known quantity; schema is naturally additive.
- Subscription tier is already on users — dashboard can be tier-gated later. Capture as backlog, do not design for it in v1.
- Audit was point-in-time on 2026-05-14. Verify any file:line before relying on it in code.

---

## Why Option 2 (show/hide + reorder) over the alternatives

Picked deliberately as the cleanest path to "full custom" later:
- Every widget must be a **self-contained unit** from day 1 (own ID, own state, renderable standalone).
- Persistence schema for v1 is "list of widget IDs in some order" — full-custom just adds `{x, y, w, h}` per entry.
- Migration to full-custom = swap CSS layout for a grid engine (e.g. react-grid-layout) + add a widget picker UI. The widget code itself doesn't change.
- The discipline of "widgets are isolated" prevents the tight coupling that would make a future rebuild painful.

---

## Widget catalog (v1 and beyond)

### v1 (committed)
- **My Trades** — personal trade list, pulled from existing Trade Tracker. Integration point: `Trade Tracker analytics with MFE/MAE + position-duration breakdown` (per MASTER_PATHWAY).
- **Best Opps of the Day** — top scanner picks. Integration point: existing Scanner v2 (~12 confluence signals, `server/scanner-v2-signals/*`).
- **Watchlist** — manual list of tickers the user follows. Each row shows quote + sparkline + maybe a strategy badge. **Reads from existing `favorites` table** (`listType: "watchlist"`), routes at `server/routes.ts:2984-3092`. No new model.

### v2 backlog (capture as we go — nothing committed)
- *(empty — Chris to brain-dump candidate widgets in a later round)*

---

## Potential problems / patterns to watch

Flagged early so Chris isn't surprised by the time/effort cost of certain choices.

1. **Widget data freshness vs cost.** Each widget that fetches live data adds load. We'll need a per-widget refresh policy (manual refresh? polling? websocket?). Likely belongs in the engine round, not per-widget.
2. **Auth dependency.** "Members only" means we depend on the existing auth system. If member accounts don't yet exist or are partial, the dashboard either blocks on that work or ships behind a temporary gate. Open question in Round 2.
3. **Persistence schema lock-in.** The shape we pick for "user → list of visible widgets in order" needs to be forward-compatible with the eventual `{x, y, w, h}` grid model. Cheap to do right now, expensive to migrate later.
4. **Widget contract drift.** If two widgets share state or hard-code each other's IDs, "self-contained" breaks and the full-custom rebuild gets painful. Mitigation: every widget round produces a contract spec (props in, events out, persisted state).
5. **Tab CRUD complexity.** Tabs at the top means we need: create tab, name tab, delete tab, reorder tabs, default tab on first visit, max tab count, what happens when a member deletes their last tab. Tab UI is its own design surface — likely a dedicated round.
6. **Mobile.** Drag-to-reorder on touch is a different UX. Defer decision until the engine round, but flag now.
7. **Best Opps definition.** "Best" is subjective — which scanner signal? Top N by what? User-tunable? Goes in the per-widget round.
8. **My Trades scope.** Open positions? Today's fills? All time? Sortable? Same — per-widget round.
9. ~~Watchlist source of truth.~~ **RESOLVED R2 audit:** reuse `favorites` table, `listType: "watchlist"`.
10. ~~Selected-ticker bus shape.~~ **RESOLVED R2 audit:** reuse `TickerContext.activeTicker`. Open sub-question: does it persist across page reloads? Currently in-memory only — probably fine for v1.
11. **Tab-scoped vs global selected ticker.** Does AAPL clicked on the Earnings tab also become "selected" on the Day Trade tab? Default: global within session. Decide at engine round.
12. **Default tabs for new members.** First-time experience matters. Likely one preset tab ("Overview") with the three v1 widgets. Open: is the preset editable, deletable, or permanent? Default per P2: editable, can be deleted, but recreated if user has zero tabs.
13. **Tier gating (backlog, not v1).** Users already have a `subscriptionTier` column. Some widgets may eventually be tier-gated. v1 ignores this; v2 round designs the gating UX.
14. **Layout-engine choice.** Even for "show/hide + reorder" v1, we have to pick: HTML5 drag-and-drop, `react-dnd`, `dnd-kit`, or `react-grid-layout` (which already supports show/hide + reorder and is the eventual full-custom engine). Per P1: picking `react-grid-layout` now even though v1 doesn't need its full power means zero migration when we go full-custom. Engine round decision.

---

## Open questions (carry forward)

Resolved in R2: third widget (Watchlist), tabs model (tabs at top), inter-widget comms (selected-ticker bus).
Resolved in R2 audit: auth wiring, DB choice (Postgres+Drizzle), state-management (Context+TanStack Query), watchlist model exists (`favorites`), bus exists (`TickerContext`).

Open going into R3 — pick the next round's focus from this list:

**Compartment-prerequisite questions (locked R2.5 — must answer before Favorites refactor starts):**
- [x] **Q-C1: Scanner v2 sessionStorage** → **Persisted TanStack Query cache.** Replace sessionStorage with a TanStack Query persistor. Canonical hook is the only source of truth; survives refresh; future widgets reuse it. (R3a, 2026-05-14)
- [x] **Q-C2: Verdict score divergence** → **Surgical fix now.** Delete the `computeScoring` legacy fallback from `/api/verdict` (`server/routes.ts:4454-4525`); force the route to use `scoreSnapshot` only. ~1-2h. Lands before Favorites refactor so future compartments can depend on verdict without inheriting divergence. (R3a, 2026-05-14)
- [x] **Q-C3: Trade Tracker P/L ownership** → **Shared pure-function module.** Put `computeOptionPnL` + `computeStockPnL` + `aggregateOpenPositions` in `shared/pnl/` as pure functions. Server endpoints AND client widgets import the same module. Matches existing `shared/schema.ts` pattern. (R3a, 2026-05-14)
- [x] **Q-C4a: Per-compartment layout** → **Folder per compartment.** `server/compartments/<name>/` and `client/src/compartments/<name>/`. Each folder owns its own `index.ts` (manifest + exports), routes/hooks, Full view, Widget view, tests. Server-only compartments (e.g. Signal Pulse) skip the client folder. (R3b auto-decided per P1/P2, 2026-05-14)
- [x] **Q-C4b: Registry location** → **Central registry per side, imports each compartment.** `server/compartments/registry.ts` collects server entries; `client/src/compartments/registry.ts` collects client entries. Adding a compartment = create the folder + one import line in each registry. (R3b auto-decided)
- [x] **Q-C4c: Manifest type** → **Shared base + side-specific extensions.** `shared/compartments/types.ts` defines `CompartmentMeta` (id, name, tier, fullPageRoute). Server entries extend it with `dataAccessor` + `mountRoutes`; client entries extend with `useHook`, `FullView`, `WidgetView`, `widgetDefaultSize`. Widget block is optional — compartments without a dashboard widget yet just omit it. Progressive contract. (R3b auto-decided)
- [x] **Q-C5: Compartment folder naming** → **Rename `server/features/` → `server/compartments/` + add `client/src/compartments/`.** Uniform naming. Cheap now since `features/*` is mostly stubs. (R3a, 2026-05-14)

**Dashboard-internal questions:**
- [ ] **Tab CRUD design:** how members add/rename/delete/reorder tabs. Default tab(s) for new members. Tab limit. Editability of preset.
- [ ] **Persistence schema:** forward-compatible JSONB shape for `user → tabs → widgets → widget config`. Per P1/P2: additive, not lock-in.
- [ ] **Engine choice:** `react-grid-layout` (v1 + full-custom-ready) vs simpler v1-only options. Per P1, lean toward the former.
- [ ] **Per-widget design rounds:** My Trades scope, Best Opps definition, Watchlist behavior (each one round, paired with the compartment refactor for the underlying feature).
- [ ] **Widget refresh policy:** auto-poll? Manual refresh button? Per-widget? Goes with the engine round.
- [ ] **First-paint UX:** what does a brand-new member see on first visit to /dashboard?

---

## Round log

### Round 1 — Foundation (2026-05-14)
- Asked: location, audience, customization shape, v1 size.
- Decisions: see Locked decisions table above.
- Re-asked customization & size with migration-cost framing (Chris asked "which is easiest to update later?") — settled on Option 2 + 2–3 widgets + backlog doc.

### Round 2 — Prereq scope, third widget, tabs (2026-05-14)
- Asked: tab meaning, audit need, third widget, inter-widget comms.
- Decisions: Tabs at top with own widget sets; audit before proceeding; Watchlist as third widget; shared selected-ticker bus only.
- Mid-round feedback from Chris #1: **"always think in terms of what is going to be the foundation to plan for better in the future."** Promoted to Guiding Principle P1.
- Mid-round feedback from Chris #2: **"always innovating and always updating and updatable."** Promoted to Guiding Principle P2.
- Audit completed by Explore agent. Two flagged problems resolved (Watchlist data source = `favorites` table; selected-ticker bus = `TickerContext.activeTicker`). Two new infrastructure facts added to Locked decisions.

### Round 2.5 — Architectural pivot to site-wide compartmentalization (2026-05-14)
- **Chris's insight:** "I need everything compartmentalized. All parts of this site, the scanners, the dividend finder, etc. If we do that then every call to a widget is minimal. Just like when we only use one RSI reference."
- Reframed the entire dashboard build as a **consumer of compartments**, not a parallel system. Promoted to plan-doc Principle P3.
- Added to `docs/MASTER_PATHWAY.md`:
  - **Principle #6** (locked): every feature is a compartment, end-to-end.
  - **New Phase 1B — Universal Compartment Contract** between existing Phase 1 and Phase 2 (locked).
  - Parking-lot entry folded into Phase 1B; dashboard added to parking lot as depending on 1B.
- **Term locked:** "compartment." Chris confirmed ×3.
- **Phase 1B task 1B.1 (audit) completed.** 12 features scored against the 4-point contract. Findings live in `~/.claude/plans/compartment-works-lock-it-velvet-pillow.md`. Key takeaways:
  - 3 features already compartment-shaped (Favorites, Earnings, Track Record).
  - Refactor order locked: Favorites (S) → Scanner v2 (M) → Trade Tracker (L) → others on-demand.
  - 5 open prerequisite questions surfaced (Q-C1 through Q-C5 in Open questions list).
  - Zero of the 12 features have unit tests; compartment refactors add tests at the boundary.
- **Implication for dashboard rounds:** every per-widget round now designs BOTH the compartment refactor for the underlying feature AND the widget UX. Dashboard ship date moves out; the code we ship is permanent infrastructure.

### Round 3a — Compartment prerequisites — strategic (2026-05-14)
- Asked: Q-C1 sessionStorage, Q-C2 Verdict divergence, Q-C3 Trade Tracker P/L ownership, Q-C5 folder naming.
- All four picked the P1/P2-aligned option.
- Decisions: Persisted TanStack Query cache; surgical Verdict fix now; shared `shared/pnl/` pure module; rename `features/` → `compartments/`.

### Round 3b — Compartment prerequisites — implementation shape (2026-05-14)
- **Mid-round feedback from Chris:** *"Stuff like that i don't understand so just do what is best for the plan."* Promoted to a guiding rule — see memory `feedback_no_jargon_quizzes.md`. Going forward, framework-level / architectural micro-decisions are auto-decided per P1/P2 and documented; Chris is asked only about strategic decisions.
- Auto-decided per P1/P2:
  - **Q-C4a — Per-compartment layout:** folder per compartment on each side.
  - **Q-C4b — Registry location:** central `registry.ts` per side, imports each compartment's `index.ts`.
  - **Q-C4c — Manifest type:** shared `CompartmentMeta` base in `shared/compartments/types.ts`, server and client each extend it with their own fields. Widget block is optional so a compartment can ship without a dashboard widget yet (progressive contract).
- All five compartment-prerequisite questions now resolved. Next step is concrete code: the Favorites compartment refactor as the template.

### Round 4 — *(next: Favorites compartment refactor — scaffold `compartments/` directories, write `shared/compartments/types.ts`, build the Favorites compartment + Watchlist widget as the worked example. First actual code change of this entire workstream.)*

---

## Migration notes (v1 → full custom)

Recorded so future-us doesn't have to re-derive:
- v1 layout = CSS flex/grid driven by ordered widget list.
- Full-custom layout = react-grid-layout (or equivalent) driven by `{id, x, y, w, h}` per widget.
- Persisted schema in v1 should be a JSON array of `{id, visible, order}` — adding `x, y, w, h` is non-breaking.
- Every widget shipped in v1 must work standalone (no sibling-widget assumptions).
- Catalog registration pattern in v1 (a single `widgets/registry.ts` or similar) means full-custom adds no new code paths inside widgets — just a different host.
