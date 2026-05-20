"""
HTF detector — Givens variant.

Looser than strict Bulkowski:
- Pole: 30%+ rise in ≤60 days (vs Bulkowski's 90% in 42 days)
- Consolidation: 5-30 days, ≤25% pullback
- Breakout: close above consolidation high on volume ≥1.3x 30-day avg

Same dataclass / interface as the Bulkowski htf module.
"""

from __future__ import annotations
import numpy as np
import pandas as pd
from patterns._common import (
    PatternHit, validate_ohlcv, rolling_vol_avg, clamp_score
)

# Givens-style (loosened from O'Neil/Bulkowski)
POLE_MIN_GAIN     = 0.30    # +30% qualifies (Givens: any sharp run to 30-60d highs)
POLE_MAX_DAYS     = 60      # 3 months
POLE_MIN_DAYS     = 5
FLAG_MIN_DAYS     = 3       # tight flags OK
FLAG_MAX_DAYS     = 30
FLAG_MAX_PULLBACK = 0.25
BREAKOUT_PAD      = 0.001
MIN_BREAKOUT_VOL_RATIO = 1.3  # Givens: "strong volume"


def scan(df: pd.DataFrame, symbol: str = "",
         lookback_days: int = 252,
         require_breakout: bool = True) -> list[PatternHit]:
    df = validate_ohlcv(df)
    needed = POLE_MAX_DAYS + FLAG_MAX_DAYS + 5
    if len(df) < needed:
        return []

    df = df.tail(lookback_days + POLE_MAX_DAYS + FLAG_MAX_DAYS).copy()
    df["vol_avg30"] = rolling_vol_avg(df)

    highs   = df["High"].to_numpy()
    lows    = df["Low"].to_numpy()
    closes  = df["Close"].to_numpy()
    vols    = df["Volume"].to_numpy()
    vol_avg = df["vol_avg30"].to_numpy()
    dates   = df.index

    hits: list[PatternHit] = []
    last_idx = -999

    for i in range(POLE_MAX_DAYS + FLAG_MAX_DAYS, len(df)):
        # Find the consolidation: a window ending at i-1 (or earlier) where
        # range <= 25% and the window ends right before today's breakout.
        # We try multiple consolidation lengths and take the best (longest) valid one.
        best_flag_high = None
        best_flag_low = None
        best_flag_days = 0
        best_flag_start = None

        for flag_days in range(FLAG_MIN_DAYS, FLAG_MAX_DAYS + 1):
            flag_start = i - flag_days
            if flag_start < POLE_MIN_DAYS:
                continue
            flag_highs = highs[flag_start:i]   # exclude today (breakout day)
            flag_lows = lows[flag_start:i]
            if len(flag_highs) < 1:
                continue
            fh = float(flag_highs.max())
            fl = float(flag_lows.min())
            if fh <= 0 or fl <= 0:
                continue
            pullback = (fh - fl) / fh
            if pullback > FLAG_MAX_PULLBACK:
                continue
            # Prefer the longest valid flag we can find
            if flag_days > best_flag_days:
                best_flag_days = flag_days
                best_flag_high = fh
                best_flag_low = fl
                best_flag_start = flag_start

        if best_flag_high is None:
            continue

        # Pole = the run leading into the flag
        flag_high_idx = best_flag_start  # approximation
        pole_search_start = max(0, flag_high_idx - POLE_MAX_DAYS)
        pole_slice = lows[pole_search_start:flag_high_idx + 1]
        if len(pole_slice) < POLE_MIN_DAYS:
            continue
        pole_low_idx = pole_search_start + int(np.argmin(pole_slice))
        pole_low = float(lows[pole_low_idx])
        pole_days = flag_high_idx - pole_low_idx
        if pole_days < POLE_MIN_DAYS or pole_days > POLE_MAX_DAYS:
            continue
        pole_gain = (best_flag_high - pole_low) / pole_low if pole_low > 0 else 0
        if pole_gain < POLE_MIN_GAIN:
            continue

        # Breakout: close above flag high
        is_breakout = closes[i] > best_flag_high * (1 + BREAKOUT_PAD)
        if not is_breakout and require_breakout:
            continue

        # Volume confirmation
        vol_ratio = (vols[i] / vol_avg[i]) if vol_avg[i] else 0
        if is_breakout and vol_ratio < MIN_BREAKOUT_VOL_RATIO and require_breakout:
            continue

        # Anti-overlap
        if (i - last_idx) < FLAG_MIN_DAYS:
            continue

        # Measure rule: target = breakout + half the pole
        target = closes[i] + 0.5 * (best_flag_high - pole_low)
        stop = best_flag_low * 0.98  # below consolidation low

        # Score
        score = 50
        if pole_gain >= 1.0: score += 15
        elif pole_gain >= 0.6: score += 10
        elif pole_gain >= 0.3: score += 5
        if best_flag_days >= 10: score += 10
        elif best_flag_days >= 5: score += 5
        pullback_pct = (best_flag_high - best_flag_low) / best_flag_high
        if pullback_pct <= 0.10: score += 10
        elif pullback_pct <= 0.15: score += 5
        if vol_ratio >= 2.0: score += 15
        elif vol_ratio >= 1.5: score += 10
        elif vol_ratio >= 1.3: score += 5

        hits.append(PatternHit(
            symbol=symbol, pattern="HTF_Givens", direction="long",
            breakout_date=dates[i], breakout_price=float(closes[i]),
            target_price=float(target), stop_price=float(stop),
            quality_score=clamp_score(score),
            pattern_start=dates[pole_low_idx], pattern_end=dates[i],
            bull_avg_move_pct=0.0, bull_failure_pct=0.0, bull_rank=0,
            extras={
                "pole_start_price": float(pole_low),
                "pole_end_price": float(best_flag_high),
                "pole_gain_pct": float(pole_gain * 100),
                "pole_days": int(pole_days),
                "flag_days": int(best_flag_days),
                "flag_high": float(best_flag_high),
                "flag_low": float(best_flag_low),
                "flag_pullback_pct": float(pullback_pct * 100),
                "breakout_vol_ratio": float(vol_ratio),
            },
        ))
        last_idx = i

    hits.sort(key=lambda h: h.breakout_date, reverse=True)
    return hits
