"""
High & Tight Flag (HTF) detector.

Based on Bulkowski, Encyclopedia of Chart Patterns 2nd ed., Ch. 22.
Bull-market avg rise: 69%, break-even failure rate: 0% (rank 1 of 23).
Bear-market avg rise: 42% (rank 1 of 19).

Algorithm:
  1. Find a "pole": price rose >= POLE_MIN_GAIN over <= POLE_MAX_DAYS.
  2. Find a "flag": consolidation of FLAG_MIN_DAYS..FLAG_MAX_DAYS
     immediately after the pole high, where the pullback from the
     pole high is <= FLAG_MAX_PULLBACK.
  3. Confirm a "breakout": close above the flag high on rising or
     above-avg-acceptable volume.
  4. Score the candidate using Bulkowski's "for best performance" rules
     (declining volume in flag, short/narrow flag, no breakout gap, etc.)

Usage:
    >>> import pandas as pd
    >>> df = pd.read_csv("AAPL.csv", parse_dates=["Date"]).set_index("Date")
    >>> # df needs columns: Open, High, Low, Close, Volume
    >>> hits = scan_htf(df, symbol="AAPL")
    >>> for h in hits:
    ...     print(h)
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Iterable
import pandas as pd
import numpy as np


# ---------------------------------------------------------------------
# Bulkowski's HTF identification thresholds (Ch. 22, Table 22.1)
# ---------------------------------------------------------------------
POLE_MIN_GAIN     = 0.90   # >= 90% rise (O'Neil says double; Bulkowski accepts ~90%)
POLE_MAX_DAYS     = 42     # "less than 2 months" — ~42 trading days
FLAG_MIN_DAYS     = 5      # short consolidations OK; Bulkowski found some <1 week
FLAG_MAX_DAYS     = 38     # O'Neil says 3-5 weeks; Bulkowski accepts up to ~38
FLAG_MAX_PULLBACK = 0.25   # <= 25% drop from pole high inside flag (O'Neil: 20%)
BREAKOUT_PADDING  = 0.001  # close must exceed flag high by 0.1% (anti-noise)


@dataclass
class HTFHit:
    """One detected High & Tight Flag setup."""
    symbol: str
    pole_start_date: pd.Timestamp
    pole_start_price: float
    pole_end_date: pd.Timestamp        # = flag start
    pole_end_price: float              # = flag high
    pole_gain_pct: float
    pole_days: int
    flag_low_date: pd.Timestamp
    flag_low_price: float
    flag_pullback_pct: float
    flag_days: int
    breakout_date: pd.Timestamp
    breakout_price: float
    breakout_volume_ratio: float       # breakout vol / 30-day avg vol
    flag_volume_trend: float           # slope of vol regression in flag; <0 is good
    target_price: float                # measure rule
    quality_score: int                 # 0-100, higher = better

    def to_dict(self):
        d = asdict(self)
        # Convert Timestamps to ISO strings for JSON serialization
        for k, v in d.items():
            if isinstance(v, pd.Timestamp):
                d[k] = v.isoformat()
        return d


# ---------------------------------------------------------------------
# Core detection
# ---------------------------------------------------------------------
def scan_htf(
    df: pd.DataFrame,
    symbol: str = "",
    lookback_days: int = 252,
    require_breakout: bool = True,
) -> list[HTFHit]:
    """
    Scan a daily OHLCV DataFrame for HTF setups.

    Parameters
    ----------
    df : DataFrame indexed by date, columns Open/High/Low/Close/Volume.
    symbol : Ticker (informational).
    lookback_days : Only scan the last N bars. Default ~1 year.
    require_breakout : If False, return forming patterns (no breakout yet).

    Returns
    -------
    list of HTFHit, newest first.
    """
    df = _validate(df)
    if len(df) < POLE_MAX_DAYS + FLAG_MAX_DAYS + 5:
        return []

    df = df.tail(lookback_days + POLE_MAX_DAYS + FLAG_MAX_DAYS).copy()
    df["vol_avg30"] = df["Volume"].rolling(30, min_periods=10).mean()

    hits: list[HTFHit] = []
    closes = df["Close"].to_numpy()
    highs  = df["High"].to_numpy()
    lows   = df["Low"].to_numpy()
    vols   = df["Volume"].to_numpy()
    vol_avg = df["vol_avg30"].to_numpy()
    dates  = df.index

    # Walk forward; at each bar i treat it as a candidate breakout day.
    # The flag high lives somewhere in [i - FLAG_MAX_DAYS, i - FLAG_MIN_DAYS].
    # The pole start lives somewhere in [flag_high - POLE_MAX_DAYS, flag_high - 1].
    start = POLE_MAX_DAYS + FLAG_MAX_DAYS
    last_breakout_idx = -1  # avoid emitting overlapping hits

    for i in range(start, len(df)):
        # Look for the most recent local high that could anchor a flag.
        flag_window_start = max(0, i - FLAG_MAX_DAYS - 1)
        flag_window_end   = i - FLAG_MIN_DAYS
        if flag_window_end <= flag_window_start:
            continue

        # Flag high = max High in the flag window (which is the pole's terminus)
        flag_slice = highs[flag_window_start:flag_window_end + 1]
        if len(flag_slice) == 0:
            continue
        flag_high_offset = int(np.argmax(flag_slice))
        flag_high_idx = flag_window_start + flag_high_offset
        flag_high = highs[flag_high_idx]

        # --- POLE check ---
        pole_search_start = max(0, flag_high_idx - POLE_MAX_DAYS)
        pole_slice_low = lows[pole_search_start:flag_high_idx + 1]
        if len(pole_slice_low) < 5:
            continue
        pole_low_offset = int(np.argmin(pole_slice_low))
        pole_start_idx = pole_search_start + pole_low_offset
        pole_low = lows[pole_start_idx]
        pole_days = flag_high_idx - pole_start_idx
        if pole_days < 5 or pole_days > POLE_MAX_DAYS:
            continue
        pole_gain = (flag_high - pole_low) / pole_low if pole_low > 0 else 0
        if pole_gain < POLE_MIN_GAIN:
            continue

        # --- FLAG check ---
        flag_bars_lows  = lows[flag_high_idx:i + 1]
        flag_bars_highs = highs[flag_high_idx:i + 1]
        flag_days = i - flag_high_idx
        if flag_days < FLAG_MIN_DAYS or flag_days > FLAG_MAX_DAYS:
            continue
        flag_low_offset = int(np.argmin(flag_bars_lows))
        flag_low_idx = flag_high_idx + flag_low_offset
        flag_low = lows[flag_low_idx]
        pullback = (flag_high - flag_low) / flag_high
        if pullback > FLAG_MAX_PULLBACK:
            continue
        # Flag must not exceed pole-high before the breakout day itself.
        # (Otherwise it's not a consolidation — the trend just continued.)
        if flag_bars_highs[:-1].max(initial=0) > flag_high * (1 + BREAKOUT_PADDING):
            continue

        # --- BREAKOUT check ---
        breakout_close = closes[i]
        is_breakout = breakout_close > flag_high * (1 + BREAKOUT_PADDING)
        if require_breakout and not is_breakout:
            continue

        # Don't double-count overlapping patterns
        if last_breakout_idx >= 0 and (i - last_breakout_idx) < FLAG_MIN_DAYS:
            continue

        # --- Score & build hit ---
        vol_ratio = (
            vols[i] / vol_avg[i] if vol_avg[i] and not np.isnan(vol_avg[i]) else 1.0
        )
        vol_trend = _volume_slope(vols[flag_high_idx:i])  # in-flag slope
        target = breakout_close + 0.5 * (flag_high - pole_low)  # Bulkowski's half-staff measure rule

        score = _score(
            pole_gain=pole_gain,
            pole_days=pole_days,
            flag_days=flag_days,
            pullback=pullback,
            vol_trend=vol_trend,
            vol_ratio=vol_ratio,
            gap=_has_gap(highs[i - 1], lows[i], closes[i - 1]),
        )

        hits.append(HTFHit(
            symbol=symbol,
            pole_start_date=dates[pole_start_idx],
            pole_start_price=float(pole_low),
            pole_end_date=dates[flag_high_idx],
            pole_end_price=float(flag_high),
            pole_gain_pct=float(pole_gain * 100),
            pole_days=int(pole_days),
            flag_low_date=dates[flag_low_idx],
            flag_low_price=float(flag_low),
            flag_pullback_pct=float(pullback * 100),
            flag_days=int(flag_days),
            breakout_date=dates[i],
            breakout_price=float(breakout_close),
            breakout_volume_ratio=float(vol_ratio),
            flag_volume_trend=float(vol_trend),
            target_price=float(target),
            quality_score=int(score),
        ))
        last_breakout_idx = i

    hits.sort(key=lambda h: h.breakout_date, reverse=True)
    return hits


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------
def _validate(df: pd.DataFrame) -> pd.DataFrame:
    needed = {"Open", "High", "Low", "Close", "Volume"}
    missing = needed - set(df.columns)
    if missing:
        raise ValueError(f"DataFrame missing columns: {missing}")
    if not isinstance(df.index, pd.DatetimeIndex):
        raise ValueError("DataFrame must be indexed by DatetimeIndex")
    if not df.index.is_monotonic_increasing:
        df = df.sort_index()
    return df


def _volume_slope(v: np.ndarray) -> float:
    """Linear-regression slope of volume, normalized so units = pct/day."""
    if len(v) < 3:
        return 0.0
    x = np.arange(len(v), dtype=float)
    mean_v = v.mean()
    if mean_v == 0:
        return 0.0
    slope = np.polyfit(x, v, 1)[0]
    return float(slope / mean_v)  # fractional change per day


def _has_gap(prev_high: float, today_low: float, prev_close: float) -> bool:
    return today_low > prev_high  # up-gap on breakout day


def _score(*, pole_gain, pole_days, flag_days, pullback,
           vol_trend, vol_ratio, gap) -> int:
    """
    Quality score 0-100 based on Bulkowski's 'For Best Performance' rules.
    Higher is better; tuned so a textbook HTF scores ~85-95.
    """
    s = 50

    # Bigger / faster poles outperform
    if pole_gain >= 1.50: s += 15
    elif pole_gain >= 1.20: s += 10
    elif pole_gain >= 1.00: s += 5

    # Short flags (Bulkowski: short/narrow flags outperform tall/wide)
    if flag_days <= 15: s += 10
    elif flag_days <= 25: s += 5

    # Shallow pullbacks are tighter, stronger
    if pullback <= 0.10: s += 10
    elif pullback <= 0.15: s += 5

    # Declining volume in flag — strong positive signal
    if vol_trend < -0.02: s += 10
    elif vol_trend < 0:   s += 5

    # Breakout volume: HTF is unusual — light breakout vol is actually fine.
    # We penalize only obviously weak (<0.7x), reward strong (>1.5x) modestly.
    if vol_ratio >= 1.5: s += 5
    elif vol_ratio < 0.7: s -= 5

    # Bulkowski: flags with breakout-day gaps perform WORSE for HTF
    if gap: s -= 5

    return max(0, min(100, s))


# ---------------------------------------------------------------------
# CLI / quick test harness
# ---------------------------------------------------------------------
if __name__ == "__main__":
    import sys, json

    if len(sys.argv) < 2:
        print("Usage: python htf_detector.py <csv_path> [symbol]")
        sys.exit(1)
    path = sys.argv[1]
    sym = sys.argv[2] if len(sys.argv) > 2 else ""
    df = pd.read_csv(path, parse_dates=["Date"]).set_index("Date")
    # Normalize common column variants
    df.columns = [c.title() if c.lower() in ("open","high","low","close","volume") else c for c in df.columns]
    hits = scan_htf(df, symbol=sym)
    print(json.dumps([h.to_dict() for h in hits], indent=2, default=str))
