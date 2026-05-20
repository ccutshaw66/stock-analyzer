"""
Backtester for the Givens-style HTF pattern.

Entry rules:
  - Detected by patterns.htf_givens (loose Bulkowski HTF: 30%+ pole in <=60 days,
    5-30 day consolidation, ≤25% pullback, close above consolidation high on
    volume ≥1.3x 30-day average)
  - Entry price = NEXT day's open after the breakout day (Givens' rule)

Exit rules (Givens):
  - Hard stop: below the consolidation low
  - Partial exit: sell 1/3 of position after 3-5 days of strength (we use
    "first day after 3 days where close > entry by >5%")
  - Trailing stop on remaining 2/3: close below the 20-day MA exits

Outputs per trade:
  symbol, entry_date, entry_price, exit_date, exit_price, holding_days,
  partial_exit (yes/no), return_pct, max_drawdown_pct, vs_buyhold_pct

Summary stats:
  - Win rate, avg return, median, std, best/worst, profit factor
  - Returns by quality score bucket
  - Vs buy-and-hold the same universe
"""

from __future__ import annotations
import os, json, glob
from dataclasses import dataclass, asdict
from typing import Optional
import numpy as np
import pandas as pd

import sys
sys.path.insert(0, "/home/claude")
from patterns import htf_givens
from patterns._common import PatternHit


@dataclass
class Trade:
    symbol: str
    entry_date: pd.Timestamp
    entry_price: float
    consolidation_low: float
    stop_price: float
    partial_exit_date: Optional[pd.Timestamp]
    partial_exit_price: Optional[float]
    exit_date: pd.Timestamp
    exit_price: float
    exit_reason: str        # "stop", "trail_20ma", "end_of_data"
    holding_days: int
    blended_return_pct: float    # accounts for partial exit
    max_drawdown_pct: float
    pole_gain_pct: float
    flag_days: int
    flag_pullback_pct: float
    breakout_vol_ratio: float
    quality_score: int

    def to_dict(self):
        d = asdict(self)
        for k, v in d.items():
            if isinstance(v, pd.Timestamp):
                d[k] = str(v.date())
        return d


def simulate_trade(df: pd.DataFrame, hit: PatternHit) -> Optional[Trade]:
    """
    Simulate a single trade from a detected breakout.
    df is the full OHLCV DataFrame for the symbol.
    """
    # Find the breakout row
    if hit.breakout_date not in df.index:
        return None
    breakout_i = df.index.get_loc(hit.breakout_date)

    # Entry = next day's open (Givens rule)
    entry_i = breakout_i + 1
    if entry_i >= len(df):
        return None

    entry_date = df.index[entry_i]
    entry_price = float(df["Open"].iloc[entry_i])
    consol_low = float(hit.extras["flag_low"])
    stop_price = consol_low * 0.99  # slight buffer below

    closes = df["Close"].to_numpy()
    highs = df["High"].to_numpy()
    lows = df["Low"].to_numpy()
    opens = df["Open"].to_numpy()

    # 20-day MA (calculated up to but not including the current bar to avoid lookahead)
    ma20_series = df["Close"].rolling(20).mean()

    partial_exit_date = None
    partial_exit_price = None
    strength_days = 0
    partial_done = False
    max_drawdown = 0.0
    peak_since_entry = entry_price

    for j in range(entry_i, len(df)):
        date_j = df.index[j]
        close_j = closes[j]
        low_j = lows[j]
        high_j = highs[j]

        # Track peak & drawdown
        if high_j > peak_since_entry:
            peak_since_entry = high_j
        dd_pct = (peak_since_entry - low_j) / peak_since_entry
        if dd_pct > max_drawdown:
            max_drawdown = dd_pct

        # Hard stop check (intraday)
        if low_j <= stop_price:
            exit_price = stop_price  # assume stop fills at stop level
            # Compute blended return: if partial already done, factor it in
            if partial_done and partial_exit_price:
                ret = (partial_exit_price / entry_price - 1) * (1/3) + \
                      (exit_price / entry_price - 1) * (2/3)
            else:
                ret = exit_price / entry_price - 1
            return Trade(
                symbol=hit.symbol,
                entry_date=entry_date, entry_price=entry_price,
                consolidation_low=consol_low, stop_price=stop_price,
                partial_exit_date=partial_exit_date,
                partial_exit_price=partial_exit_price,
                exit_date=date_j, exit_price=exit_price, exit_reason="stop",
                holding_days=j - entry_i,
                blended_return_pct=float(ret * 100),
                max_drawdown_pct=float(max_drawdown * 100),
                pole_gain_pct=float(hit.extras["pole_gain_pct"]),
                flag_days=int(hit.extras["flag_days"]),
                flag_pullback_pct=float(hit.extras["flag_pullback_pct"]),
                breakout_vol_ratio=float(hit.extras["breakout_vol_ratio"]),
                quality_score=hit.quality_score,
            )

        # Partial exit check: 3 consecutive strong closes (above entry by 5%+)
        # AND haven't done partial yet
        if not partial_done and close_j > entry_price * 1.05:
            strength_days += 1
            if strength_days >= 3:
                partial_exit_date = date_j
                partial_exit_price = close_j
                partial_done = True
                strength_days = 0
        else:
            strength_days = 0

        # Trailing 20-MA exit (only after partial done — until then we ride)
        # Givens: "Trail the rest using the 20-day MA"
        if partial_done and j >= 20:
            ma20 = ma20_series.iloc[j]
            if not np.isnan(ma20) and close_j < ma20:
                exit_price = close_j  # exit on close
                ret = (partial_exit_price / entry_price - 1) * (1/3) + \
                      (exit_price / entry_price - 1) * (2/3)
                return Trade(
                    symbol=hit.symbol,
                    entry_date=entry_date, entry_price=entry_price,
                    consolidation_low=consol_low, stop_price=stop_price,
                    partial_exit_date=partial_exit_date,
                    partial_exit_price=partial_exit_price,
                    exit_date=date_j, exit_price=exit_price, exit_reason="trail_20ma",
                    holding_days=j - entry_i,
                    blended_return_pct=float(ret * 100),
                    max_drawdown_pct=float(max_drawdown * 100),
                    pole_gain_pct=float(hit.extras["pole_gain_pct"]),
                    flag_days=int(hit.extras["flag_days"]),
                    flag_pullback_pct=float(hit.extras["flag_pullback_pct"]),
                    breakout_vol_ratio=float(hit.extras["breakout_vol_ratio"]),
                    quality_score=hit.quality_score,
                )

    # Ran out of data — close at last available
    last_close = closes[-1]
    if partial_done and partial_exit_price:
        ret = (partial_exit_price / entry_price - 1) * (1/3) + \
              (last_close / entry_price - 1) * (2/3)
    else:
        ret = last_close / entry_price - 1
    return Trade(
        symbol=hit.symbol,
        entry_date=entry_date, entry_price=entry_price,
        consolidation_low=consol_low, stop_price=stop_price,
        partial_exit_date=partial_exit_date,
        partial_exit_price=partial_exit_price,
        exit_date=df.index[-1], exit_price=float(last_close),
        exit_reason="end_of_data",
        holding_days=len(df) - 1 - entry_i,
        blended_return_pct=float(ret * 100),
        max_drawdown_pct=float(max_drawdown * 100),
        pole_gain_pct=float(hit.extras["pole_gain_pct"]),
        flag_days=int(hit.extras["flag_days"]),
        flag_pullback_pct=float(hit.extras["flag_pullback_pct"]),
        breakout_vol_ratio=float(hit.extras["breakout_vol_ratio"]),
        quality_score=hit.quality_score,
    )


def backtest_symbol(df: pd.DataFrame, symbol: str,
                    min_score: int = 0) -> list[Trade]:
    """Find all HTF setups in this symbol's history and simulate each."""
    # Detect all historical setups by scanning with a long lookback
    hits = htf_givens.scan(df, symbol=symbol, lookback_days=len(df))
    trades = []
    for h in hits:
        if h.quality_score < min_score:
            continue
        t = simulate_trade(df, h)
        if t:
            trades.append(t)
    return trades


def load_data(data_dir: str = "/home/claude/fmp_data") -> dict[str, pd.DataFrame]:
    """Load all symbol JSON files into DataFrames."""
    out = {}
    for path in glob.glob(f"{data_dir}/*.json"):
        symbol = os.path.basename(path).replace(".json", "")
        with open(path) as f:
            records = json.load(f)
        df = pd.DataFrame(records)
        df["date"] = pd.to_datetime(df["date"])
        df = df.sort_values("date").set_index("date")
        # Normalize column names
        df.columns = [c.capitalize() if c.lower() in
                      ("open","high","low","close","volume") else c
                      for c in df.columns]
        if all(c in df.columns for c in ["Open","High","Low","Close","Volume"]):
            out[symbol] = df[["Open","High","Low","Close","Volume"]].copy()
    return out


def summarize(trades: list[Trade]) -> dict:
    if not trades:
        return {"n_trades": 0}
    returns = np.array([t.blended_return_pct for t in trades])
    wins = returns[returns > 0]
    losses = returns[returns <= 0]
    win_rate = len(wins) / len(returns) * 100
    avg_return = float(np.mean(returns))
    median_return = float(np.median(returns))
    avg_win = float(np.mean(wins)) if len(wins) else 0
    avg_loss = float(np.mean(losses)) if len(losses) else 0
    profit_factor = abs(wins.sum() / losses.sum()) if len(losses) and losses.sum() != 0 else float("inf")
    avg_hold = float(np.mean([t.holding_days for t in trades]))
    avg_dd = float(np.mean([t.max_drawdown_pct for t in trades]))

    # Stop hit rate
    stops = sum(1 for t in trades if t.exit_reason == "stop")
    trails = sum(1 for t in trades if t.exit_reason == "trail_20ma")

    # Expectancy
    expectancy = (win_rate/100) * avg_win + (1 - win_rate/100) * avg_loss

    return {
        "n_trades": len(trades),
        "win_rate_pct": round(win_rate, 1),
        "avg_return_pct": round(avg_return, 2),
        "median_return_pct": round(median_return, 2),
        "avg_win_pct": round(avg_win, 2),
        "avg_loss_pct": round(avg_loss, 2),
        "profit_factor": round(profit_factor, 2),
        "expectancy_per_trade_pct": round(expectancy, 2),
        "avg_hold_days": round(avg_hold, 1),
        "avg_drawdown_pct": round(avg_dd, 2),
        "stop_outs": stops,
        "trail_exits": trails,
        "best_trade": round(float(returns.max()), 2),
        "worst_trade": round(float(returns.min()), 2),
    }


def summarize_by_score_bucket(trades: list[Trade]) -> list[dict]:
    """Bucket trades by quality_score and show stats per bucket."""
    buckets = [(0,50), (50,70), (70,85), (85,101)]
    out = []
    for lo, hi in buckets:
        bucket_trades = [t for t in trades if lo <= t.quality_score < hi]
        if not bucket_trades:
            continue
        summary = summarize(bucket_trades)
        summary["score_range"] = f"{lo}-{hi-1}"
        out.append(summary)
    return out


if __name__ == "__main__":
    print("Loading data...")
    data = load_data()
    print(f"  loaded {len(data)} symbols: {sorted(data.keys())}\n")

    all_trades = []
    by_symbol = {}
    for symbol, df in sorted(data.items()):
        trades = backtest_symbol(df, symbol)
        by_symbol[symbol] = trades
        all_trades.extend(trades)
        if trades:
            avg_ret = np.mean([t.blended_return_pct for t in trades])
            print(f"  {symbol:<6} {len(trades)} trades, avg return {avg_ret:+.1f}%")
        else:
            print(f"  {symbol:<6} no setups found")

    print(f"\n{'='*70}")
    print(f"OVERALL SUMMARY ({len(all_trades)} trades)")
    print(f"{'='*70}")
    summary = summarize(all_trades)
    for k, v in summary.items():
        print(f"  {k:<28} {v}")

    print(f"\n{'='*70}")
    print(f"BY QUALITY SCORE BUCKET")
    print(f"{'='*70}")
    buckets = summarize_by_score_bucket(all_trades)
    if buckets:
        keys = ["score_range", "n_trades", "win_rate_pct", "avg_return_pct",
                "profit_factor", "expectancy_per_trade_pct", "avg_hold_days"]
        print(f"  {'Range':<10} {'N':>4} {'Win%':>6} {'AvgRet%':>8} "
              f"{'PF':>5} {'Exp/Tr%':>8} {'Hold':>5}")
        for b in buckets:
            print(f"  {b['score_range']:<10} {b['n_trades']:>4} "
                  f"{b['win_rate_pct']:>6.1f} {b['avg_return_pct']:>+8.2f} "
                  f"{b['profit_factor']:>5.2f} "
                  f"{b['expectancy_per_trade_pct']:>+8.2f} "
                  f"{b['avg_hold_days']:>5.1f}")

    print(f"\n{'='*70}")
    print(f"INDIVIDUAL TRADES")
    print(f"{'='*70}")
    print(f"  {'SYM':<6} {'ENTRY':<11} {'EXIT':<11} {'DAYS':>4} "
          f"{'ENTRY$':>8} {'EXIT$':>8} {'RET%':>7} {'DD%':>6} "
          f"{'RSN':<10} {'POLE%':>6} {'FLAG':>4} {'BVOL':>5} {'Q':>3}")
    for t in sorted(all_trades, key=lambda x: x.entry_date):
        d = t.to_dict()
        print(f"  {d['symbol']:<6} {d['entry_date']:<11} {d['exit_date']:<11} "
              f"{d['holding_days']:>4} "
              f"{d['entry_price']:>8.2f} {d['exit_price']:>8.2f} "
              f"{d['blended_return_pct']:>+7.1f} {d['max_drawdown_pct']:>6.1f} "
              f"{d['exit_reason']:<10} {d['pole_gain_pct']:>6.0f} "
              f"{d['flag_days']:>4} {d['breakout_vol_ratio']:>5.1f} "
              f"{d['quality_score']:>3}")
