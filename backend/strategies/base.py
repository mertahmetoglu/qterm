"""The interface every strategy implements, so backtest.py can run any of them
under identical execution rules.

The split is deliberate. A *strategy* decides only three things: when to enter,
in which direction, and where its stop and target sit. The *executor*
(backtest.simulate) owns everything about how that intent becomes a filled
trade -- next-bar fill, slippage, fees, forward-scanning for SL/TP, time stops,
one-position-at-a-time. A strategy therefore cannot give itself an optimistic
fill even by accident, and any two strategies are always compared under exactly
the same execution assumptions. That's the whole point of comparing them.
"""
from dataclasses import dataclass, field


@dataclass
class EntrySignal:
    """A decision made on candle `signal_idx`'s close.

    The executor fills it at candle signal_idx+1's open, so a strategy never
    sees its own fill bar -- this is the no-lookahead guarantee, enforced in
    one place rather than trusted to each strategy.

    Stop and target can be expressed three ways, because different strategies
    naturally think in different units:
      - `sl` / `tp`      absolute prices (structure-based: "stop below the
                         previous swing low")
      - `sl_pct`/`tp_pct` fractions of the fill price ("0.5% stop", or an
                         ATR distance converted to a fraction on the signal bar)
      - `tp_r`           target as a multiple of the *actual* risk taken,
                         which can only be resolved once the fill is known
    """
    signal_idx: int
    direction: str                      # "LONG" | "SHORT"
    sl: float | None = None
    tp: float | None = None
    sl_pct: float | None = None
    tp_pct: float | None = None
    tp_r: float | None = None
    meta: dict = field(default_factory=dict)

    def levels(self, fill_price):
        """Resolve to absolute (sl, tp) prices given the actual fill price."""
        sign = 1 if self.direction == "LONG" else -1
        sl = self.sl if self.sl is not None else fill_price * (1 - sign * self.sl_pct)
        if self.tp is not None:
            tp = self.tp
        elif self.tp_r is not None:
            tp = fill_price + sign * self.tp_r * abs(fill_price - sl)
        else:
            tp = fill_price * (1 + sign * self.tp_pct)
        return sl, tp


class Strategy:
    """Subclasses override `name`, the defaults, and `generate`."""

    name = "base"
    description = ""
    default_interval = "15m"
    default_max_hold_bars = 96

    # Two execution shapes are supported, because they are genuinely different
    # kinds of strategy and forcing one into the other would misreport it:
    #
    #   False  entry/stop/target. A trade is opened, then closed by TP, SL or
    #          the hold limit. Between trades the account is flat.
    #   True   always in the market. There is no stop and no target; the
    #          position is held until the opposite signal flips it. This is
    #          what a TradingView `strategy.entry` in both directions does.
    always_in_market = False

    # Only meaningful when always_in_market is True: on a short signal, exit to
    # flat instead of reversing. Needed for venues where retail short selling
    # is unavailable or restricted, which includes Borsa Istanbul equities.
    long_only = False

    def generate(self, candles):
        """Return EntrySignals in chronological order.

        Signals may overlap in time; the executor drops any that fire while a
        position is still open, so strategies don't track position state
        themselves.

        `candles` are dicts from market_data.parse_kline: open_time, open,
        high, low, close, volume, close_time.
        """
        raise NotImplementedError

    def params(self):
        """Strategy configuration, recorded in the backtest result JSON so a
        published number can always be traced back to the exact rules."""
        return {}

    def describe(self):
        return {"name": self.name, "description": self.description, "params": self.params()}
