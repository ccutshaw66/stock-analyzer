"""
Bulkowski pattern detectors for Stock Otter.

Usage:
    from patterns import scan_all
    hits = scan_all(df, symbol="AAPL")
    for h in hits:
        print(h.pattern, h.direction, h.quality_score, h.target_price)

Or call individual detectors:
    from patterns import htf, hs_bottom
    htf_hits = htf.scan(df, symbol="AAPL")
"""

from patterns._common import PatternHit
from patterns import (
    htf,
    htf_givens,
    pipe_bottom,
    hs_bottom,
    hs_top,
    double_bottom_ee,
    double_top_ee,
    rounding_bottom,
    triple_bottom,
    asc_triangle,
)

# Registry: pattern_id -> module (each must expose scan(df, symbol, ...))
DETECTORS = {
    "HTF":            htf,
    "HTF_Givens":     htf_givens,
    "PipeBottom":     pipe_bottom,
    "HSBottom":       hs_bottom,
    "HSTop":          hs_top,
    "DoubleBottomEE": double_bottom_ee,
    "DoubleTopEE":    double_top_ee,
    "RoundingBottom": rounding_bottom,
    "TripleBottom":   triple_bottom,
    "AscTriangle":    asc_triangle,
}


def scan_all(df, symbol: str = "", include: list[str] | None = None,
             exclude: list[str] | None = None, min_score: int = 0) -> list[PatternHit]:
    """
    Run every detector against a DataFrame and return a unified hit list.

    Parameters
    ----------
    df : DataFrame indexed by date with Open/High/Low/Close/Volume.
    symbol : Ticker (informational).
    include : Only run these detector ids (default: all).
    exclude : Skip these detector ids.
    min_score : Filter out hits with quality_score below this.

    Returns
    -------
    list of PatternHit, sorted by (breakout_date desc, quality_score desc).
    """
    include = set(include) if include else set(DETECTORS.keys())
    exclude = set(exclude) if exclude else set()

    hits: list[PatternHit] = []
    for name, mod in DETECTORS.items():
        if name not in include or name in exclude:
            continue
        try:
            for h in mod.scan(df, symbol=symbol):
                if h.quality_score >= min_score:
                    hits.append(h)
        except Exception as e:
            # Detector blew up — don't kill the whole scan
            print(f"[warn] {name} failed on {symbol}: {e}")

    hits.sort(key=lambda h: (h.breakout_date, h.quality_score), reverse=True)
    return hits


__all__ = ["PatternHit", "DETECTORS", "scan_all"]
