"""
Watchlist adapter — pulls the HTF-actionable list from stockotter.

Hits GET /api/bot/htf-watchlist with the shared-secret X-Bot-Key header.
Returns the symbol list (and rich metadata) the bot evaluates each tick.
"""
import os
from typing import List, Optional
import httpx


def _stockotter_url() -> str:
    return os.environ.get("STOCKOTTER_INTERNAL_URL", "http://10.209.32.9:5000").rstrip("/")


def _bot_key() -> Optional[str]:
    return os.environ.get("BOT_API_KEY")


async def fetch_htf_watchlist(limit: int = 25, min_score: int = 70) -> Optional[dict]:
    """Return {scanned_at, universe_size, count, symbols:[...]} or None on failure."""
    key = _bot_key()
    if not key:
        print("[watchlist] BOT_API_KEY not set — cannot authenticate", flush=True)
        return None

    url = f"{_stockotter_url()}/api/bot/htf-watchlist"
    params = {"limit": limit, "minScore": min_score}
    headers = {"X-Bot-Key": key}
    async with httpx.AsyncClient(timeout=20.0) as client:
        try:
            r = await client.get(url, params=params, headers=headers)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            print(f"[watchlist] fetch failed: {e}", flush=True)
            return None


async def fetch_symbols(limit: int = 25, min_score: int = 70) -> List[str]:
    """Convenience: just the ticker strings."""
    data = await fetch_htf_watchlist(limit=limit, min_score=min_score)
    if not data:
        return []
    return [s["ticker"] for s in data.get("symbols", []) if s.get("ticker")]
