"""
FMP price adapter — fetches daily OHLCV bars from
/stable/historical-price-eod/full and normalizes to chronological order.
"""
import os
from typing import List, Optional
import httpx

FMP_BASE = "https://financialmodelingprep.com/stable"


def _api_key() -> str:
    key = os.environ.get("FMP_API_KEY")
    if not key:
        raise RuntimeError("FMP_API_KEY not set")
    return key


async def fetch_eod(symbol: str, limit: int = 400) -> Optional[List[dict]]:
    """Return OHLCV bars oldest-first as [{date, open, high, low, close, volume}].

    Returns None on hard failure (caller decides whether to skip the symbol).
    """
    url = f"{FMP_BASE}/historical-price-eod/full"
    params = {"symbol": symbol, "apikey": _api_key()}
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            r = await client.get(url, params=params)
            r.raise_for_status()
            raw = r.json()
        except Exception as e:
            print(f"[price] {symbol} fetch failed: {e}", flush=True)
            return None

    # FMP returns either {historical: [...]} or a flat list. Normalize.
    if isinstance(raw, dict):
        rows = raw.get("historical") or raw.get("data") or []
    else:
        rows = raw or []

    if not rows:
        return None

    norm = []
    for r in rows:
        try:
            norm.append({
                "date": r.get("date"),
                "open": float(r.get("open", 0)),
                "high": float(r.get("high", 0)),
                "low": float(r.get("low", 0)),
                "close": float(r.get("close", 0)),
                "volume": float(r.get("volume", 0)),
            })
        except (TypeError, ValueError):
            continue

    # FMP returns newest-first. Sort chronological ascending by date.
    norm.sort(key=lambda x: x["date"])
    return norm[-limit:] if len(norm) > limit else norm
