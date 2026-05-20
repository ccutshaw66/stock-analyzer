"""
Rounding Bottom (Saucer) — Bulkowski Ch. 39.
Rank 5 of 23 bull, rank 6 of 19 bear.
Avg rise 43% bull, 25% bear. Break-even fail 5%.

A long, curved, U-shaped bottom — usually 3+ months. Detection: fit a
quadratic to the lows over a window; require the parabola to open upward,
the vertex to lie inside the window, and the curve fit to be reasonably
clean. Breakout = close above the "rim" (the higher of left/right edge).
"""

from __future__ import annotations
import numpy as np
import pandas as pd
from patterns._common import (
    PatternHit, validate_ohlcv, rolling_vol_avg, clamp_score
)

MIN_BOWL_DAYS = 60          # 3 months minimum
MAX_BOWL_DAYS = 250         # 1 year maximum
MIN_R2        = 0.55        # parabola must fit at least this well
MIN_HEIGHT    = 0.10        # rim 10%+ above bowl
BREAKOUT_PAD  = 0.001


def scan(df: pd.DataFrame, symbol: str = "",
         lookback_days: int = 504, require_breakout: bool = True) -> list[PatternHit]:
    df = validate_ohlcv(df)
    if len(df) < MAX_BOWL_DAYS + 5:
        return []
    df = df.tail(lookback_days + MAX_BOWL_DAYS).copy()
    df["vol_avg30"] = rolling_vol_avg(df)

    highs = df["High"].to_numpy()
    lows  = df["Low"].to_numpy()
    closes = df["Close"].to_numpy()
    vols  = df["Volume"].to_numpy()
    vol_avg = df["vol_avg30"].to_numpy()
    dates = df.index

    hits: list[PatternHit] = []
    last_idx = -999

    # Slide window of varying widths; sample widths to keep cost down
    widths = [60, 80, 100, 130, 160, 200, 250]
    for width in widths:
        if width >= len(df):
            continue
        for end in range(width, len(df), 5):  # step 5 to save work
            start = end - width
            window_lows = lows[start:end + 1]
            x = np.arange(width + 1, dtype=float)

            # Fit quadratic
            try:
                coeffs = np.polyfit(x, window_lows, 2)
            except np.linalg.LinAlgError:
                continue
            a, b, c = coeffs
            if a <= 0:  # not a bowl
                continue

            # Vertex must lie inside the window
            vx = -b / (2 * a)
            if vx < width * 0.20 or vx > width * 0.80:
                continue

            # Quality of fit
            fitted = a * x * x + b * x + c
            ss_res = float(((window_lows - fitted) ** 2).sum())
            ss_tot = float(((window_lows - window_lows.mean()) ** 2).sum())
            if ss_tot == 0:
                continue
            r2 = 1 - ss_res / ss_tot
            if r2 < MIN_R2:
                continue

            # Rim and bowl
            bowl_low = float(window_lows.min())
            left_rim = float(highs[start:start + width // 4].max())
            right_rim_search_end = end + 1
            right_rim = float(highs[start + 3 * width // 4:right_rim_search_end].max())
            rim = min(left_rim, right_rim)  # breakout is over the LOWER of the two rims
            height = rim - bowl_low
            if bowl_low <= 0 or height / bowl_low < MIN_HEIGHT:
                continue

            # Breakout: scan forward up to 30 bars
            breakout_idx = None
            for j in range(end, min(len(df), end + 30)):
                if closes[j] > rim * (1 + BREAKOUT_PAD):
                    breakout_idx = j
                    break
            if breakout_idx is None:
                if require_breakout:
                    continue
                breakout_idx = end

            if (breakout_idx - last_idx) < width // 4:
                continue

            target = closes[breakout_idx] + height
            stop = bowl_low * 0.97

            vr = (vols[breakout_idx] / vol_avg[breakout_idx]
                  if vol_avg[breakout_idx] else 1.0)

            # Bulkowski: volume in rounding bottom should also form a U shape
            vol_first_third = vols[start:start + width // 3].mean()
            vol_middle = vols[start + width // 3:start + 2 * width // 3].mean()
            vol_last_third = vols[start + 2 * width // 3:end].mean()
            u_volume = vol_middle < vol_first_third and vol_middle < vol_last_third

            score = 50
            score += int((r2 - MIN_R2) * 100)  # +0 to +45 by fit quality
            if u_volume: score += 10
            if vr > 1.5: score += 10
            elif vr > 1.2: score += 5
            if height / bowl_low > 0.25: score += 5

            hits.append(PatternHit(
                symbol=symbol, pattern="RoundingBottom", direction="long",
                breakout_date=dates[breakout_idx],
                breakout_price=float(closes[breakout_idx]),
                target_price=float(target), stop_price=float(stop),
                quality_score=clamp_score(score),
                pattern_start=dates[start], pattern_end=dates[breakout_idx],
                bull_avg_move_pct=43.0, bull_failure_pct=5.0, bull_rank=5,
                bear_avg_move_pct=25.0, bear_failure_pct=10.0, bear_rank=6,
                extras={
                    "bowl_low": float(bowl_low),
                    "rim_price": float(rim),
                    "bowl_days": int(width),
                    "fit_r2": float(r2),
                    "u_volume": bool(u_volume),
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
