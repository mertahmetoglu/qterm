"""Single source of truth for indicator math and trade-signal scoring.

Ported 1:1 from the frontend's src/indicators.js (same recursion, same seeding,
same score thresholds) so live streaming and backtesting can never disagree.
Verified against the JS original by scripts/check_parity.py — do not hand-tune
this file without re-running that check, and do not re-implement any of this
logic anywhere else (App.jsx reads results from the backend instead).

Pure stdlib on purpose: no numpy/pandas dependency for this module, so the
parity check can run before any pip install, and so there's never a doubt
that a vectorized rewrite subtly changed the arithmetic.
"""

import math

LEVERAGE = 1       # was 10 -- at 10x, a negative-edge strategy's compounding
                   # losses become "wipe the account" instead of "slowly bleed";
                   # leverage doesn't change whether the edge is positive or
                   # negative, only how violently that edge compounds. See README.
STOP_PCT = 0.005   # 0.5% price move = 0.5% capital loss at 1x
TP_PCT = 0.015     # 1.5% price move = 1.5% capital gain at 1x (1:3 R/R)

# A trade is "actionable" only on STRONG BUY/STRONG SELL (|total| >= 4, i.e.
# strength >= 50). This used to be gated at strength >= 60, which is
# mathematically unreachable: with 4 indicators each scored in [-2, 2], the
# EMA component only hits +-2 on the exact crossover bar, and RSI/MACD/BB
# essentially never *also* hit their +-2 extreme on that same bar -- so
# |total| tops out at 4 in practice (confirmed against ~2 years of real
# BTCUSDT data: max |total| observed was 4, and strength >= 60 produced a
# single trade in 2 years). Backtesting this is what caught it -- see README.
ACTIONABLE_SIGNALS = ("STRONG BUY", "STRONG SELL")
ACTIONABLE_STRENGTH = 50


def is_actionable(signal, strength):
    return signal in ACTIONABLE_SIGNALS and strength >= ACTIONABLE_STRENGTH


def _round_half_up(x):
    """Match JS Math.round (rounds .5 away from zero) instead of Python's
    round-half-to-even. Only ever called with non-negative x here."""
    return int(math.floor(x + 0.5))


def ema(prices, period):
    n = len(prices)
    if n < period:
        return [None] * n
    result = [None] * n
    e = sum(prices[:period]) / period
    result[period - 1] = e
    k = 2 / (period + 1)
    for i in range(period, n):
        e = prices[i] * k + e * (1 - k)
        result[i] = e
    return result


def calc_rsi(prices, period=14):
    n = len(prices)
    result = [None] * n
    if n < period + 1:
        return result
    gains = 0.0
    losses = 0.0
    for i in range(1, period + 1):
        d = prices[i] - prices[i - 1]
        if d > 0:
            gains += d
        else:
            losses -= d
    avg_gain = gains / period
    avg_loss = losses / period
    result[period] = 100 - 100 / (1 + (1e9 if avg_loss == 0 else avg_gain / avg_loss))
    for i in range(period + 1, n):
        d = prices[i] - prices[i - 1]
        avg_gain = (avg_gain * (period - 1) + max(d, 0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-d, 0)) / period
        result[i] = 100 - 100 / (1 + (1e9 if avg_loss == 0 else avg_gain / avg_loss))
    return result


def calc_macd(prices, fast=12, slow=26, signal=9):
    ema_fast = ema(prices, fast)
    ema_slow = ema(prices, slow)
    macd_line = [
        (ema_fast[i] - ema_slow[i]) if ema_fast[i] is not None and ema_slow[i] is not None else None
        for i in range(len(prices))
    ]
    valid_macd = [v for v in macd_line if v is not None]
    sig_ema = ema(valid_macd, signal)
    signal_line = [None] * len(macd_line)
    idx = 0
    for i, v in enumerate(macd_line):
        if v is None:
            continue
        signal_line[i] = sig_ema[idx] if idx < len(sig_ema) else None
        idx += 1
    histogram = [
        (macd_line[i] - signal_line[i]) if macd_line[i] is not None and signal_line[i] is not None else None
        for i in range(len(macd_line))
    ]
    return macd_line, signal_line, histogram


def calc_bollinger(prices, period=20, mult=2):
    n = len(prices)
    result = []
    for i in range(n):
        if i < period - 1:
            result.append({"upper": None, "middle": None, "lower": None})
            continue
        window = prices[i - period + 1:i + 1]
        mean = sum(window) / period
        variance = sum((x - mean) ** 2 for x in window) / period
        std = math.sqrt(variance)
        result.append({"upper": mean + mult * std, "middle": mean, "lower": mean - mult * std})
    return result


def _score(e9, e9p, e21, e21p, r, m, mp, sig, sigp, h, price, bbu, bbl, bbm):
    """The confluence-scoring rules, factored out so compute_signal (live,
    single point) and compute_signal_series (backtest, every point) can
    never disagree -- there is exactly one place this logic is written."""
    if e9 > e21 and e9p <= e21p:
        ema_score = 2
    elif e9 > e21:
        ema_score = 1
    elif e9 < e21 and e9p >= e21p:
        ema_score = -2
    else:
        ema_score = -1

    if r < 30:
        rsi_score = 2
    elif r < 45:
        rsi_score = 1
    elif r > 70:
        rsi_score = -2
    elif r > 55:
        rsi_score = -1
    else:
        rsi_score = 0

    if m > sig and mp <= sigp:
        macd_score = 2
    elif m > sig and h > 0:
        macd_score = 1
    elif m < sig and mp >= sigp:
        macd_score = -2
    elif m < sig and h < 0:
        macd_score = -1
    else:
        macd_score = 0

    if price < bbl:
        bb_score = 2
    elif price > bbu:
        bb_score = -2
    elif price < bbm:
        bb_score = 1
    elif price > bbm:
        bb_score = -1
    else:
        bb_score = 0

    scores = {"ema": ema_score, "rsi": rsi_score, "macd": macd_score, "bb": bb_score}
    total = sum(scores.values())
    strength = _round_half_up(abs(total) / 8 * 100)

    if total >= 4:
        signal, color = "STRONG BUY", "#00ff88"
    elif total >= 2:
        signal, color = "BUY", "#00cc66"
    elif total <= -4:
        signal, color = "STRONG SELL", "#ff3355"
    elif total <= -2:
        signal, color = "SELL", "#cc2244"
    else:
        signal, color = "HOLD", "#ffd700"

    return scores, total, strength, signal, color


def compute_signal(closes):
    """Live use: the signal for the *last* point in `closes`."""
    if len(closes) < 50:
        return None

    ema9 = ema(closes, 9)
    ema21 = ema(closes, 21)
    rsi_arr = calc_rsi(closes, 14)
    macd_line, signal_line, histogram = calc_macd(closes)
    bb = calc_bollinger(closes, 20)

    n = len(closes) - 1
    price = closes[n]
    e9, e9p = ema9[n], ema9[n - 1]
    e21, e21p = ema21[n], ema21[n - 1]
    r = rsi_arr[n]
    m, mp = macd_line[n], macd_line[n - 1]
    sig, sigp = signal_line[n], signal_line[n - 1]
    h = histogram[n]
    bbu, bbl, bbm = bb[n]["upper"], bb[n]["lower"], bb[n]["middle"]

    if any(v is None for v in [e9, e21, r, m, sig, h, bbu, bbl]):
        return None

    scores, total, strength, signal, color = _score(e9, e9p, e21, e21p, r, m, mp, sig, sigp, h, price, bbu, bbl, bbm)

    return {
        "signal": signal,
        "color": color,
        "strength": strength,
        "total": total,
        "actionable": is_actionable(signal, strength),
        "scores": scores,
        "price": price,
        "e9": e9,
        "e21": e21,
        "rsi": r,
        "macdHist": h,
        "bbUpper": bbu,
        "bbLower": bbl,
        "bbMid": bbm,
        "ema9": ema9,
        "ema21": ema21,
        "rsiArr": rsi_arr,
        "macdLine": macd_line,
        "signalLine": signal_line,
        "histogram": histogram,
        "bb": bb,
    }


def compute_signal_series(closes):
    """Backtest use: the same scoring for *every* point in `closes`, computed
    in O(n) (indicator arrays built once) instead of O(n^2) (recomputing
    compute_signal from scratch at every bar). Returns a list the same
    length as closes; entries still warming up are None."""
    n = len(closes)
    ema9 = ema(closes, 9)
    ema21 = ema(closes, 21)
    rsi_arr = calc_rsi(closes, 14)
    macd_line, signal_line, histogram = calc_macd(closes)
    bb = calc_bollinger(closes, 20)

    out = [None] * n
    for i in range(1, n):
        e9, e9p = ema9[i], ema9[i - 1]
        e21, e21p = ema21[i], ema21[i - 1]
        r = rsi_arr[i]
        m, mp = macd_line[i], macd_line[i - 1]
        sig, sigp = signal_line[i], signal_line[i - 1]
        h = histogram[i]
        bbu, bbl, bbm = bb[i]["upper"], bb[i]["lower"], bb[i]["middle"]
        if any(v is None for v in [e9, e9p, e21, e21p, r, m, mp, sig, sigp, h, bbu, bbl]):
            continue
        scores, total, strength, signal, color = _score(
            e9, e9p, e21, e21p, r, m, mp, sig, sigp, h, closes[i], bbu, bbl, bbm
        )
        out[i] = {
            "signal": signal, "strength": strength, "total": total,
            "actionable": is_actionable(signal, strength),
            "scores": scores, "price": closes[i],
        }
    return out
