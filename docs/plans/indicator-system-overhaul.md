# StockOtter: A Trustworthy Indicator System (+ Go/No-Go on Black-Scholes & PEGY)

## Context — why we're doing this

Chris doesn't trust the indicators. He can't point at any single part and say "this gives me
consistent results across tickers and I'd bet real money on it." He's right to feel that way, and
the reason is **structural, not cosmetic**:

1. **The score is a hand-tuned opinion, not a measured edge.** `server/snapshot/score.ts` is an
   11-factor weighted average with weights chosen by hand (0.15 institutional flow, 0.10 several,
   0.08 valuation, …). No weight was ever earned by evidence that it predicts forward returns.
2. **Two verdict systems that can disagree.** `score.ts` `bucketVerdict()` says STRONG CONVICTION /
   INVESTMENT GRADE / SPECULATIVE / HIGH RISK at 85/70/55. Separately `server/conviction/trigger-check.ts`
   `aggregateVerdict()` says GO / CAUTION / NO. A stock can read INVESTMENT GRADE *and* NO. That alone
   destroys confidence.
3. **Validation is in-sample.** `backtest.py` / `backtest_gates.py` test signals on the same data used
   to design them, with no walk-forward, no out-of-sample hold-out, and no benchmark — so a good-looking
   backtest tells us almost nothing (this is exactly the backtest-overfitting trap Bailey & López de Prado
   formalized with the Deflated Sharpe Ratio).
4. **Redundant indicators masquerading as confirmation.** Several "independent" indicators (RSI, MACD,
   EMA-stack, 1Y/3Y return) are largely the same thing — price momentum. When they "all agree," that's
   one signal counted four times = false confidence, not confluence.

**Decisions locked with Chris:**
- Options **are** in scope for the site.
- Scope = **verdicts + validation backbone** (not just shipping two metrics).
- Trust metric = **beat SPY on a risk-adjusted basis (Sharpe / drawdown), out-of-sample.**
- GO philosophy = **confluence of *independent*, individually-validated indicators** (de-duplicate
  redundant ones so agreement is real).

Intended outcome: a system where each indicator has a *measured, out-of-sample, SPY-relative* edge,
redundant indicators are collapsed, and a GO means several genuinely-independent validated edges agree.

---

## The two go/no-go verdicts Chris asked to be convinced of

### Black-Scholes → **NO-GO. Killed from this effort.** (Chris's call: "if it isn't the correct indicator, kill it.")

- Black-Scholes is an **options *pricing*** model. It outputs the fair price of an option given the
  stock price, strike, time, rate, and volatility. **It says nothing about whether a stock is a good
  investment** — which is the entire purpose of the site. Feeding it into the equity quality score would
  be a category error and would *lower* trust, not raise it. (Sources: Damodaran/Stern, Corporate Finance
  Institute, Interactive Brokers.)
- It is the **wrong tool for the job we care about**, so it does nothing for the actual confidence problem
  (hand-tuned, unvalidated indicators). Including it here would only dilute the real fix.
- **Verdict: drop it.** It is removed from this plan entirely. *If* genuine options workflows are ever
  built, the Black-Scholes machinery (theoretical price, implied volatility → IV Rank, expected move) can
  return then as its own standalone options feature — but **never inside the stock-evaluation score**, and
  not as part of this trust-building work.

### PEGY → **CONDITIONAL-GO: a guarded upgrade to the P/E-only valuation factor.**

- Today `scoreValuation()` is **P/E only** (8% weight) and is blind to growth and dividends — it scores a
  30× growth compounder identically to a 30× melting ice cube. PEGY = `P/E ÷ (earnings-growth% + div-yield%)`
  directly fixes that, and **we already collect all three inputs** (`trailingPE`, `earningsGrowth`,
  `dividendYield`). So it's a ~15-line change, not a data project.
- Caveats that make it *conditional*, not blind-trust: **(a)** weak academic validation — Lynch's PEGY is
  popular among practitioners but has little rigorous out-of-sample evidence; **(b)** it **breaks on
  negative/zero growth** (ratio explodes or goes negative → meaningless); **(c)** our growth is a single
  noisy YoY calc, not a smoothed forward estimate.
- **Verdict:** implement PEGY **with guards** — use it when growth is meaningfully positive, otherwise fall
  back to the existing P/E ladder — and, per the backbone below, **only let it earn weight if it beats SPY
  out-of-sample.** Don't treat it as an oracle.

> Bottom line for Chris: neither metric alone is the "system you can be confident in." Black-Scholes is the
> wrong tool for stock-picking, so it's dropped; PEGY stays but only as a guarded valuation upgrade that must
> earn its keep. **The confidence comes from the validation backbone, not from any single indicator.**

---

## Target architecture: confluence of independent, validated factors

```
Raw data ─▶ Independent factor families (de-duplicated)
                 Value | Quality | Momentum | Low-Vol/Risk | Income | Flow/Sentiment
                          │
                          ▼
           Per-factor OUT-OF-SAMPLE validation vs SPY (Sharpe, drawdown, deflated Sharpe)
                          │  (weights are EARNED, not hand-set; failing factors get ~0 weight)
                          ▼
           ONE composite score  ─▶  ONE verdict  +  a "confluence count"
                                     (GO only when N independent VALIDATED factors agree)
```

This is the evidence-based shape (AQR/Novy-Marx multi-factor: value + quality + momentum + low-vol are the
factors with decades of out-of-sample support, and they're deliberately *low-correlation* so agreement is
meaningful).

---

## Implementation plan (ordered)

### Phase 0 — Confirm current backtest reality (read-only)
Read `backtest.py`, `backtest_gates.py`, and the `*_results.json` files; document the actual universe, date
range, metric, and confirm there is no walk-forward / no SPY benchmark. This sets the honest baseline.
*(A research agent is finishing this; findings fold in here.)*

### Phase 1 — Validation backbone (the core; this is what earns trust)
- Extend the Python backtest layer (new `python/validation/` module, reusing `backtest.py` data loading) to:
  - **Isolate each factor** (the 11 existing + new PEGY) and rank tickers by it.
  - **Walk-forward / out-of-sample**: rolling train→test windows across a broad universe (e.g. S&P 500
    constituents) over a multi-year range; never score on data used to fit.
  - **Compute per-factor**: forward-return spread (top vs bottom quintile), **Sharpe**, **max drawdown**,
    and **excess return vs SPY buy-and-hold** over the same windows.
  - **Multiple-testing correction**: report a **Deflated Sharpe Ratio** so trying many factors doesn't
    manufacture a fake winner.
  - **Correlation matrix** across factors → flag redundant ones (the RSI/MACD/EMA/momentum cluster) and
    collapse each cluster into one representative vote.
- Output: `python/validation/factor_validation.json` — per factor: `{sharpe, maxDD, excessVsSPY,
  deflatedSharpe, correlationCluster, verdict: GO|NO-GO}`.
- This file becomes the **source of truth for which indicators are allowed to carry weight.**

### Phase 2 — PEGY (the easy, high-value win)
- Upgrade `scoreValuation()` in `server/snapshot/score.ts`: compute guarded PEGY from `trailingPE`,
  `fundamentals.earningsGrowth`, `quote.dividendYield`; bucket (`<1` cheap-for-growth → high, `1–2` fair,
  `2–3` full, `>3` expensive); **fall back to the existing P/E ladder** when growth ≤ small positive floor
  or null. Reuse `num()/clamp10()/fmt()`. Surface the PEGY number in the `reasoning` string.
- Render it on the client wherever the valuation factor is shown (identify exact component during build).

### Phase 3 — Reconcile the two verdict systems into one confluence verdict
- Make `trigger-check.ts` `aggregateVerdict()` and `score.ts` `bucketVerdict()` consistent: a single
  composite score plus a **confluence rule** — **GO only when ≥ N independent *validated* factors agree**;
  disagreement → CAUTION; validated-negative confluence → NO. Weights come from Phase 1 (validated edge),
  not hand-tuning. Retire/repoint whichever path becomes redundant so the user never sees contradictory calls.

### Phase 4 — Surface validation in the UI
- Show each indicator's **validated GO/NO-GO badge** (from Phase 1's JSON) next to its contribution, so Chris
  can literally see "this indicator beat SPY out-of-sample / this one didn't." This is what converts the
  abstract score into something he can trust and audit.

---

## Reuse / existing pieces to lean on
- `server/snapshot/score.ts` helpers `num()`, `clamp10()`, `fmt()`, `scoreSnapshot()` aggregation.
- `server/snapshot/fundamentals.ts` already computes `earningsGrowth` (YoY) and `dividendYield` — no new fetch.
- `backtest.py` data loading / signal generation as the base for the walk-forward harness.
- `server/conviction/trigger-check.ts` aggregateVerdict as the home for the unified confluence verdict.

## Risks
- **Overfitting the backbone itself** → mitigate with strict walk-forward + Deflated Sharpe + held-out final test.
- **Data gaps** (growth/options coverage by ticker) → guards + graceful fallback already part of the design.
- **PEGY edge cases** (negative growth) → explicit fallback to P/E ladder.
- **Scope** — Phase 1 is the heavy lift; Phase 2 (PEGY) is independent and shippable on its own.

## Verification (end-to-end)
1. Run `python/validation/` walk-forward harness → inspect `factor_validation.json`; confirm Sharpe,
   max drawdown, **excess-vs-SPY**, and Deflated Sharpe are present per factor and that redundant factors are
   clustered. A factor with no out-of-sample SPY edge must show `NO-GO` and carry ~0 weight.
2. `npm run check` (TypeScript) clean.
3. Analyze 5–10 varied tickers; confirm: PEGY number renders, valuation factor moves sensibly, and the
   single verdict + confluence count is internally consistent (no INVESTMENT-GRADE-but-NO contradictions).
4. Grep to confirm **no Black-Scholes / options-pricing code was added** to the stock-evaluation path.
5. Compare a basket's GO calls vs SPY buy-and-hold over the out-of-sample window — risk-adjusted improvement
   is the acceptance bar.
