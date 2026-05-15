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

Run these. Parallelize where possible (`npm run check` is the slow one — kick it off first, do the static checks while it runs).

### A. Build & types (BLOCKER if fails)

```bash
npm run check
```

Any TypeScript error is a blocker. Don't try to ship around it. If errors exist in files you didn't touch, surface them separately — they may be pre-existing.

### B. Project-rule violations (BLOCKER)

Grep the diff for:

1. **Yahoo or Polygon usage in new code** — both are kill targets. New code may NOT introduce calls to:
   - `yahoo-finance2`, `yahooFinance`, anything from `server/polygon.ts`, `polygonGet`, etc.
   - Existing usage is fine to leave — only flag *new* references in the diff.

2. **Hard-coded universe / ticker lists** in scanner or info pages. The "scanner universe restrictions" bug is open — any new fixed-list constant in scanner-adjacent code is a regression.

3. **Missing cache layer for fundamentals / quarterly data.** If new code calls FMP for fundamentals/insider/13F/etc. directly without going through `server/cache.ts` / `institutional-cache.ts` / `long-range-cache.ts` patterns, flag it. Per-request fetches of quarterly data violate the caching strategy.

4. **Direct field-name access without `docs/FMP_REFERENCE.md` lookup.** If the diff has new `data?.[0]?.<field>` patterns on FMP responses, verify the field name exists in the reference doc. If it doesn't, suggest running the `fmp-endpoint` skill.

5. **CHANGES.md entry exists** for the work. Read the top of `CHANGES.md` — if the newest entry doesn't describe what's in the diff, that's a blocker (per the CHANGES.md rule).

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

### E. Memory rule compliance (NITS, but worth surfacing)

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

## Hard rules

- **Never auto-fix during a verify pass.** Surface findings, let Chris decide. The point of verification is honesty, not optimism.
- **Never skip the type check.** If `npm run check` won't run, that itself is a blocker — surface it.
- **Never audit against a stale baseline.** `git fetch origin` at the start, ahead/behind check, refresh the diff right before each check group. A stale diff is worse than no audit — it produces false confidence.
- **Don't fabricate cleanliness.** If you didn't check something (e.g. didn't load the page in a browser), say so explicitly: "UI behavior not verified — Chris should spot-check in the browser before ship."
- **Be specific.** "Looks good" is not a verification. Every clean check should be named in the "What ran clean" section so Chris can see exactly what was and wasn't checked.
