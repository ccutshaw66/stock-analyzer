# Markov Strategy — deployable service

FastAPI wrapper around `markov_trading_v2.py`. Same pattern as HERMES:
hosts on Railway (or any container host), the Stockotter `/markov` page
calls it over HTTP.

## Files

| File | Purpose |
|---|---|
| `markov_trading_v2.py` | The HMM regime strategy. Pure math + a `backtest()` function. |
| `app.py` | FastAPI app exposing `POST /api/backtest`. |
| `requirements.txt` | Pinned Python dependencies. |
| `Dockerfile` | Container build for Railway / Render / Fly / your own server. |

## Endpoint

```
POST /api/backtest
Content-Type: application/json

{
  "ticker": "SPY",
  "start": "2010-01-01",
  "end": "",
  "states": 3,
  "train_frac": 0.6,
  "target_vol": 0.10,
  "cost_bps": 3.0,
  "min_hold_days": 2,
  "allow_short": true
}
```

Returns:

```json
{
  "regime_stats": [
    {"state": 0, "mean_return": 0.0011, "volatility": 0.0072},
    ...
  ],
  "performance": {
    "net":   {"cagr": 0.094, "sharpe": 1.21, "sortino": 1.85, "max_drawdown": -0.12, "hit_rate": 0.54},
    "gross": {"cagr": 0.103, "sharpe": 1.34, ...},
    "bh":    {"cagr": 0.115, "sharpe": 0.86, ...}
  },
  "equity_curve": [{"date": "2018-05-01", "strategy": 1.0, "bh": 1.0}, ...],
  "positions":    [{"date": "2018-05-01", "position": 0.42}, ...]
}
```

This contract matches `client/src/compartments/markov/useMarkov.ts`. Keep
the two in sync — change here, change there, no third copy.

## Local run

```bash
cd python/markov
pip install -r requirements.txt
uvicorn app:app --reload --port 8000

# smoke-test
curl -s -X POST http://localhost:8000/api/backtest \
  -H "Content-Type: application/json" \
  -d '{"ticker":"SPY","start":"2018-01-01","end":"","states":3,"train_frac":0.6,"target_vol":0.1,"cost_bps":3,"min_hold_days":2,"allow_short":true}' \
  | head -c 400
```

## Deploy to Railway (or wherever)

1. Push this `python/markov/` directory as its own GitHub repo (or use
   Railway's "Deploy from GitHub" pointing at the Stockotter repo's
   `python/markov/` path if your Railway plan supports subpath builds).
2. Railway auto-detects the `Dockerfile` and builds. Set the
   `MARKOV_ALLOWED_ORIGINS` env var to your Stockotter origin
   (`https://stockotter.ai`) to lock CORS down.
3. Once Railway gives you a URL like
   `https://markov-prod-xxxx.up.railway.app`, open
   `client/src/compartments/markov/useMarkov.ts` and change:
   ```ts
   export const MARKOV_API: string | null = null;
   ```
   to:
   ```ts
   export const MARKOV_API: string | null =
     "https://markov-prod-xxxx.up.railway.app";
   ```
4. The "Awaiting Python service deployment" warning on `/markov`
   disappears automatically — `useMarkov()` checks `MARKOV_API !== null`
   to flip the page to "Live".

## Known caveat — yfinance

Right now the service pulls price history from yfinance (Yahoo Finance).
That's at odds with the broader "kill Yahoo" rule for Stockotter, but
acceptable here because:

1. Markov is research/experimental, not on the critical signal path.
2. There's no first-party Python client for FMP that covers OHLCV
   the way yfinance does. Writing one is a separate task.

This is logged in `docs/TODO.md`. Eventually, switch this service to
pull from the FMP `/historical-price-eod/full` endpoint over plain
`requests`, matching the rest of Stockotter.
