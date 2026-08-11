""""Flow Buy/Sell" -- a TradingView Pine strategy, reduced to what it actually trades.

The published script draws a lot: a Kalman-smoothed support/resistance cloud,
ATR volatility bands, RSI-weighted gradient bar colouring, "Strong Buy" /
"Strong Sell" labels. None of it reaches the order logic. The entry conditions
are:

    signalFilter = input.bool(false, ...)          // default false
    buyCondition  = cross_UP and (not signalFilter or close > smoothedSupportZoneEnd)
    sellCondition = cross_DN and (not signalFilter or close < smoothedResistanceZoneStart)

With `signalFilter` at its default of false, `not signalFilter` is true and the
`or` short-circuits, so both conditions collapse to the bare MACD cross. The
zones, the Kalman filter and the RSI are decoration; RSI only picks which label
gets drawn. What is left is:

    MACD(20, 50, 12) crossover, always in the market, reversing on every cross.

That is what is implemented here, so the backtest measures the strategy rather
than the chart. Enabling `signalFilter` in the original would genuinely change
the rules -- that variant is not implemented, and any claim about this script
should say which of the two it refers to.

Sizing and costs in the Pine header (100% of equity per trade, 0.05% commission)
are handled by the executor and the CLI, not here.
"""
from signal_engine import calc_macd
from strategies.base import EntrySignal, Strategy


class MacdFlipStrategy(Strategy):
    name = "macd_flip"
    description = (
        "Flow Buy/Sell (TradingView): MACD(20,50,12) crossover, always in the market, "
        "reversing long/short on each cross"
    )
    default_interval = "1h"
    always_in_market = True

    def __init__(self, fast=20, slow=50, signal=12, long_only=False):
        self.fast = fast
        self.slow = slow
        self.signal = signal
        self.long_only = long_only

    def params(self):
        return {
            "macd": f"{self.fast}/{self.slow}/{self.signal}",
            "execution": "always in market, reverse on opposite cross",
            "long_only": self.long_only,
            "note": "signalFilter=false in the source, so the S/R cloud and RSI do not gate entries",
        }

    def generate(self, candles):
        closes = [c["close"] for c in candles]
        macd_line, signal_line, _ = calc_macd(closes, self.fast, self.slow, self.signal)

        out = []
        for i in range(1, len(closes)):
            m, mp = macd_line[i], macd_line[i - 1]
            s, sp = signal_line[i], signal_line[i - 1]
            if m is None or mp is None or s is None or sp is None:
                continue
            if mp <= sp and m > s:
                out.append(EntrySignal(signal_idx=i, direction="LONG", meta={"cross": "up"}))
            elif mp >= sp and m < s:
                out.append(EntrySignal(signal_idx=i, direction="SHORT", meta={"cross": "down"}))
        return out


class MacdFlipLongOnlyStrategy(MacdFlipStrategy):
    """Same signals, but a sell cross exits to flat instead of reversing short.

    Registered separately because on Borsa Istanbul equities this is the version
    a retail account could actually run: short selling there is restricted, has
    been suspended outright for extended periods, and is not available on the
    index without derivatives. Reporting only the long/short number would
    describe a strategy most readers cannot trade.
    """

    name = "macd_flip_long"
    description = (
        "Flow Buy/Sell, long-only: MACD(20,50,12) crossover, long on an up-cross, "
        "flat on a down-cross (no shorting)"
    )

    def __init__(self, **kwargs):
        kwargs.setdefault("long_only", True)
        super().__init__(**kwargs)
