import json
from pathlib import Path
from datetime import datetime

def show_dashboard(state_dir: Path):
    trades_file = state_dir / "trades.jsonl"
    strategy_file = state_dir / "strategy.yaml"
    
    trades = []
    if trades_file.exists():
        with open(trades_file) as f:
            for line in f:
                if line.strip():
                    trades.append(json.loads(line))
    
    # Calculate stats
    if not trades:
        print("\n" + "="*50)
        print("  HERMES TRADING DASHBOARD")
        print("="*50)
        print("\n  No trades yet. Waiting for RSI < threshold...\n")
        return
    
    total_trades = len(trades)
    winners = [t for t in trades if t.get("pnl_pct", 0) > 0]
    losers = [t for t in trades if t.get("pnl_pct", 0) <= 0]
    
    total_pnl = sum(t.get("pnl_pct", 0) for t in trades)
    win_rate = (len(winners) / total_trades * 100) if total_trades > 0 else 0
    avg_win = sum(t.get("pnl_pct", 0) for t in winners) / len(winners) if winners else 0
    avg_loss = sum(t.get("pnl_pct", 0) for t in losers) / len(losers) if losers else 0
    
    # Max drawdown
    cumulative = 0
    peak = 0
    max_dd = 0
    for t in trades:
        cumulative += t.get("pnl_pct", 0)
        peak = max(peak, cumulative)
        dd = peak - cumulative
        max_dd = max(max_dd, dd)
    
    # Sharpe (simplified)
    import math
    returns = [t.get("pnl_pct", 0) for t in trades]
    if len(returns) > 1:
        mean_ret = sum(returns) / len(returns)
        variance = sum((r - mean_ret) ** 2 for r in returns) / (len(returns) - 1)
        std_dev = math.sqrt(variance) if variance > 0 else 0.0001
        sharpe = (mean_ret / std_dev) * math.sqrt(252) if std_dev > 0 else 0
    else:
        sharpe = 0
    
    # Current strategy
    strategy_version = "?"
    if strategy_file.exists():
        import yaml
        with open(strategy_file) as f:
            strat = yaml.safe_load(f)
            strategy_version = strat.get("version", "?")
    
    # Display
    print("\n" + "="*50)
    print("  HERMES TRADING DASHBOARD")
    print("="*50)
    print(f"\n  Strategy Version:  v{strategy_version}")
    print(f"  Total Trades:      {total_trades}")
    print(f"  Win Rate:          {win_rate:.1f}%")
    print(f"  Total P&L:         {total_pnl:+.2f}%")
    print(f"  Avg Winner:        {avg_win:+.2f}%")
    print(f"  Avg Loser:         {avg_loss:+.2f}%")
    print(f"  Max Drawdown:      {max_dd:.2f}%")
    print(f"  Sharpe Ratio:      {sharpe:.2f}")
    print("\n  Recent Trades:")
    print("  " + "-"*46)
    
    for t in trades[-5:]:
        pnl = t.get("pnl_pct", 0)
        symbol = "+" if pnl > 0 else ""
        exit_time = t.get("exit_time", "")[:10]
        print(f"  {exit_time}  {t.get('direction', '?'):5}  {symbol}{pnl:.2f}%  v{t.get('strategy_version', '?')}")
    
    print("\n" + "="*50 + "\n")

if __name__ == "__main__":
    show_dashboard(Path(r"C:\Hermes\hermes-trading\state"))
