"""
HTF parity test — Python scan_htf() must produce identical hits to the
TypeScript scanHtf() against the same synthetic bars.

Baseline source: scripts/kairos-baseline.ts (`npm run kairos:baseline`).
Tolerance: 1e-6 on all numeric fields (covers rounding/format jitter).
If the baseline JSON is missing, this test is skipped with a clear
message — running the generator is a prerequisite.
"""
import json
import math
from pathlib import Path
import pytest

from kairos_trading.strategies.htf import scan_htf

BASELINE = Path(__file__).parent / "baseline" / "htf_baseline.json"


def _close(a, b, tol=1e-6):
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    if isinstance(a, bool) or isinstance(b, bool):
        return a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if math.isnan(a) and math.isnan(b):
            return True
        return abs(float(a) - float(b)) <= tol * max(1.0, abs(float(a)), abs(float(b)))
    return a == b


@pytest.mark.skipif(not BASELINE.exists(), reason=f"baseline missing — run `npm run kairos:baseline` to generate {BASELINE}")
def test_htf_matches_typescript_baseline():
    payload = json.loads(BASELINE.read_text())
    bars = payload["bars"]
    expected = payload["hits"]

    actual = scan_htf(bars, symbol=payload["symbol"])

    assert len(actual) == len(expected), f"hit count differs (py={len(actual)}, ts={len(expected)})"

    for a, e in zip(actual, expected):
        assert a["symbol"] == e["symbol"]
        assert a["pattern"] == e["pattern"]
        assert a["direction"] == e["direction"]
        assert a["qualityScore"] == e["qualityScore"]
        # Date fields: TS emits ISO datetime, Python may emit yyyy-mm-dd — compare prefix
        assert str(a["breakoutDate"])[:10] == str(e["breakoutDate"])[:10]
        assert str(a["patternStart"])[:10] == str(e["patternStart"])[:10]
        assert str(a["patternEnd"])[:10] == str(e["patternEnd"])[:10]
        for field in ("breakoutPrice", "targetPrice", "stopPrice"):
            assert _close(a[field], e[field], 1e-6), f"{field} mismatch: py={a[field]} ts={e[field]}"
        ae, ee = a["extras"], e["extras"]
        for field in ("poleStartPrice", "poleEndPrice", "poleGainPct", "flagHigh", "flagLow",
                       "flagPullbackPct", "breakoutVolRatio"):
            assert _close(ae[field], ee[field], 1e-6), f"extras.{field} mismatch: py={ae[field]} ts={ee[field]}"
        for field in ("poleDays", "flagDays"):
            assert ae[field] == ee[field], f"extras.{field} mismatch: py={ae[field]} ts={ee[field]}"
        assert ae["hasOverheadResistance"] == ee["hasOverheadResistance"]
        assert _close(ae["nearestResistancePct"], ee["nearestResistancePct"], 1e-4)
