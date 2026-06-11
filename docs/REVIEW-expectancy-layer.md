# 🔎 FOR REVIEW — Expectancy Layer (built 2026-06-11 while you were out)

This is the start of leaning into "the ultimate research tool" + your **"winners bigger than
losers"** north star. Built on a branch, verified, **NOT deployed to production.** Review, then
we merge → auto-deploys to stockotter.ai.

## How to look at it
Dev app is running locally: **http://localhost:5000** (log in: `ottertrader@stockotter.ai` /
`demo123` — the demo has 52 closed trades so the numbers are populated).
1. **/analytics** — the new **Expectancy Scorecard** is the headline card at the top.
2. **/dashboard** — the compact **Expectancy widget** sits under the Morning Brief (Expectancy |
   Action Queue | Checklist row).

For the demo account both show: **Win:Loss 2.48×, expectancy +$498/trade, profit factor 10.4,
win rate 80.8%** → green "you're growing" verdict. (Independently re-derived — the math checks.)

## What was built (2 commits, branch `feat/expectancy-scorecard`)
- `84cdf9f` — Expectancy Scorecard on /analytics. Extended the **existing** `/api/trades/analytics`
  endpoint (one source of truth — no new data path) to also return `avgWinPct`, `avgLossPct`,
  `winLossRatio`. New card shows win rate, avg winner vs avg loser ($ & %), the headline Win:Loss
  ratio, expectancy ($ and R), profit factor, and a green/red plain-English verdict.
- `3d08bc0` — Compact Expectancy widget on the dashboard (new compartment), reusing the same query.
  Graceful empty state ("Log closed trades to track your expectancy") for accounts with no trades.

Typecheck green (0 errors) on both. Nothing else changed.

## ⚠️ One decision for you
The avg win/loss **%** is computed as P/L relative to **capital deployed (cost to open)**. Confirm
that's the % basis you want, or tell me to change it.

## Recommended next (needs your input — I did NOT build these blind)
1. **Per-trade R-multiple grading** on the Tracker — needs to know where each trade's *initial
   risk/stop* comes from (do trades store a stop? a default risk %?).
2. **Stops + let-winners-run trailing exits** — the rules that actually make winners > losers.
3. **Paper-trade expectancy proving** (your bots) → only then **live auto-trade, small**.

## Rollback handles
- Branch `feat/expectancy-scorecard` (off `main @ 2416e79`).
- Tags: `rollback/pre-expectancy-scorecard`, `rollback/pre-expectancy-widget-20260611`.
- `main` is untouched — production is unaffected until you approve a merge.
