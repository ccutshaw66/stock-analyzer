import yfinance as yf

SCHEMA_VERSION = "1.0"

async def fetch(asset: str) -> dict:
    try:
        indicators = {"DXY": "DX-Y.NYB", "SPY": "SPY", "VIX": "^VIX", "TLT": "TLT"}
        results = {}
        for name, ticker in indicators.items():
            try:
                data = yf.Ticker(ticker)
                hist = data.history(period="2d")
                if len(hist) >= 1:
                    current = hist["Close"].iloc[-1]
                    prev = hist["Close"].iloc[-2] if len(hist) >= 2 else current
                    change_pct = ((current - prev) / prev) * 100
                    results[name.lower()] = {"value": round(float(current), 2), "change_1d_pct": round(float(change_pct), 2)}
            except Exception:
                results[name.lower()] = None
        risk_score = 0
        if results.get("spy") and results["spy"].get("change_1d_pct"):
            risk_score += 1 if results["spy"]["change_1d_pct"] > 0 else -1
        if results.get("vix") and results["vix"].get("change_1d_pct"):
            risk_score += -1 if results["vix"]["change_1d_pct"] > 0 else 1
        if results.get("dxy") and results["dxy"].get("change_1d_pct"):
            risk_score += -1 if results["dxy"]["change_1d_pct"] > 0 else 1
        risk_regime = "risk-on" if risk_score > 0 else "risk-off" if risk_score < 0 else "neutral"
        return {"schema_version": SCHEMA_VERSION, "asset": asset, "available": True, "indicators": results, "risk_regime": risk_regime, "risk_score": risk_score}
    except Exception as e:
        return {"schema_version": SCHEMA_VERSION, "asset": asset, "available": False, "error": str(e)}
