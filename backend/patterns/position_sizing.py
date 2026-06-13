"""
Position sizing and portfolio risk management for HTF trades.

Wraps the pattern detector output into a ready-to-trade recommendation:
how many shares to buy, how much capital that uses, and how it affects
overall portfolio risk.

Usage:
    from position_sizing import AccountConfig, size_position, PortfolioState

    config = AccountConfig(capital=7000.0)
    rec = size_position(hit, config)
    print(rec.recommended_shares, rec.position_value, rec.actual_risk)

    # Check against open portfolio
    portfolio = PortfolioState.load("portfolio.json")
    can_take, reason = portfolio.can_add_position(rec, hit, config)

CAPITAL-PRESERVATION RULES (docs/RULES.md §6) — 1:1 with the TS port
(server/signals/risk/position-sizing.ts). §6 is THE success bar: "don't
lose money" = positive expectancy + controlled drawdown, NOT beating SPY.
The hard numbers come from the trading books in docs/books/:

  - max_risk_per_trade_pct = 0.02  -> never risk >2% of the account on one
    trade (Aziz, *Mastering Trading Psychology*). Was 0.10 = 5x too hot.
  - stop_loss_max_pct      = 0.08  -> cut every loss at <=8% from cost
    (O'Neil, *How to Make Money in Stocks*). A wider stop only warns; the 2%
    risk cap already shrinks the share count so total risk stays <=2%.
  - max_chase_pct          = 0.05  -> never enter >5% above the pivot
    (O'Neil). Surfaced via entry_is_chased() for the engine/bot.
  - max_daily_loss_pct     = 0.01  /  max_weekly_loss_pct = 0.03 -> Aziz
    circuit-breaker. Config + helpers (daily_loss_breached/weekly_loss_breached)
    land now; ENFORCEMENT is the trading-bot loop (not yet built).
  - assumed_spread_dollars = 0.10  -> price-scaled slippage; a $5 name pays
    far more spread than a $50 name (O'Neil O7 + *Liquidity, Markets and
    Trading in Action*). See effective_slippage_pct().
  - Never average down -> can_add_position() blocks adding to ANY held symbol
    (O'Neil + Aziz). See the comment there.

Keep in 1:1 parity with the TS port (npm run htf:parity).
"""

from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import Optional
import json
import os
import math
from datetime import datetime

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from patterns._common import PatternHit


# ---------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------
@dataclass
class AccountConfig:
    """Account-level risk parameters. All thresholds tunable as capital grows."""
    capital: float = 7000.0
    max_risk_per_trade_pct: float = 0.02        # 2% of capital (Aziz — never risk >2% on one trade)
    max_position_pct: float = 0.25              # 25% of capital max in one name
    max_simultaneous_positions: int = 5
    max_sector_exposure_pct: float = 0.40       # 40% in one sector
    max_total_open_risk_pct: float = 0.30       # 30% of capital at risk at any time
    min_reward_risk_ratio: float = 2.0          # require 2:1 reward/risk
    commission_per_trade: float = 0.0           # broker-specific
    slippage_pct: float = 0.002                 # 0.2% on entry+exit
    stop_loss_max_pct: float = 0.08             # cut every loss at <=8% from cost (O'Neil)
    max_chase_pct: float = 0.05                 # never enter >5% above the pivot (O'Neil)
    max_daily_loss_pct: float = 0.01            # stop for the day at 1% realized loss (Aziz)
    max_weekly_loss_pct: float = 0.03           # stop for the week at 3% realized loss (Aziz)
    assumed_spread_dollars: float = 0.10        # assumed bid/ask spread $ (O'Neil O7 + liquidity book)

    @property
    def max_risk_per_trade(self) -> float:
        return self.capital * self.max_risk_per_trade_pct

    @property
    def max_position_size(self) -> float:
        return self.capital * self.max_position_pct

    @property
    def max_total_open_risk(self) -> float:
        return self.capital * self.max_total_open_risk_pct

    @property
    def max_sector_exposure(self) -> float:
        return self.capital * self.max_sector_exposure_pct

    @classmethod
    def from_file(cls, path: str) -> "AccountConfig":
        with open(path) as f:
            return cls(**json.load(f))

    def save(self, path: str):
        with open(path, "w") as f:
            json.dump(asdict(self), f, indent=2)


# ---------------------------------------------------------------------
# Capital-preservation helpers (docs/RULES.md §6)
# ---------------------------------------------------------------------
def entry_is_chased(current_price: float, pivot_price: float,
                    config: AccountConfig) -> bool:
    """
    O'Neil: never chase an entry more than max_chase_pct above the pivot.
    True when current_price has run > pivot_price * (1 + max_chase_pct).
    """
    if pivot_price <= 0:
        return False
    return current_price > pivot_price * (1 + config.max_chase_pct)


def daily_loss_breached(realized_today_pct: float, config: AccountConfig) -> bool:
    """
    Aziz circuit-breaker: stop trading for the DAY once realized losses for
    today reach max_daily_loss_pct of the account. `realized_today_pct` is a
    signed fraction of capital (a 1% loss is -0.01). True = breached.
    ENFORCED by the trading-bot loop (not yet built) — config + helper land now.
    """
    return realized_today_pct <= -config.max_daily_loss_pct


def weekly_loss_breached(realized_this_week_pct: float, config: AccountConfig) -> bool:
    """
    Aziz circuit-breaker: stop trading for the WEEK once realized losses for
    the week reach max_weekly_loss_pct of the account. `realized_this_week_pct`
    is a signed fraction of capital (a 3% loss is -0.03). True = breached.
    ENFORCED by the trading-bot loop (not yet built) — config + helper land now.
    """
    return realized_this_week_pct <= -config.max_weekly_loss_pct


def effective_slippage_pct(price: float, config: AccountConfig) -> float:
    """
    Price-scaled slippage (O'Neil O7 + the liquidity book): flat slippage_pct
    PLUS half the assumed bid/ask spread as a fraction of price. A $5 name pays
    far more spread, proportionally, than a $50 name. Exported for the
    validation harness + bot (and applied wherever slippage is modeled).
    """
    if price <= 0:
        return config.slippage_pct
    return config.slippage_pct + (config.assumed_spread_dollars / 2) / price


# ---------------------------------------------------------------------
# Position recommendation
# ---------------------------------------------------------------------
@dataclass
class PositionRecommendation:
    """Output of sizing a single pattern hit."""
    symbol: str
    entry_price: float
    stop_price: float
    target_price: float
    risk_per_share: float
    reward_per_share: float
    reward_risk_ratio: float
    max_shares_by_risk: int             # capped by max_risk_per_trade
    max_shares_by_position: int         # capped by max_position_size
    recommended_shares: int             # min of above
    position_value: float
    actual_risk: float                  # actual $ at risk with chosen size
    pct_of_capital: float
    expected_profit_at_target: float
    warnings: list[str] = field(default_factory=list)
    blocked_reason: Optional[str] = None     # set if trade should NOT be taken

    @property
    def is_actionable(self) -> bool:
        return self.blocked_reason is None and self.recommended_shares > 0

    def to_dict(self):
        return asdict(self)

    def format_summary(self) -> str:
        """One-line trader-friendly summary."""
        if self.blocked_reason:
            return f"{self.symbol} BLOCKED: {self.blocked_reason}"
        msg = (f"{self.symbol} @ ${self.entry_price:.2f}: "
               f"BUY {self.recommended_shares} sh = "
               f"${self.position_value:,.0f} "
               f"({self.pct_of_capital*100:.1f}% capital, "
               f"${self.actual_risk:.0f} risk, "
               f"R/R {self.reward_risk_ratio:.1f}:1)")
        if self.warnings:
            msg += f"  ⚠ {'; '.join(self.warnings)}"
        return msg


def size_position(hit: PatternHit, config: AccountConfig) -> PositionRecommendation:
    """
    Given a PatternHit, compute the recommended position size.

    Logic:
        risk_per_share = entry - stop
        max_shares_by_risk = floor(max_risk_per_trade / risk_per_share)
        max_shares_by_position = floor(max_position_size / entry)
        recommended = min(both)

    Returns a recommendation even if it has to be blocked — caller decides.
    """
    entry = hit.breakout_price
    stop = hit.stop_price
    target = hit.target_price

    warnings = []
    blocked = None

    # Sanity checks
    if entry <= 0 or stop <= 0:
        return PositionRecommendation(
            symbol=hit.symbol, entry_price=entry, stop_price=stop,
            target_price=target, risk_per_share=0, reward_per_share=0,
            reward_risk_ratio=0, max_shares_by_risk=0,
            max_shares_by_position=0, recommended_shares=0,
            position_value=0, actual_risk=0, pct_of_capital=0,
            expected_profit_at_target=0,
            blocked_reason="invalid entry/stop prices",
        )

    if hit.direction == "long":
        risk_per_share = entry - stop
        reward_per_share = target - entry
    else:  # short
        risk_per_share = stop - entry
        reward_per_share = entry - target

    if risk_per_share <= 0:
        return PositionRecommendation(
            symbol=hit.symbol, entry_price=entry, stop_price=stop,
            target_price=target, risk_per_share=risk_per_share,
            reward_per_share=reward_per_share, reward_risk_ratio=0,
            max_shares_by_risk=0, max_shares_by_position=0,
            recommended_shares=0, position_value=0,
            actual_risk=0, pct_of_capital=0, expected_profit_at_target=0,
            blocked_reason="stop is on wrong side of entry",
        )

    reward_risk_ratio = reward_per_share / risk_per_share if risk_per_share > 0 else 0

    # Shares cap by risk
    max_by_risk = math.floor(config.max_risk_per_trade / risk_per_share)
    # Shares cap by position size
    max_by_position = math.floor(config.max_position_size / entry)
    recommended = min(max_by_risk, max_by_position)

    if recommended < 1:
        blocked = (f"unaffordable: 1 share = ${entry:.2f} exceeds "
                   f"max position ${config.max_position_size:.0f}")
    elif reward_risk_ratio < 1.0:
        blocked = (f"reward/risk {reward_risk_ratio:.1f}:1 — losing trade by design "
                   f"(target $-{abs(target-entry):.2f} vs stop $-{risk_per_share:.2f})")

    position_value = recommended * entry
    actual_risk = recommended * risk_per_share
    pct_capital = position_value / config.capital if config.capital > 0 else 0
    expected_profit = recommended * reward_per_share

    # Warnings (non-blocking)
    if reward_risk_ratio < config.min_reward_risk_ratio:
        warnings.append(
            f"R/R {reward_risk_ratio:.1f} below min {config.min_reward_risk_ratio}"
        )
    if pct_capital > 0.20:
        warnings.append(f"large position ({pct_capital*100:.0f}% of capital)")
    if pct_capital < 0.05 and recommended > 0:
        warnings.append(f"tiny position ({pct_capital*100:.0f}% — may not be worth commissions)")
    if hit.quality_score < 70:
        warnings.append(f"low quality score ({hit.quality_score})")

    # If risk cap bites first (cheap stock, tight stop), good — we're efficient
    # If position cap bites first (expensive stock, wide stop), warn user
    if max_by_position < max_by_risk:
        warnings.append("position-cap limited (wide stop on expensive stock)")

    # O'Neil: cut every loss at <=8% from cost. A wider stop is NOT blocked (the
    # 2% per-trade risk cap already shrank the share count to keep risk <=2%), but
    # it earns a warning so the trader sees the stop is past O'Neil's max.
    stop_pct = (entry - stop) / entry if entry > 0 else 0
    if stop_pct > config.stop_loss_max_pct:
        warnings.append(
            f"stop {round(stop_pct * 100)}% below entry exceeds your "
            f"{round(config.stop_loss_max_pct * 100)}% max (O'Neil) — position "
            f"auto-sized down to keep risk ≤{round(config.max_risk_per_trade_pct * 100)}%"
        )

    return PositionRecommendation(
        symbol=hit.symbol,
        entry_price=entry, stop_price=stop, target_price=target,
        risk_per_share=risk_per_share, reward_per_share=reward_per_share,
        reward_risk_ratio=reward_risk_ratio,
        max_shares_by_risk=max_by_risk,
        max_shares_by_position=max_by_position,
        recommended_shares=recommended,
        position_value=position_value, actual_risk=actual_risk,
        pct_of_capital=pct_capital,
        expected_profit_at_target=expected_profit,
        warnings=warnings, blocked_reason=blocked,
    )


# ---------------------------------------------------------------------
# Portfolio state and risk checks
# ---------------------------------------------------------------------
@dataclass
class OpenPosition:
    symbol: str
    sector: str
    shares: int
    entry_price: float
    stop_price: float
    entry_date: str
    current_price: Optional[float] = None     # updated externally

    @property
    def position_value(self) -> float:
        price = self.current_price or self.entry_price
        return self.shares * price

    @property
    def at_risk(self) -> float:
        """How much $ is at risk if stop hits, from current price."""
        # Risk shrinks as price moves up (stop trails up too in Givens' system,
        # but we use the original stop here for conservative accounting)
        return max(0, self.shares * (self.entry_price - self.stop_price))


@dataclass
class PortfolioState:
    positions: list[OpenPosition] = field(default_factory=list)

    @classmethod
    def load(cls, path: str) -> "PortfolioState":
        if not os.path.exists(path):
            return cls()
        with open(path) as f:
            data = json.load(f)
        return cls(positions=[OpenPosition(**p) for p in data.get("positions", [])])

    def save(self, path: str):
        with open(path, "w") as f:
            json.dump({"positions": [asdict(p) for p in self.positions]}, f, indent=2)

    @property
    def total_value(self) -> float:
        return sum(p.position_value for p in self.positions)

    @property
    def total_open_risk(self) -> float:
        return sum(p.at_risk for p in self.positions)

    def sector_exposure(self, sector: str) -> float:
        return sum(p.position_value for p in self.positions if p.sector == sector)

    def can_add_position(self, rec: PositionRecommendation,
                          hit: PatternHit, config: AccountConfig,
                          sector: str = "Unknown") -> tuple[bool, str]:
        """
        Returns (allowed, reason). Reason is empty when allowed.
        Apply portfolio-level risk rules.
        """
        if not rec.is_actionable:
            return False, rec.blocked_reason or "not actionable"

        # Never average down (O'Neil + Aziz): blocking adds to ANY already-held
        # symbol enforces this — you can't pour more capital into an open loser.
        if any(p.symbol == hit.symbol for p in self.positions):
            return False, f"already hold {hit.symbol}"

        # Max simultaneous positions
        if len(self.positions) >= config.max_simultaneous_positions:
            return False, (f"at max positions "
                           f"({len(self.positions)}/{config.max_simultaneous_positions})")

        # Total open risk
        new_total_risk = self.total_open_risk + rec.actual_risk
        if new_total_risk > config.max_total_open_risk:
            return False, (f"would exceed max open risk: "
                           f"${new_total_risk:.0f} > ${config.max_total_open_risk:.0f}")

        # Sector concentration
        new_sector_exposure = self.sector_exposure(sector) + rec.position_value
        if new_sector_exposure > config.max_sector_exposure:
            return False, (f"would exceed {sector} sector cap: "
                           f"${new_sector_exposure:.0f} > ${config.max_sector_exposure:.0f}")

        return True, ""

    def add_position(self, rec: PositionRecommendation, hit: PatternHit,
                     sector: str = "Unknown"):
        self.positions.append(OpenPosition(
            symbol=hit.symbol, sector=sector,
            shares=rec.recommended_shares,
            entry_price=rec.entry_price,
            stop_price=rec.stop_price,
            entry_date=datetime.now().strftime("%Y-%m-%d"),
        ))

    def remove_position(self, symbol: str):
        self.positions = [p for p in self.positions if p.symbol != symbol]

    def status_summary(self, config: AccountConfig) -> dict:
        """Snapshot for UI display."""
        return {
            "n_open": len(self.positions),
            "max_open": config.max_simultaneous_positions,
            "capacity_remaining": config.max_simultaneous_positions - len(self.positions),
            "total_value": round(self.total_value, 2),
            "total_open_risk": round(self.total_open_risk, 2),
            "max_open_risk": round(config.max_total_open_risk, 2),
            "open_risk_pct": round(
                self.total_open_risk / config.max_total_open_risk * 100, 1
            ) if config.max_total_open_risk > 0 else 0,
            "cash_remaining_estimate": round(config.capital - self.total_value, 2),
            "positions": [
                {
                    "symbol": p.symbol, "sector": p.sector,
                    "shares": p.shares, "entry": p.entry_price,
                    "stop": p.stop_price, "value": round(p.position_value, 2),
                    "at_risk": round(p.at_risk, 2),
                }
                for p in self.positions
            ],
        }


# ---------------------------------------------------------------------
# CLI / smoke test
# ---------------------------------------------------------------------
if __name__ == "__main__":
    # Demo: take the RKLB May 11 breakout from our earlier work
    print("=" * 70)
    print("POSITION SIZING DEMO — $7,000 account, 2% max risk")
    print("=" * 70)

    config = AccountConfig(capital=7000.0)
    print(f"\nConfig: ${config.capital} capital, "
          f"${config.max_risk_per_trade:.0f} max risk/trade, "
          f"${config.max_position_size:.0f} max position\n")

    # Synthetic hits at different price points to show how sizing scales
    test_cases = [
        # (symbol, entry, stop, target, score)
        ("RKLB",   105.27,  74.00, 130.00, 85),  # Real May 11 breakout
        ("LUNR",    23.59,  19.00,  32.00, 75),
        ("BKSY",    41.38,  33.00,  55.00, 75),
        ("CHEAP",    4.50,   3.60,   8.00, 80),  # Low-priced stock
        ("EXPENSIVE", 95.00, 80.00, 130.00, 80),  # High-priced, wide stop
        ("BADRR",   30.00,  25.00,  32.00, 75),  # Bad reward/risk
    ]

    portfolio = PortfolioState()

    for symbol, entry, stop, target, score in test_cases:
        # Fake a PatternHit
        import pandas as pd
        hit = PatternHit(
            symbol=symbol, pattern="HTF_Givens", direction="long",
            breakout_date=pd.Timestamp.now(), breakout_price=entry,
            target_price=target, stop_price=stop, quality_score=score,
            pattern_start=pd.Timestamp.now(), pattern_end=pd.Timestamp.now(),
            extras={},
        )
        rec = size_position(hit, config)
        print(rec.format_summary())

        # Check portfolio rules
        allowed, reason = portfolio.can_add_position(rec, hit, config,
                                                     sector="Aerospace")
        if allowed:
            portfolio.add_position(rec, hit, sector="Aerospace")
            print(f"    ✓ added to portfolio")
        else:
            print(f"    ✗ portfolio rule: {reason}")
        print()

    print("=" * 70)
    print("PORTFOLIO STATUS")
    print("=" * 70)
    status = portfolio.status_summary(config)
    for k, v in status.items():
        if k != "positions":
            print(f"  {k:<28} {v}")
    print(f"\n  Open positions:")
    for p in status["positions"]:
        print(f"    {p['symbol']:<6} {p['shares']:>4} sh × ${p['entry']:>6.2f} "
              f"= ${p['value']:>7.2f}  (risk ${p['at_risk']:.0f})")
