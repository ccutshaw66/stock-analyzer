"""
Double Bottom, Eve & Eve — Bulkowski Ch. 19.
Rank 6 of 23 bull, rank 8 of 19 bear. Best of the 4 DB variants.
Avg rise 40% bull, 30% bear. Break-even fail 4%.

Two rounded lows ("Eve" = wide/round, as opposed to "Adam" = narrow/V-spike)
at similar price. The two valleys separated by a peak. Breakout = close
above the confirmation point (the peak between the two lows).

Eve detection: each valley spans >= 10 bars near the low, narrow at the
bottom but not a single-bar spike.
"""

from __future__ import annotations
import numpy as np
import pandas as pd
from patterns._common import (
    PatternHit, validate_ohlcv, rolling_vol_avg,
    local_minima_indices, local_maxima_indices, clamp_score
)

PIVOT_ORDER = 5
LOW_MATCH_TOL = 0.04        # bottoms within 4% of each other
MIN_VALLEY_SEP = 10         # 10 trading days between valleys
MAX_VALLEY_SEP = 130        # ~6 months
MIN_EVE_WIDTH = 10          # Eve valleys are wider; ≥10 bars near the low
EVE_LOW_BAND  = 0.03        # bars within 3% of the low count toward width
BREAKOUT_PAD = 0.001


def scan(df: pd.DataFrame, symbol: str = "",
         lookback_days: int = 252, require_breakout: bool = True) -> list[PatternHit]:
    df = validate_ohlcv(df)
    if len(df) < MAX_VALLEY_SEP + 5:
        return []
    df = df.tail(lookback_days + MAX_VALLEY_SEP).copy()
    df["vol_avg30"] = rolling_vol_avg(df)

    highs = df["High"].to_numpy()
    lows  = df["Low"].to_numpy()
    closes = df["Close"].to_numpy()
    vols  = df["Volume"].to_numpy()
    vol_avg = df["vol_avg30"].to_numpy()
    dates = df.index

    min_idx = local_minima_indices(lows, order=PIVOT_ORDER)
    max_idx = local_maxima_indices(highs, order=PIVOT_ORDER)

    hits: list[PatternHit] = []
    last_idx = -999

    for a in range(len(min_idx) - 1):
        for b in range(a + 1, len(min_idx)):
            v1, v2 = min_idx[a], min_idx[b]
            sep = v2 - v1
            if sep < MIN_VALLEY_SEP or sep > MAX_VALLEY_SEP:
                continue

            p1, p2 = lows[v1], lows[v2]
            # Lows must match within tolerance
            avg_low = (p1 + p2) / 2
            if abs(p1 - p2) / avg_low > LOW_MATCH_TOL:
                continue

            # Both must be Eve-style (wide/rounded)
            if not _is_eve(lows, v1, p1) or not _is_eve(lows, v2, p2):
                continue

            # Find confirmation peak between the two valleys
            peaks_between = [m for m in max_idx if v1 < m < v2]
            if not peaks_between:
                continue
            peak_idx = max(peaks_between, key=lambda k: highs[k])
            peak = highs[peak_idx]

            # Peak must be meaningfully above both valleys
            height = peak - avg_low
            if height / avg_low < 0.10:  # >=10% height
                continue

            # Breakout: close above peak
            breakout_idx = None
            for j in range(v2 + 1, min(len(df), v2 + 90)):
                if closes[j] > peak * (1 + BREAKOUT_PAD):
                    breakout_idx = j
                    break
            if breakout_idx is None:
                if require_breakout:
                    continue
                breakout_idx = len(df) - 1

            if (breakout_idx - last_idx) < MIN_VALLEY_SEP:
                continue

            target = closes[breakout_idx] + height
            stop = avg_low * 0.97

            vr = (vols[breakout_idx] / vol_avg[breakout_idx]
                  if vol_avg[breakout_idx] else 1.0)

            score = 55
            if abs(p1 - p2) / avg_low < 0.02: score += 10
            elif abs(p1 - p2) / avg_low < 0.03: score += 5
            if height / avg_low >= 0.20: score += 10
            elif height / avg_low >= 0.15: score += 5
            if vr > 1.5: score += 10
            elif vr > 1.2: score += 5
            # Bulkowski: bull-market Eve&Eve performs best with prior downtrend
            prior_high = float(highs[max(0, v1 - 30):v1].max(initial=avg_low))
            if (prior_high - avg_low) / avg_low > 0.10: score += 5

            hits.append(PatternHit(
                symbol=symbol, pattern="DoubleBottomEE", direction="long",
                breakout_date=dates[breakout_idx],
                breakout_price=float(closes[breakout_idx]),
                target_price=float(target), stop_price=float(stop),
                quality_score=clamp_score(score),
                pattern_start=dates[v1], pattern_end=dates[breakout_idx],
                bull_avg_move_pct=40.0, bull_failure_pct=4.0, bull_rank=6,
                bear_avg_move_pct=30.0, bear_failure_pct=8.0, bear_rank=8,
                extras={
                    "valley1_date": str(dates[v1].date()), "valley1_price": float(p1),
                    "valley2_date": str(dates[v2].date()), "valley2_price": float(p2),
                    "peak_date": str(dates[peak_idx].date()), "peak_price": float(peak),
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


def _is_eve(lows: np.ndarray, idx: int, low: float) -> bool:
    """Eve = rounded, wide valley. Count bars within EVE_LOW_BAND of the low
    in the +/- 15-bar window. Need MIN_EVE_WIDTH or more."""
    start = max(0, idx - 15)
    end = min(len(lows), idx + 16)
    window = lows[start:end]
    band = low * (1 + EVE_LOW_BAND)
    return int(np.sum(window <= band)) >= MIN_EVE_WIDTH
