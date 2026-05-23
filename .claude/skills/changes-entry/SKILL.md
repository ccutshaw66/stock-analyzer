---
name: changes-entry
description: Generate a CHANGES.md entry for the current uncommitted (or recently committed) work on stockotter. One entry per completed change — NOT one per commit. Reads the working diff, groups it by feature/fix, and prepends a dated block to CHANGES.md in the existing style. Use before running `ship`, or whenever Chris says "log it", "update changes", "add a CHANGES entry".
---

# CHANGES.md Entry

Enforces Chris's CHANGES.md rule: every code change ships with a CHANGES.md entry, written as **a summary of the completed change**, not commit-by-commit.

## When to use

- Right before running the `ship` skill.
- After finishing a feature or fix, before pushing.
- When Chris says "log it" / "update changes" / "write the CHANGES entry".

## Steps

### 1. Gather what changed

```bash
git status
git diff --stat HEAD
git diff HEAD
```

If there are unpushed commits already containing the change, also:
```bash
git log origin/main..HEAD --oneline
git diff origin/main..HEAD
```

### 2. Read the current CHANGES.md style

Read the top ~50 lines of `CHANGES.md`. Match:
- Heading: `## YYYY-MM-DD — <Round N / Phase X> — <short title>` (or just `## YYYY-MM-DD — <title>` if no round numbering applies).
- Body sections: `**Why:**` (the motivation, often a Chris quote), `**What:**` (sub-headings for areas touched), and where relevant `**Files:**`, `**Tested:**`, `**Known limitations:**`.

Use today's date in `YYYY-MM-DD` form (from the `currentDate` system context, not the local clock — Chris's calendar is the truth).

### 3. Draft the entry

One block per **completed change**, even if it spans multiple commits. Group sub-bullets by area (e.g. "Server", "Client", "Schema") if helpful. Keep it readable for a human (or future AI) picking up the project a year from now.

**Why section:** state the motivation in one or two sentences. If Chris said something memorable that drove the change, quote it (the existing log does this — it's how context survives).

**What section:** describe the user-visible effect first, then the internal mechanics. Avoid file paths in prose; if files matter, list them at the bottom under `**Files touched:**`.

### 4. Prepend, don't append

Newest entries go on top, directly under the `---` separator after the preamble. Use `Edit` to insert the new block; never `Write` the whole file.

### 5. Hand off

Tell Chris in plain English: "Logged today's change to CHANGES.md — ready to ship when you are." Don't include the entry text in chat unless asked; he can read the file.

## What NOT to include

- Don't write one entry per commit — bundle the whole completed change.
- Don't dump file paths in chat or in the Why section.
- Don't add a CHANGES entry for trivial in-flight rewrites that will be folded into a larger change before ship.
- Don't duplicate info already obvious from the diff — focus on the **why** and the **user-visible effect**.
