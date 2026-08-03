"""Historical backtest for the exact signal engine that runs live.

Rules (documented, not hidden -- see README Limitations section too):
  - The signal is read at candle T's close; the trade fills at candle T+1's
    open. No lookahead: a decision never uses information from its own
    execution bar or later.
  - Single position at a time (flat / long / short). The live dashboard's
    paper-trade panel can show overlapping entries because it doesn't track
    position state -- this simulation does, which is the realistic
    convention for a strategy backtest.
  - A new position only opens when the signal *changes* to an actionable
    state (matches the live entry logic in App.jsx exactly, not just the
    indicator math).
  - TP/SL are resolved by scanning forward through subsequent candles'
    high/low. If both would be touched within the same candle, SL is
    assumed to have hit first -- conservative, since 15m/5m/1h OHLC candles
    don't tell us the intra-candle order of events.
  - Positions are time-stopped after --max-hold-bars candles if neither TP
    nor SL is hit by then (default 96 bars = 24h at 15m).
  - Taker fees (both legs) and slippage (both fills) are modelled as a drag
    on the *unleveraged* price return before the leverage multiplier is
    applied, so cost drag scales with leverage the way it actually would on
    a real leveraged/futures position (fees are charged on notional, and
    notional = leverage x margin).

Explicitly NOT modelled: perpetual funding rate, parameter optimization /
walk-forward validation, partial fills, liquidation before SL. See README.
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

import pandas as pd

from fx_data import fetch_fx_candles
from market_data import fetch_klines_range
from metrics import daily_buy_hold_series, summarize
from report import plot_drawdown, plot_equity_curve
from signal_engine import LEVERAGE, STOP_PCT, TP_PCT
from strategies import STRATEGIES, get_strategy

HERE = Path(__file__).resolve().parent
CACHE_DIR = HERE / "data_cache"
REPORTS_DIR = HERE / "reports"

DEFAULT_FEE_BPS = 5          # ~0.05% taker per side (Binance futures, no VIP/BNB discount)
DEFAULT_SLIPPAGE_BPS = 3     # modest assumption for a liquid pair like BTCUSDT
DEFAULT_MAX_HOLD_BARS = 96   # 24h at 15m -- this is an intraday strategy, not a swing one


def _cache_path(source, symbol, interval, start_ms, end_ms):
    CACHE_DIR.mkdir(exist_ok=True)
    prefix = "" if source == "binance" else f"{source}_"
    return CACHE_DIR / f"{prefix}{symbol}_{interval}_{start_ms}_{end_ms}.parquet"


def load_candles(symbol, interval, start_ms, end_ms, source="binance"):
    """Candles in one shape regardless of venue, so the executor and the
    strategies never learn which market they're running on."""
    path = _cache_path(source, symbol, interval, start_ms, end_ms)
    if path.exists():
        return pd.read_parquet(path).to_dict("records")
    if source == "binance":
        candles = asyncio.run(fetch_klines_range(symbol, interval, start_ms, end_ms))
    elif source == "dukascopy":
        candles = fetch_fx_candles(symbol, interval, start_ms, end_ms)
    else:
        raise ValueError(f"unknown source {source!r}")
    if candles:
        pd.DataFrame(candles).to_parquet(path)
    return candles


def apply_slippage(price, direction, is_entry, slippage_bps):
    slip = slippage_bps / 10_000
    if is_entry:
        return price * (1 + slip) if direction == "LONG" else price * (1 - slip)
    return price * (1 - slip) if direction == "LONG" else price * (1 + slip)


def simulate(candles, strategy, fee_bps=DEFAULT_FEE_BPS, slippage_bps=DEFAULT_SLIPPAGE_BPS,
             max_hold_bars=DEFAULT_MAX_HOLD_BARS):
    """Execute a strategy's entry intents under fixed, strategy-agnostic rules.

    The strategy only says when/which way/where the stop and target sit; every
    execution assumption below is applied identically no matter which strategy
    produced the signal, so two strategies' results are actually comparable.
    """
    closes = [c["close"] for c in candles]
    n = len(candles)
    fee_rate = fee_bps / 10_000

    trades = []
    busy_until = -1

    for entry in strategy.generate(candles):
        # Single position at a time: a signal that fires while a trade is still
        # open is dropped, not queued.
        if entry.signal_idx <= busy_until:
            continue

        entry_idx = entry.signal_idx + 1
        if entry_idx >= n:
            break

        direction = entry.direction
        entry_price = apply_slippage(candles[entry_idx]["open"], direction, True, slippage_bps)
        sl, tp = entry.levels(entry_price)

        exit_idx, raw_exit, reason = None, None, None
        last_scan = min(entry_idx + max_hold_bars, n - 1)
        for j in range(entry_idx, last_scan + 1):
            hi, lo = candles[j]["high"], candles[j]["low"]
            hit_sl = lo <= sl if direction == "LONG" else hi >= sl
            hit_tp = hi >= tp if direction == "LONG" else lo <= tp
            if hit_sl:
                exit_idx, raw_exit, reason = j, sl, "SL"
            elif hit_tp:
                exit_idx, raw_exit, reason = j, tp, "TP"
            if exit_idx is not None:
                break
        if exit_idx is None:
            exit_idx, raw_exit, reason = last_scan, candles[last_scan]["close"], "TIME"

        exit_price = apply_slippage(raw_exit, direction, False, slippage_bps)
        gross_ret = ((exit_price - entry_price) / entry_price if direction == "LONG"
                     else (entry_price - exit_price) / entry_price)
        net_ret = gross_ret - 2 * fee_rate

        trades.append({
            "entry_time": candles[entry_idx]["open_time"],
            "exit_time": candles[exit_idx]["close_time"],
            "direction": direction,
            "entry": entry_price,
            "exit": exit_price,
            "sl": sl,
            "tp": tp,
            "reason": reason,
            "gross_return": gross_ret,
            "net_return": net_ret,
            "leveraged_return": net_ret * LEVERAGE,
            **entry.meta,
        })

        busy_until = exit_idx

    return trades, closes


def main():
    ap = argparse.ArgumentParser(description="Backtest a strategy against historical Binance data.")
    ap.add_argument("--strategy", default="confluence", choices=sorted(STRATEGIES),
                    help="which strategy to run (default: confluence)")
    ap.add_argument("--symbol", default="BTCUSDT")
    ap.add_argument("--source", default="binance", choices=("binance", "dukascopy"),
                    help="binance = crypto klines, dukascopy = FX majors (e.g. --symbol EURUSD)")
    ap.add_argument("--interval", default=None, help="default: the strategy's own timeframe")
    ap.add_argument("--start", default=None, help="YYYY-MM-DD (UTC), default 2 years before --end")
    ap.add_argument("--end", default=None, help="YYYY-MM-DD (UTC), default today")
    ap.add_argument("--fee-bps", type=float, default=DEFAULT_FEE_BPS)
    ap.add_argument("--slippage-bps", type=float, default=DEFAULT_SLIPPAGE_BPS)
    ap.add_argument("--max-hold-bars", type=int, default=None,
                    help="default: the strategy's own hold limit")
    ap.add_argument("--out", default=str(REPORTS_DIR))
    args = ap.parse_args()

    strategy = get_strategy(args.strategy)
    interval = args.interval or strategy.default_interval
    max_hold_bars = args.max_hold_bars if args.max_hold_bars is not None else strategy.default_max_hold_bars

    end = pd.Timestamp(args.end, tz="UTC") if args.end else pd.Timestamp.now(tz="UTC").normalize()
    start = pd.Timestamp(args.start, tz="UTC") if args.start else end - pd.Timedelta(days=730)
    start_ms, end_ms = int(start.timestamp() * 1000), int(end.timestamp() * 1000)

    print(f"Strategy: {strategy.name} ({interval}, max hold {max_hold_bars} bars)")
    print(f"Fetching {args.symbol} {interval} candles from {args.source} {start.date()} -> {end.date()} ...")
    candles = load_candles(args.symbol, interval, start_ms, end_ms, source=args.source)
    print(f"{len(candles)} candles loaded.")
    if len(candles) < 100:
        print("Not enough data to backtest.", file=sys.stderr)
        sys.exit(1)

    trades, closes = simulate(candles, strategy, args.fee_bps, args.slippage_bps, max_hold_bars)
    print(f"{len(trades)} trades simulated.")

    stats, equity_curve = summarize(trades, closes, candles[0]["open_time"], candles[-1]["close_time"])

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    candle_times = [c["open_time"] for c in candles]
    # Per-strategy filenames so running one strategy never overwrites another's
    # published charts.
    tag = f"{strategy.name}_{args.symbol}_{interval}"
    plot_equity_curve(equity_curve, closes, candle_times,
                      out_dir / f"equity_curve_{tag}.png", leverage=LEVERAGE, symbol=args.symbol)
    plot_drawdown(equity_curve, out_dir / f"drawdown_{tag}.png")

    buy_hold_curve = daily_buy_hold_series(closes, candle_times)
    eq_norm = equity_curve / equity_curve.iloc[0]

    result = {
        "strategy": strategy.describe(),
        "symbol": args.symbol, "interval": interval, "source": args.source,
        "start": str(start.date()), "end": str(end.date()),
        "leverage": LEVERAGE, "stop_pct": STOP_PCT, "tp_pct": TP_PCT,
        "fee_bps": args.fee_bps, "slippage_bps": args.slippage_bps, "max_hold_bars": max_hold_bars,
        "stats": stats,
        # Frontend renders these directly (BacktestView.jsx) -- same series the
        # PNGs above are plotted from, just JSON instead of matplotlib.
        "equity_curve": [{"date": d.strftime("%Y-%m-%d"), "value": float(v)} for d, v in eq_norm.items()],
        "buy_hold_curve": [{"date": d.strftime("%Y-%m-%d"), "value": float(v)} for d, v in buy_hold_curve.items()],
    }
    payload = json.dumps(result, indent=2, default=str)
    # Keyed by strategy AND symbol AND interval: with several strategies across
    # several markets, a name that omits the symbol silently overwrites another
    # market's published result. The generic name is what the dashboard's
    # /api/backtest serves, i.e. whichever run was most recent.
    (out_dir / f"backtest_{strategy.name}_{args.symbol}_{interval}.json").write_text(payload)
    (out_dir / "backtest_result.json").write_text(payload)
    print(json.dumps({k: v for k, v in result.items()
                      if k not in ("equity_curve", "buy_hold_curve")}, indent=2, default=str))


if __name__ == "__main__":
    main()
