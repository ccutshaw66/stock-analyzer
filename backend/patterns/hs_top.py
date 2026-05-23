"""
Head & Shoulders Top — Bulkowski Ch. 27.
Rank 1 of 21 bull (down breakouts), rank 6 of 19 bear.
Avg decline 22% bull, 22% bear. Break-even fail 4%.

Mirror of H&S Bottom: three peaks (LS, Head, RS) with Head highest.
Breakout = close below neckline. SHORT or EXIT signal.
"""

from __future__ import annotations
import numpy as np
import pandas as pd
from patterns._common import (
    PatternHit, validate_ohlcv, rolling_vol_avg,
    local_minima_indices, local_maxima_indices, clamp_score
)

PIVOT_ORDER = 5
MIN_PATTERN_DAYS = 20
MAX_PATTERN_DAYS = 150
SHOULDER_SYM_TOL = 0.20
SHOULDER_TIME_TOL = 0.40
BREAKOUT_PAD = 0.001


def scan(df: pd.DataFrame, symbol: str = "",
         lookback_days: int = 252, require_breakout: bool = True) -> list[PatternHit]:
    df = validate_ohlcv(df)
    if len(df) < MAX_PATTERN_DAYS + 5:
        return []
    df = df.tail(lookback_days + MAX_PATTERN_DAYS).copy()
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

    for a in range(len(max_idx) - 2):
        for b in range(a + 1, len(max_idx) - 1):
            for c in range(b + 1, len(max_idx)):
                ls, head, rs = max_idx[a], max_idx[b], max_idx[c]
                width = rs - ls
                if width < MIN_PATTERN_DAYS or width > MAX_PATTERN_DAYS:
                    continue

                ls_p, head_p, rs_p = highs[ls], highs[head], highs[rs]

                if head_p <= ls_p or head_p <= rs_p:
                    continue

                # Symmetry of shoulder height (distance below head)
                drop_ls = (head_p - ls_p) / head_p
                drop_rs = (head_p - rs_p) / head_p
                if drop_ls < 0.02 or drop_rs < 0.02:
                    continue
                tighter = min(drop_ls, drop_rs)
                if abs(drop_ls - drop_rs) / tighter > SHOULDER_SYM_TOL * 2:
                    continue

                w_lh = head - ls
                w_hr = rs - head
                if w_lh < 5 or w_hr < 5:
                    continue
                tw = min(w_lh, w_hr)
                if abs(w_lh - w_hr) / tw > SHOULDER_TIME_TOL * 2:
                    continue

                # Neckline: lowest lows between LS-Head and Head-RS
                lo1 = [m for m in min_idx if ls < m < head]
                lo2 = [m for m in min_idx if head < m < rs]
                if not lo1 or not lo2:
                    continue
                n1 = min(lo1, key=lambda k: lows[k])
                n2 = min(lo2, key=lambda k: lows[k])
                p1, p2 = lows[n1], lows[n2]
                slope = (p2 - p1) / (n2 - n1) if n2 != n1 else 0

                breakout_idx = None
                for j in range(rs + 1, min(len(df), rs + 60)):
                    neckline_at_j = p1 + slope * (j - n1)
                    if closes[j] < neckline_at_j * (1 - BREAKOUT_PAD):
                        breakout_idx = j
                        break
                if breakout_idx is None:
                    if require_breakout:
                        continue
                    breakout_idx = len(df) - 1

                if (breakout_idx - last_idx) < MIN_PATTERN_DAYS // 2:
                    continue

                neckline_at_b = p1 + slope * (breakout_idx - n1)
                height = head_p - neckline_at_b
                target = closes[breakout_idx] - height
                stop = head_p * 1.02

                vr = (vols[breakout_idx] / vol_avg[breakout_idx]
                      if vol_avg[breakout_idx] else 1.0)

                score = 55
                if abs(drop_ls - drop_rs) / tighter < 0.20: score += 5
                if abs(w_lh - w_hr) / tw < 0.20: score += 5
                if vr > 1.5: score += 10
                elif vr > 1.2: score += 5
                if height / head_p > 0.20: score += 10
                elif height / head_p > 0.10: score += 5
                # Bulkowski: volume on RS should be lower than LS in H&S top
                ls_vol = vols[max(0, ls - 3):ls + 4].mean()
                rs_vol = vols[max(0, rs - 3):rs + 4].mean()
                if rs_vol < ls_vol: score += 5

                hits.append(PatternHit(
                    symbol=symbol, pattern="HSTop", direction="short",
                    breakout_date=dates[breakout_idx],
                    breakout_price=float(closes[breakout_idx]),
                    target_price=float(target), stop_price=float(stop),
                    quality_score=clamp_score(score),
                    pattern_start=dates[ls], pattern_end=dates[breakout_idx],
                    bull_avg_move_pct=-22.0, bull_failure_pct=4.0, bull_rank=1,
                    bear_avg_move_pct=-22.0, bear_failure_pct=8.0, bear_rank=6,
                    extras={
                        "ls_date": str(dates[ls].date()), "ls_price": float(ls_p),
                        "head_date": str(dates[head].date()), "head_price": float(head_p),
                        "rs_date": str(dates[rs].date()), "rs_price": float(rs_p),
                        "neckline_start": float(p1), "neckline_end": float(p2),
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
