"""
Ascending Triangle — Bulkowski Ch. 49.
Rank 5 of 23 bull (up bk), rank 7 of 19 bear.
Avg rise 35% bull, 30% bear. Break-even fail 13%.

Two trendlines: flat horizontal resistance touched 2+ times, rising
support touched 2+ times. Breakout = close above resistance.
"""

from __future__ import annotations
import numpy as np
import pandas as pd
from patterns._common import (
    PatternHit, validate_ohlcv, rolling_vol_avg,
    local_minima_indices, local_maxima_indices, clamp_score
)

PIVOT_ORDER = 4
MIN_TRIANGLE_DAYS = 20
MAX_TRIANGLE_DAYS = 130
RESISTANCE_TOL = 0.02       # peaks within 2% of each other = horizontal
MIN_PEAK_TOUCHES = 2
MIN_TROUGH_TOUCHES = 2
BREAKOUT_PAD = 0.001


def scan(df: pd.DataFrame, symbol: str = "",
         lookback_days: int = 252, require_breakout: bool = True) -> list[PatternHit]:
    df = validate_ohlcv(df)
    if len(df) < MAX_TRIANGLE_DAYS + 5:
        return []
    df = df.tail(lookback_days + MAX_TRIANGLE_DAYS).copy()
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

    # Walk forward: at each bar i, look back for ascending-triangle setup
    for i in range(MIN_TRIANGLE_DAYS, len(df)):
        end = i
        for start in range(max(0, end - MAX_TRIANGLE_DAYS), end - MIN_TRIANGLE_DAYS):
            peaks_in = [m for m in max_idx if start <= m < end]
            troughs_in = [m for m in min_idx if start <= m < end]
            if len(peaks_in) < MIN_PEAK_TOUCHES or len(troughs_in) < MIN_TROUGH_TOUCHES:
                continue

            peak_prices = np.array([highs[k] for k in peaks_in])
            avg_peak = float(peak_prices.mean())
            if avg_peak == 0:
                continue
            # All peaks within tolerance of average?
            if (peak_prices.max() - peak_prices.min()) / avg_peak > RESISTANCE_TOL:
                continue
            resistance = avg_peak

            # Troughs must be ascending
            trough_x = np.array(troughs_in, dtype=float)
            trough_y = np.array([lows[k] for k in troughs_in], dtype=float)
            if len(trough_y) < 2:
                continue
            slope = float(np.polyfit(trough_x, trough_y, 1)[0])
            if slope <= 0:
                continue
            # The last trough must be meaningfully above the first
            if (trough_y[-1] - trough_y[0]) / trough_y[0] < 0.02:
                continue

            # Breakout check at bar i
            if closes[i] <= resistance * (1 + BREAKOUT_PAD):
                if require_breakout:
                    continue

            if (i - last_idx) < MIN_TRIANGLE_DAYS // 2:
                continue

            # Measure rule: target = breakout + height at start of triangle
            triangle_height = resistance - float(trough_y[0])
            target = closes[i] + triangle_height
            stop = resistance * 0.97  # back inside the triangle

            vr = (vols[i] / vol_avg[i]) if vol_avg[i] else 1.0

            score = 50
            if len(peaks_in) >= 3: score += 10
            if len(troughs_in) >= 3: score += 10
            if vr > 1.5: score += 10
            elif vr > 1.2: score += 5
            # Volume should diminish through the triangle
            vol_trend = float(np.polyfit(
                np.arange(end - start, dtype=float),
                vols[start:end], 1
            )[0])
            if vol_trend < 0: score += 5
            # Don't breakout too late — Bulkowski: best is breakouts in the
            # middle 2/3 of the pattern (premature breakouts underperform)
            duration = end - start
            position_of_break = (end - start) / duration if duration > 0 else 1.0
            # placeholder — we already require breakout at end

            hits.append(PatternHit(
                symbol=symbol, pattern="AscTriangle", direction="long",
                breakout_date=dates[i], breakout_price=float(closes[i]),
                target_price=float(target), stop_price=float(stop),
                quality_score=clamp_score(score),
                pattern_start=dates[start], pattern_end=dates[i],
                bull_avg_move_pct=35.0, bull_failure_pct=13.0, bull_rank=5,
                bear_avg_move_pct=30.0, bear_failure_pct=11.0, bear_rank=7,
                extras={
                    "resistance": float(resistance),
                    "support_slope": float(slope),
                    "peak_touches": int(len(peaks_in)),
                    "trough_touches": int(len(troughs_in)),
                    "triangle_days": int(end - start),
                    "breakout_vol_ratio": float(vr),
                },
            ))
            last_idx = i
            break  # only one triangle per breakout bar

    hits.sort(key=lambda h: h.breakout_date, reverse=True)
    seen = set(); out = []
    for h in hits:
        k = (h.breakout_date, round(h.breakout_price, 2))
        if k in seen: continue
        seen.add(k); out.append(h)
    return out
