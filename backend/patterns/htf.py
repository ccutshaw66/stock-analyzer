"""
High & Tight Flag (HTF) — Bulkowski Ch. 22.
Rank 1 of 23 (bull) and 1 of 19 (bear). Avg rise 69% bull, 42% bear.
0% break-even failure rate.

Setup: 90%+ rise in ≤2 months (pole), 5-38 day consolidation with
≤25% pullback (flag), breakout above flag high.
"""

from __future__ import annotations
import numpy as np
import pandas as pd
from patterns._common import (
    PatternHit, validate_ohlcv, rolling_vol_avg, has_up_gap,
    linreg_slope_norm, clamp_score
)

POLE_MIN_GAIN     = 0.90
POLE_MAX_DAYS     = 42
FLAG_MIN_DAYS     = 5
FLAG_MAX_DAYS     = 38
FLAG_MAX_PULLBACK = 0.25
BREAKOUT_PAD      = 0.001


def scan(df: pd.DataFrame, symbol: str = "",
         lookback_days: int = 252, require_breakout: bool = True) -> list[PatternHit]:
    df = validate_ohlcv(df)
    if len(df) < POLE_MAX_DAYS + FLAG_MAX_DAYS + 5:
        return []

    df = df.tail(lookback_days + POLE_MAX_DAYS + FLAG_MAX_DAYS).copy()
    df["vol_avg30"] = rolling_vol_avg(df)

    highs = df["High"].to_numpy()
    lows  = df["Low"].to_numpy()
    closes = df["Close"].to_numpy()
    vols   = df["Volume"].to_numpy()
    vol_avg = df["vol_avg30"].to_numpy()
    dates = df.index

    hits: list[PatternHit] = []
    last_idx = -999

    for i in range(POLE_MAX_DAYS + FLAG_MAX_DAYS, len(df)):
        flag_window_start = max(0, i - FLAG_MAX_DAYS - 1)
        flag_window_end = i - FLAG_MIN_DAYS
        if flag_window_end <= flag_window_start:
            continue

        flag_slice = highs[flag_window_start:flag_window_end + 1]
        if len(flag_slice) == 0:
            continue
        fh_offset = int(np.argmax(flag_slice))
        flag_high_idx = flag_window_start + fh_offset
        flag_high = highs[flag_high_idx]

        # Pole
        pole_start = max(0, flag_high_idx - POLE_MAX_DAYS)
        pole_slice = lows[pole_start:flag_high_idx + 1]
        if len(pole_slice) < 5:
            continue
        pl_offset = int(np.argmin(pole_slice))
        pole_start_idx = pole_start + pl_offset
        pole_low = lows[pole_start_idx]
        pole_days = flag_high_idx - pole_start_idx
        if pole_days < 5 or pole_days > POLE_MAX_DAYS:
            continue
        pole_gain = (flag_high - pole_low) / pole_low if pole_low > 0 else 0
        if pole_gain < POLE_MIN_GAIN:
            continue

        # Flag
        flag_days = i - flag_high_idx
        if flag_days < FLAG_MIN_DAYS or flag_days > FLAG_MAX_DAYS:
            continue
        flag_lows  = lows[flag_high_idx:i + 1]
        flag_highs = highs[flag_high_idx:i + 1]
        flag_low_idx = flag_high_idx + int(np.argmin(flag_lows))
        flag_low = lows[flag_low_idx]
        pullback = (flag_high - flag_low) / flag_high
        if pullback > FLAG_MAX_PULLBACK:
            continue
        if flag_highs[:-1].max(initial=0) > flag_high * (1 + BREAKOUT_PAD):
            continue

        # Breakout
        if closes[i] <= flag_high * (1 + BREAKOUT_PAD):
            if require_breakout:
                continue

        if (i - last_idx) < FLAG_MIN_DAYS:
            continue

        vol_ratio = (vols[i] / vol_avg[i]) if vol_avg[i] and not np.isnan(vol_avg[i]) else 1.0
        vol_trend = linreg_slope_norm(vols[flag_high_idx:i])
        target = closes[i] + 0.5 * (flag_high - pole_low)
        stop = flag_low * 0.98

        score = 50
        if pole_gain >= 1.5: score += 15
        elif pole_gain >= 1.2: score += 10
        elif pole_gain >= 1.0: score += 5
        if flag_days <= 15: score += 10
        elif flag_days <= 25: score += 5
        if pullback <= 0.10: score += 10
        elif pullback <= 0.15: score += 5
        if vol_trend < -0.02: score += 10
        elif vol_trend < 0: score += 5
        if vol_ratio >= 1.5: score += 5
        elif vol_ratio < 0.7: score -= 5
        if has_up_gap(highs[i - 1], lows[i]): score -= 5  # gap hurts HTF

        hits.append(PatternHit(
            symbol=symbol, pattern="HTF", direction="long",
            breakout_date=dates[i], breakout_price=float(closes[i]),
            target_price=float(target), stop_price=float(stop),
            quality_score=clamp_score(score),
            pattern_start=dates[pole_start_idx], pattern_end=dates[i],
            bull_avg_move_pct=69.0, bull_failure_pct=0.0, bull_rank=1,
            bear_avg_move_pct=42.0, bear_failure_pct=0.0, bear_rank=1,
            extras={
                "pole_start_price": float(pole_low),
                "pole_end_price": float(flag_high),
                "pole_gain_pct": float(pole_gain * 100),
                "pole_days": int(pole_days),
                "flag_days": int(flag_days),
                "flag_pullback_pct": float(pullback * 100),
                "breakout_vol_ratio": float(vol_ratio),
                "flag_vol_trend": float(vol_trend),
            },
        ))
        last_idx = i

    hits.sort(key=lambda h: h.breakout_date, reverse=True)
    return hits
