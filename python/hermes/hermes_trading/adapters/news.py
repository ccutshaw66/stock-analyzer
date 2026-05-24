import os
import httpx

SCHEMA_VERSION = "1.0"

async def fetch(asset: str) -> dict:
    api_key = os.environ.get("NEWS_API_KEY")
    base_asset = asset.split("/")[0] if "/" in asset else asset
    search_terms = {"BTC": "Bitcoin", "ETH": "Ethereum", "SOL": "Solana"}
    search_term = search_terms.get(base_asset.upper(), base_asset)
    if not api_key:
        return {"schema_version": SCHEMA_VERSION, "asset": asset, "available": False, "note": "Set NEWS_API_KEY for news sentiment"}
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get("https://newsapi.org/v2/everything", params={"q": search_term, "sortBy": "publishedAt", "pageSize": 10, "apiKey": api_key}, timeout=10)
            if resp.status_code != 200:
                return {"schema_version": SCHEMA_VERSION, "asset": asset, "available": False, "error": f"API returned {resp.status_code}"}
            data = resp.json()
            articles = data.get("articles", [])
            positive_words = ["surge", "rally", "gain", "bull", "high", "up", "rise", "growth"]
            negative_words = ["crash", "drop", "fall", "bear", "low", "down", "decline", "loss"]
            pos_count = 0
            neg_count = 0
            for article in articles:
                title = (article.get("title") or "").lower()
                pos_count += sum(1 for w in positive_words if w in title)
                neg_count += sum(1 for w in negative_words if w in title)
            total = pos_count + neg_count
            sentiment = (pos_count - neg_count) / total if total > 0 else 0
            return {"schema_version": SCHEMA_VERSION, "asset": asset, "available": True, "article_count": len(articles), "sentiment_score": round(sentiment, 3), "positive_signals": pos_count, "negative_signals": neg_count}
        except Exception as e:
            return {"schema_version": SCHEMA_VERSION, "asset": asset, "available": False, "error": str(e)}
