"""Backtest performance metrics -- hand-rolled (not pulled from a black-box
library) so every number is auditable line by line.

Sharpe/Sortino are computed on a *daily* equity curve (annualized with
sqrt(252)) rather than a per-trade approximation -- the standard, comparable
convention. The equity curve only updates when a trade closes (this
strategy isn't always in the market); days with no closed trade hold the
previous value flat.
"""
import numpy as np
import pandas as pd

TRADING_DAYS_PER_YEAR = 252


def build_equity_curve(trades, start_time_ms, end_time_ms, initial_equity=1.0):
    start = pd.to_datetime(start_time_ms, unit="ms")
    end = pd.to_datetime(end_time_ms, unit="ms")

    if not trades:
        return pd.Series([initial_equity, initial_equity], index=[start, end])

    events = [(start, initial_equity)]
    equity = initial_equity
    for t in sorted(trades, key=lambda x: x["exit_time"]):
        equity *= (1 + t["leveraged_return"])
        events.append((pd.to_datetime(t["exit_time"], unit="ms"), equity))
    if events[-1][0] < end:
        events.append((end, equity))

    s = pd.Series([e for _, e in events], index=[t for t, _ in events])
    s = s[~s.index.duplicated(keep="last")].sort_index()
    return s.resample("D").last().ffill()


def daily_buy_hold_series(closes, candle_times, initial=1.0):
    """Daily-resampled, normalized buy-and-hold series for the same window --
    factored out so the PNG chart (report.py) and the JSON API export
    (backtest.py) can't disagree about what "buy and hold" means here."""
    bh = pd.Series(closes, index=pd.to_datetime(candle_times, unit="ms"))
    bh_daily = bh.resample("D").last().ffill()
    return bh_daily / bh_daily.iloc[0] * initial


def sharpe_ratio(daily_returns, risk_free=0.0):
    std = daily_returns.std()
    if len(daily_returns) < 2 or pd.isna(std) or std == 0:
        return 0.0
    excess = daily_returns - risk_free / TRADING_DAYS_PER_YEAR
    return float(excess.mean() / std * np.sqrt(TRADING_DAYS_PER_YEAR))


def sortino_ratio(daily_returns, risk_free=0.0):
    downside = daily_returns[daily_returns < 0]
    downside_std = downside.std()
    if len(downside) < 2 or pd.isna(downside_std) or downside_std == 0:
        return 0.0
    excess = daily_returns - risk_free / TRADING_DAYS_PER_YEAR
    return float(excess.mean() / downside_std * np.sqrt(TRADING_DAYS_PER_YEAR))


def max_drawdown(equity_curve):
    running_max = equity_curve.cummax()
    drawdown = equity_curve / running_max - 1
    return float(drawdown.min())


def profit_factor(trades):
    gross_profit = sum(t["leveraged_return"] for t in trades if t["leveraged_return"] > 0)
    gross_loss = abs(sum(t["leveraged_return"] for t in trades if t["leveraged_return"] < 0))
    if gross_loss == 0:
        return float("inf") if gross_profit > 0 else 0.0
    return gross_profit / gross_loss


def summarize(trades, closes, start_time_ms, end_time_ms, initial_equity=1.0):
    equity_curve = build_equity_curve(trades, start_time_ms, end_time_ms, initial_equity)
    daily_returns = equity_curve.pct_change().dropna()

    wins = [t for t in trades if t["leveraged_return"] > 0]
    losses = [t for t in trades if t["leveraged_return"] <= 0]

    total_return = float(equity_curve.iloc[-1] / equity_curve.iloc[0] - 1)
    years = max((equity_curve.index[-1] - equity_curve.index[0]).days / 365.25, 1e-9)
    cagr = float((equity_curve.iloc[-1] / equity_curve.iloc[0]) ** (1 / years) - 1) if equity_curve.iloc[0] > 0 else 0.0
    buy_hold_return = (closes[-1] - closes[0]) / closes[0] if closes else 0.0

    stats = {
        "n_trades": len(trades),
        "win_rate": len(wins) / len(trades) if trades else 0.0,
        "sharpe": sharpe_ratio(daily_returns),
        "sortino": sortino_ratio(daily_returns),
        "max_drawdown": max_drawdown(equity_curve),
        "profit_factor": profit_factor(trades),
        "total_return": total_return,
        "cagr": cagr,
        "buy_hold_return": float(buy_hold_return),
        "avg_win": float(np.mean([t["leveraged_return"] for t in wins])) if wins else 0.0,
        "avg_loss": float(np.mean([t["leveraged_return"] for t in losses])) if losses else 0.0,
        "exit_reasons": {r: sum(1 for t in trades if t["reason"] == r) for r in ("TP", "SL", "TIME")},
    }
    return stats, equity_curve
