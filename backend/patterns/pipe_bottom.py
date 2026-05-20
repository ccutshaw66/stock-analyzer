"""
Pipe Bottom — Bulkowski Ch. 41. Rank 2 of 23 bull, rank 3 of 19 bear.
Avg rise 45% bull, 38% bear. Break-even fail 5%.

WEEKLY chart only. Two adjacent weekly bars with long lower shadows
("downward price spikes") at approximately the same low, in a downtrend.
Breakout = close above the higher of the two pipe-bar highs.

If you only have daily data, this resamples to weekly internally.
"""

from __future__ import annotations
import numpy as np
import pandas as pd
from patterns._common import (
    PatternHit, validate_ohlcv, rolling_vol_avg, clamp_score
)

# Bulkowski Table 41.1 thresholds
PIPE_TOLERANCE      = 0.02   # the two lows within 2% of each other
MIN_SPIKE_FACTOR    = 1.5    # spike length >= 1.5x the prior 12-week avg
DOWNTREND_BARS      = 12     # require a prior downtrend of N weeks
DOWNTREND_MIN_DROP  = 0.10   # >=10% drop into the pipe
BREAKOUT_PAD        = 0.001


def scan(df: pd.DataFrame, symbol: str = "",
         lookback_weeks: int = 104, require_breakout: bool = True) -> list[PatternHit]:
    df = validate_ohlcv(df)

    # Resample daily -> weekly if needed
    if _looks_daily(df):
        df = _to_weekly(df)

    if len(df) < DOWNTREND_BARS + 5:
        return []
    df = df.tail(lookback_weeks + DOWNTREND_BARS).copy()
    df["vol_avg"] = rolling_vol_avg(df, window=10)

    highs = df["High"].to_numpy()
    lows  = df["Low"].to_numpy()
    closes = df["Close"].to_numpy()
    opens  = df["Open"].to_numpy()
    vols   = df["Volume"].to_numpy()
    vol_avg = df["vol_avg"].to_numpy()
    dates = df.index

    hits: list[PatternHit] = []
    last_idx = -999

    for i in range(DOWNTREND_BARS + 1, len(df) - 1):
        # Two adjacent pipe bars: i-1 and i
        l1, l2 = lows[i - 1], lows[i]
        h1, h2 = highs[i - 1], highs[i]

        # Lows must be similar
        avg_low = (l1 + l2) / 2
        if abs(l1 - l2) / avg_low > PIPE_TOLERANCE:
            continue

        # Spikes must be long: the body should be in the upper portion of the bar
        spike1 = min(opens[i - 1], closes[i - 1]) - l1
        spike2 = min(opens[i], closes[i]) - l2
        bar1 = h1 - l1
        bar2 = h2 - l2
        if bar1 <= 0 or bar2 <= 0:
            continue
        if spike1 / bar1 < 0.5 or spike2 / bar2 < 0.5:
            continue

        # Each spike must exceed 1.5x average bar range of prior 12 weeks
        prior_ranges = highs[i - DOWNTREND_BARS - 1:i - 1] - lows[i - DOWNTREND_BARS - 1:i - 1]
        if len(prior_ranges) < 5:
            continue
        avg_range = float(prior_ranges.mean())
        if avg_range == 0:
            continue
        if bar1 < MIN_SPIKE_FACTOR * avg_range or bar2 < MIN_SPIKE_FACTOR * avg_range:
            continue

        # Require prior downtrend
        prior_high = float(highs[i - DOWNTREND_BARS - 1:i - 1].max())
        drop = (prior_high - avg_low) / prior_high if prior_high > 0 else 0
        if drop < DOWNTREND_MIN_DROP:
            continue

        pipe_high = max(h1, h2)

        # Breakout: close above pipe_high
        # Scan forward up to 8 weeks for the breakout bar
        breakout_idx = None
        for j in range(i + 1, min(len(df), i + 9)):
            if closes[j] > pipe_high * (1 + BREAKOUT_PAD):
                breakout_idx = j
                break
        if breakout_idx is None:
            if require_breakout:
                continue
            breakout_idx = len(df) - 1  # forming

        if (breakout_idx - last_idx) < 4:
            continue

        # Measure rule: target = breakout + (pipe_high - pipe_low)
        pattern_height = pipe_high - avg_low
        target = closes[breakout_idx] + pattern_height
        stop = avg_low * 0.97

        vr = vols[breakout_idx] / vol_avg[breakout_idx] if vol_avg[breakout_idx] else 1.0
        spike_vol_ratio = (vols[i - 1] + vols[i]) / (2 * vol_avg[i]) if vol_avg[i] else 1.0

        score = 55
        if drop >= 0.20: score += 10
        elif drop >= 0.15: score += 5
        if bar1 >= 2 * avg_range and bar2 >= 2 * avg_range: score += 10
        if abs(l1 - l2) / avg_low < 0.005: score += 5  # very tight match
        if spike_vol_ratio > 1.5: score += 10  # heavy volume on pipes
        elif spike_vol_ratio > 1.2: score += 5
        if vr > 1.5: score += 5
        if drop < 0.08: score -= 10

        hits.append(PatternHit(
            symbol=symbol, pattern="PipeBottom", direction="long",
            breakout_date=dates[breakout_idx],
            breakout_price=float(closes[breakout_idx]),
            target_price=float(target), stop_price=float(stop),
            quality_score=clamp_score(score),
            pattern_start=dates[i - 1], pattern_end=dates[breakout_idx],
            bull_avg_move_pct=45.0, bull_failure_pct=5.0, bull_rank=2,
            bear_avg_move_pct=38.0, bear_failure_pct=12.0, bear_rank=3,
            extras={
                "pipe_low": float(avg_low),
                "pipe_high": float(pipe_high),
                "prior_downtrend_pct": float(drop * 100),
                "spike_vol_ratio": float(spike_vol_ratio),
                "weekly": True,
            },
        ))
        last_idx = breakout_idx

    hits.sort(key=lambda h: h.breakout_date, reverse=True)
    return hits


def _looks_daily(df: pd.DataFrame) -> bool:
    """Heuristic: median day-gap < 4 days => daily; else assume weekly."""
    if len(df) < 5:
        return False
    diffs = np.diff(df.index.view("i8")) / 1e9 / 86400  # days
    return float(np.median(diffs)) < 4.0


def _to_weekly(df: pd.DataFrame) -> pd.DataFrame:
    w = df.resample("W-FRI").agg({
        "Open": "first", "High": "max", "Low": "min",
        "Close": "last", "Volume": "sum"
    }).dropna()
    return w
