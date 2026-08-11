"""Backtest the "Flow Buy/Sell" TradingView strategy on Borsa Istanbul.

    python run_bist.py

Runs MACD(20/50/12) flip over 1, 3, 6 and 12 month windows ending today, on the
BIST 100 index and several of the most liquid names, in three variants:

  long/short   the Pine script as written (reverses on every cross)
  long-only    a sell cross exits to flat -- the version a Turkish retail
               account could actually run, since short selling BIST equities is
               restricted and has been suspended outright for long stretches
  gross        zero-cost control, to separate "no signal" from "signal eaten
               by costs"

Costs default to 20bp per side, not the 5bp in the Pine header. BIST retail
commission plus BSMV plus exchange fees land well above 5bp for most accounts,
and this strategy trades often enough that the difference dominates the result.
Both assumptions are reported.

Timeframe is 1h. Daily bars would leave a 1-month window with ~21 bars, and
MACD(50) needs ~62 before it produces anything at all.
"""
import json
import sys
from pathlib import Path

import pandas as pd

from backtest import load_candles, simulate
from metrics import summarize
from strategies import get_strategy
from yahoo_data import BIST_SYMBOLS

HERE = Path(__file__).resolve().parent
REPORTS_DIR = HERE / "reports"

INTERVAL = "1h"
WINDOWS = {"1mo": 30, "3mo": 91, "6mo": 182, "1yr": 365}
SYMBOLS = ["XU100.IS", "THYAO.IS", "GARAN.IS", "AKBNK.IS", "ASELS.IS", "KCHOL.IS"]

PINE_FEE_BPS = 5.0        # what the script's header assumes
REALISTIC_FEE_BPS = 20.0  # BIST retail commission + BSMV + exchange fees
SLIPPAGE_BPS = 5.0


def run(strategy_name, symbol, days, fee_bps, slippage_bps, end):
    strategy = get_strategy(strategy_name)
    start = end - pd.Timedelta(days=days)
    # MACD(50) plus signal smoothing needs a warm-up that the window itself
    # must not eat, so pull extra bars before the window and let the metrics
    # window stay as requested.
    fetch_start = start - pd.Timedelta(days=45)
    candles = load_candles(symbol, INTERVAL,
                           int(fetch_start.timestamp() * 1000), int(end.timestamp() * 1000),
                           source="yahoo")
    if len(candles) < 80:
        return None

    trades, closes = simulate(candles, strategy, fee_bps=fee_bps, slippage_bps=slippage_bps,
                              max_hold_bars=strategy.default_max_hold_bars)
    start_ms = int(start.timestamp() * 1000)
    trades = [t for t in trades if t["entry_time"] >= start_ms]
    in_window = [c for c in candles if c["open_time"] >= start_ms]
    if not in_window:
        return None
    closes_w = [c["close"] for c in in_window]

    stats, _ = summarize(trades, closes_w, in_window[0]["open_time"], in_window[-1]["close_time"])
    return stats


def main():
    end = pd.Timestamp.now(tz="UTC").normalize()
    rows = []

    for symbol in SYMBOLS:
        for wname, days in WINDOWS.items():
            for strat in ("macd_flip", "macd_flip_long"):
                for label, fee in (("pine 5bp", PINE_FEE_BPS), ("real 20bp", REALISTIC_FEE_BPS)):
                    try:
                        s = run(strat, symbol, days, fee, SLIPPAGE_BPS, end)
                    except Exception as e:
                        print(f"  {symbol} {wname} {strat} {label}: FAILED {e}", file=sys.stderr)
                        continue
                    if s is None:
                        continue
                    rows.append({"symbol": symbol, "window": wname, "days": days,
                                 "strategy": strat, "cost_label": label, "fee_bps": fee,
                                 "slippage_bps": SLIPPAGE_BPS, "stats": s})
                # zero-cost control, long/short only
                try:
                    s = run(strat, symbol, days, 0.0, 0.0, end)
                    if s:
                        rows.append({"symbol": symbol, "window": wname, "days": days,
                                     "strategy": strat, "cost_label": "gross 0bp",
                                     "fee_bps": 0.0, "slippage_bps": 0.0, "stats": s})
                except Exception:
                    pass
        print(f"{symbol} done", flush=True)

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (REPORTS_DIR / "bist_matrix.json").write_text(json.dumps(
        {"interval": INTERVAL, "end": str(end.date()), "rows": rows}, indent=2, default=str))

    hdr = (f"{'symbol':10s} {'window':7s} {'strategy':15s} {'costs':14s} "
           f"{'n':>4s} {'win':>6s} {'ret':>9s} {'B&H':>9s} {'sharpe':>8s} {'PF':>6s} {'maxDD':>8s}")
    print("\n" + hdr)
    print("-" * len(hdr))
    last = None
    for r in rows:
        key = (r["symbol"], r["window"])
        if key != last:
            last = key
            print()
        s = r["stats"]
        print(f"{r['symbol']:10s} {r['window']:7s} {r['strategy']:15s} {r['cost_label']:14s} "
              f"{s['n_trades']:4d} {s['win_rate']*100:5.1f}% {s['total_return']*100:+8.1f}% "
              f"{s['buy_hold_return']*100:+8.1f}% {s['sharpe']:+8.2f} {s['profit_factor']:6.2f} "
              f"{s['max_drawdown']*100:+7.1f}%")

    print(f"\n{len(rows)} runs -> reports/bist_matrix.json")


if __name__ == "__main__":
    main()
