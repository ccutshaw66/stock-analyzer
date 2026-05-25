import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict
import yaml
import aiofiles
from hermes_trading.adapters import price, onchain, news, macro
from hermes_trading.score import score
from hermes_trading import alerts
from hermes_trading.volatility import calculate_position_sizes, format_position_report

class TradingLoop:
    def __init__(self, assets: list, state_dir: Path, goal: dict):
        self.assets = assets
        self.state_dir = state_dir
        self.goal = goal
        self.consecutive_failures = 0
        self.max_consecutive_failures = 5
        self.retry_attempts = 3
        self.positions: Dict[str, dict] = {}
        self.trades_file = state_dir / "trades.jsonl"
        self.heartbeat_file = state_dir / "heartbeat.json"
        self.strategy_file = state_dir / "strategy.yaml"
        self.mode = os.environ.get("HERMES_TRADING_MODE", "paper")
        self.last_rsi: Dict[str, float] = {}
        self.volatilities: Dict[str, float] = {}
        self.position_sizes: Dict[str, float] = {}
        self.rebalance_interval = 60  # Recalculate position sizes every 60 loops (~1 hour)
        self.loop_count = 0

    def load_strategy(self) -> dict:
        if not self.strategy_file.exists():
            return {"version": "01", "assets": {}}
        with open(self.strategy_file) as f:
            return yaml.safe_load(f)

    def save_strategy(self, strategy: dict):
        with open(self.strategy_file, "w") as f:
            yaml.dump(strategy, f, default_flow_style=False)

    async def fetch_with_retry(self, adapter_name: str, fetch_fn, asset: str):
        for attempt in range(self.retry_attempts):
            try:
                data = await fetch_fn(asset)
                return data
            except Exception as e:
                wait_time = 2 ** attempt
                print(f"[{asset}][{adapter_name}] Attempt {attempt+1} failed: {e}. Retrying in {wait_time}s...", flush=True)
                await asyncio.sleep(wait_time)
        return None

    async def fetch_asset_data(self, asset: str):
        price_data = await self.fetch_with_retry("price", price.fetch, asset)
        if price_data is None:
            return None
        return {"price": price_data, "timestamp": datetime.now(timezone.utc).isoformat()}

    async def update_position_sizes(self):
        """Recalculate position sizes based on current volatility."""
        print("\n?? Recalculating position sizes based on volatility...", flush=True)
        
        # Calculate new position sizes
        self.position_sizes = calculate_position_sizes(self.volatilities)
        
        # Update strategy file
        strategy = self.load_strategy()
        for asset, size in self.position_sizes.items():
            if asset in strategy.get("assets", {}):
                strategy["assets"][asset]["position_size_r"] = round(size, 3)
        self.save_strategy(strategy)
        
        # Build report
        report_data = {}
        for asset in self.assets:
            report_data[asset] = {
                "volatility": self.volatilities.get(asset, 0),
                "position_size": self.position_sizes.get(asset, 0)
            }
        
        report = format_position_report(report_data)
        print(report.replace("<b>", "").replace("</b>", ""), flush=True)
        await alerts.alert(report)

    def evaluate_entry(self, asset: str, data: dict, strategy: dict) -> bool:
        asset_strategy = strategy.get("assets", {}).get(asset, {})
        entry = asset_strategy.get("entry", {"indicator": "rsi", "threshold": 30, "direction": "long"})
        indicator = entry.get("indicator", "rsi")
        threshold = entry.get("threshold", 30)
        direction = entry.get("direction", "long")
        price_data = data.get("price", {})
        if indicator == "rsi":
            rsi = price_data.get("rsi", 50)
            self.last_rsi[asset] = rsi
            if direction == "long":
                return rsi < threshold
            else:
                return rsi > (100 - threshold)
        return False

    def evaluate_exit(self, asset: str, data: dict, strategy: dict) -> bool:
        if asset not in self.positions:
            return False
        position = self.positions[asset]
        current_price = data.get("price", {}).get("close", 0)
        entry_price = position.get("entry_price", current_price)
        asset_strategy = strategy.get("assets", {}).get(asset, {})
        stop_loss_pct = asset_strategy.get("stop_loss_pct", 2.0)
        pnl_pct = ((current_price - entry_price) / entry_price) * 100
        if pnl_pct < -stop_loss_pct:
            return True
        if pnl_pct > (stop_loss_pct * 2):
            return True
        return False

    async def log_trade(self, trade: dict):
        async with aiofiles.open(self.trades_file, "a") as f:
            await f.write(json.dumps(trade) + "\n")

    async def write_heartbeat(self):
        heartbeat = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "assets": self.assets,
            "mode": self.mode,
            "positions": list(self.positions.keys()),
            "volatilities": self.volatilities,
            "position_sizes": self.position_sizes,
            "rsi_values": self.last_rsi,
            "consecutive_failures": self.consecutive_failures
        }
        async with aiofiles.open(self.heartbeat_file, "w") as f:
            await f.write(json.dumps(heartbeat, indent=2))

    async def run(self):
        print(f"Starting trading loop in {self.mode} mode...", flush=True)
        print(f"Watching assets: {', '.join(self.assets)}", flush=True)
        await alerts.alert(f"?? <b>Hermes Trading Started</b>\n\nAssets: {', '.join(self.assets)}\nMode: {self.mode}\nVolatility-weighted sizing: ON")
        
        while True:
            try:
                self.loop_count += 1
                print(f"\n--- Loop {self.loop_count} at {datetime.now(timezone.utc).isoformat()} ---", flush=True)
                _gpath = self.state_dir / "goal.yaml"
                if _gpath.exists():
                    try:
                        with open(_gpath) as _f:
                            _fresh = yaml.safe_load(_f) or {}
                        if "assets" in _fresh:
                            _new = [a["symbol"] for a in _fresh["assets"]]
                            if _new != self.assets:
                                print(f"[goal-reload] {self.assets} -> {_new}", flush=True)
                                self.assets = _new
                                self.goal = _fresh
                    except Exception as _e:
                        print(f"[goal-reload] failed: {_e}", flush=True)
                strategy = self.load_strategy()
                
                for asset in self.assets:
                    print(f"\n[{asset}] Fetching data...", flush=True)
                    data = await self.fetch_asset_data(asset)
                    
                    if data is None:
                        print(f"[{asset}] Failed to fetch data", flush=True)
                        continue
                    
                    price_info = data.get("price", {})
                    rsi = price_info.get("rsi", 50)
                    close = price_info.get("close", 0)
                    volatility = price_info.get("volatility", 0)
                    self.volatilities[asset] = volatility
                    self.last_rsi[asset] = rsi
                    
                    asset_strategy = strategy.get("assets", {}).get(asset, {})
                    threshold = asset_strategy.get("entry", {}).get("threshold", 30)
                    position_size = self.position_sizes.get(asset, asset_strategy.get("position_size_r", 0.33))
                    
                    print(f"[{asset}]  | RSI: {rsi:.1f} | Vol: {volatility:.2f}% | Size: {position_size*100:.1f}%", flush=True)
                    
                    if asset not in self.positions:
                        if self.evaluate_entry(asset, data, strategy):
                            self.positions[asset] = {
                                "entry_price": close,
                                "entry_time": data["timestamp"],
                                "direction": asset_strategy.get("entry", {}).get("direction", "long"),
                                "size": position_size
                            }
                            print(f"[{asset}] OPENED {self.positions[asset]['direction']} at ", flush=True)
                            await alerts.alert_trade_opened(asset, self.positions[asset]["direction"], close, rsi)
                    else:
                        if self.evaluate_exit(asset, data, strategy):
                            position = self.positions[asset]
                            entry_price = position["entry_price"]
                            pnl_pct = ((close - entry_price) / entry_price) * 100
                            trade = {
                                "id": datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"),
                                "asset": asset,
                                "direction": position["direction"],
                                "entry_price": entry_price,
                                "exit_price": close,
                                "entry_time": position["entry_time"],
                                "exit_time": data["timestamp"],
                                "pnl_pct": round(pnl_pct, 4),
                                "size": position["size"],
                                "strategy_version": strategy.get("version", "01"),
                                "mode": self.mode
                            }
                            await self.log_trade(trade)
                            print(f"[{asset}] CLOSED at  | PnL: {pnl_pct:+.2f}%", flush=True)
                            await alerts.alert_trade_closed(asset, position["direction"], entry_price, close, pnl_pct)
                            del self.positions[asset]
                
                # Recalculate position sizes every hour
                if self.loop_count % self.rebalance_interval == 0:
                    await self.update_position_sizes()
                
                await self.write_heartbeat()
                self.consecutive_failures = 0
                print("\nSleeping 60 seconds...", flush=True)
                await asyncio.sleep(60)
                
            except Exception as e:
                print(f"Loop error: {e}", flush=True)
                import traceback
                traceback.print_exc()
                self.consecutive_failures += 1
                if self.consecutive_failures >= self.max_consecutive_failures:
                    print("Circuit breaker triggered. Halting loop.", flush=True)
                    await alerts.alert_error("Circuit Breaker", str(e))
                    break
                await asyncio.sleep(60)
