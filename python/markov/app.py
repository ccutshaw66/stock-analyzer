"""
FastAPI wrapper around `markov_trading_v2.backtest()`.

Exposes a single endpoint:

    POST /api/backtest
    body:
      {
        "ticker": "SPY",
        "start": "2010-01-01",
        "end": "" | "2024-12-31",
        "states": 3,
        "train_frac": 0.6,
        "target_vol": 0.10,
        "cost_bps": 3.0,
        "min_hold_days": 2,
        "allow_short": true
      }
    →
      {
        "regime_stats": [{"state": 0, "mean_return": ..., "volatility": ...}, ...],
        "performance": {
          "net":   {cagr, sharpe, sortino, max_drawdown, hit_rate},
          "gross": {cagr, sharpe, sortino, max_drawdown, hit_rate},
          "bh":    {cagr, sharpe, sortino, max_drawdown, hit_rate}
        },
        "equity_curve": [{"date": "YYYY-MM-DD", "strategy": 1.0, "bh": 1.0}, ...],
        "positions":    [{"date": "YYYY-MM-DD", "position": 0.42}, ...]
      }

The contract above is what `client/src/compartments/markov/useMarkov.ts`
consumes — keep the two in sync. CORS is wide open by default so the
Stockotter frontend can reach this directly; tighten via the
MARKOV_ALLOWED_ORIGINS env var (comma-separated) in production.

Also exposes:
    GET  /health  →  {"status": "ok"}    — for Railway / uptime probes.
    GET  /        →  one-line ping.

Run locally:
    pip install -r requirements.txt
    uvicorn app:app --reload --port 8000
"""
from __future__ import annotations

import math
import os
from typing import Any

import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from markov_trading_v2 import backtest, perf


# ─── App + CORS ─────────────────────────────────────────────────────────────

app = FastAPI(title="Markov Strategy Service", version="1.0")

_allowed = os.getenv("MARKOV_ALLOWED_ORIGINS", "*")
_origins = [o.strip() for o in _allowed.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins or ["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ─── Request / response models ──────────────────────────────────────────────

class BacktestRequest(BaseModel):
    ticker: str = Field(..., examples=["SPY"])
    start: str = Field(..., examples=["2010-01-01"])
    end: str | None = Field(default=None, description="Inclusive end date, or blank for today")
    states: int = Field(default=3, ge=2, le=6)
    train_frac: float = Field(default=0.6, ge=0.2, le=0.9)
    target_vol: float = Field(default=0.10, ge=0.02, le=0.5)
    cost_bps: float = Field(default=3.0, ge=0, le=50)
    min_hold_days: int = Field(default=2, ge=1, le=20)
    allow_short: bool = True


# ─── Helpers ────────────────────────────────────────────────────────────────

def _safe_float(x: Any) -> float:
    """JSON-safe numeric coercion — NaN/Inf become 0.0 so the page can render."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0.0
    return v if math.isfinite(v) else 0.0


def _perf_payload(rets: pd.Series) -> dict[str, float]:
    """Map the legacy `perf()` dict to the snake_case shape the page expects."""
    raw = perf(rets)
    return {
        "cagr": _safe_float(raw.get("CAGR", 0)),
        "sharpe": _safe_float(raw.get("Sharpe", 0)),
        "sortino": _safe_float(raw.get("Sortino", 0)),
        "max_drawdown": _safe_float(raw.get("MaxDD", 0)),
        "hit_rate": _safe_float(raw.get("HitRate", 0)),
    }


def _date_str(idx: Any) -> str:
    """Render a pandas index value as YYYY-MM-DD."""
    try:
        return pd.Timestamp(idx).strftime("%Y-%m-%d")
    except Exception:
        return str(idx)


# ─── Routes ─────────────────────────────────────────────────────────────────

@app.get("/")
def root() -> dict[str, str]:
    return {"service": "markov", "endpoint": "POST /api/backtest"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/backtest")
def run_backtest(req: BacktestRequest) -> dict[str, Any]:
    # ── Pull price history ──
    try:
        data = yf.download(
            req.ticker,
            start=req.start,
            end=req.end or None,
            auto_adjust=True,
            progress=False,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"yfinance download failed: {e}") from e

    if data is None or data.empty:
        raise HTTPException(status_code=404, detail=f"No price data returned for {req.ticker}.")

    close = data["Close"].squeeze()
    if not isinstance(close, pd.Series):
        # Multi-column response (e.g. when yfinance returns a frame) — pick the ticker col.
        close = pd.Series(data["Close"].iloc[:, 0])

    # ── Run the existing backtest ──
    try:
        df, stats = backtest(
            close,
            n_states=req.states,
            train_frac=req.train_frac,
            target_vol=req.target_vol,
            cost_bps=req.cost_bps,
            min_hold_days=req.min_hold_days,
            allow_short=req.allow_short,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backtest failed: {e}") from e

    # ── Shape the response ──
    regime_stats = [
        {
            "state": int(row["state"]),
            "mean_return": _safe_float(row["mean_ret"]),
            "volatility": _safe_float(row["vol"]),
        }
        for _, row in stats.iterrows()
    ]

    performance = {
        "net": _perf_payload(df["net_ret"]),
        "gross": _perf_payload(df["gross_ret"]),
        "bh": _perf_payload(df["bh_ret"]),
    }

    eq_strat = (1 + df["net_ret"].fillna(0)).cumprod()
    eq_bh = (1 + df["bh_ret"].fillna(0)).cumprod()

    equity_curve = [
        {"date": _date_str(idx), "strategy": _safe_float(s), "bh": _safe_float(b)}
        for idx, s, b in zip(df.index, eq_strat.values, eq_bh.values)
    ]

    positions = [
        {"date": _date_str(idx), "position": _safe_float(p)}
        for idx, p in zip(df.index, df["position"].values)
    ]

    return {
        "regime_stats": regime_stats,
        "performance": performance,
        "equity_curve": equity_curve,
        "positions": positions,
    }
