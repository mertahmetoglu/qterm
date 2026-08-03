"""The original EMA/RSI/MACD/Bollinger confluence strategy as a plugin.

The scoring math itself stays in signal_engine.py -- that module is also what
the live feed runs and what scripts/check_parity.py validates against the
original JS implementation, so it deliberately stays the single source of
truth. This file only translates its per-bar output into entry intents.
"""
from signal_engine import STOP_PCT, TP_PCT, compute_signal_series
from strategies.base import EntrySignal, Strategy


class ConfluenceStrategy(Strategy):
    name = "confluence"
    description = (
        "EMA(9/21) + RSI(14) + MACD(12,26,9) + Bollinger(20,2) confluence score; "
        "enters when the score first reaches STRONG BUY / STRONG SELL"
    )
    default_interval = "15m"
    default_max_hold_bars = 96

    def generate(self, candles):
        closes = [c["close"] for c in candles]
        signals = compute_signal_series(closes)

        out = []
        prev = None
        for i, sig in enumerate(signals):
            if sig is None:
                continue
            changed = prev != sig["signal"]
            prev = sig["signal"]
            if changed and sig["actionable"]:
                out.append(EntrySignal(
                    signal_idx=i,
                    direction="LONG" if sig["signal"] in ("BUY", "STRONG BUY") else "SHORT",
                    sl_pct=STOP_PCT,
                    tp_pct=TP_PCT,
                    meta={"signal": sig["signal"], "strength": sig["strength"]},
                ))
        return out

    def params(self):
        return {"stop_pct": STOP_PCT, "tp_pct": TP_PCT}
