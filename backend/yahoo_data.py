"""Yahoo Finance adapter -- used here for Borsa Istanbul (`.IS` symbols).

Binance and Dukascopy don't carry Turkish equities, and there is no free BIST
feed with an open API. Yahoo does carry them: `XU100.IS` for the BIST 100
index, `THYAO.IS` / `GARAN.IS` / ... for individual names.

Limits worth knowing before trusting a result from this source:
  - Intraday history is capped. 1h goes back ~730 days, 15m and finer only
    ~60. Daily goes back years.
  - Yahoo equity data is consolidated end-of-day-adjusted and is not an
    exchange feed. It is fine for judging whether a strategy has a signal;
    it is not tick-accurate, and intraday bars can carry gaps around
    auctions and halts.
  - `auto_adjust=False` is used deliberately so prices are the ones actually
    traded rather than back-adjusted for dividends/splits. Back-adjusted
    prices would let a strategy "see" a level that never existed at the time.
"""
import logging

import pandas as pd

logger = logging.getLogger("yahoo_data")

INTERVAL_MS = {
    "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000,
    "1d": 86_400_000, "1wk": 604_800_000,
}

# Yahoo's own history caps, in days, per interval.
MAX_LOOKBACK_DAYS = {"15m": 60, "30m": 60, "1h": 730, "1d": 20_000, "1wk": 20_000}

BIST_SYMBOLS = {
    "XU100.IS": "BIST 100",
    "THYAO.IS": "Turkish Airlines",
    "GARAN.IS": "Garanti BBVA",
    "AKBNK.IS": "Akbank",
    "ASELS.IS": "Aselsan",
    "KCHOL.IS": "Koc Holding",
    "EREGL.IS": "Eregli Demir Celik",
    "SISE.IS": "Sisecam",
}


def fetch_yahoo_candles(symbol, interval, start_ms, end_ms):
    import yfinance as yf

    if interval not in INTERVAL_MS:
        raise ValueError(f"unsupported interval {interval!r} for yahoo source")

    start = pd.Timestamp(start_ms, unit="ms", tz="UTC")
    end = pd.Timestamp(end_ms, unit="ms", tz="UTC")

    cap = MAX_LOOKBACK_DAYS[interval]
    earliest = pd.Timestamp.now(tz="UTC") - pd.Timedelta(days=cap)
    if start < earliest:
        logger.warning("%s %s: Yahoo only serves ~%dd of history at this interval; "
                       "start moved %s -> %s", symbol, interval, cap,
                       start.date(), earliest.date())
        start = earliest

    df = yf.download(symbol, start=start.tz_localize(None), end=end.tz_localize(None),
                     interval=interval, progress=False, auto_adjust=False)
    if df is None or df.empty:
        return []

    # One ticker still comes back column-MultiIndexed on current yfinance.
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df.rename(columns=str.lower)

    needed = ["open", "high", "low", "close"]
    missing = [c for c in needed if c not in df.columns]
    if missing:
        raise RuntimeError(f"{symbol}: Yahoo response missing columns {missing}")

    df = df.dropna(subset=needed)
    idx = df.index
    if idx.tz is None:
        idx = idx.tz_localize("UTC")
    # Pin the resolution before converting to integers. pandas 2 indexes can be
    # datetime64[s] as well as [ns] -- yfinance returns [s] here -- so a bare
    # astype("int64") // 1e6 silently produced timestamps in 1970. Asking for
    # milliseconds explicitly makes the unit independent of what Yahoo sent.
    open_ms = (idx.tz_convert("UTC").tz_localize(None)
               .astype("datetime64[ms]").astype("int64")).tolist()
    step = INTERVAL_MS[interval]

    out = []
    for i, t in enumerate(open_ms):
        row = df.iloc[i]
        out.append({
            "open_time": int(t),
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": float(row.get("volume", 0.0) or 0.0),
            "close_time": int(t) + step - 1,
        })

    out = [c for c in out if start_ms <= c["open_time"] < end_ms]
    logger.info("%s %s: %d bars %s -> %s", symbol, interval, len(out),
                pd.Timestamp(out[0]["open_time"], unit="ms").date() if out else "-",
                pd.Timestamp(out[-1]["open_time"], unit="ms").date() if out else "-")
    return out
