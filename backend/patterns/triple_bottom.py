"""
Triple Bottom — Bulkowski Ch. 48.
Rank 7 of 23 bull, rank 8 of 19 bear.
Avg rise 37% bull, 28% bear. Break-even fail 4%.

Three roughly-equal lows, separated by two peaks. Confirmation = close
above the higher of the two intervening peaks.
"""

from __future__ import annotations
import numpy as np
import pandas as pd
from patterns._common import (
    PatternHit, validate_ohlcv, rolling_vol_avg,
    local_minima_indices, local_maxima_indices, clamp_score
)

PIVOT_ORDER = 5
LOW_MATCH_TOL = 0.04
MIN_VALLEY_SEP = 10
MAX_VALLEY_SEP = 100
BREAKOUT_PAD = 0.001


def scan(df: pd.DataFrame, symbol: str = "",
         lookback_days: int = 252, require_breakout: bool = True) -> list[PatternHit]:
    df = validate_ohlcv(df)
    if len(df) < MAX_VALLEY_SEP * 2 + 10:
        return []
    df = df.tail(lookback_days + MAX_VALLEY_SEP * 2).copy()
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

    for a in range(len(min_idx) - 2):
        for b in range(a + 1, len(min_idx) - 1):
            for c in range(b + 1, len(min_idx)):
                v1, v2, v3 = min_idx[a], min_idx[b], min_idx[c]
                if (v2 - v1) < MIN_VALLEY_SEP or (v2 - v1) > MAX_VALLEY_SEP:
                    continue
                if (v3 - v2) < MIN_VALLEY_SEP or (v3 - v2) > MAX_VALLEY_SEP:
                    continue

                p1, p2, p3 = lows[v1], lows[v2], lows[v3]
                avg = (p1 + p2 + p3) / 3
                spread = (max(p1, p2, p3) - min(p1, p2, p3)) / avg
                if spread > LOW_MATCH_TOL:
                    continue

                # Two intervening peaks
                peaks1 = [m for m in max_idx if v1 < m < v2]
                peaks2 = [m for m in max_idx if v2 < m < v3]
                if not peaks1 or not peaks2:
                    continue
                pk1 = max(peaks1, key=lambda k: highs[k])
                pk2 = max(peaks2, key=lambda k: highs[k])
                confirmation = max(highs[pk1], highs[pk2])
                height = confirmation - avg
                if height / avg < 0.08:
                    continue

                # Breakout
                breakout_idx = None
                for j in range(v3 + 1, min(len(df), v3 + 60)):
                    if closes[j] > confirmation * (1 + BREAKOUT_PAD):
                        breakout_idx = j
                        break
                if breakout_idx is None:
                    if require_breakout:
                        continue
                    breakout_idx = len(df) - 1

                if (breakout_idx - last_idx) < MIN_VALLEY_SEP:
                    continue

                target = closes[breakout_idx] + height
                stop = avg * 0.96

                vr = (vols[breakout_idx] / vol_avg[breakout_idx]
                      if vol_avg[breakout_idx] else 1.0)

                score = 55
                if spread < 0.015: score += 10
                elif spread < 0.025: score += 5
                if height / avg > 0.20: score += 10
                elif height / avg > 0.12: score += 5
                if vr > 1.5: score += 10
                elif vr > 1.2: score += 5
                # Bulkowski: volume should diminish on each successive low
                v1_vol = vols[max(0, v1 - 3):v1 + 4].mean()
                v3_vol = vols[max(0, v3 - 3):v3 + 4].mean()
                if v3_vol < v1_vol: score += 5

                hits.append(PatternHit(
                    symbol=symbol, pattern="TripleBottom", direction="long",
                    breakout_date=dates[breakout_idx],
                    breakout_price=float(closes[breakout_idx]),
                    target_price=float(target), stop_price=float(stop),
                    quality_score=clamp_score(score),
                    pattern_start=dates[v1], pattern_end=dates[breakout_idx],
                    bull_avg_move_pct=37.0, bull_failure_pct=4.0, bull_rank=7,
                    bear_avg_move_pct=28.0, bear_failure_pct=8.0, bear_rank=8,
                    extras={
                        "valley1_price": float(p1),
                        "valley2_price": float(p2),
                        "valley3_price": float(p3),
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
