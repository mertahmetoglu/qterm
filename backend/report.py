"""Matplotlib chart generation for the backtest README section."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt

from metrics import daily_buy_hold_series

plt.rcParams.update({
    "figure.facecolor": "#0c1218",
    "axes.facecolor": "#0c1218",
    "axes.edgecolor": "#2a4060",
    "axes.labelcolor": "#c8dde8",
    "text.color": "#c8dde8",
    "xtick.color": "#4a6a7a",
    "ytick.color": "#4a6a7a",
    "font.size": 10,
})


def plot_equity_curve(equity_curve, closes, candle_times, out_path, leverage=1, symbol="BTCUSDT"):
    bh_norm = daily_buy_hold_series(closes, candle_times)
    eq_norm = equity_curve / equity_curve.iloc[0]

    fig, ax = plt.subplots(figsize=(10, 4.5))
    ax.plot(eq_norm.index, eq_norm.values, label=f"Strategy ({leverage}x, net of fees+slippage)", color="#00cc66", linewidth=1.6)
    ax.plot(bh_norm.index, bh_norm.values, label=f"Buy & Hold {symbol}", color="#7a95a5", linewidth=1.2, linestyle="--")
    ax.set_ylabel("Equity (normalized, start = 1.0)")
    ax.set_title("Strategy vs Buy & Hold")
    ax.legend(loc="upper left", frameon=False)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    fig.autofmt_xdate()
    ax.grid(alpha=0.15)
    fig.tight_layout()
    fig.savefig(out_path, dpi=140)
    plt.close(fig)


def plot_drawdown(equity_curve, out_path):
    running_max = equity_curve.cummax()
    dd = (equity_curve / running_max - 1) * 100

    fig, ax = plt.subplots(figsize=(10, 3))
    ax.fill_between(dd.index, dd.values, 0, color="#ff3355", alpha=0.3)
    ax.plot(dd.index, dd.values, color="#ff3355", linewidth=1)
    ax.set_ylabel("Drawdown (%)")
    ax.set_title("Strategy Drawdown")
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    fig.autofmt_xdate()
    ax.grid(alpha=0.15)
    fig.tight_layout()
    fig.savefig(out_path, dpi=140)
    plt.close(fig)
