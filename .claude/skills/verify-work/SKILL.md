---
name: verify-work
description: Pre-flight audit of in-flight or just-completed stockotter work. Runs TypeScript check, scans the diff for project-rule violations (Yahoo/Polygon usage, missing CHANGES.md entry, hard-coded universe lists, missing cache layer, unbranded empty/loading/error states), checks for dead code and duplicated logic, and reports findings grouped by severity. Use BEFORE running `ship`, or whenever Chris asks "verify the work", "audit what you did", "is this safe to ship?", "did you do this right?".
---

# Verify Work

Self-audit gate. Catches violations of Chris's rules and common quality issues **before** ship, not after.

## When to use

- Right before running `ship` — every time.
- Chris asks "verify", "audit", "double-check", "is this ready", "did you do this right".
- After a long multi-file edit session, before reporting "done".
- When stepping back into an in-flight workstream to confirm prior state is sane.

## Scope

By default, audit **the current diff vs `origin/main`** (committed + uncommitted). If Chris specifies a different scope (e.g. "verify the last 3 commits", "audit the whole scanner page"), use that.

### Keep the diff fresh — this is mandatory

A stale diff produces a worthless audit. Re-pull the actual state every time, and re-pull again right before each check group so edits made mid-audit don't slip past you.

**Start of audit — sync state:**

```bash
git fetch origin                              # pull latest origin refs
git rev-parse --abbrev-ref HEAD               # which branch am I on?
git rev-list --left-right --count HEAD...origin/main   # ahead/behind counts
git status --porcelain                        # uncommitted state
```

If local is **behind** `origin/main`, stop and surface it. The audit baseline is wrong until Chris decides whether to rebase / merge / reset. Do not silently audit against a stale main.

If the working tree has **uncommitted changes you didn't make this session**, surface them — they may be in-progress work that shouldn't be bundled into the verify.

**Before each check group — refresh the diff:**

```bash
git diff --stat origin/main...HEAD            # committed delta
git diff origin/main...HEAD                   # committed detail
git diff HEAD                                 # uncommitted detail
git status --porcelain                        # what's untracked / staged
```

Do not cache the diff from the start of the audit. If you edited a file 10 minutes ago for an unrelated reason, that file is in the diff *now* and must be re-grabbed. Re-running these four commands costs nothing.

**If the work is already pushed:** the diff vs `origin/main` will be empty. Don't conclude "nothing to verify" — switch the baseline to the merge-base of this branch's most recent unique work, or ask Chris for the commit range. An empty diff with a recently-shipped feature means you're looking at the wrong scope, not a clean repo.

## Checks

Run these. Parallelize where possible (`npm run check` and `npm run build` are the slow ones — kick them off first, do the static checks while they run).

### A. Build & types (BLOCKER if either fails)

Both checks must pass. Run them in parallel.

```bash
npm run check    # tsc — catches type errors
npm run build    # vite/esbuild — catches parse errors tsc misses
```

**Why both:** `tsc` is permissive about some JSX patterns (e.g. bare identifiers as attribute values like `<Line stroke=SIGNAL_BULL>` instead of `<Line stroke={SIGNAL_BULL}>`). Vite/esbuild rejects them at parse time. The 2026-05-15 design-tokens ship discovered this the hard way — `tsc` passed, build failed on the server, deploy reported `last_deploy.success: false`. Running `npm run build` locally would have caught it.

Any error in either is a blocker. Don't try to ship around it. If errors exist in files you didn't touch, surface them separately — they may be pre-existing.

### B. Project-rule violations (BLOCKER)

**Universal structure rule (2026-05-15) — the master rule.** No new feature may be built as a one-off. Every build plugs into the existing universal structure: compartments, widgets, registries, and shared token modules. Check the diff for violations:
- New page that doesn't register in `client/src/lib/page-registry.ts`.
- New widget / scanner signal / strategy that doesn't register in its matching registry.
- New color, font size, tile size, indicator period, or signal threshold hardcoded in a component instead of imported from `lib/design-tokens.ts` / `shared/dashboard/layout-tokens.ts` / `shared/indicators/constants.ts` / tailwind config.
- New page-chrome (header bar, branded strip) that doesn't use the standard `<PageHeader>` template.
- "Just add it here for now" pattern — short-circuiting the registry by editing the host page directly to wire a new entry. The registry must be the seam, always.

This is the master rule above. The individual rules below are specific applications of it.

Grep the diff for:

1. **Yahoo or Polygon usage in new code** — both are kill targets. New code may NOT introduce calls to:
   - `yahoo-finance2`, `yahooFinance`, anything from `server/polygon.ts`, `polygonGet`, etc.
   - Existing usage is fine to leave — only flag *new* references in the diff.

2. **Hard-coded universe / ticker lists** in scanner or info pages. The "scanner universe restrictions" bug is open — any new fixed-list constant in scanner-adjacent code is a regression.

3. **Missing cache layer for fundamentals / quarterly data.** If new code calls FMP for fundamentals/insider/13F/etc. directly without going through `server/cache.ts` / `institutional-cache.ts` / `long-range-cache.ts` patterns, flag it. Per-request fetches of quarterly data violate the caching strategy.

4. **Direct field-name access without `docs/FMP_REFERENCE.md` lookup.** If the diff has new `data?.[0]?.<field>` patterns on FMP responses, verify the field name exists in the reference doc. If it doesn't, suggest running the `fmp-endpoint` skill.

5. **CHANGES.md entry exists** for the work. Read the top of `CHANGES.md` — if the newest entry doesn't describe what's in the diff, that's a blocker (per the CHANGES.md rule).

6. **Design-tokens rule — every color comes from tokens (BLOCKER for any new `client/` code).**

   The compartmentalization rule says one source of truth. After the design-tokens ship (2026-05-15), the ONLY files allowed to contain raw hex codes or `rgb()`/`rgba()` color literals are:
   - `client/src/lib/design-tokens.ts` (canonical TS source)
   - `client/src/index.css` (canonical CSS-variable source)
   - `client/src/components/ui/chart.tsx` (shadcn Recharts library override selectors — `#ccc` / `#fff` are CSS attribute selectors, not app colors)

   Grep the diff in `client/` for:
   - `#[0-9a-fA-F]{6}` and `#[0-9a-fA-F]{3}\b` — six- or three-digit hex codes outside the allowed files. **Block.**
   - `rgba?\(` — raw rgb/rgba calls outside the allowed files. **Block unless** it's the `rgb(var(--token) / alpha)` form that references a CSS variable (that form IS allowed).
   - Tailwind arbitrary color values like `bg-[#…]`, `text-[#…]`, `border-[#…]`. **Block.** Use named Tailwind tokens (`bg-bull`, `text-brand-text-muted`, `border-brand-border`).

   Exception: URL hash fragments in `path="#anchor"` style props and `href="#anchor"` are NOT hex codes. The regex `#[0-9a-fA-F]{3,6}` won't match these because anchor names typically contain letters outside `a-f`. If a false positive appears, surface it but don't block.

7. **Font-size rule — every font size comes from the scale (BLOCKER for any new `client/` code).**

   No new `text-[Npx]` arbitrary tailwind values are allowed. The font-size scale in `tailwind.config.js` covers:
   - `text-tiny` (8px), `text-mini` (9px), `text-micro` (10px), `text-2xs` (11px)
   - Plus the standard Tailwind scale (`text-xs`, `text-sm`, `text-base`, …)

   Grep the diff for `text-\[[0-9]+px\]`. Any hit in `client/` is a blocker — replace with the appropriate named token. If a size isn't covered, add it to the `fontSize` config in `tailwind.config.js` first.

8. **Tile-size rule — every dashboard widget size comes from layout tokens (BLOCKER for any new compartment manifest).**

   Compartment manifests must not contain raw `{ w, h }` numbers for `widgetDefaultSize` or `widgetMinSize`. They must reference named slots from `@shared/dashboard/layout-tokens`:
   - `TILE_SM`, `TILE_MD`, `TILE_LG`, `TILE_FULL`
   - `TILE_MIN_SM`, `TILE_MIN_MD`, `TILE_MIN_LG`

   Same rule applies to `server/dashboard/layout.ts` and any other server code that produces a default layout — widget positions must spread `...TILE_*` for `w`/`h`, not literal numbers.

9. **Chart rule — every TV-style chart pane uses the shared primitive (BLOCKER for any new chart on the site).**

   No page may import `createChart` from `lightweight-charts` directly. All TV-style candle panes go through `@/components/chart` — `<CandlePane bars overlays markers />` is the canonical entry. Custom indicator overlays use the `LineOverlay` type from `@/components/chart` and pull colors from design-tokens (CHART_EMA_*, SIGNAL_BULL/BEAR/WATCH).

   Grep the diff for:
   - `from "lightweight-charts"` in any file outside `client/src/components/chart/` — block.
   - New per-page `createChart()` calls — block.
   - Hardcoded line colors in overlay configs — they must reference design-tokens constants, not inline hex.

   Recharts is allowed for non-candle visualizations (radar, payoff curves, scatter) that don't fit TV-style. For candles + indicators + signals, use `<CandlePane>`.

10. **Moveable-widgets rule — widgets must work outside `/dashboard`.**

    Per `architecture_moveable_widgets` memory, every WidgetView is drop-in placeable anywhere on the site. Block:
    - Widget imports from `@/lib/dashboard/*` (dashboard-only modules).
    - Hardcoded `gridX` / `gridY` / "dashboard" assumptions inside a widget's render.
    - Widget components that take dashboard-context as props (data should come from React Query hooks instead).

### C. Efficiency & code quality (SHOULD-FIX)

1. **Duplicated indicator math.** If the diff adds an EMA/RSI/MACD/SMA computation, check whether `server/indicators/` already has one. Duplication is a smell.

2. **Pure functions stay pure.** Strategy files (`server/signals/strategies/*.ts`) must not introduce I/O, fetches, or module-level mutable state. Flag any new side-effects.

3. **Registry-driven wiring.** New strategies / widgets / scanner signals should plug into existing registries, not require editing the host page. If the diff edits both a registry AND a page to add a single item, that's a smell (page should be data-driven).

4. **Dead code.** New exports nobody imports, commented-out blocks, `// TODO` with no follow-up. Delete or call out.

5. **`git add -A` risk.** Check `git status` for stray screenshots, `.env*`, `*.log`, `node_modules` changes, or other files that shouldn't be in the commit.

### D. UI quality bar (SHOULD-FIX for any client/ change)

If `client/` is touched, verify the change clears the fintech quality bar:

1. **Branded empty state** — otter mascot or brand element, not a default placeholder.
2. **Branded loading state** — skeleton or spinner styled to the brand, not a raw `Loading...`.
3. **Branded error state** — friendly copy + recovery action, not a stack trace or raw error.
4. **Typography hierarchy** — no `font-size: 14px;` overrides; uses the tailwind type scale.
5. **Performance** — no obvious N+1 fetches in `useEffect` chains, no unbounded `setInterval` without cleanup.

### E. Interactive UI behavior (BLOCKER for any diff touching toggle / button / dropdown / form handlers)

**The EMA-toggle lesson (2026-05-16):** type-check passed, build passed, the buttons rendered and visually responded to clicks. The fix shipped four times before the bug actually went away — each prior "fix" was based on the same false signal that `tsc` clean + visible button state = working feature. The real bug was a key-name mismatch upstream of the chart; React state updated correctly, the result was just silently discarded by a destructure with default values.

A clean type-check and a working-looking UI are not evidence that an interactive feature works. Two things must be true to mark interactive-UI work as ready:

1. **Trace the state path end-to-end in the code.** For every handler in the diff (`onClick`, `onChange`, `onSubmit`, `setX(...)`), follow the state value from the setter to the place that consumes it. If a function accepts an object and destructures specific keys with defaults, verify the *exact key names* of the producer match the consumer. Anonymous parameter shapes and `Partial<…>` parameters are the danger zone — `tsc` will not flag a key-name mismatch when defaults make every field optional.

2. **Click it in a running browser.** Start the dev server if it's not running, open the page, perform the user action (click the toggle, change the dropdown, submit the form), and confirm the downstream effect actually changed. "Buttons render and animate on click" is not the same as "the feature works." If you cannot run the browser yourself, say so explicitly in the report: *"UI behavior not verified — Chris should click the toggle and confirm the line appears/disappears before ship."* Do not silently skip and report clean.

Heuristic for when this section applies: the diff contains any of `onClick`, `onChange`, `onSubmit`, `useState<…>`, a new toggle component, a new form field, or a new dropdown / select / multi-select. If unsure, apply the section — the cost of an extra browser click is trivial compared to a four-attempt fix loop.

### F. Memory rule compliance (NITS, but worth surfacing)

- Did the work hit `dev` branch or go straight to `main`? (Per `feedback_direct_main_push`, direct main is fine if Chris approved verbally.)
- Was a `safe/<timestamp>` tag created before destructive ops? (Only relevant if rollback would be hard.)
- Are there mid-job approval prompts in the diff (e.g. interactive scripts the user has to answer)? Per `no_mid_workstream_prompts`, these should be removed.

## Report format

Plain English, no file paths in chat unless asked. Group by severity:

> **Verdict:** READY / NOT READY / READY WITH NOTES
>
> **Blockers (N):**
> - <one-line description>
> - …
>
> **Should-fix (N):**
> - <one-line description>
> - …
>
> **Nits (N):**
> - <one-line description>
> - …
>
> **What ran clean:** types ✓, CHANGES entry ✓, no Yahoo/Polygon ✓, …

If verdict is READY, end with: "Safe to ship." Chris can chain `/ship` from there.

If verdict is NOT READY, end with: "Fix blockers then re-run /verify-work." Don't auto-fix — Chris decides which findings get addressed.

## Site-wide audit mode

When Chris asks to "audit the whole site" / "report what's not adhering to the compartment rule" / "site-wide verify" (NOT just the current diff), expand the scope and report on the entire `client/` + `server/` tree, not the diff.

What to check site-wide:

1. **Hex/rgb leakage.** `grep -rE "#[0-9a-fA-F]{6}" client/src --include="*.tsx" --include="*.ts"` outside the allowed files (see rule B6). Same for `rgba?\(...\)` outside the var-reference form. Same for `bg-[#…]` / `text-[#…]` / `border-[#…]` arbitrary-color Tailwind values.

2. **Font-size leakage.** `grep -rE "text-\[[0-9]+px\]" client/src --include="*.tsx"`. Any hit = a component reaching for an arbitrary size. Should be a named token.

3. **Tile-size leakage.** `grep -rE "widgetDefaultSize:|widgetMinSize:" client/src --include="*.ts" --include="*.tsx"` and check the value side — should be `TILE_*` identifiers, not `{ w: N, h: N }` literals. Same for `widgets: [...]` arrays in `server/dashboard/`.

4. **Cache layer bypasses.** `grep -rn "fmpGet(" server/` outside the canonical cache modules (`server/cache.ts`, `server/institutional-cache.ts`, `server/long-range-cache.ts`, `server/market-pulse-cache.ts`, `server/long-range-warmup.ts`, etc.) — direct FMP calls in route handlers or compartment data accessors are fine if they're truly request-scoped (real-time quotes), but flag any that look like quarterly / fundamentals data hitting the wire on every request.

5. **Yahoo / Polygon ghost code.** `grep -rni "yahoo\|polygon" client/src server/` — surface every remaining reference, even in comments. Per the kill plan, both providers should be drained over time.

6. **Strategy registry drift.** Strategies under `server/signals/strategies/` should all be referenced in the strategy registry AND the `/chart` page toggles. If one is registered server-side but missing from the client toggle, that's drift.

7. **Compartments not in the registry.** Any folder under `server/compartments/` or `client/src/compartments/` that isn't imported in the matching `registry.ts`. Manifest must be wired.

8. **Mixed-source signal colors.** Any chart legend or badge using `text-green-400` / `text-red-400` / `bg-yellow-500/15` (Tailwind palette classes) instead of the semantic `text-bull` / `text-bear` / `bg-watch/15` tokens. These visually overlap but break the "single source" rule — a brand-color swap won't reach them.

Site-wide audit output is a categorized report with a count per category, top offending files, and a one-line recommendation per category. Don't auto-fix anything — Chris decides priority.

## Hard rules

- **Never auto-fix during a verify pass.** Surface findings, let Chris decide. The point of verification is honesty, not optimism.
- **Never skip the type check or the build.** Both `npm run check` AND `npm run build` must pass. If either won't run, that itself is a blocker. `tsc` alone is not sufficient — it missed the 2026-05-15 JSX-braces bug that broke production.
- **Never audit against a stale baseline.** `git fetch origin` at the start, ahead/behind check, refresh the diff right before each check group. A stale diff is worse than no audit — it produces false confidence.
- **Don't fabricate cleanliness.** If you didn't check something (e.g. didn't load the page in a browser), say so explicitly: "UI behavior not verified — Chris should spot-check in the browser before ship."
- **Type-check + build clean is NOT proof an interactive feature works.** For any diff touching click/change/submit handlers, do the section-E end-to-end state-path trace AND require a browser click before reporting ready. This rule exists because of the 2026-05-16 EMA-toggle 4-attempt fix loop — each prior attempt looked clean by tsc + visible-button-state and was wrong.
- **Be specific.** "Looks good" is not a verification. Every clean check should be named in the "What ran clean" section so Chris can see exactly what was and wasn't checked.
