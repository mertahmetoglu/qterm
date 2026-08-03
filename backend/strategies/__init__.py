"""Strategy registry. Adding a strategy means adding one module here and
nothing else -- backtest.py discovers it by name via --strategy.
"""
from strategies.base import EntrySignal, Strategy
from strategies.confluence import ConfluenceStrategy
from strategies.powell_1000 import Powell1000Strategy, PowellOpeningRangeStrategy
from strategies.powell_open import PowellOpenContinuationStrategy, PowellOpenStrategy

STRATEGIES = {
    ConfluenceStrategy.name: ConfluenceStrategy,
    # Faithful reconstruction of the published Powell 10:00 description.
    PowellOpenStrategy.name: PowellOpenStrategy,
    PowellOpenContinuationStrategy.name: PowellOpenContinuationStrategy,
    # Earlier readings, kept so the write-up can show what was tried and why
    # it was wrong rather than quietly deleting it.
    Powell1000Strategy.name: Powell1000Strategy,
    PowellOpeningRangeStrategy.name: PowellOpeningRangeStrategy,
}

__all__ = ["EntrySignal", "Strategy", "STRATEGIES", "get_strategy"]


def get_strategy(name, **kwargs):
    if name not in STRATEGIES:
        available = ", ".join(sorted(STRATEGIES))
        raise KeyError(f"unknown strategy {name!r}; available: {available}")
    return STRATEGIES[name](**kwargs)
