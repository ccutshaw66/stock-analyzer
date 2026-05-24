import math
from typing import List

def calculate_sharpe(returns: List[float], risk_free_rate: float = 0.0) -> float:
    if len(returns) < 2:
        return 0.0
    mean_return = sum(returns) / len(returns)
    variance = sum((r - mean_return) ** 2 for r in returns) / (len(returns) - 1)
    std_dev = math.sqrt(variance) if variance > 0 else 0.0001
    annualized_return = mean_return * 252
    annualized_std = std_dev * math.sqrt(252)
    return (annualized_return - risk_free_rate) / annualized_std if annualized_std > 0 else 0.0

def calculate_max_drawdown(returns: List[float]) -> float:
    if not returns:
        return 0.0
    cumulative = 0.0
    peak = 0.0
    max_dd = 0.0
    for r in returns:
        cumulative += r
        peak = max(peak, cumulative)
        drawdown = (peak - cumulative) / 100
        max_dd = max(max_dd, drawdown)
    return max_dd

def score(trades: List[dict], goal: dict) -> float:
    if not trades:
        return 0.0
    returns = [t.get("pnl_pct", 0) for t in trades]
    total_return = sum(returns) / 100
    max_dd = calculate_max_drawdown(returns)
    sharpe = calculate_sharpe(returns)
    target_return = goal.get("target_return_30d", 0.05)
    max_drawdown = goal.get("max_drawdown", 0.08)
    min_sharpe = goal.get("min_sharpe", 1.2)
    failure_below = goal.get("failure_below", -0.04)
    days_equivalent = len(trades)
    annualized_return = (total_return / days_equivalent) * 30 if days_equivalent > 0 else 0
    if annualized_return >= target_return:
        return_score = min(1.0, annualized_return / target_return)
    elif annualized_return >= 0:
        return_score = annualized_return / target_return
    elif annualized_return >= failure_below:
        return_score = annualized_return / abs(failure_below) * 0.5
    else:
        return_score = -1.0
    if max_dd <= 0:
        dd_score = 1.0
    elif max_dd <= max_drawdown:
        dd_score = 1.0 - (max_dd / max_drawdown)
    else:
        overage = (max_dd - max_drawdown) / max_drawdown
        dd_score = -min(1.0, overage)
    if sharpe >= min_sharpe:
        sharpe_score = 1.0
    elif sharpe >= 0:
        sharpe_score = sharpe / min_sharpe
    else:
        sharpe_score = max(-1.0, sharpe / min_sharpe)
    composite = return_score * 0.4 + dd_score * 0.4 + sharpe_score * 0.2
    return max(-1.0, min(1.0, composite))
