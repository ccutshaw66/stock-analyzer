"""Smoke test — make sure every detector imports and runs without error."""
import sys
sys.path.insert(0, "/home/claude")

import numpy as np
import pandas as pd
from patterns import scan_all, DETECTORS


def make_random_walk(n=400, seed=0, start=50.0):
    rng = np.random.default_rng(seed)
    rets = rng.normal(0, 0.015, n)
    price = start * np.exp(np.cumsum(rets))
    dates = pd.date_range("2023-01-01", periods=n, freq="B")
    return pd.DataFrame({
        "Open":  price,
        "High":  price * (1 + np.abs(rng.normal(0, 0.005, n))),
        "Low":   price * (1 - np.abs(rng.normal(0, 0.005, n))),
        "Close": price,
        "Volume": rng.integers(800_000, 1_500_000, n),
    }, index=dates)


def make_htf_pattern():
    """Textbook HTF series."""
    rng = np.random.default_rng(1)
    dates = pd.date_range("2023-01-01", periods=200, freq="B")
    price = np.ones(200) * 10.0
    price[0:30] = 10 + rng.normal(0, 0.1, 30)
    price[30:65] = np.linspace(10, 22, 35) + rng.normal(0, 0.2, 35)
    price[65:85] = np.linspace(22, 19, 20) + rng.normal(0, 0.15, 20)
    price[85:115] = np.linspace(22.5, 30, 30) + rng.normal(0, 0.2, 30)
    price[115:] = 30 + rng.normal(0, 0.3, 85)

    vol = np.full(200, 1_000_000.0)
    vol[30:65] = 2_500_000
    vol[65:85] = np.linspace(2_000_000, 800_000, 20)
    vol[85] = 3_500_000
    vol[86:] = 1_500_000

    return pd.DataFrame({
        "Open":  np.concatenate([[price[0]], price[:-1]]),
        "High":  price * 1.01,
        "Low":   price * 0.99,
        "Close": price,
        "Volume": vol,
    }, index=dates)


def make_hs_top():
    """Textbook H&S top."""
    rng = np.random.default_rng(2)
    dates = pd.date_range("2023-01-01", periods=200, freq="B")
    price = np.zeros(200)
    # Run up
    price[0:30] = np.linspace(50, 70, 30) + rng.normal(0, 0.4, 30)
    # Left shoulder
    price[30:50] = np.concatenate([np.linspace(70, 78, 10), np.linspace(78, 72, 10)])
    # Head
    price[50:80] = np.concatenate([np.linspace(72, 85, 15), np.linspace(85, 72, 15)])
    # Right shoulder
    price[80:100] = np.concatenate([np.linspace(72, 78, 10), np.linspace(78, 70, 10)])
    # Breakdown below neckline (~72)
    price[100:130] = np.linspace(70, 55, 30) + rng.normal(0, 0.5, 30)
    price[130:] = 55 + rng.normal(0, 0.5, 70)
    price = price + rng.normal(0, 0.3, 200)

    return pd.DataFrame({
        "Open":  price,
        "High":  price + 0.7,
        "Low":   price - 0.7,
        "Close": price,
        "Volume": rng.integers(1_000_000, 2_000_000, 200),
    }, index=dates)


print("=" * 60)
print("SMOKE TEST: import & run every detector on noise")
print("=" * 60)
df_noise = make_random_walk(seed=42)
for name in DETECTORS:
    try:
        mod = DETECTORS[name]
        hits = mod.scan(df_noise, symbol="NOISE")
        print(f"  {name:<18} OK  ({len(hits)} hits on noise)")
    except Exception as e:
        print(f"  {name:<18} FAIL  {e!r}")

print("\n" + "=" * 60)
print("FUNCTIONAL TEST: textbook HTF should trigger HTF detector")
print("=" * 60)
df_htf = make_htf_pattern()
hits = scan_all(df_htf, symbol="TESTHTF")
htf_hits = [h for h in hits if h.pattern == "HTF"]
print(f"  Total hits: {len(hits)}")
print(f"  HTF hits:   {len(htf_hits)}")
for h in htf_hits[:3]:
    print(f"    {h.breakout_date.date()} score={h.quality_score} "
          f"target=${h.target_price:.2f}")

print("\n" + "=" * 60)
print("FUNCTIONAL TEST: textbook H&S Top should trigger HSTop detector")
print("=" * 60)
df_hst = make_hs_top()
hits = scan_all(df_hst, symbol="TESTHST")
hst_hits = [h for h in hits if h.pattern == "HSTop"]
print(f"  Total hits: {len(hits)}")
print(f"  HSTop hits: {len(hst_hits)}")
for h in hst_hits[:3]:
    print(f"    {h.breakout_date.date()} score={h.quality_score} "
          f"target=${h.target_price:.2f}")

print("\n" + "=" * 60)
print("SUMMARY (all hits on H&S top sample, top 10):")
print("=" * 60)
for h in hits[:10]:
    print(f"  {h.breakout_date.date()} {h.pattern:<16} "
          f"{h.direction:<6} score={h.quality_score:>3}  "
          f"@ ${h.breakout_price:.2f} -> ${h.target_price:.2f}")
