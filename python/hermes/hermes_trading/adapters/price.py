import os
import numpy as np

SCHEMA_VERSION = "1.0"

def calculate_rsi(closes: list, period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    deltas = np.diff(closes)
    gains = np.where(deltas > 0, deltas, 0)
    losses = np.where(deltas < 0, -deltas, 0)
    avg_gain = np.mean(gains[-period:])
    avg_loss = np.mean(losses[-period:])
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return float(rsi)

def calculate_volatility(closes: list, period: int = 14) -> float:
    if len(closes) < period + 1:
        return 0.0
    returns = []
    for i in range(1, len(closes)):
        ret = (closes[i] - closes[i-1]) / closes[i-1] * 100
        returns.append(ret)
    return float(np.std(returns[-period:]))

async def fetch(asset: str) -> dict:
    crypto_assets = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "DOT", "AVAX", "MATIC", "LINK"]
    base_asset = asset.split("/")[0].upper()
    
    if base_asset in crypto_assets:
        return await fetch_crypto(asset)
    else:
        return await fetch_stock(base_asset)

async def fetch_crypto(asset: str) -> dict:
    import ccxt.async_support as ccxt
    kraken_asset = asset.replace("/USDT", "/USD")
    exchange = ccxt.kraken({"enableRateLimit": True})
    try:
        ticker = await exchange.fetch_ticker(kraken_asset)
        ohlcv = await exchange.fetch_ohlcv(kraken_asset, "1h", limit=50)
        closes = [candle[4] for candle in ohlcv]
        highs = [candle[2] for candle in ohlcv]
        lows = [candle[3] for candle in ohlcv]
        rsi = calculate_rsi(closes)
        volatility = calculate_volatility(closes)
        return {
            "schema_version": SCHEMA_VERSION,
            "asset": asset,
            "close": ticker["last"],
            "open": ticker.get("open", ticker["last"]),
            "high": ticker.get("high", ticker["last"]),
            "low": ticker.get("low", ticker["last"]),
            "volume": ticker.get("baseVolume", 0),
            "change_24h_pct": ticker.get("percentage", 0),
            "rsi": round(rsi, 2),
            "volatility": round(volatility, 2),
            "bid": ticker.get("bid", ticker["last"]),
            "ask": ticker.get("ask", ticker["last"])
        }
    finally:
        await exchange.close()

async def fetch_stock(symbol: str) -> dict:
    import yfinance as yf
    import asyncio
    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(None, lambda: _fetch_stock_sync(symbol))
    return data

def _fetch_stock_sync(symbol: str) -> dict:
    import yfinance as yf
    ticker = yf.Ticker(symbol)
    hist = ticker.history(period="5d", interval="1h")
    if hist.empty:
        raise Exception(f"No data for {symbol}")
    closes = hist["Close"].tolist()
    highs = hist["High"].tolist()
    lows = hist["Low"].tolist()
    rsi = calculate_rsi(closes)
    volatility = calculate_volatility(closes)
    current = closes[-1]
    prev_close = closes[-2] if len(closes) > 1 else current
    change_pct = ((current - prev_close) / prev_close) * 100
    return {
        "schema_version": SCHEMA_VERSION,
        "asset": f"{symbol}/USD",
        "close": round(current, 2),
        "open": round(float(hist["Open"].iloc[-1]), 2),
        "high": round(float(hist["High"].iloc[-1]), 2),
        "low": round(float(hist["Low"].iloc[-1]), 2),
        "volume": int(hist["Volume"].iloc[-1]),
        "change_24h_pct": round(change_pct, 2),
        "rsi": round(rsi, 2),
        "volatility": round(volatility, 2),
        "bid": round(current, 2),
        "ask": round(current, 2)
    }
