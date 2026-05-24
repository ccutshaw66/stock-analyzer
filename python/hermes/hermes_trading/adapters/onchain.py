import os
import httpx

SCHEMA_VERSION = "1.0"

async def fetch(asset: str) -> dict:
    api_key = os.environ.get("GLASSNODE_API_KEY")
    if "BTC" not in asset.upper():
        return {"schema_version": SCHEMA_VERSION, "asset": asset, "available": False}
    if not api_key:
        return {"schema_version": SCHEMA_VERSION, "asset": asset, "available": False, "note": "Set GLASSNODE_API_KEY for on-chain data"}
    async with httpx.AsyncClient() as client:
        try:
            base_url = "https://api.glassnode.com/v1/metrics"
            headers = {"X-Api-Key": api_key}
            resp = await client.get(f"{base_url}/addresses/active_count", params={"a": "BTC", "i": "24h"}, headers=headers, timeout=10)
            active_addresses = resp.json()[-1]["v"] if resp.status_code == 200 else None
            return {"schema_version": SCHEMA_VERSION, "asset": asset, "available": True, "active_addresses_24h": active_addresses}
        except Exception as e:
            return {"schema_version": SCHEMA_VERSION, "asset": asset, "available": False, "error": str(e)}
