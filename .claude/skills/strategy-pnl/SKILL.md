---
name: strategy-pnl
description: Run a stockotter strategy against the long-range basket and report per-trade dollar P&L (total $, win rate, R-multiple, compound return, max drawdown) per-ticker and aggregated. Hits `/api/diag/strategy-pnl` (BBTC+VER long) or `/api/diag/strategy-tft-pnl` (TFT variants). Use whenever Chris asks "what's the P&L?", "did this strategy actually make money?", or wants to validate a strategy change before re-enabling it.
---

# Strategy P&L

Standardizes how strategy changes are evaluated. Per Chris's memory: short side and VER_WATCH_SELL were demoted info-only after losing across all backtested windows — **nothing gets re-enabled until per-trade dollar P&L is positive on backtest**.

## When to use

- Chris asks "what's the P&L of strategy X?"
- A strategy was modified and needs validation before merge/ship.
- Comparing a candidate change against the current baseline.
- Considering re-enabling the short side or VER_WATCH_SELL.

## The two endpoints

| Endpoint | Strategy | Notes |
|---|---|---|
| `/api/diag/strategy-pnl` | BBTC + VER (long-only) | One `positionSize` per trade. Short side is info-only since 2026-05-08; no shorts execute. |
| `/api/diag/strategy-tft-pnl` | TFT 40w / 60w / catastrophic-only | Differs from above — deploys ONE positionSize per trade. Has `shorts=on|off`, `atrFloor`, `coreStop` params. |

## Standard call

Default to the 10-year basket Chris uses for evaluation (the same one that produced the $419K result on 2026-05-08):

```
GET /api/diag/strategy-pnl?symbols=<basket>&days=3650&positionSize=10000&detail=1
GET /api/diag/strategy-pnl?symbols=<basket>&days=3650&positionSize=10000&amcGate=loose&detail=1
```

For TFT:
```
GET /api/diag/strategy-tft-pnl?symbols=<basket>&days=3650&positionSize=10000&coreStop=40w&detail=1
```

**Don't hard-code a symbol list here** — read the basket from whatever Chris last used (check `CHANGES.md` for the most recent strategy evaluation, or ask him for the list).

## Output format

Report to Chris in plain English:

> **Strategy:** <name + variant + gate settings>
> **Window:** <years> · **Position size:** $<n> per trade · **Tickers:** <count>
>
> **Basket totals:** $<P&L> on $<deployed> · <return%> · win rate <%> · max DD $<n> (<%>)
> **R-multiple:** <avg R> across <n> trades
>
> **Top contributors:** <ticker> +$<n>, <ticker> +$<n>, …
> **Drag:** <ticker> $<n>, <ticker> $<n>
>
> **Verdict:** <one line — pass/fail vs prior baseline>

## Comparing vs baseline

When evaluating a change:
1. Run the **current `main`** version first to capture baseline numbers.
2. Apply the change, run again with the **same basket, window, and position size**.
3. Diff the totals. Report Δ$ P&L, Δ win rate, Δ max DD.

Never compare against a different basket or window — that's noise, not signal.

## Hard rules

- **Long-only re-enable gate:** short side stays info-only until $ P&L is positive on backtest. Don't suggest enabling it without numbers.
- **VER_WATCH_SELL gate:** demoted 2026-05-08; needs a from-scratch rebuild before re-enable. Don't include it in P&L runs as if it's active.
- Use the same basket Chris used last time. Switching baskets mid-evaluation invalidates the comparison.
- Cache costs: a 10-year basket run is heavy. Don't re-run unchanged scenarios — quote the previous result if applicable.
