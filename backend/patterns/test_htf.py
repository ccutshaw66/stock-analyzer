"""Quick sanity check for htf_detector."""
import sys
sys.path.insert(0, "/home/claude")

import numpy as np
import pandas as pd
from htf_detector import scan_htf


def make_htf_series(seed=1):
    """Synthesize a clean HTF: ~30 bars of flat, then 100% rise in 35 bars,
    then 20-bar shallow consolidation, then breakout."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2024-01-01", periods=200, freq="B")
    price = np.ones(200) * 10.0

    # Bars 0-29: flat around $10
    price[0:30] = 10 + rng.normal(0, 0.1, 30)

    # Bars 30-64: pole — from $10 to $22 (120% gain in 35 bars)
    pole_path = np.linspace(10, 22, 35) + rng.normal(0, 0.2, 35)
    price[30:65] = pole_path

    # Bars 65-84: flag — drift down to $19, declining volume (handled below)
    flag_path = np.linspace(22, 19, 20) + rng.normal(0, 0.15, 20)
    price[65:85] = flag_path

    # Bar 85+: breakout above flag high
    breakout_path = np.linspace(22.5, 30, 30) + rng.normal(0, 0.2, 30)
    price[85:115] = breakout_path
    price[115:] = 30 + rng.normal(0, 0.3, 85)

    high = price * 1.01
    low  = price * 0.99
    open_ = np.concatenate([[price[0]], price[:-1]])
    close = price

    # Volume: high during pole, declining in flag, high on breakout
    vol = np.full(200, 1_000_000.0)
    vol[30:65] = 2_500_000 + rng.normal(0, 100_000, 35)        # heavy on pole
    vol[65:85] = np.linspace(2_000_000, 800_000, 20)            # declining in flag
    vol[85] = 3_500_000                                          # surge on breakout
    vol[86:] = 1_500_000 + rng.normal(0, 100_000, 114)

    return pd.DataFrame({
        "Open": open_, "High": high, "Low": low, "Close": close, "Volume": vol
    }, index=dates)


def make_noise_series(seed=2):
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2024-01-01", periods=200, freq="B")
    price = 50 + np.cumsum(rng.normal(0, 0.5, 200))
    return pd.DataFrame({
        "Open": price, "High": price + 0.5, "Low": price - 0.5,
        "Close": price, "Volume": rng.integers(800_000, 1_200_000, 200)
    }, index=dates)


print("=== Test 1: textbook HTF ===")
df1 = make_htf_series()
hits1 = scan_htf(df1, symbol="TEST")
for h in hits1:
    print(f"  Pole: ${h.pole_start_price:.2f} -> ${h.pole_end_price:.2f} "
          f"(+{h.pole_gain_pct:.0f}% in {h.pole_days}d)")
    print(f"  Flag: {h.flag_days}d, pullback {h.flag_pullback_pct:.1f}%")
    print(f"  Breakout: {h.breakout_date.date()} @ ${h.breakout_price:.2f}, "
          f"vol {h.breakout_volume_ratio:.1f}x")
    print(f"  Target: ${h.target_price:.2f}")
    print(f"  Score: {h.quality_score}/100")
    print()

print(f"\n=== Test 2: random walk noise ===")
df2 = make_noise_series()
hits2 = scan_htf(df2, symbol="NOISE")
print(f"  Hits: {len(hits2)} (expect 0)")
