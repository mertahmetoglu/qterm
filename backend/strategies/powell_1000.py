"""Powell 10:00 ET break-and-retest.

The strategy as it's usually described ("mark the 10:00 candle, wait for the
break, wait for the retest, enter on confirmation") is too loose to backtest:
every ambiguous word is a place where the implementer's choice -- not the
strategy's -- decides the result. Each one is pinned down below and repeated in
the README, so the reported numbers describe a rule set someone else could
reproduce or disagree with explicitly.

Why this is even plausible on BTC, which has no market open: the premise is US
session order flow, and since the January 2024 US spot BTC ETFs (IBIT, FBTC et
al., which trade 09:30-16:00 ET) BTC genuinely does see concentrated US-hours
flow. That is a much weaker prior than the same strategy on ES/NQ -- BTC has no
opening auction, no overnight gap, no halt -- but it is a testable one, and the
backtest window is entirely post-ETF-launch.

Rules
  Anchor        the 10:00 America/New_York candle. DST-aware: 10:00 ET is
                14:00 UTC in winter and 13:00 UTC in summer, so a hardcoded UTC
                offset would silently anchor the wrong candle for half the
                year. Its high/low are the day's reference levels.
  Weekends      skipped. The entire premise is US-session flow and there is no
                US session on Saturday or Sunday. (US market holidays are NOT
                skipped -- see README limitations.)
  Break         the first candle to CLOSE beyond the anchor range, within
                `break_window_bars` after the anchor. Close, not wick: a wick
                through a level is noise, a close is a commitment.
  Retest        a later candle trading back to touch the broken level (low <=
                level for a long, high >= level for a short) within
                `retest_window_bars` of the break. If a candle instead CLOSES
                back inside the anchor range first, the break is treated as
                failed and the day is abandoned.
  Confirmation  the first candle AFTER the retest that closes back beyond the
                level in the break direction. That candle is the signal bar;
                the executor fills at the next bar's open. Requiring a separate
                bar means a single candle can't both retest and confirm.
  Stop          the opposite extreme of the anchor candle (structure-based, so
                risk is set by the session's own range rather than a constant).
  Target        a fixed multiple of that risk (default 2R).
  At most one trade per session day.
"""
import pandas as pd

from strategies.base import EntrySignal, Strategy

NY_TZ = "America/New_York"


class Powell1000Strategy(Strategy):
    name = "powell_1000"
    description = (
        "Powell 10:00 ET break-and-retest: mark the 10:00 New York candle's range, "
        "trade the first close beyond it that retests and confirms"
    )
    default_interval = "5m"
    default_max_hold_bars = 72   # 6h at 5m -- entry ~10:30 ET, flat by ~16:30 ET

    def __init__(self, anchor_hour=10, anchor_minute=0, break_window_bars=24,
                 retest_window_bars=12, tp_r=2.0, skip_weekends=True,
                 anchor_mode="candle", range_start_hour=9, range_start_minute=30):
        self.anchor_hour = anchor_hour
        self.anchor_minute = anchor_minute
        self.break_window_bars = break_window_bars      # 24 bars of 5m = break must land by 12:00 ET
        self.retest_window_bars = retest_window_bars    # 12 bars of 5m = 1h to retest and confirm
        self.tp_r = tp_r
        self.skip_weekends = skip_weekends
        # Which levels the day's reference is taken from. The written strategy
        # is ambiguous here and the choice dominates the result, so both
        # readings are implemented and reported rather than one being picked
        # silently:
        #   "candle"        the 10:00 bar's own high/low. Literal reading of
        #                   "mark the 10:00 candle", but on a 5m chart that is
        #                   a very narrow range, so stops sit inside the noise.
        #   "opening_range" high/low of 09:30-10:00, i.e. the window the
        #                   strategy's own rationale calls the liquidity
        #                   hunt/manipulation phase. Wider, structurally
        #                   meaningful levels.
        self.anchor_mode = anchor_mode
        self.range_start_hour = range_start_hour
        self.range_start_minute = range_start_minute

    def params(self):
        return {
            "anchor": f"{self.anchor_hour:02d}:{self.anchor_minute:02d} America/New_York",
            "anchor_mode": self.anchor_mode,
            "range_start": (f"{self.range_start_hour:02d}:{self.range_start_minute:02d}"
                            if self.anchor_mode == "opening_range" else None),
            "break_window_bars": self.break_window_bars,
            "retest_window_bars": self.retest_window_bars,
            "tp_r": self.tp_r,
            "stop": ("opposite extreme of the 09:30-10:00 opening range"
                     if self.anchor_mode == "opening_range"
                     else "opposite extreme of the anchor candle"),
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
                continue  # no candle at the anchor time that day (data gap)

            if self.anchor_mode == "opening_range":
                # Levels come from 09:30-10:00; the break scan still starts at
                # the 10:00 bar, so the reference window is fully closed before
                # anything is traded off it.
                span = [i for i in idxs
                        if (ts[i].hour, ts[i].minute) >= (self.range_start_hour, self.range_start_minute)
                        and i < anchor]
                if not span:
                    continue
                hi = max(candles[i]["high"] for i in span)
                lo = min(candles[i]["low"] for i in span)
                scan_from = anchor
            else:
                hi, lo = candles[anchor]["high"], candles[anchor]["low"]
                scan_from = anchor + 1

            signal = self._scan_session(candles, idxs, anchor, hi, lo, scan_from)
            if signal is not None:
                out.append(signal)

        out.sort(key=lambda s: s.signal_idx)
        return out

    def _scan_session(self, candles, idxs, anchor, hi, lo, scan_from):
        if not hi > lo:
            return None  # degenerate/flat reference, no range to break

        after = [i for i in idxs if i >= scan_from]

        break_idx = direction = level = None
        for i in after[:self.break_window_bars]:
            close = candles[i]["close"]
            if close > hi:
                break_idx, direction, level = i, "LONG", hi
                break
            if close < lo:
                break_idx, direction, level = i, "SHORT", lo
                break
        if break_idx is None:
            return None

        retest_idx = None
        for i in [j for j in after if j > break_idx][:self.retest_window_bars]:
            c = candles[i]

            # Break failed -- price closed back through the far side of the
            # anchor range. Abandon the day rather than trade a fakeout.
            if (direction == "LONG" and c["close"] < lo) or (direction == "SHORT" and c["close"] > hi):
                return None

            if retest_idx is None:
                touched = c["low"] <= level if direction == "LONG" else c["high"] >= level
                if touched:
                    retest_idx = i
                continue

            confirmed = c["close"] > level if direction == "LONG" else c["close"] < level
            if confirmed:
                return EntrySignal(
                    signal_idx=i,
                    direction=direction,
                    sl=lo if direction == "LONG" else hi,
                    tp_r=self.tp_r,
                    meta={
                        "anchor_idx": anchor,
                        "anchor_high": hi,
                        "anchor_low": lo,
                        "break_idx": break_idx,
                        "retest_idx": retest_idx,
                        "level": level,
                    },
                )

        return None


class PowellOpeningRangeStrategy(Powell1000Strategy):
    """The 09:30-10:00 opening-range reading of the same written strategy.

    Registered as its own strategy so both interpretations get run, reported
    and compared instead of one being chosen silently. The description's own
    rationale -- that the post-open half hour is a liquidity hunt and 10:00
    confirms the real direction -- reads more naturally as "trade the break of
    the 09:30-10:00 range" than as "trade the break of one 5-minute candle",
    and the two produce very different stop distances.
    """

    name = "powell_or"
    description = (
        "Powell 10:00 ET, opening-range reading: mark the 09:30-10:00 New York range, "
        "trade the first close beyond it that retests and confirms"
    )

    def __init__(self, **kwargs):
        kwargs.setdefault("anchor_mode", "opening_range")
        super().__init__(**kwargs)
