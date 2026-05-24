import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
import yaml

def load_trades(trades_file: Path, limit: int = 25) -> list:
    if not trades_file.exists():
        return []
    trades = []
    with open(trades_file) as f:
        for line in f:
            if line.strip():
                trades.append(json.loads(line))
    return trades[-limit:]

def load_strategy(strategy_file: Path) -> dict:
    if not strategy_file.exists():
        return {"version": "01", "entry": {"indicator": "rsi", "threshold": 30, "direction": "long"}, "stop_loss_pct": 2.0, "position_size_r": 0.5}
    with open(strategy_file) as f:
        return yaml.safe_load(f)

def load_goal(goal_file: Path) -> dict:
    with open(goal_file) as f:
        return yaml.safe_load(f)

def save_strategy(strategy: dict, strategy_file: Path, history_dir: Path):
    if strategy_file.exists():
        current = load_strategy(strategy_file)
        old_version = current.get("version", "01")
        archive_path = history_dir / f"v{old_version}.yaml"
        shutil.copy(strategy_file, archive_path)
    with open(strategy_file, "w") as f:
        yaml.dump(strategy, f, default_flow_style=False)

def append_hypothesis(hypothesis: dict, hypotheses_file: Path):
    with open(hypotheses_file, "a") as f:
        f.write(json.dumps(hypothesis) + "\n")

def bump_version(version: str) -> str:
    try:
        num = int(version)
        return f"{num + 1:02d}"
    except ValueError:
        return "02"

def fallback_reflect(state_dir: Path):
    trades_file = state_dir / "trades.jsonl"
    strategy_file = state_dir / "strategy.yaml"
    goal_file = state_dir / "goal.yaml"
    history_dir = state_dir / "history"
    hypotheses_file = state_dir / "hypotheses.jsonl"
    history_dir.mkdir(exist_ok=True)
    trades = load_trades(trades_file)
    strategy = load_strategy(strategy_file)
    goal = load_goal(goal_file)
    if len(trades) < 1:
        print("No trades to reflect on yet.")
        return
    total_pnl = sum(t.get("pnl_pct", 0) for t in trades)
    avg_pnl = total_pnl / len(trades)
    cumulative = 0
    peak = 0
    max_dd = 0
    for t in trades:
        cumulative += t.get("pnl_pct", 0)
        peak = max(peak, cumulative)
        dd = peak - cumulative
        max_dd = max(max_dd, dd)
    target_return = goal.get("target_return_30d", 0.05) * 100
    max_drawdown = goal.get("max_drawdown", 0.08) * 100
    hypothesis = {"timestamp": datetime.now(timezone.utc).isoformat(), "trades_analyzed": len(trades), "avg_pnl_pct": round(avg_pnl, 4), "max_drawdown_pct": round(max_dd, 4), "mode": "fallback"}
    changed = False
    if max_dd > max_drawdown and not changed:
        old_val = strategy.get("stop_loss_pct", 2.0)
        new_val = max(0.5, old_val - 0.2)
        strategy["stop_loss_pct"] = round(new_val, 2)
        hypothesis["variable_changed"] = "stop_loss_pct"
        hypothesis["old_value"] = old_val
        hypothesis["new_value"] = new_val
        hypothesis["reasoning"] = f"Drawdown {max_dd:.2f}% exceeded max {max_drawdown:.2f}%. Tightening stop loss."
        changed = True
    if avg_pnl < (target_return / 30) and not changed:
        old_val = strategy.get("entry", {}).get("threshold", 30)
        new_val = min(40, old_val + 2)
        strategy.setdefault("entry", {})["threshold"] = new_val
        hypothesis["variable_changed"] = "entry.threshold"
        hypothesis["old_value"] = old_val
        hypothesis["new_value"] = new_val
        hypothesis["reasoning"] = f"Avg return {avg_pnl:.2f}% below daily target. Loosening entry threshold."
        changed = True
    if not changed:
        print("No changes needed based on current performance.")
        hypothesis["variable_changed"] = None
        hypothesis["reasoning"] = "Performance within acceptable bounds."
    else:
        old_version = strategy.get("version", "01")
        strategy["version"] = bump_version(old_version)
        save_strategy(strategy, strategy_file, history_dir)
        print(f"Strategy updated: v{old_version} -> v{strategy['version']}")
        print(f"Changed: {hypothesis['variable_changed']}")
        print(f"Reasoning: {hypothesis['reasoning']}")
    append_hypothesis(hypothesis, hypotheses_file)

def main():
    parser = argparse.ArgumentParser(description="Reflection cycle for Hermes Trading")
    parser.add_argument("--fallback", action="store_true", help="Use deterministic fallback")
    parser.add_argument("--hermes", action="store_true", help="Use Hermes for reflection")
    parser.add_argument("--state-dir", type=str, default="/app/state", help="State directory path")
    args = parser.parse_args()
    state_dir = Path(args.state_dir)
    if not state_dir.exists():
        state_dir = Path.home() / "hermes-trading" / "state"
    if args.hermes:
        print("Hermes mode not yet implemented, using fallback")
        fallback_reflect(state_dir)
    else:
        fallback_reflect(state_dir)

if __name__ == "__main__":
    main()
