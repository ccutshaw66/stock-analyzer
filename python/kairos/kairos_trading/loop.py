"""
KAIROS trading loop (paper-mode default).

Each tick:
  1. Hot-reload goal.yaml (lets dashboard edits land without a restart).
  2. Refresh the HTF watchlist from stockotter if stale.
  3. For each watchlist symbol with no open position, fetch EOD bars,
     evaluate HTF (scan_htf on the latest bar) and BBTC (compute_bbtc on
     the full series). Open a long position if EITHER fires. Conviction
     tag = "HTF" / "BBTC" / "BOTH".
  4. For each open position, fetch the latest bar, recompute the
     strategy-specific exit (HTF: stop / target hit; BBTC: hard stop or
     trail or state-based exit). Close + log on hit.
  5. Write heartbeat.json + watchlist.json + equity sample.

Live mode is gated behind TWO env flags (KAIROS_MODE=live AND
KAIROS_I_ACCEPT_RISK=true) per the HERMES safety pattern. Paper mode
mirrors the trade decisions to state files but never sends orders.
"""
import asyncio
import json
import os
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import aiofiles
import yaml

from kairos_trading.adapters import price as price_adapter
from kairos_trading.adapters import watchlist as watchlist_adapter
from kairos_trading.strategies.htf import scan_htf
from kairos_trading.strategies.bbtc import compute_bbtc, compute_indicators

STRATEGY_VERSION = "0.1.0"


# ─── Live-mode safety gate ─────────────────────────────────────────────────────

def _is_live_mode() -> bool:
    return (
        os.environ.get("KAIROS_MODE", "paper").lower() == "live"
        and os.environ.get("KAIROS_I_ACCEPT_RISK", "").lower() == "true"
    )


# ─── Position model ────────────────────────────────────────────────────────────

@dataclass
class Position:
    symbol: str
    entry_strategy: str  # "HTF" | "BBTC" | "BOTH"
    entry_price: float
    shares: float
    entry_time: str
    stop_price: float
    target_price: Optional[float]
    # BBTC management state (None for HTF-only positions)
    entry_atr: Optional[float] = None
    highest_since_entry: Optional[float] = None

    def to_status_dict(self, current_price: float) -> dict:
        pnl_dollars = (current_price - self.entry_price) * self.shares
        pnl_pct = ((current_price - self.entry_price) / self.entry_price) * 100 if self.entry_price else 0.0
        return {
            "symbol": self.symbol,
            "entry_strategy": self.entry_strategy,
            "entry_price": self.entry_price,
            "current_price": current_price,
            "shares": self.shares,
            "entry_time": self.entry_time,
            "stop_price": self.stop_price,
            "target_price": self.target_price,
            "unrealized_pnl_pct": round(pnl_pct, 4),
            "unrealized_pnl_dollars": round(pnl_dollars, 2),
        }


# ─── TradingLoop ──────────────────────────────────────────────────────────────

class TradingLoop:
    def __init__(self, state_dir: Path):
        self.state_dir = state_dir
        self.mode = "live" if _is_live_mode() else "paper"
        self.positions: Dict[str, Position] = {}
        self.equity: float = 10_000.0          # mark-to-market: cash + open position value
        self.cash: float = 10_000.0            # uninvested buying power
        self.equity_curve: List[float] = []
        self.equity_timestamps: List[str] = []
        self.watchlist: List[str] = []
        self.watchlist_rows: List[dict] = []
        self.last_watchlist_refresh: Optional[datetime] = None
        self.goal: dict = {}
        self.loop_count = 0
        self.consecutive_failures = 0
        self.max_consecutive_failures = 5

        self.trades_file = state_dir / "trades.jsonl"
        self.heartbeat_file = state_dir / "heartbeat.json"
        self.equity_file = state_dir / "equity.json"
        self.watchlist_file = state_dir / "watchlist.json"
        self.positions_file = state_dir / "positions.json"
        self.goal_file = state_dir / "goal.yaml"

        self._load_state()

    # ─── Persistence ───────────────────────────────────────────────────────

    def _load_goal(self) -> dict:
        if not self.goal_file.exists():
            return {}
        try:
            return yaml.safe_load(self.goal_file.read_text()) or {}
        except Exception as e:
            print(f"[goal] reload failed: {e}", flush=True)
            return self.goal or {}

    def _load_state(self):
        self.goal = self._load_goal()
        starting = float(self.goal.get("starting_equity", 10_000.0))
        self.equity = starting
        stored_cash: Optional[float] = None
        if self.equity_file.exists():
            try:
                eq = json.loads(self.equity_file.read_text())
                self.equity_curve = list(eq.get("equity", []))
                self.equity_timestamps = list(eq.get("timestamps", []))
                if self.equity_curve:
                    self.equity = float(self.equity_curve[-1])
                if eq.get("cash") is not None:
                    stored_cash = float(eq["cash"])
            except Exception:
                pass
        # Positions: restore from positions.json so bot restarts don't
        # orphan open positions (heartbeat.json is the UI-shape dump and
        # drops BBTC trailing-stop internals; positions.json is the full
        # dataclass dump for round-trip).
        if self.positions_file.exists():
            try:
                data = json.loads(self.positions_file.read_text())
                for p_dict in data.get("positions", []):
                    pos = Position(**p_dict)
                    self.positions[pos.symbol] = pos
                if self.positions:
                    print(
                        f"[state] restored {len(self.positions)} open position(s) "
                        f"from positions.json: {', '.join(self.positions.keys())}",
                        flush=True,
                    )
            except Exception as e:
                print(f"[state] positions.json load failed: {e} — starting flat", flush=True)

        # Buying power. Prefer the persisted cash field; otherwise reconstruct
        # from (last equity − cost basis of open positions), which recovers the
        # right number from old state files written before the cash model.
        if stored_cash is not None:
            self.cash = stored_cash
        else:
            cost_basis = sum(p.shares * p.entry_price for p in self.positions.values())
            self.cash = (self.equity_curve[-1] if self.equity_curve else starting) - cost_basis
        if self.cash < 0:
            print(
                f"[state] WARNING: reconstructed cash is ${self.cash:,.0f} (NEGATIVE) — the account "
                f"is over-deployed across {len(self.positions)} open positions. New entries are "
                f"blocked until positions close. To start clean: stop the bot, delete equity.json + "
                f"positions.json, set starting_equity in goal.yaml, restart.",
                flush=True,
            )

    async def _write_heartbeat(self, current_prices: Dict[str, float]):
        open_positions = [
            p.to_status_dict(current_prices.get(p.symbol, p.entry_price))
            for p in self.positions.values()
        ]
        heartbeat = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "mode": self.mode,
            "strategy_version": STRATEGY_VERSION,
            "watchlist": self.watchlist,
            "open_positions": open_positions,
            "consecutive_failures": self.consecutive_failures,
            "loop_count": self.loop_count,
            "equity": round(self.equity, 2),
            "cash": round(self.cash, 2),
            "invested": round(self._invested(current_prices), 2),
            "open_position_count": len(self.positions),
        }
        async with aiofiles.open(self.heartbeat_file, "w") as f:
            await f.write(json.dumps(heartbeat, indent=2))

    def _invested(self, prices: Dict[str, float]) -> float:
        """Current market value of all open positions."""
        return sum(p.shares * prices.get(p.symbol, p.entry_price) for p in self.positions.values())

    def _account_equity(self, prices: Dict[str, float]) -> float:
        """Mark-to-market account value = uninvested cash + open position value."""
        return self.cash + self._invested(prices)

    async def _write_watchlist(self):
        async with aiofiles.open(self.watchlist_file, "w") as f:
            await f.write(json.dumps(self.watchlist_rows, indent=2))

    async def _write_positions(self):
        payload = {
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "positions": [asdict(p) for p in self.positions.values()],
        }
        async with aiofiles.open(self.positions_file, "w") as f:
            await f.write(json.dumps(payload, indent=2))

    async def _write_equity(self):
        ts = datetime.now(timezone.utc).isoformat()
        self.equity_curve.append(round(self.equity, 2))
        self.equity_timestamps.append(ts)
        # cap at ~30d of 30-min ticks ≈ 1500 samples
        if len(self.equity_curve) > 2000:
            self.equity_curve = self.equity_curve[-2000:]
            self.equity_timestamps = self.equity_timestamps[-2000:]
        payload = {"equity": self.equity_curve, "timestamps": self.equity_timestamps, "cash": round(self.cash, 2)}
        async with aiofiles.open(self.equity_file, "w") as f:
            await f.write(json.dumps(payload, indent=2))

    async def _log_trade(self, trade: dict):
        async with aiofiles.open(self.trades_file, "a") as f:
            await f.write(json.dumps(trade) + "\n")

    # ─── Watchlist refresh ────────────────────────────────────────────────

    def _watchlist_is_stale(self) -> bool:
        if self.last_watchlist_refresh is None:
            return True
        refresh_hours = float(self.goal.get("watchlist_refresh_hours", 1))
        age = (datetime.now(timezone.utc) - self.last_watchlist_refresh).total_seconds()
        return age > refresh_hours * 3600

    async def _refresh_watchlist(self):
        min_score = int(self.goal.get("min_score", 70))
        data = await watchlist_adapter.fetch_htf_watchlist(limit=25, min_score=min_score)
        if not data:
            print("[watchlist] refresh failed — keeping prior list", flush=True)
            return
        symbols_meta = data.get("symbols", [])
        self.watchlist = [s["ticker"] for s in symbols_meta if s.get("ticker")]
        self.watchlist_rows = [
            {
                "ticker": s["ticker"],
                "htf_state": "fired" if s.get("stage") == "fired" else "armed",
                "bbtc_state": "none",  # filled per-symbol below when bot evaluates
                "current_price": None,
                "current_rsi": None,
                "last_evaluated": None,
            }
            for s in symbols_meta if s.get("ticker")
        ]
        self.last_watchlist_refresh = datetime.now(timezone.utc)
        print(f"[watchlist] refreshed ({len(self.watchlist)} symbols, min_score={min_score})", flush=True)

    # ─── Strategy evaluation ──────────────────────────────────────────────

    def _eval_signals(self, symbol: str, bars: List[dict]) -> dict:
        """Return {htf_hit, bbtc_state, latest_close, latest_rsi, latest_atr}."""
        result = {
            "htf_hit": None,
            "bbtc_state": "none",
            "bbtc_top_signal": "HOLD",
            "latest_close": None,
            "latest_rsi": None,
            "latest_atr": None,
        }
        if not bars:
            return result

        result["latest_close"] = bars[-1]["close"]

        # HTF: scan; treat the most recent hit on the final bar as a fresh fire.
        hits = scan_htf(bars, symbol=symbol, min_score=int(self.goal.get("min_score", 70)))
        if hits:
            latest = hits[0]
            # Compare hit date to the final bar date
            if latest.get("breakoutDate") == bars[-1].get("date"):
                result["htf_hit"] = latest

        # BBTC: compute on the full series; use last signal as state.
        highs = [b["high"] for b in bars]
        lows = [b["low"] for b in bars]
        closes = [b["close"] for b in bars]
        try:
            ind = compute_indicators(highs, lows, closes)
            bb = compute_bbtc(
                closes=closes, highs=highs, lows=lows,
                ema9=ind["ema9"], ema21=ind["ema21"], ema50=ind["ema50"],
                atr14=ind["atr14"], adx14=ind["adx14"], rsi14=ind["rsi14"],
                sma200=ind["sma200"],
            )
            result["bbtc_top_signal"] = bb["topSignal"]
            # Map to watchlist UI states
            last_sig = bb["lastSignal"]
            if last_sig == "BUY":
                result["bbtc_state"] = "BUY"
            elif last_sig == "SELL":
                result["bbtc_state"] = "SELL"
            elif last_sig == "STOP_HIT":
                result["bbtc_state"] = "STOP_HIT"
            else:
                result["bbtc_state"] = "HOLD"
            result["latest_rsi"] = ind["rsi14"][-1] if ind["rsi14"] else None
            result["latest_atr"] = ind["atr14"][-1] if ind["atr14"] else None
            result["_bbtc_full"] = bb  # for entry logic
            result["_indicators"] = ind
        except Exception as e:
            print(f"[{symbol}] BBTC eval failed: {e}", flush=True)

        return result

    def _conviction_tag(self, htf_fired: bool, bbtc_fired: bool) -> str:
        if htf_fired and bbtc_fired:
            return "BOTH"
        if htf_fired:
            return "HTF"
        return "BBTC"

    def _position_size_shares(self, entry_price: float) -> float:
        if entry_price <= 0:
            return 0
        pct = float(self.goal.get("position_size_pct", 0.02))
        # Size off equity, but NEVER commit more than the cash actually on hand.
        dollars = min(self.equity * pct, self.cash)
        if dollars <= 0:
            return 0
        return round(dollars / entry_price, 4)

    # ─── Entry / exit ─────────────────────────────────────────────────────

    async def _try_open(self, symbol: str, signals: dict):
        if symbol in self.positions:
            return
        # Hard cap on concurrent positions (diversification + sanity guard so a
        # rotating watchlist can't pile up dozens of open positions).
        max_open = int(self.goal.get("max_open_positions", 25))
        if len(self.positions) >= max_open:
            return
        htf = signals.get("htf_hit")
        bbtc_top = signals.get("bbtc_top_signal", "HOLD")
        htf_fired = htf is not None
        bbtc_fired = bbtc_top == "ENTER"
        if not (htf_fired or bbtc_fired):
            return

        entry_price = signals["latest_close"]
        if entry_price is None or entry_price <= 0:
            return

        if htf_fired:
            stop_price = float(htf["stopPrice"])
            target_price = float(htf["targetPrice"])
            entry_atr = signals.get("latest_atr")
        else:
            # BBTC-only entry: hard stop at entry - 2.5 × ATR; no fixed target (trail handles it)
            atr = signals.get("latest_atr") or 0.0
            stop_price = entry_price - 2.5 * atr
            target_price = None
            entry_atr = atr

        shares = self._position_size_shares(entry_price)
        if shares <= 0:
            return
        cost = shares * entry_price
        if cost > self.cash + 1e-6:
            return  # not enough buying power — can't open what we can't afford

        pos = Position(
            symbol=symbol,
            entry_strategy=self._conviction_tag(htf_fired, bbtc_fired),
            entry_price=entry_price,
            shares=shares,
            entry_time=datetime.now(timezone.utc).isoformat(),
            stop_price=stop_price,
            target_price=target_price,
            entry_atr=entry_atr,
            highest_since_entry=entry_price,
        )
        self.positions[symbol] = pos
        self.cash -= cost  # buying power is now committed to this position
        print(f"[{symbol}] OPEN {pos.entry_strategy} {shares}sh @ ${entry_price:.2f} cost=${cost:,.0f} cash_left=${self.cash:,.0f}", flush=True)

    async def _try_close(self, symbol: str, signals: dict) -> bool:
        pos = self.positions.get(symbol)
        if pos is None:
            return False

        latest_close = signals.get("latest_close")
        latest_atr = signals.get("latest_atr")
        if latest_close is None:
            return False

        exit_reason: Optional[str] = None

        # Update high-water mark for trailing logic
        if pos.highest_since_entry is None or latest_close > pos.highest_since_entry:
            pos.highest_since_entry = latest_close

        # HTF stops/targets dominate when HTF was the trigger
        if pos.entry_strategy in ("HTF", "BOTH"):
            if latest_close <= pos.stop_price:
                exit_reason = "STOP"
            elif pos.target_price is not None and latest_close >= pos.target_price:
                exit_reason = "TARGET"

        # BBTC trailing/hard-stop logic when active
        if exit_reason is None and pos.entry_strategy in ("BBTC", "BOTH") and pos.entry_atr and latest_atr:
            hard_stop = pos.entry_price - 2.5 * pos.entry_atr
            trail_stop = (pos.highest_since_entry or pos.entry_price) - 3.0 * latest_atr
            effective_stop = max(hard_stop, trail_stop)
            if latest_close <= effective_stop:
                exit_reason = "TRAIL" if trail_stop >= hard_stop else "STOP"
            # State-based exit: BBTC top signal flipped to SELL
            bb_top = signals.get("bbtc_top_signal", "HOLD")
            if exit_reason is None and bb_top == "SELL":
                exit_reason = "STOP"  # treat trend break as a stop event

        if exit_reason is None:
            return False

        pnl_dollars = (latest_close - pos.entry_price) * pos.shares
        pnl_pct = ((latest_close - pos.entry_price) / pos.entry_price) * 100
        trade = {
            "id": datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f"),
            "symbol": pos.symbol,
            "entry_strategy": pos.entry_strategy,
            "direction": "long",
            "entry_price": pos.entry_price,
            "exit_price": latest_close,
            "shares": pos.shares,
            "entry_time": pos.entry_time,
            "exit_time": datetime.now(timezone.utc).isoformat(),
            "pnl_pct": round(pnl_pct, 4),
            "pnl_dollars": round(pnl_dollars, 2),
            "exit_reason": exit_reason,
            "mode": self.mode,
        }
        await self._log_trade(trade)
        # Return proceeds to cash. Realized P&L is implicit: `cost` (shares×entry)
        # left cash on open; shares×exit comes back now → net change = pnl_dollars.
        self.cash += pos.shares * latest_close
        del self.positions[symbol]
        print(f"[{symbol}] CLOSE {exit_reason} @ ${latest_close:.2f} pnl={pnl_pct:+.2f}% cash=${self.cash:,.0f}", flush=True)
        return True

    # ─── Main loop ────────────────────────────────────────────────────────

    async def run(self):
        print(f"KAIROS loop starting in {self.mode} mode (strategy v{STRATEGY_VERSION})", flush=True)
        while True:
            try:
                self.loop_count += 1
                self.goal = self._load_goal()

                if self._watchlist_is_stale():
                    await self._refresh_watchlist()

                # Union of watchlist symbols and currently-open positions
                to_evaluate = list(dict.fromkeys(list(self.watchlist) + list(self.positions.keys())))
                current_prices: Dict[str, float] = {}

                for symbol in to_evaluate:
                    try:
                        bars = await price_adapter.fetch_eod(symbol, limit=400)
                    except Exception as e:
                        print(f"[{symbol}] price fetch error: {e}", flush=True)
                        bars = None
                    if not bars:
                        continue

                    signals = self._eval_signals(symbol, bars)
                    if signals.get("latest_close"):
                        current_prices[symbol] = signals["latest_close"]

                    # Update watchlist row's per-symbol state
                    for row in self.watchlist_rows:
                        if row["ticker"] == symbol:
                            row["current_price"] = signals.get("latest_close")
                            row["current_rsi"] = round(signals["latest_rsi"], 2) if signals.get("latest_rsi") is not None else None
                            row["bbtc_state"] = signals.get("bbtc_state", "none")
                            row["htf_state"] = "fired" if signals.get("htf_hit") else row.get("htf_state", "armed")
                            row["last_evaluated"] = datetime.now(timezone.utc).isoformat()
                            break

                    # Close before considering open (don't flip in one tick)
                    closed = await self._try_close(symbol, signals)
                    if not closed:
                        await self._try_open(symbol, signals)

                # Mark the account to market (cash + open position value) before
                # persisting, so equity reflects reality not just realized P&L.
                self.equity = self._account_equity(current_prices)
                await self._write_heartbeat(current_prices)
                await self._write_watchlist()
                await self._write_equity()
                await self._write_positions()

                self.consecutive_failures = 0
                interval_min = float(self.goal.get("loop_interval_minutes", 30))
                await asyncio.sleep(max(60, int(interval_min * 60)))
            except Exception as e:
                self.consecutive_failures += 1
                print(f"[loop] error: {e} (failures={self.consecutive_failures})", flush=True)
                import traceback; traceback.print_exc()
                if self.consecutive_failures >= self.max_consecutive_failures:
                    print("[loop] circuit breaker tripped — halting", flush=True)
                    break
                await asyncio.sleep(60)
