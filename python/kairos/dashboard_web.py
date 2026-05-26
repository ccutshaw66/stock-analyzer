"""
KAIROS dashboard — read-only FastAPI service exposing bot state to the
stockotter Express proxy at /api/kairos/*.

Endpoint shapes are dictated by client/src/compartments/kairos/useKairos.ts —
do not change them without updating the hook.
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional
import json
import yaml
import os
from pathlib import Path
from datetime import datetime, timezone

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

STATE_DIR = Path("/app/state")
DEFAULT_STARTING_EQUITY = 10_000.0


# ─── State loaders ────────────────────────────────────────────────────────────

def _load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def _load_jsonl(path: Path):
    if not path.exists():
        return []
    out = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out


def load_heartbeat() -> dict:
    return _load_json(STATE_DIR / "heartbeat.json", {})


def load_trades() -> list:
    return _load_jsonl(STATE_DIR / "trades.jsonl")


def load_equity() -> dict:
    return _load_json(STATE_DIR / "equity.json", {"equity": [], "timestamps": []})


def load_watchlist_state() -> list:
    return _load_json(STATE_DIR / "watchlist.json", [])


def load_goal() -> dict:
    f = STATE_DIR / "goal.yaml"
    if not f.exists():
        return {}
    return yaml.safe_load(f.read_text()) or {}


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/api/status")
def status():
    h = load_heartbeat()
    g = load_goal()
    return {
        "status": "online" if h else "offline",
        "mode": h.get("mode", g.get("mode", "paper")),
        "watchlist": h.get("watchlist", []),
        "open_positions": h.get("open_positions", []),
        "strategy_version": h.get("strategy_version", "0.1.0"),
        "last_heartbeat": h.get("timestamp"),
    }


@app.get("/api/positions")
def positions():
    return load_heartbeat().get("open_positions", [])


@app.get("/api/trades")
def trades():
    # newest first, capped at 100 for payload size
    return list(reversed(load_trades()))[:100]


@app.get("/api/equity")
def equity():
    eq = load_equity()
    series = eq.get("equity", [])
    if not series:
        starting = float(load_goal().get("starting_equity", DEFAULT_STARTING_EQUITY))
        return {
            "equity": [starting],
            "timestamps": [datetime.now(timezone.utc).isoformat()],
        }
    return eq


@app.get("/api/watchlist")
def watchlist():
    return load_watchlist_state()


@app.get("/api/goal")
def goal():
    g = load_goal()
    return {
        "starting_equity": float(g.get("starting_equity", DEFAULT_STARTING_EQUITY)),
        "position_size_pct": float(g.get("position_size_pct", 0.02)),
        "watchlist_refresh_hours": float(g.get("watchlist_refresh_hours", 1)),
        "loop_interval_minutes": float(g.get("loop_interval_minutes", 30)),
        "min_score": int(g.get("min_score", 70)),
        "target_return_30d": g.get("target_return_30d"),
        "max_drawdown": g.get("max_drawdown"),
        "min_sharpe": g.get("min_sharpe"),
    }


# ─── Writable goal config ─────────────────────────────────────────────────────
# Bot's loop hot-reloads state/goal.yaml at the top of each iteration, so a
# PUT here lands in the live bot within at most one tick (loop_interval_minutes).
# Validation bounds are deliberately wide — Chris is the only operator and
# wants override freedom; we reject obvious typos (negative position size,
# 500% drawdown) but otherwise stay out of the way.

class GoalUpdate(BaseModel):
    """Partial update; only fields present are touched."""
    starting_equity: Optional[float] = Field(None, gt=0, le=10_000_000)
    # position_size_pct is a fraction (0.02 = 2%). Cap at 50% per trade
    # so a fat-finger 50.0 (intending "50%") gets rejected, not interpreted
    # as "5000% of equity per trade".
    position_size_pct: Optional[float] = Field(None, gt=0, le=0.5)
    watchlist_refresh_hours: Optional[float] = Field(None, gt=0, le=24)
    loop_interval_minutes: Optional[float] = Field(None, gt=0, le=240)
    min_score: Optional[int] = Field(None, ge=0, le=100)
    # target_return_30d / max_drawdown are decimals (0.05 = 5%). Same fat-finger
    # protection — cap at 100% drawdown and 1000% target.
    target_return_30d: Optional[float] = Field(None, ge=-1.0, le=10.0)
    max_drawdown: Optional[float] = Field(None, gt=0, le=1.0)
    min_sharpe: Optional[float] = Field(None, ge=-5.0, le=10.0)


@app.put("/api/goal")
def update_goal(update: GoalUpdate):
    patch = update.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(status_code=400, detail="empty_update")
    current = load_goal()
    new = {**current, **patch}

    # Atomic write — write to temp then rename so the bot's hot-reload never
    # sees a half-written file.
    f = STATE_DIR / "goal.yaml"
    tmp = STATE_DIR / "goal.yaml.tmp"
    tmp.write_text(yaml.safe_dump(new, default_flow_style=False, sort_keys=False))
    os.replace(tmp, f)

    return goal()  # round-trip — client sees the actual stored values


@app.get("/health")
def health():
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8082)
