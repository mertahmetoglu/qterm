"""Run the confluence strategy across markets, in one command.

    python run_matrix.py

Writes reports/matrix.json and prints the same table the README publishes.
The point is that no number in this repo is a screenshot someone has to trust:
the full set of runs is declared below, and one command regenerates all of it
from cached market data.

The strategy was built for BTCUSDT 15m. Running the identical rules elsewhere
asks whether whatever it does on BTC is a property of the signal or of one
market. ATR-scaled exits are what make that comparison meaningful at all: a
fixed 0.5% stop is several days of range on EURUSD 15m and a few minutes on
SOLUSDT, whereas 1.5x ATR means the same thing on every instrument.

Every run is executed twice -- once with realistic costs for that venue, once
at zero cost. The pair matters more than either number alone: it separates "the
signal has nothing" from "the signal has something that execution costs eat",
and those two failures have completely different implications.

Cost assumptions per venue, and why:
  crypto  5bp taker per side + 3bp slippage  Binance futures, no VIP/BNB tier
  fx      0.35bp + 0.5bp                     retail ECN commission (~$3.5 per
                                             side per $100k) over a ~0.1 pip
                                             raw EURUSD spread
  index   0.1bp + 0.3bp                      NQ/ES futures are extremely cheap
                                             per unit of notional (the CFDs
                                             stand in for them as price data)
"""
import json
import sys
from pathlib import Path

import pandas as pd

from backtest import load_candles, simulate
from metrics import summarize
from strategies import get_strategy

HERE = Path(__file__).resolve().parent
REPORTS_DIR = HERE / "reports"

START, END = "2024-07-23", "2026-07-23"

COSTS = {
    "crypto": {"fee_bps": 5.0, "slippage_bps": 3.0},
    "fx": {"fee_bps": 0.35, "slippage_bps": 0.5},
    "index": {"fee_bps": 0.1, "slippage_bps": 0.3},
}

# (group, strategy, source, symbol, market, interval-or-None-for-strategy-default)
MATRIX = [
    # The market the strategy was built for, and the one the dashboard trades.
    ("BTCUSDT, the live market", "confluence", "binance", "BTCUSDT", "crypto", None),

    # Other crypto majors: same venue, same costs, highly correlated with BTC.
    ("Other crypto majors", "confluence", "binance", "ETHUSDT", "crypto", None),
    ("Other crypto majors", "confluence", "binance", "SOLUSDT", "crypto", None),
    ("Other crypto majors", "confluence", "binance", "XRPUSDT", "crypto", None),

    # Different asset classes with an order of magnitude lower costs.
    ("FX majors", "confluence", "dukascopy", "EURUSD", "fx", None),
    ("FX majors", "confluence", "dukascopy", "GBPUSD", "fx", None),
    ("FX majors", "confluence", "dukascopy", "USDJPY", "fx", None),
    ("US equity indices", "confluence", "dukascopy", "USATECHIDXUSD", "index", None),
    ("US equity indices", "confluence", "dukascopy", "USA500IDXUSD", "index", None),
]


def run_one(strategy_name, source, symbol, market, interval, start_ms, end_ms):
    strategy = get_strategy(strategy_name)
    interval = interval or strategy.default_interval
    candles = load_candles(symbol, interval, start_ms, end_ms, source=source)
    if len(candles) < 100:
        raise RuntimeError(f"not enough data for {symbol} {interval} from {source}")

    out = {}
    for scenario, costs in (("net", COSTS[market]), ("gross", {"fee_bps": 0.0, "slippage_bps": 0.0})):
        trades, closes = simulate(
            candles, strategy,
            fee_bps=costs["fee_bps"], slippage_bps=costs["slippage_bps"],
            max_hold_bars=strategy.default_max_hold_bars,
        )
        stats, _ = summarize(trades, closes, candles[0]["open_time"], candles[-1]["close_time"])
        out[scenario] = stats
    return {
        "strategy": strategy_name,
        "source": source,
        "symbol": symbol,
        "market": market,
        "interval": interval,
        "max_hold_bars": strategy.default_max_hold_bars,
        "costs": {
            **COSTS[market],
            "roundtrip_bps": 2 * COSTS[market]["fee_bps"] + 2 * COSTS[market]["slippage_bps"],
        },
        "net": out["net"],
        "gross": out["gross"],
    }


def main():
    start = pd.Timestamp(START, tz="UTC")
    end = pd.Timestamp(END, tz="UTC")
    start_ms, end_ms = int(start.timestamp() * 1000), int(end.timestamp() * 1000)

    rows = []
    for i, (group, strat, source, symbol, market, interval) in enumerate(MATRIX, 1):
        print(f"[{i}/{len(MATRIX)}] {strat} on {symbol} ...", flush=True)
        try:
            row = run_one(strat, source, symbol, market, interval, start_ms, end_ms)
        except Exception as e:
            print(f"    FAILED: {e}", file=sys.stderr)
            continue
        row["group"] = group
        rows.append(row)

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "window": {"start": START, "end": END},
        "leverage": 1,
        "cost_assumptions": COSTS,
        "rows": rows,
    }
    (REPORTS_DIR / "matrix.json").write_text(json.dumps(payload, indent=2, default=str))

    print()
    hdr = f"{'strategy':17s} {'symbol':14s} {'tf':4s} {'rt':>6s} {'n':>5s} {'win':>6s} " \
          f"{'netSh':>7s} {'netPF':>6s} {'netRet':>8s} {'grsSh':>7s} {'grsPF':>6s} {'B&H':>8s}"
    print(hdr)
    print("-" * len(hdr))
    current = None
    for r in rows:
        if r["group"] != current:
            current = r["group"]
            print(f"\n== {current} ==")
        n, g = r["net"], r["gross"]
        print(f"{r['strategy']:17s} {r['symbol']:14s} {r['interval']:4s} "
              f"{r['costs']['roundtrip_bps']:5.1f}b {n['n_trades']:5d} {n['win_rate']*100:5.1f}% "
              f"{n['sharpe']:+7.2f} {n['profit_factor']:6.2f} {n['total_return']*100:+7.1f}% "
              f"{g['sharpe']:+7.2f} {g['profit_factor']:6.2f} {n['buy_hold_return']*100:+7.1f}%")

    print(f"\n{len(rows)}/{len(MATRIX)} runs written to reports/matrix.json")


if __name__ == "__main__":
    main()
