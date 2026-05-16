---
name: interview
description: Before starting any non-trivial new project, feature, page, widget, strategy, endpoint, or plugin, interview Chris with a short structured set of plain-English questions so the work is anchored to what he actually wants. Captures the core problem, the user, what success looks like, what this should NOT do, and the foundation it plugs into. Saves the answers as a project brief so the rest of the build (and `verify-work` later) can check against it. Use whenever Chris asks for something new and the answer isn't obvious from one sentence — never "plunge into code" without this. Skip ONLY for trivial fixes / one-line tweaks Chris has already fully specified.
---

# Interview

Front-loads the questions instead of discovering scope mid-build. Costs ~60 seconds up front, saves rounds of "no, that's not what I meant".

## When to use

**Trigger this skill at the START of any of these:**

- A new page / route (e.g. "build a dashboard for X")
- A new widget / scanner / strategy / endpoint
- A non-trivial refactor that changes user-visible behavior
- Anything Chris describes in more than one sentence
- Anything where the immediate code path isn't already obvious from a previous conversation

**Skip ONLY for:**

- One-line tweaks Chris fully specified (e.g. "change the BUY label to green")
- Bug fixes where the bug is reproduced and the fix is mechanical
- Continuations of an in-flight task already scoped earlier in the session

**When in doubt, run it.** Chris's foundation-first rule says every choice should be weighed against forward-compat — that's impossible without knowing the goal.

## The interview

Ask in **one** `AskUserQuestion` batch — never spread questions across turns (Chris hates mid-workstream prompts and jargon quizzes). Max 4 questions per the tool. Every question MUST include an "I have a question first" option per his `feedback_questions_in_choices` rule.

### Question set (plain English, no jargon)

Pick the 3–4 most relevant from below. Don't ask all of them every time — read the request, choose what matters.

1. **Core problem.** *"What's the actual problem this solves — what's broken or missing today?"*
   - Options should be concrete framings Chris can pick from, e.g. "I keep doing X manually", "Users can't see Y", "Z is wrong and I need to verify it", "Something else (open answer)".

2. **Audience.** *"Who is this for?"*
   - Options: "Me (Chris) — internal/diag tool", "Stockotter visitors", "Both — but visitor-facing is the priority", "Both — but my workflow is the priority".

3. **Success.** *"What's the concrete moment you'd say this works?"*
   - Options: short observable outcomes, e.g. "I can see X at a glance on the dashboard", "The scanner returns results I'd actually trade off", "Page loads in <1s and shows correct values", "I never have to do <manual thing> again".

4. **Non-goals.** *"What should this explicitly NOT do or include?"*
   - Options: "Don't replace existing X", "No new external dependencies", "No deploy gate / can ship behind toggle", "Open answer".

5. **Foundation hook.** *"Does this plug into something existing, or stand alone?"*
   - Options: "Add to an existing registry (strategy/widget/scanner)", "New page/route, stands alone", "Background job/cron, no UI", "Open answer".

6. **Risk / reversibility.** *"How easy must this be to back out if it doesn't pan out?"*
   - Options: "Toggleable / additive — I want to try it", "Hard requirement — needs to be load-bearing", "Experimental — fine to scrap", "Open answer".

**Always include** an `"I have a question first"` option on every question so Chris can clarify without breaking the thread.

## After answers — confirm understanding

Once Chris answers, summarize what you heard in **3–5 plain-English lines**, in this shape:

> **Building:** <one line — what>
> **For:** <one line — who>
> **Done when:** <one line — observable outcome>
> **Not doing:** <one line — non-goals>
> **Foundation:** <one line — plugs into X / standalone>

Then ask **one** confirmation: *"Does that match what you want? If yes I'll start. If anything's off, tell me what."*

If Chris corrects, fold in and re-summarize once. Then start the work.

## Save the brief

After confirmation, write the brief to memory as a **project memory** so later checks (`verify-work`, `ship`) can validate against it.

File path: `C:\Users\ChristopherCutshaw\.claude\projects\I--stockotter\memory\brief_<short-kebab-slug>.md`

```markdown
---
name: brief-<slug>
description: <one-line scope summary of the feature>
metadata:
  type: project
---

# Brief — <feature name>

**Started:** 2026-MM-DD
**Status:** in-progress

**Building:** <one line>
**For:** <one line>
**Done when:** <one line>
**Not doing:** <one line>
**Foundation:** <one line>

## Constraints / decisions from interview
- <any specific rules from Chris's answers>
- <e.g. "must use FMP, not Polygon", "must clear fintech quality bar", "no new deps">

## Open questions (resolve before ship)
- <anything Chris flagged as TBD>
```

Also add a one-line pointer in `MEMORY.md`:

```
- [Brief — <feature name>](brief_<slug>.md) — <one-line hook>
```

Mark the brief `status: shipped` (and update if relevant) when the feature ships. Delete or archive the brief if the feature is scrapped.

## Anti-patterns

- ❌ Asking jargon questions ("REST vs GraphQL?", "monolith vs microservice?") — Chris's `no_jargon_quizzes` rule. Auto-decide architecture per foundation-first principles and document the choice in the brief.
- ❌ Multi-turn interviews — one `AskUserQuestion` batch, one confirmation, then go.
- ❌ Skipping when "it's obvious" — if it's truly obvious, the brief is 5 lines and takes 30 seconds. If it's not obvious, you needed the brief.
- ❌ Writing the brief without confirmation — get Chris's "yes" first, then save.
- ❌ Generic Success criteria like "users will be happy" — every Success line must be **observable** (a page renders, a number is computed, a manual step is eliminated).
- ❌ Skipping the "I have a question first" option on any choice.

## Why this exists

Without the interview, every new project starts with assumptions that get unwound rounds later. The Confluence Chart rebuild (Round 9) was a high-profile example — built once as a 3-line widget Chris called "useless", rebuilt as a full page. An interview at the start would have caught the scope mismatch before any code was written. This skill exists to make sure that doesn't repeat.
