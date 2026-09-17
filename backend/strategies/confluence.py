"""The original EMA/RSI/MACD/Bollinger confluence strategy as a plugin.

The scoring math itself stays in signal_engine.py -- that module is also what
the live feed runs and what scripts/check_parity.py validates against the
original JS implementation, so it deliberately stays the single source of
truth. This file only translates its per-bar output into entry intents.
"""
from signal_engine import (ATR_PERIOD, ATR_STOP_MULT, REWARD_RISK,
                           compute_signal_series, signal_direction)
from strategies.base import EntrySignal, Strategy


class ConfluenceStrategy(Strategy):
    name = "confluence"
    description = (
        "EMA(9/21) + RSI(14) + MACD(12,26,9) + Bollinger(20,2) confluence score; "
        f"enters when the score first reaches STRONG BUY / STRONG SELL, stop "
        f"{ATR_STOP_MULT}x ATR({ATR_PERIOD}), target {REWARD_RISK}R"
    )
    default_interval = "15m"
    default_max_hold_bars = 96

    def generate(self, candles):
        closes = [c["close"] for c in candles]
        highs = [c["high"] for c in candles]
        lows = [c["low"] for c in candles]
        signals = compute_signal_series(closes, highs, lows)

        out = []
        prev = None
        for i, sig in enumerate(signals):
            if sig is None:
                continue
            changed = prev != sig["signal"]
            prev = sig["signal"]
            if changed and sig["actionable"] and sig["atr"]:
                # The stop distance is fixed on the signal bar (ATR at T's
                # close) and expressed as a fraction of price, so the executor
                # applies it to the actual T+1 fill. The target is resolved
                # from the realised risk, which keeps reward:risk exactly
                # REWARD_RISK even when the fill slips.
                out.append(EntrySignal(
                    signal_idx=i,
                    direction=signal_direction(sig["signal"]),
                    sl_pct=ATR_STOP_MULT * sig["atr"] / sig["price"],
                    tp_r=REWARD_RISK,
                    meta={"signal": sig["signal"], "strength": sig["strength"], "atr": sig["atr"]},
                ))
        return out

    def params(self):
        return {"atr_period": ATR_PERIOD, "atr_stop_mult": ATR_STOP_MULT, "reward_risk": REWARD_RISK}
