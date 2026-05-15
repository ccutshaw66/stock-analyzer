---
name: ship
description: Deploy stockotter to production. Tags a `safe/<timestamp>` rollback point on the current HEAD, commits any pending changes (with CHANGES.md entry verified), pushes to `origin/main`, and confirms the GitHub webhook fired so pm2 picked up the new build on imt-uv-helpdesk. Use whenever Chris says "ship it", "push", "deploy", or "go live" after a feature is done.
---

# Ship

Chris's canonical deploy flow. Encodes the cardinal rules: **snapshot BEFORE executing**, and the deploy preference: **auto-commit + auto-push to origin/main, with a `safe/` tag for rollback**.

## When to use

- Chris approves a feature and says ship/push/deploy/go-live.
- A bug fix is done and verified locally.
- **Do not** run mid-job — only after the user has approved a completed unit of work.

## Steps

Run these in order. Stop and surface any error — never `--no-verify`, never `--force` to main without explicit ask.

### 1. Verify CHANGES.md has an entry for this work

Read the top of `CHANGES.md`. If the newest entry doesn't describe what you just did, **stop and add one** (see the `changes-entry` skill). Per Chris's rule: every code change ships with a CHANGES.md entry — summary per completed change, not commit-by-commit.

### 2. Snapshot

```bash
git tag "safe/$(date +%Y%m%d-%H%M%S)" HEAD
git push origin --tags
```

This is the rollback point. If anything goes wrong post-push, `git reset --hard safe/<timestamp>` and force-push (with explicit user OK).

### 3. Show the diff

```bash
git status
git diff --stat HEAD
```

Surface what's about to ship in one sentence — no file paths in chat unless asked.

### 4. Commit

```bash
git add <specific files>   # never -A or .
git commit -m "$(cat <<'EOF'
<one-line summary matching the CHANGES.md heading>

<2-3 sentence body: why this change, what it touches>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Match the commit message style of recent commits (`git log --oneline -5`).

### 5. Push to main

```bash
git push origin main
```

This triggers the GitHub webhook → pm2 reload on imt-uv-helpdesk. **No PR ceremony** — Chris's verbal approval is the gate (see `feedback_direct_main_push`).

### 6. Confirm deploy landed

Report to Chris in plain English: "Shipped. Tag `safe/<ts>` is the rollback. Webhook should reload pm2 in ~30s." Don't claim success for the live site — Chris verifies in the browser.

## Rollback (if Chris asks)

```bash
git tag -l "safe/*" | tail -10           # list recent
git reset --hard safe/<chosen>
git push origin main --force-with-lease  # requires explicit OK
```

## Hard rules

- Never `git add -A` or `git add .` — name files explicitly.
- Never `--no-verify`, never `--amend` after push.
- Never push to main without a CHANGES.md entry for the change.
- Never skip the `safe/` tag.
- Report once at the end. No "ready for the next step?" prompts mid-job.
