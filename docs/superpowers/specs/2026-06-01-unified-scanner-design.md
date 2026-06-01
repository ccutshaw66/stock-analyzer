# Unified Scanner — Design Spec

**Date:** 2026-06-01
**Status:** Approved design (pending written-spec review)
**Author:** Claude (with Chris)

## Problem

The site has four separate, hardcoded live scanners (HTF, BBTC+VER, AMC, Scanner-V2) plus several backtest-only strategies (Rounding Bottom, Wyckoff Spring, Pipe Bottom, TFT) with no live discovery at all. Using them feels like "russian roulette": sometimes nothing, sometimes low-grade noise, sometimes a real hit.

**Root cause (confirmed in code):** every scanner funnels through `fmpScreener`, which **Fisher-Yates shuffles** the universe and scans only a random ~500–2000-ticker slice, then returns whatever fires. So:
- Results are **non-deterministic** run-to-run (different random slice each time).
- The random slice often contains no setups → "nothing."
- Two scanners (BBTC+VER, AMC) have **no minimum-score filter** → low-grade hits show through as "crap."

The shuffle was a band-aid: without it, an unfiltered universe scan kept returning the same mega-caps. The real fix is to constrain the universe with **required filters** and score-gate the output, then pre-rank so results are instant and deterministic.

## Goals

1. **One** scanner covering **every** strategy, replacing the four scattered ones.
2. **Deterministic + reliable** — same filters always yield the same best-first results; never an empty/garbage dice-roll.
3. **Complete-market** coverage (NOT restricted to $5–$75 — see clarification below), with **price as a filter**.
4. Only show **green-grade** setups (score 80+).
5. Registry-driven: a new strategy appears in the scanner automatically via its manifest.
6. Lives as a **page and a dashboard widget**, at the fintech quality bar.

### Universe scope clarification (Chris, 2026-06-01)
The $5–$75 band is about making *strategy backtests* relevant to Chris's account size — it is **not** a site-wide restriction. The scanner covers the **complete market**; affordability is expressed through the **required market-cap choice** and the **price filter**, not a hard cap.

## Design

### 1. Required filters (scan disabled until set)
The scan button is **disabled until the required choices are made** — no blind button-press.

- **Market Cap** — *required, no "All."* Tiers: Micro (<$300M) · Small ($300M–$2B) · Mid ($2B–$10B) · Large ($10B–$200B) · Mega ($200B+). Single tier (or contiguous range). Forces a tier the user can actually trade.
- **Price** — *required; the available ranges adapt to the chosen market-cap tier.* Example bands:
  - Micro/Small: `$1–5` · `$5–15` · `$15–50`
  - Mid: `$10–30` · `$30–75` · `$75–150`
  - Large/Mega: `$20–100` · `$100–300` · `$300+`
- **Sector** — optional, "All" allowed.
- **Strategies** — which to scan. Default: all **live** strategies. Experimental ones (e.g. Pipe Bottom) are off by default and badged.
- **Result count (top-N)** — default 25, user-adjustable.

### 2. Score gate — green only (80–100)
The scanner **only returns setups scored ≥ 80**. UI states it plainly: *"Showing green-grade setups only (80+)."* The control allows raising the floor (e.g. 90+) but **never below 80**. This is the primary noise-cut — no yellow-75s.

Each strategy's existing 0–100 `qualityScore` is the gated value (HTF, Rounding, Wyckoff, etc. all already produce one).

### 3. Results
Top-N, **best score first, deterministic**. Each result card shows:
- **Ticker + company name** — the name is clickable and uses the existing `useTickerNavigate` hook → sets the global active ticker and routes to **/profile** (the Company Research surface). *(The full company narrative lives on the Profile page — tracked as a separate TODO, see memory `todo_profile_company_narrative`. Not embedded inline in the scanner.)*
- **Strategy** that fired (badge, brand color).
- **Score** (green grade).
- **Entry / Stop / Target** from the detector.
- Compact key stats (e.g. price, market cap, sector).

### 4. Engine — pre-ranked + auto-refresh (chosen option #1)
- A **scheduled job** scans the whole market after each close and pre-scores every setup for every live strategy, storing a ranked result set (cached on disk/DB per the caching strategy).
- The scanner UI **slices that pre-ranked set instantly** by the user's filters (market cap, price, sector, strategy, score floor, top-N) → instant, deterministic.
- A **"Refresh now"** button re-runs the scan on demand (respecting tier scan limits).
- Because required filters constrain the working set, even an on-demand refresh is tractable.

### 5. Plumbing (foundation-first / universal-structure)
- **Registry-driven.** Extend `shared/strategies/registry.ts` so each manifest can declare a live-scan capability (which detector to run + that it's scannable). The unified scanner walks the registry — adding a future strategy makes it appear here with no scanner edits.
- New compartment `client/src/compartments/unified-scanner/` (manifest + hook + WidgetView + FullView) and `server/compartments/unified-scanner/` (universe resolver + scan/score + ranked cache + routes), per the compartment pattern.
- **Page + dashboard widget** from the same data source (moveable-widgets rule).
- Branded **loading / empty / error** states (quality bar). Empty state explains *why* (e.g. "No green-grade setups in Small-cap / $5–15 / Technology right now — widen a filter").

### 6. Consolidation
The unified scanner becomes the single scanner home. The old scanner routes/pages (BBTC+VER, AMC, Scanner-V2, and the HTF setups page's discovery role) **redirect into it** so there's one place. (HTF's pattern-chart drill-in stays; only the scattered *discovery* surfaces consolidate.)

### 7. Tier gating
Inherits the existing per-tier scan limits (`scansPerDay`: free 10 / pro 30 / elite unlimited) via the current `checkFeatureAccess('scansPerDay')` middleware. MM-exposure enrichment stays Pro/Elite.

## Out of scope (separate follow-on pieces, already agreed)
- **Strategy-Chart toggles** — add HTF / Rounding / Wyckoff / Pipe to the `/chart` backtest page (next piece; the registry-driven detectors from this build make it nearly free).
- **Company narrative on the Profile page** — tracked TODO (`todo_profile_company_narrative`).
- **Step-by-step "how to use Stock Otter" workflow** — final piece, once scanner + chart are coherent.

## Open / to-confirm during planning
- Exact market-cap tier boundaries and per-tier price bands (above are the proposed defaults).
- Scan cadence for the scheduled job (end-of-day vs a couple intraday refreshes) — default end-of-day + manual refresh; can add intraday later (the rejected "hybrid" option).
- Storage for the ranked cache (reuse existing disk-cache pattern vs a DB table).

## Acceptance
- Same filters → identical results across runs (deterministic).
- No result below score 80 ever shown.
- Every live strategy appears via the registry with zero scanner-page edits.
- Works as both `/scanner` page and a dashboard widget, with branded empty/loading/error states.
- Old scanner routes redirect to the unified scanner.
