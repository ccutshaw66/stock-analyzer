"""
Shared utilities for Bulkowski pattern detectors.

All detectors take a pandas DataFrame indexed by DatetimeIndex with
columns Open, High, Low, Close, Volume. All return a list of
PatternHit dataclasses sorted newest-first.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional
import numpy as np
import pandas as pd


@dataclass
class PatternHit:
    """Generic hit record returned by every detector."""
    symbol: str
    pattern: str                  # e.g. "HTF", "PipeBottom"
    direction: str                # "long" or "short"
    breakout_date: pd.Timestamp
    breakout_price: float
    target_price: float           # measure-rule projection
    stop_price: float             # suggested stop (just past invalidation level)
    quality_score: int            # 0-100
    pattern_start: pd.Timestamp
    pattern_end: pd.Timestamp
    extras: dict = field(default_factory=dict)  # pattern-specific data

    # Bulkowski reference stats so UI can show expected performance
    bull_avg_move_pct: float = 0.0
    bull_failure_pct: float = 0.0
    bull_rank: int = 0
    bear_avg_move_pct: float = 0.0
    bear_failure_pct: float = 0.0
    bear_rank: int = 0

    def to_dict(self):
        d = asdict(self)
        for k, v in d.items():
            if isinstance(v, pd.Timestamp):
                d[k] = v.isoformat()
        return d


def validate_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    needed = {"Open", "High", "Low", "Close", "Volume"}
    missing = needed - set(df.columns)
    if missing:
        raise ValueError(f"DataFrame missing columns: {missing}")
    if not isinstance(df.index, pd.DatetimeIndex):
        raise ValueError("DataFrame index must be DatetimeIndex")
    if not df.index.is_monotonic_increasing:
        df = df.sort_index()
    return df


def rolling_vol_avg(df: pd.DataFrame, window: int = 30) -> pd.Series:
    return df["Volume"].rolling(window, min_periods=max(5, window // 3)).mean()


def has_up_gap(prev_high: float, today_low: float) -> bool:
    """True when today opens/trades above yesterday's high (true gap)."""
    return today_low > prev_high


def has_down_gap(prev_low: float, today_high: float) -> bool:
    return today_high < prev_low


def is_pullback_or_throwback(prices: np.ndarray, breakout_level: float,
                             direction: str, within_days: int = 30) -> bool:
    """
    Bulkowski: a throwback (long) or pullback (short) is price returning
    to the breakout level within 30 days. Returns True if it happened.
    """
    window = prices[:within_days]
    if direction == "long":
        return bool(np.any(window <= breakout_level))
    return bool(np.any(window >= breakout_level))


def local_minima_indices(arr: np.ndarray, order: int = 5) -> list[int]:
    """Indices of local minima where arr[i] is the lowest in [i-order, i+order]."""
    out = []
    n = len(arr)
    for i in range(order, n - order):
        window = arr[i - order:i + order + 1]
        if arr[i] == window.min() and np.sum(window == arr[i]) == 1:
            out.append(i)
    return out


def local_maxima_indices(arr: np.ndarray, order: int = 5) -> list[int]:
    out = []
    n = len(arr)
    for i in range(order, n - order):
        window = arr[i - order:i + order + 1]
        if arr[i] == window.max() and np.sum(window == arr[i]) == 1:
            out.append(i)
    return out


def linreg_slope_norm(values: np.ndarray) -> float:
    """Linear-regression slope normalized by the mean (fractional change/bar)."""
    if len(values) < 3:
        return 0.0
    x = np.arange(len(values), dtype=float)
    mean = float(values.mean())
    if mean == 0:
        return 0.0
    slope = float(np.polyfit(x, values, 1)[0])
    return slope / mean


def clamp_score(s: float) -> int:
    return int(max(0, min(100, round(s))))
