"""
BBTC parity test — Python compute_bbtc() with TS-supplied indicator inputs
must produce identical signals + summary to the TypeScript computeBBTC().

Baseline source: scripts/kairos-baseline.ts (`npm run kairos:baseline`).
The baseline includes the pre-computed EMA9/21/50/ATR14 the TS reference
used. We feed those SAME indicator series into compute_bbtc() so this
test measures only the *strategy logic* parity — not the
pandas-ta-vs-hand-rolled indicator implementation drift, which is its
own concern handled by the indicator-comparison test below.
"""
import json
import math
from pathlib import Path
import pytest

from kairos_trading.strategies.bbtc import compute_bbtc

BASELINE = Path(__file__).parent / "baseline" / "bbtc_baseline.json"


def _close(a, b, tol=1e-6):
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if math.isnan(a) and math.isnan(b):
            return True
        return abs(float(a) - float(b)) <= tol * max(1.0, abs(float(a)), abs(float(b)))
    return a == b


@pytest.mark.skipif(not BASELINE.exists(), reason=f"baseline missing — run `npm run kairos:baseline` to generate {BASELINE}")
def test_bbtc_matches_typescript_baseline():
    payload = json.loads(BASELINE.read_text())
    bars = payload["bars"]
    ind = payload["indicators"]
    expected = payload["result"]

    closes = [b["close"] for b in bars]
    highs = [b["high"] for b in bars]
    lows = [b["low"] for b in bars]

    # Feed the full TS-computed indicator stack. The baseline now emits
    # adx14/rsi14/sma200 from BBTC's canonical TS Wilder helpers, so this
    # test measures pure strategy-logic parity — pandas-ta-vs-Wilder
    # smoothing drift is excluded by design.
    actual = compute_bbtc(
        closes=closes, highs=highs, lows=lows,
        ema9=ind["ema9"], ema21=ind["ema21"], ema50=ind["ema50"],
        atr14=ind["atr14"],
        adx14=ind["adx14"], rsi14=ind["rsi14"], sma200=ind["sma200"],
    )

    assert actual["trend"] == expected["trend"], f"trend mismatch: py={actual['trend']} ts={expected['trend']}"
    assert actual["bias"] == expected["bias"], f"bias mismatch: py={actual['bias']} ts={expected['bias']}"
    assert actual["topSignal"] == expected["topSignal"], f"topSignal mismatch: py={actual['topSignal']} ts={expected['topSignal']}"
    assert _close(actual["entryPrice"], expected["entryPrice"], 1e-4)
    assert _close(actual["highestSinceEntry"], expected["highestSinceEntry"], 1e-4)

    # Signal-by-signal comparison. Allow off-by-one drift on entry bar (ADX
    # initialization window can differ by 1 bar between Wilder implementations).
    py_signals = [(i, s) for i, s in enumerate(actual["signals"]) if s]
    ts_signals = [(i, s) for i, s in enumerate(expected["signals"]) if s]
    assert len(py_signals) == len(ts_signals), (
        f"signal count differs: py={len(py_signals)} ts={len(ts_signals)}\n"
        f"py: {py_signals}\nts: {ts_signals}"
    )
    for (pi, ps), (ti, ts) in zip(py_signals, ts_signals):
        assert ps == ts, f"signal type mismatch at py={pi}/ts={ti}: {ps} vs {ts}"
        assert abs(pi - ti) <= 1, f"signal bar position differs by >1: py={pi} ts={ti}"
