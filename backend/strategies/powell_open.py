"""Powell 10:00 -- faithful reconstruction from the published description.

This replaces an earlier attempt (strategies/powell_1000.py) that was built
from a second-hand AI summary and got the mechanics materially wrong. The
actual source is a closed-source TradingView indicator, "Pro 10:00 Powell
Strategy [NQ ES]" by Ash_TheTrader. Its exact thresholds are proprietary, so
this is a reconstruction of what the author *does* publish, not a clone:

  published                                  implemented here
  ---------------------------------------    --------------------------------
  "displays the session open price as a       open_level = the OPEN price of
   reference level" at 10:00 New York         the 10:00 America/New_York bar
                                              (one line, not a candle range)
  "waits for price to manipulate a set        displacement_pct away from
   distance (default 15 pts) away from        open_level; 15 NQ points on a
   the open to trap early breakout traders"   ~20,900 index is ~7bp, the default
  "prints ... exactly when the price snaps    entry once price comes back to
   back to retest the true open",             open_level, confirmed on a bar
   "conditions are confirmed on candle close" close; fill on the next bar's open
  "Stop Loss ... based on recent Swing        stop at the session's most adverse
   Highs/Lows"                                extreme since 10:00
  "Take Profit reference level" (undisclosed) tp_r multiple of risk, default 2R
  "designed for Nasdaq (NQ) and S&P500 (ES)"  run on the index CFD proxies
  "recommended timeframes: 1-minute and       5m
   5-minute charts"

The one thing the description genuinely does not settle is **direction**.
"Trap early breakout traders" implies the move away from the open was a
fake-out, which argues for fading it; "retest the true open" as support
argues for continuation. Both are implemented and both are reported --
picking one silently would make the published number a coin flip dressed up
as a result.
"""
import pandas as pd

from strategies.base import EntrySignal, Strategy

NY_TZ = "America/New_York"

# 15 points on a ~20,900 Nasdaq 100 is 0.072%. Expressed as a fraction so the
# same rule transfers to instruments at other price levels.
DEFAULT_DISPLACEMENT_PCT = 0.0007


class PowellOpenStrategy(Strategy):
    name = "powell_open"
    description = (
        "Powell 10:00 ET: mark the 10:00 New York open price, wait for price to displace "
        "a set distance away from it, then trade its return to that level"
    )
    default_interval = "5m"
    default_max_hold_bars = 72          # 6h at 5m -- flat before the US close

    def __init__(self, anchor_hour=10, anchor_minute=0,
                 displacement_pct=DEFAULT_DISPLACEMENT_PCT,
                 displacement_window_bars=24, return_window_bars=24,
                 tp_r=2.0, direction_mode="fade", skip_weekends=True):
        self.anchor_hour = anchor_hour
        self.anchor_minute = anchor_minute
        self.displacement_pct = displacement_pct
        self.displacement_window_bars = displacement_window_bars   # 2h at 5m
        self.return_window_bars = return_window_bars               # 2h at 5m
        self.tp_r = tp_r
        self.direction_mode = direction_mode                       # "fade" | "continuation"
        self.skip_weekends = skip_weekends

    def params(self):
        return {
            "anchor": f"{self.anchor_hour:02d}:{self.anchor_minute:02d} America/New_York",
            "reference": "open price of the anchor bar (single level)",
            "displacement_pct": self.displacement_pct,
            "displacement_window_bars": self.displacement_window_bars,
            "return_window_bars": self.return_window_bars,
            "direction_mode": self.direction_mode,
            "tp_r": self.tp_r,
            "stop": "most adverse extreme since the anchor bar",
            "skip_weekends": self.skip_weekends,
            "one_trade_per_session_day": True,
        }

    def generate(self, candles):
        if not candles:
            return []

        ts = pd.to_datetime([c["open_time"] for c in candles], unit="ms", utc=True).tz_convert(NY_TZ)

        sessions = {}
        for i, t in enumerate(ts):
            sessions.setdefault(t.date(), []).append(i)

        out = []
        for _, idxs in sorted(sessions.items()):
            if self.skip_weekends and ts[idxs[0]].dayofweek >= 5:
                continue
            anchor = next(
                (i for i in idxs
                 if ts[i].hour == self.anchor_hour and ts[i].minute == self.anchor_minute),
                None,
            )
            if anchor is None:
                continue
            sig = self._scan_session(candles, idxs, anchor)
            if sig is not None:
                out.append(sig)

        out.sort(key=lambda s: s.signal_idx)
        return out

    def _scan_session(self, candles, idxs, anchor):
        open_level = candles[anchor]["open"]
        if open_level <= 0:
            return None

        after = [i for i in idxs if i >= anchor]
        threshold = open_level * self.displacement_pct

        # 1. Displacement: first bar to trade a set distance away from the open.
        disp_idx = disp_dir = None
        for i in after[:self.displacement_window_bars]:
            c = candles[i]
            if c["high"] - open_level >= threshold:
                disp_idx, disp_dir = i, "UP"
                break
            if open_level - c["low"] >= threshold:
                disp_idx, disp_dir = i, "DOWN"
                break
        if disp_idx is None:
            return None

        # 2. Return to the open level, confirmed on a bar close.
        window = [j for j in after if j > disp_idx][:self.return_window_bars]
        hi_since = max(candles[j]["high"] for j in after[:after.index(disp_idx) + 1])
        lo_since = min(candles[j]["low"] for j in after[:after.index(disp_idx) + 1])

        for i in window:
            c = candles[i]
            hi_since = max(hi_since, c["high"])
            lo_since = min(lo_since, c["low"])

            if self.direction_mode == "fade":
                # The displacement is treated as the trap. Entry once a bar
                # closes back through the open on the far side, i.e. the
                # breakout has actually failed rather than merely paused.
                crossed = c["close"] < open_level if disp_dir == "UP" else c["close"] > open_level
                if not crossed:
                    continue
                direction = "SHORT" if disp_dir == "UP" else "LONG"
            else:
                # Continuation: the open has to be revisited and then hold,
                # so the bar must touch the level and still close away from it
                # in the original direction.
                touched = c["low"] <= open_level if disp_dir == "UP" else c["high"] >= open_level
                held = c["close"] > open_level if disp_dir == "UP" else c["close"] < open_level
                if not (touched and held):
                    continue
                direction = "LONG" if disp_dir == "UP" else "SHORT"

            sl = hi_since if direction == "SHORT" else lo_since
            # A stop on the wrong side of the signal bar would be filled
            # instantly at the next open; skip rather than book a fake trade.
            if (direction == "SHORT" and sl <= c["close"]) or (direction == "LONG" and sl >= c["close"]):
                return None

            return EntrySignal(
                signal_idx=i,
                direction=direction,
                sl=sl,
                tp_r=self.tp_r,
                meta={
                    "anchor_idx": anchor,
                    "open_level": open_level,
                    "displacement_idx": disp_idx,
                    "displacement_dir": disp_dir,
                },
            )

        return None


class PowellOpenContinuationStrategy(PowellOpenStrategy):
    """The continuation reading of the same description, registered separately
    so both directions get published side by side."""

    name = "powell_open_cont"
    description = (
        "Powell 10:00 ET, continuation reading: displace away from the 10:00 open, "
        "retest it as support/resistance, trade in the direction of the displacement"
    )

    def __init__(self, **kwargs):
        kwargs.setdefault("direction_mode", "continuation")
        super().__init__(**kwargs)
