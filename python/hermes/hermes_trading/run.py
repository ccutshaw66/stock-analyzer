import argparse
import asyncio
import yaml
from pathlib import Path
from hermes_trading.loop import TradingLoop

def load_goal(state_dir: Path) -> dict:
    goal_path = state_dir / "goal.yaml"
    if not goal_path.exists():
        raise FileNotFoundError(f"Goal file not found: {goal_path}")
    with open(goal_path) as f:
        return yaml.safe_load(f)

def main():
    parser = argparse.ArgumentParser(description="Hermes Trading Worker")
    parser.add_argument("--state-dir", type=str, default="/app/state", help="State directory path")
    args = parser.parse_args()
    state_dir = Path(args.state_dir)
    if not state_dir.exists():
        state_dir = Path.home() / "hermes-trading" / "state"
    goal = load_goal(state_dir)
    
    # Support both single asset and multi-asset configs
    if "assets" in goal:
        assets = [a["symbol"] for a in goal["assets"]]
    else:
        assets = [goal.get("asset", "BTC/USD")]
    
    print(f"Booting hermes-trading worker")
    print(f"  Assets: {', '.join(assets)}")
    print(f"  Reflection every: {goal.get('reflection_every', 5)} trades")
    
    loop = TradingLoop(assets=assets, state_dir=state_dir, goal=goal)
    asyncio.run(loop.run())

if __name__ == "__main__":
    main()
