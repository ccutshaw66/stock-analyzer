"""
Double Top, Eve & Eve — Bulkowski Ch. 31.
Rank 2 of 21 bull (down breakouts), rank 9 of 19 bear.
Avg decline 18% bull, 18% bear. Break-even fail 11%.

Mirror of Eve&Eve Double Bottom. Two rounded peaks at similar price
separated by a trough. Confirmation = close below the intervening trough.
"""

from __future__ import annotations
import numpy as np
import pandas as pd
from patterns._common import (
    PatternHit, validate_ohlcv, rolling_vol_avg,
    local_minima_indices, local_maxima_indices, clamp_score
)

PIVOT_ORDER = 5
HIGH_MATCH_TOL = 0.04
MIN_PEAK_SEP = 10
MAX_PEAK_SEP = 130
MIN_EVE_WIDTH = 10
EVE_HIGH_BAND  = 0.03
BREAKOUT_PAD = 0.001


def scan(df: pd.DataFrame, symbol: str = "",
         lookback_days: int = 252, require_breakout: bool = True) -> list[PatternHit]:
    df = validate_ohlcv(df)
    if len(df) < MAX_PEAK_SEP + 5:
        return []
    df = df.tail(lookback_days + MAX_PEAK_SEP).copy()
    df["vol_avg30"] = rolling_vol_avg(df)

    highs = df["High"].to_numpy()
    lows  = df["Low"].to_numpy()
    closes = df["Close"].to_numpy()
    vols  = df["Volume"].to_numpy()
    vol_avg = df["vol_avg30"].to_numpy()
    dates = df.index

    max_idx = local_maxima_indices(highs, order=PIVOT_ORDER)
    min_idx = local_minima_indices(lows, order=PIVOT_ORDER)

    hits: list[PatternHit] = []
    last_idx = -999

    for a in range(len(max_idx) - 1):
        for b in range(a + 1, len(max_idx)):
            p1, p2 = max_idx[a], max_idx[b]
            sep = p2 - p1
            if sep < MIN_PEAK_SEP or sep > MAX_PEAK_SEP:
                continue

            h1, h2 = highs[p1], highs[p2]
            avg = (h1 + h2) / 2
            if abs(h1 - h2) / avg > HIGH_MATCH_TOL:
                continue
            if not _is_eve_top(highs, p1, h1) or not _is_eve_top(highs, p2, h2):
                continue

            troughs = [m for m in min_idx if p1 < m < p2]
            if not troughs:
                continue
            trough_idx = min(troughs, key=lambda k: lows[k])
            confirmation = lows[trough_idx]
            height = avg - confirmation
            if height / avg < 0.10:
                continue

            breakout_idx = None
            for j in range(p2 + 1, min(len(df), p2 + 90)):
                if closes[j] < confirmation * (1 - BREAKOUT_PAD):
                    breakout_idx = j
                    break
            if breakout_idx is None:
                if require_breakout:
                    continue
                breakout_idx = len(df) - 1

            if (breakout_idx - last_idx) < MIN_PEAK_SEP:
                continue

            target = closes[breakout_idx] - height
            stop = avg * 1.03

            vr = (vols[breakout_idx] / vol_avg[breakout_idx]
                  if vol_avg[breakout_idx] else 1.0)

            score = 55
            if abs(h1 - h2) / avg < 0.02: score += 10
            elif abs(h1 - h2) / avg < 0.03: score += 5
            if height / avg >= 0.20: score += 10
            elif height / avg >= 0.15: score += 5
            if vr > 1.5: score += 10
            elif vr > 1.2: score += 5

            hits.append(PatternHit(
                symbol=symbol, pattern="DoubleTopEE", direction="short",
                breakout_date=dates[breakout_idx],
                breakout_price=float(closes[breakout_idx]),
                target_price=float(target), stop_price=float(stop),
                quality_score=clamp_score(score),
                pattern_start=dates[p1], pattern_end=dates[breakout_idx],
                bull_avg_move_pct=-18.0, bull_failure_pct=11.0, bull_rank=2,
                bear_avg_move_pct=-18.0, bear_failure_pct=11.0, bear_rank=9,
                extras={
                    "peak1_date": str(dates[p1].date()), "peak1_price": float(h1),
                    "peak2_date": str(dates[p2].date()), "peak2_price": float(h2),
                    "trough_date": str(dates[trough_idx].date()),
                    "confirmation_price": float(confirmation),
                    "pattern_height": float(height),
                    "breakout_vol_ratio": float(vr),
                },
            ))
            last_idx = breakout_idx

    hits.sort(key=lambda h: h.breakout_date, reverse=True)
    seen = set(); out = []
    for h in hits:
        k = (h.breakout_date, round(h.breakout_price, 2))
        if k in seen: continue
        seen.add(k); out.append(h)
    return out


def _is_eve_top(highs: np.ndarray, idx: int, high: float) -> bool:
    start = max(0, idx - 15)
    end = min(len(highs), idx + 16)
    window = highs[start:end]
    band = high * (1 - EVE_HIGH_BAND)
    return int(np.sum(window >= band)) >= MIN_EVE_WIDTH
