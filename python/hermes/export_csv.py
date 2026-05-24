import json
import csv
from pathlib import Path
from datetime import datetime

def export_trades_to_csv(state_dir: Path):
    trades_file = state_dir / "trades.jsonl"
    csv_file = state_dir / "trades.csv"
    
    if not trades_file.exists():
        print("No trades file found.")
        return
    
    trades = []
    with open(trades_file) as f:
        for line in f:
            if line.strip():
                trades.append(json.loads(line))
    
    if not trades:
        print("No trades to export.")
        return
    
    # Write CSV
    with open(csv_file, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "id", "asset", "direction", "entry_price", "exit_price",
            "entry_time", "exit_time", "pnl_pct", "size", "strategy_version", "mode"
        ])
        writer.writeheader()
        writer.writerows(trades)
    
    print(f"Exported {len(trades)} trades to {csv_file}")

if __name__ == "__main__":
    export_trades_to_csv(Path(r"C:\Hermes\hermes-trading\state"))
