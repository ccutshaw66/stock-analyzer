# HTF Trading System

A complete High Tight Flag (HTF) pattern trading system for Stock Otter. Detects momentum breakout setups, sizes positions for account risk limits, manages portfolio-level concentration rules, and backtests against historical data.

Based on Thomas Bulkowski's *Encyclopedia of Chart Patterns* (2nd ed.) and Ross Givens' modified rules.

---

## TL;DR for Claude Code

You're integrating this into Stock Otter. The components are already written and tested. Your job is to wire them into the existing app.

**What exists** (drop into your Python source tree, e.g. `backend/` or wherever the rest of the Python lives):

- `patterns/` — pattern detection package. Primary detector is `htf_givens.py`. Eight other Bulkowski detectors are included but optional.
- `position_sizing.py` — converts a pattern detection into "buy X shares" with portfolio-level safety checks.
- `backtest_givens.py` — runs the strategy against historical data and reports stats.

**What's needed**:

1. A universe scanner that pulls all tradeable US stocks from FMP, filters them, and runs `htf_givens.scan()` on each — nightly or on demand.
2. An API endpoint that exposes the scan results to the frontend.
3. A UI panel showing "Today's Setups" with the position-sizing recommendation per hit.
4. A persistent portfolio store so the system knows what's already open.

**Account context**: $7,000 capital, 10% max risk per trade. See "Account configuration" below for all parameters.

---

## The trading rules being implemented

These are Ross Givens' rules for trading the High Tight Flag, a loosened version of Bulkowski's #1-ranked chart pattern.

### Setup (detection)

A stock qualifies when:

1. **Pole**: 30%+ price rise in 5-60 days (a recent sharp run to 30-60 day highs)
2. **Flag**: 3-30 days of consolidation that pulls back no more than 25% from the pole high
3. **Breakout**: closes above the consolidation high on volume ≥1.3x the 30-day average

### Entry

- Buy the **next day's open** after the breakout (Givens' rule)

### Exit

- **Hard stop**: just below the consolidation low (the flag low). If hit intraday, exit at the stop.
- **Partial exit**: sell 1/3 of the position after 3 consecutive days of strength (close >5% above entry)
- **Trailing stop**: trail the remaining 2/3 with a close below the 20-day moving average

### Position sizing

- Risk no more than 10% of account ($700 on a $7K account) on any single trade
- Position size capped at 25% of account ($1,750)
- Don't take trades where reward:risk is below 1.0 (mathematically losing)

### Portfolio rules

- Max 5 simultaneous open positions
- Max 30% of account at risk across all open positions ($2,100 on a $7K account)
- Max 40% in any single sector ($2,800)

---

## Module reference

### `patterns/htf_givens.py` — the detector

Entry point: `scan(df, symbol, lookback_days=252, require_breakout=True) -> list[PatternHit]`

**Input**: pandas DataFrame indexed by date with columns `Open, High, Low, Close, Volume`.
**Output**: list of `PatternHit` objects, newest first.

A `PatternHit` contains everything needed to act on the setup:

```python
@dataclass
class PatternHit:
    symbol: str
    pattern: str                    # "HTF_Givens"
    direction: str                  # "long"
    breakout_date: pd.Timestamp
    breakout_price: float           # close on breakout day
    target_price: float             # measure rule: entry + 0.5 × pole height
    stop_price: float               # just below consolidation low
    quality_score: int              # 0-100 (use min_score=70 in production)
    pattern_start: pd.Timestamp     # pole start
    pattern_end: pd.Timestamp       # breakout day
    extras: dict                    # pole_gain_pct, flag_days, flag_pullback_pct,
                                    # breakout_vol_ratio, flag_high, flag_low, ...
```

Quality score buckets (verified in backtest):
- **85+**: highest conviction — small sample but 100% win rate in initial test
- **70-84**: standard fire — production threshold
- **<70**: noise — filter out

### `position_sizing.py` — risk-managed sizing

Two key functions:

**`size_position(hit, config) -> PositionRecommendation`**

Takes a `PatternHit` and an `AccountConfig`, returns a recommendation:

```python
@dataclass
class PositionRecommendation:
    symbol: str
    entry_price: float
    stop_price: float
    target_price: float
    risk_per_share: float
    reward_risk_ratio: float
    recommended_shares: int         # 0 if blocked
    position_value: float           # $ committed
    actual_risk: float              # $ at risk if stop hits
    pct_of_capital: float
    warnings: list[str]             # soft flags
    blocked_reason: str | None      # hard block — don't take the trade
    
    @property
    def is_actionable(self) -> bool  # True only if not blocked
```

Hard blocks (trade cannot be taken):
- R/R below 1.0 (losing trade by design)
- Can't afford 1 share within position cap
- Invalid prices (stop on wrong side of entry)

Soft warnings (trade allowed but flagged):
- R/R below the configured minimum (default 2.0)
- Position >20% or <5% of capital
- Quality score below 70

**`PortfolioState`** — tracks open positions, enforces portfolio rules

```python
portfolio = PortfolioState.load("portfolio.json")
allowed, reason = portfolio.can_add_position(rec, hit, config, sector="Aerospace")
if allowed:
    portfolio.add_position(rec, hit, sector="Aerospace")
    portfolio.save("portfolio.json")
```

Portfolio-level blocks:
- Already holding this ticker
- Max simultaneous positions reached
- Would exceed max total open risk
- Would exceed max sector exposure

### `backtest_givens.py` — historical validation

Entry point: `backtest_symbol(df, symbol, min_score=0) -> list[Trade]`

Simulates the entry + partial exit + trail rules on historical data. Returns per-trade results with blended return %, max drawdown, exit reason, and the pattern's quality score.

Run from CLI for a quick check:
```powershell
python backtest_givens.py
```

Loads any JSON files from `fmp_data/` (FMP `historical-price-eod-full` format) and produces a summary.

---

## Account configuration

All parameters in one place — `AccountConfig` dataclass in `position_sizing.py`. Recommend storing as JSON in a single config file the user can edit as capital grows.

```python
@dataclass
class AccountConfig:
    capital: float = 7000.0
    max_risk_per_trade_pct: float = 0.10       # 10% = $700 on $7K
    max_position_pct: float = 0.25             # 25% max in one name
    max_simultaneous_positions: int = 5
    max_sector_exposure_pct: float = 0.40      # 40% in one sector
    max_total_open_risk_pct: float = 0.30      # 30% of capital at risk
    min_reward_risk_ratio: float = 2.0         # require 2:1 reward/risk
    commission_per_trade: float = 0.0
    slippage_pct: float = 0.002                # 0.2% on entry+exit
```

Scaling plan as account grows: bump `capital`, raise `max_simultaneous_positions` to 7 around $15K, then to 10 around $30K. The percentages can stay the same.

---

## Universe filter (what to scan)

For a $7K account, the right universe is small/mid-cap volatile movers — not blue chips and not pennies:

| Filter | Value | Why |
|---|---|---|
| Price | $5 – $75 | Above penny stocks, below where position-cap forces tiny positions |
| Avg daily volume | ≥ 750,000 shares | Clean fills on the position sizes the account can take |
| Market cap | ≥ $200M | Excludes pump-and-dump targets |
| Exchange | NYSE, NASDAQ, AMEX | Skip OTC |
| Exclude | ETFs, ETNs, leveraged products, IPOs < 6 months | These don't form normal patterns |

This yields roughly 1,000-1,500 candidates. Scanning that nightly via FMP is the right size — small enough to be fast, large enough to find setups.

---

## How everything connects

```
┌─────────────────────────────────────────────────────────────────┐
│                      Nightly Pipeline                           │
│                                                                 │
│  1. Universe loader (FMP directory + quote endpoints)           │
│     ↓ ~1,500 tickers passing filters                            │
│  2. OHLCV fetcher (FMP chart endpoint, cached locally)          │
│     ↓ 90 days of bars per ticker                                │
│  3. patterns.htf_givens.scan() on each                          │
│     ↓ list of PatternHits (most tickers return [])              │
│  4. Filter: keep hits where quality_score >= 70                 │
│     ↓ ~5-25 hits on a typical night                             │
│  5. position_sizing.size_position(hit, config) on each          │
│     ↓ each hit now has a PositionRecommendation                 │
│  6. PortfolioState.can_add_position() check against open names  │
│     ↓ split into "actionable" and "filtered" buckets            │
│  7. Save results to DB with timestamp                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Stock Otter Frontend                         │
│                                                                 │
│  • "Today's Setups" panel  — actionable trades                  │
│  • "Filtered" panel        — blocked trades + reason            │
│  • "Portfolio" panel       — open positions, total risk         │
│  • "Backtest" panel        — run history on any ticker          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation checklist for Claude Code

In rough priority order:

### 1. Get the modules importable
- Place `patterns/`, `position_sizing.py`, `backtest_givens.py` in the Python source tree
- Verify: `python -c "from patterns import htf_givens; from position_sizing import AccountConfig"` runs without error

### 2. Universe scanner
- New module, e.g. `scanner/universe.py`
- Pulls actively-traded US stocks from FMP `directory` endpoint
- Filters using FMP `quote` batch endpoint (price, volume, mkt cap)
- Excludes ETFs/ETNs/IPOs<6mo
- Returns list of qualifying tickers
- Logs count at each filter stage

### 3. Local OHLCV cache
- SQLite or parquet files
- Key: (symbol, date) → OHLCV row
- Avoid re-pulling tickers scanned within the last 24 hours
- Handle FMP rate limits with retry + backoff

### 4. Scan orchestrator
- Loop universe → fetch OHLCV → `htf_givens.scan()` → `size_position()` → `can_add_position()`
- Progress bar
- Save results to DB with timestamp + run ID
- Make runnable as `python -m stockotter.scan` from PowerShell

### 5. API endpoints
- `GET /api/setups?date=...&min_score=70` → actionable setups for a given run
- `GET /api/setups/filtered?date=...` → blocked setups (with reasons)
- `GET /api/portfolio` → current portfolio status
- `POST /api/portfolio/positions` → add/remove a position (user manually tracks fills)
- `POST /api/backtest` body: `{symbol, since}` → trade list + summary stats
- `GET/PUT /api/config` → read/write `AccountConfig`

### 6. UI panels
- **Today's Setups**: table sorted by quality score desc. Columns: ticker, pattern, entry, target, stop, R/R, shares, $position, $risk, score (color-coded: green ≥85, yellow 70-84, red <70). Each row clickable → opens chart.
- **Filtered Setups**: same data but with `blocked_reason` shown
- **Portfolio**: open positions table + summary (total value, total at risk, capacity remaining, sector breakdown)
- **Config**: form to edit `AccountConfig` JSON
- **Backtest**: ticker input → returns trade history + summary stats

### 7. Tests
- `pytest` for the scanner logic
- Smoke test: run scan on 5 known tickers, verify no errors
- Verify position sizing math against the demo in `position_sizing.py`

---

## Things to watch out for

1. **FMP rate limits** — depends on the user's plan. Check before doing a full 1,500-ticker scan. Add retry/backoff.
2. **Stale data** — exclude tickers where last bar is more than 3 days old (holidays excepted).
3. **Splits and dividends** — use FMP's `historical-price-eod-full` (dividend-adjusted) or you'll get false breakouts on ex-div dates.
4. **Look-ahead bias** — when backtesting, the detector must only see bars *before* the breakout candidate. The current detector handles this correctly for live scanning but a strict backtest needs walk-forward mode.
5. **Survivorship bias** — backtesting against today's universe misses delisted names. Note this in any reported performance.
6. **A losing market regime** — in choppy or downtrending markets, this scanner may return 0-3 hits per night. That's the system working correctly. Don't loosen filters to force more signals.

---

## Files in this design

```
patterns/
├── __init__.py             # scan_all() entry point + DETECTORS registry
├── _common.py              # PatternHit dataclass + shared helpers
├── htf.py                  # Bulkowski strict HTF (90%+ pole in 42 days)
├── htf_givens.py           # ★ PRIMARY: loosened HTF (30%+ pole in 60 days)
├── pipe_bottom.py          # Weekly chart only
├── hs_bottom.py            # Head & Shoulders Bottom
├── hs_top.py               # Head & Shoulders Top (short signal)
├── double_bottom_ee.py     # Double Bottom, Eve & Eve
├── double_top_ee.py        # Double Top, Eve & Eve (short signal)
├── rounding_bottom.py      # Saucer
├── triple_bottom.py
└── asc_triangle.py         # Ascending Triangle

position_sizing.py          # AccountConfig, size_position, PortfolioState
backtest_givens.py          # Strategy backtester with Givens' exit rules
test_all.py                 # Smoke tests for the detectors
```

---

## Quick reference: opening the toolkit interactively

```python
import pandas as pd
from patterns import htf_givens, scan_all
from position_sizing import AccountConfig, size_position, PortfolioState

# Load a single ticker's OHLCV
df = pd.read_csv("RKLB.csv", parse_dates=["date"]).set_index("date")

# Scan with the primary detector only
hits = htf_givens.scan(df, symbol="RKLB")

# Or scan with all detectors at once
hits = scan_all(df, symbol="RKLB", min_score=70)

# Size each hit for a $7K account
config = AccountConfig(capital=7000)
for hit in hits:
    rec = size_position(hit, config)
    print(rec.format_summary())
```
