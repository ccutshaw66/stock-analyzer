"""
Head & Shoulders Bottom (inverse H&S) — Bulkowski Ch. 26.
Rank 7 of 23 bull, rank 6 of 19 bear.
Avg rise 38% bull, 38% bear. Break-even fail 3%.

Three troughs: LS (left shoulder), Head (deepest), RS (right shoulder).
Head must be lower than both shoulders. Shoulders roughly symmetric in
time and depth. Breakout = close above neckline.
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
SHOULDER_SYM_TOL = 0.20    # shoulders within 20% depth of each other
SHOULDER_TIME_TOL = 0.40   # ls-to-head and head-to-rs widths within 40%
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
    vols   = df["Volume"].to_numpy()
    vol_avg = df["vol_avg30"].to_numpy()
    dates = df.index

    min_idx = local_minima_indices(lows, order=PIVOT_ORDER)
    max_idx = local_maxima_indices(highs, order=PIVOT_ORDER)

    hits: list[PatternHit] = []
    last_idx = -999

    # Iterate over candidate (LS, Head, RS) triples
    for a in range(len(min_idx) - 2):
        for b in range(a + 1, len(min_idx) - 1):
            for c in range(b + 1, len(min_idx)):
                ls, head, rs = min_idx[a], min_idx[b], min_idx[c]
                width = rs - ls
                if width < MIN_PATTERN_DAYS or width > MAX_PATTERN_DAYS:
                    continue

                ls_p, head_p, rs_p = lows[ls], lows[head], lows[rs]

                # Head must be the lowest
                if head_p >= ls_p or head_p >= rs_p:
                    continue

                # Shoulder symmetry: depth
                depth_ls = (ls_p - head_p) / head_p if head_p > 0 else 0
                depth_rs = (rs_p - head_p) / head_p if head_p > 0 else 0
                if depth_ls < 0.02 or depth_rs < 0.02:
                    continue
                shallower = min(depth_ls, depth_rs)
                if shallower == 0:
                    continue
                if abs(depth_ls - depth_rs) / shallower > SHOULDER_SYM_TOL * 2:
                    continue

                # Time symmetry
                w_lh = head - ls
                w_hr = rs - head
                if w_lh < 5 or w_hr < 5:
                    continue
                tighter = min(w_lh, w_hr)
                if abs(w_lh - w_hr) / tighter > SHOULDER_TIME_TOL * 2:
                    continue

                # Neckline: two highest highs between LS-Head and Head-RS
                hi1_candidates = [m for m in max_idx if ls < m < head]
                hi2_candidates = [m for m in max_idx if head < m < rs]
                if not hi1_candidates or not hi2_candidates:
                    continue
                n1 = max(hi1_candidates, key=lambda k: highs[k])
                n2 = max(hi2_candidates, key=lambda k: highs[k])
                p1, p2 = highs[n1], highs[n2]

                # Neckline can slope. Project linearly to find breakout level
                slope = (p2 - p1) / (n2 - n1) if n2 != n1 else 0

                # Find first close above projected neckline after rs
                breakout_idx = None
                for j in range(rs + 1, min(len(df), rs + 60)):
                    neckline_at_j = p1 + slope * (j - n1)
                    if closes[j] > neckline_at_j * (1 + BREAKOUT_PAD):
                        breakout_idx = j
                        break
                if breakout_idx is None:
                    if require_breakout:
                        continue
                    breakout_idx = len(df) - 1

                if (breakout_idx - last_idx) < MIN_PATTERN_DAYS // 2:
                    continue

                neckline_at_b = p1 + slope * (breakout_idx - n1)
                height = neckline_at_b - head_p
                target = closes[breakout_idx] + height
                stop = head_p * 0.98

                vr = (vols[breakout_idx] / vol_avg[breakout_idx]
                      if vol_avg[breakout_idx] else 1.0)

                # Score
                score = 55
                # Tight symmetry
                if abs(depth_ls - depth_rs) / shallower < 0.20: score += 5
                if abs(w_lh - w_hr) / tighter < 0.20: score += 5
                # Breakout volume confirmation
                if vr > 1.5: score += 10
                elif vr > 1.2: score += 5
                # Larger pattern = more reliable
                if height / head_p > 0.20: score += 10
                elif height / head_p > 0.10: score += 5
                # Volume in right shoulder should be lower than left shoulder
                ls_vol = vols[max(0, ls - 3):ls + 4].mean()
                rs_vol = vols[max(0, rs - 3):rs + 4].mean()
                if rs_vol < ls_vol: score += 5

                hits.append(PatternHit(
                    symbol=symbol, pattern="HSBottom", direction="long",
                    breakout_date=dates[breakout_idx],
                    breakout_price=float(closes[breakout_idx]),
                    target_price=float(target), stop_price=float(stop),
                    quality_score=clamp_score(score),
                    pattern_start=dates[ls], pattern_end=dates[breakout_idx],
                    bull_avg_move_pct=38.0, bull_failure_pct=3.0, bull_rank=7,
                    bear_avg_move_pct=38.0, bear_failure_pct=8.0, bear_rank=6,
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
    # Deduplicate near-identical hits (same rs, same breakout)
    return _dedupe(hits)


def _dedupe(hits: list[PatternHit]) -> list[PatternHit]:
    seen = set()
    out = []
    for h in hits:
        key = (h.breakout_date, round(h.breakout_price, 2))
        if key in seen:
            continue
        seen.add(key)
        out.append(h)
    return out
