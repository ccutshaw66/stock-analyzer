import numpy as np
from typing import Dict, List

def calculate_atr(highs: List[float], lows: List[float], closes: List[float], period: int = 14) -> float:
    """Calculate Average True Range (ATR) for volatility measurement."""
    if len(closes) < period + 1:
        return 0.0
    
    true_ranges = []
    for i in range(1, len(closes)):
        high_low = highs[i] - lows[i]
        high_close = abs(highs[i] - closes[i-1])
        low_close = abs(lows[i] - closes[i-1])
        true_ranges.append(max(high_low, high_close, low_close))
    
    return np.mean(true_ranges[-period:])

def calculate_volatility_pct(closes: List[float], period: int = 14) -> float:
    """Calculate volatility as percentage (standard deviation of returns)."""
    if len(closes) < period + 1:
        return 0.0
    
    returns = []
    for i in range(1, len(closes)):
        ret = (closes[i] - closes[i-1]) / closes[i-1] * 100
        returns.append(ret)
    
    return np.std(returns[-period:])

def calculate_position_sizes(volatilities: Dict[str, float], max_risk_pct: float = 1.0) -> Dict[str, float]:
    """
    Calculate inverse-volatility weighted position sizes.
    Higher volatility = smaller position.
    
    Args:
        volatilities: Dict of asset -> volatility percentage
        max_risk_pct: Maximum risk per trade as percentage
    
    Returns:
        Dict of asset -> position size (0.0 to 1.0)
    """
    if not volatilities:
        return {}
    
    # Filter out zero volatilities
    valid_vols = {k: v for k, v in volatilities.items() if v > 0}
    
    if not valid_vols:
        # Equal weight if no valid volatilities
        equal_weight = 1.0 / len(volatilities)
        return {k: equal_weight for k in volatilities}
    
    # Inverse volatility weighting
    inverse_vols = {k: 1.0 / v for k, v in valid_vols.items()}
    total_inverse = sum(inverse_vols.values())
    
    # Normalize to sum to 1.0
    position_sizes = {k: v / total_inverse for k, v in inverse_vols.items()}
    
    # Add any assets with zero volatility as equal weight of remaining
    for k in volatilities:
        if k not in position_sizes:
            position_sizes[k] = 0.1  # Small default position
    
    # Renormalize
    total = sum(position_sizes.values())
    position_sizes = {k: v / total for k, v in position_sizes.items()}
    
    return position_sizes

def format_position_report(assets: Dict[str, dict]) -> str:
    """Format a nice report of position sizing."""
    lines = ["?? <b>Position Sizing (Volatility-Weighted)</b>\n"]
    
    for asset, data in assets.items():
        vol = data.get("volatility", 0)
        size = data.get("position_size", 0) * 100
        lines.append(f"{asset}: {size:.1f}% (vol: {vol:.2f}%)")
    
    return "\n".join(lines)
