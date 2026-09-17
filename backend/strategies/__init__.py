"""Strategy registry. Adding a strategy means adding one module here and
nothing else -- backtest.py discovers it by name via --strategy.
"""
from strategies.base import EntrySignal, Strategy
from strategies.confluence import ConfluenceStrategy
from strategies.macd_flip import MacdFlipLongOnlyStrategy, MacdFlipStrategy

STRATEGIES = {
    ConfluenceStrategy.name: ConfluenceStrategy,
    # TradingView "Flow Buy/Sell", i.e. a MACD(20/50/12) reversal system.
    MacdFlipStrategy.name: MacdFlipStrategy,
    MacdFlipLongOnlyStrategy.name: MacdFlipLongOnlyStrategy,
}

__all__ = ["EntrySignal", "Strategy", "STRATEGIES", "get_strategy"]


def get_strategy(name, **kwargs):
    if name not in STRATEGIES:
        available = ", ".join(sorted(STRATEGIES))
        raise KeyError(f"unknown strategy {name!r}; available: {available}")
    return STRATEGIES[name](**kwargs)
