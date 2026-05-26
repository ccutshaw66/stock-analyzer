"""Entry point. `python -m kairos_trading.run --state-dir /app/state`"""
import argparse
import asyncio
from pathlib import Path

from kairos_trading.loop import TradingLoop


def main():
    parser = argparse.ArgumentParser(description="KAIROS bot worker")
    parser.add_argument("--state-dir", type=str, default="/app/state", help="State directory path")
    args = parser.parse_args()
    state_dir = Path(args.state_dir)
    state_dir.mkdir(parents=True, exist_ok=True)

    print(f"Booting kairos-trading worker (state={state_dir})", flush=True)
    loop = TradingLoop(state_dir=state_dir)
    asyncio.run(loop.run())


if __name__ == "__main__":
    main()
