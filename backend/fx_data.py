"""FX market data from Dukascopy's public datafeed.

Why a second data source at all: on BTCUSDT a round trip costs ~16bp, which is
a large fraction of what an intraday signal can hope to earn per trade.
Running the same strategy on FX majors and index CFDs -- EURUSD round-trip cost
on a retail ECN account is roughly 2-4bp, an order of magnitude cheaper --
separates "the signal is weak" from "the signal is fine but crypto execution
costs eat it", rather than just searching for an asset where the same strategy
happens to look better.

Format (verified empirically against known 2025-01-06 EURUSD prices before
being trusted, see git history for the probe script):
  URL     /datafeed/{SYMBOL}/{YYYY}/{MM}/{DD}/BID_candles_min_1.bi5
          month is 0-indexed (January = 00), day is 1-indexed.
  Body    LZMA, FORMAT_ALONE (raw, no container header)
  Record  24 bytes big-endian `>iiiiif`:
          seconds-from-UTC-midnight, open, close, low, high, volume
          The four prices are int32 scaled by the pair's point value
          (1e5 for 5-decimal pairs, 1e3 for JPY crosses); volume is float32
          tick count, not real traded volume.
  Empty minutes (market closed) come through as all-zero price fields and
  are dropped.

Only weekdays are fetched. FX is closed Friday 22:00 UTC to Sunday 22:00 UTC;
skipping Sat/Sun drops the ~2h of Sunday-evening trading, which is thin and
gappy anyway, and saves ~200 requests per symbol-year.
"""
import asyncio
import logging
import lzma
import random
import struct
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pandas as pd

logger = logging.getLogger("fx_data")

DUKAS_URL = "https://datafeed.dukascopy.com/datafeed/{sym}/{y:04d}/{m:02d}/{d:02d}/BID_candles_min_1.bi5"
RECORD = struct.Struct(">iiiiif")
RECORD_SIZE = RECORD.size          # 24
MAX_CONCURRENCY = 2                # Dukascopy 429s aggressively above this
MAX_ATTEMPTS = 6
THROTTLE_S = 0.35                  # polite floor between requests
RATE_LIMIT_BACKOFF_S = (5, 15, 30, 60, 120)
RAW_CACHE = Path(__file__).resolve().parent / "data_cache" / "dukascopy"

# Dukascopy symbols are the plain 6-letter pair, e.g. EURUSD, USDJPY.
FX_SYMBOLS = ("EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCHF", "USDCAD", "NZDUSD")

# US index CFDs -- the closest freely available proxies for ES/NQ futures.
INDEX_SYMBOLS = {
    "USA500IDXUSD": "S&P 500",
    "USATECHIDXUSD": "Nasdaq 100",
    "USA30IDXUSD": "Dow 30",
}


def point_scale(symbol):
    """Int32 price fields are scaled by the instrument's point value.

    Verified empirically per family rather than assumed: EURUSD parses to
    ~1.03 at 1e5, USDJPY to ~157 at 1e3, and USA500IDXUSD to ~5852 /
    USATECHIDXUSD to ~20881 at 1e3 -- all matching the real quotes for the
    sample date. A wrong scale here would silently produce plausible-looking
    but meaningless backtests, so it is pinned per symbol family.
    """
    sym = symbol.upper()
    if sym in INDEX_SYMBOLS:
        return 1e3
    return 1e3 if "JPY" in sym else 1e5


def parse_day(blob, day_start_ms, scale):
    """Decompress one day's .bi5 and return 1-minute candles."""
    if not blob:
        return []
    try:
        data = lzma.decompress(blob, format=lzma.FORMAT_ALONE)
    except lzma.LZMAError:
        return []          # Dukascopy serves an empty/garbage body for closed days

    out = []
    for off in range(0, len(data) - RECORD_SIZE + 1, RECORD_SIZE):
        t, o, c, lo, hi, vol = RECORD.unpack_from(data, off)
        if o == 0 and hi == 0 and lo == 0 and c == 0:
            continue       # no ticks in that minute
        open_time = day_start_ms + t * 1000
        out.append({
            "open_time": open_time,
            "open": o / scale,
            "high": hi / scale,
            "low": lo / scale,
            "close": c / scale,
            "volume": float(vol),
            "close_time": open_time + 60_000 - 1,
        })
    return out


class FxDataIncomplete(RuntimeError):
    """Raised rather than silently backtesting on a dataset with holes in it.

    An earlier version returned [] for a day whose download failed, which
    quietly dropped a full trading day out of the sample -- the backtest still
    produced confident-looking numbers from incomplete data. Failing loudly is
    the whole point here.
    """


def _raw_path(symbol, day):
    return RAW_CACHE / symbol / f"{day:%Y-%m-%d}.bi5"


async def _fetch_day(client, sem, symbol, day, scale):
    """Return (candles, ok). Raw bodies are cached per day so a re-run only
    refetches what's actually missing."""
    day_ms = int(day.replace(tzinfo=timezone.utc).timestamp() * 1000)
    path = _raw_path(symbol, day)
    if path.exists():
        return parse_day(path.read_bytes(), day_ms, scale), True

    url = DUKAS_URL.format(sym=symbol, y=day.year, m=day.month - 1, d=day.day)
    async with sem:
        for attempt in range(MAX_ATTEMPTS):
            try:
                r = await client.get(url)
                if r.status_code == 429:
                    # Shared public feed -- being throttled is normal, not an
                    # error. Wait it out rather than burning the attempt budget
                    # with fast retries that make the throttling worse.
                    wait = RATE_LIMIT_BACKOFF_S[min(attempt, len(RATE_LIMIT_BACKOFF_S) - 1)]
                    retry_after = r.headers.get("Retry-After")
                    if retry_after and retry_after.isdigit():
                        wait = max(wait, int(retry_after))
                    logger.info("rate limited on %s %s, waiting %ds", symbol, day.date(), wait)
                    await asyncio.sleep(wait + random.random())
                    continue
                if r.status_code == 404:
                    body = b""          # genuinely no data (holiday); cache the fact
                else:
                    r.raise_for_status()
                    body = r.content
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(body)
                await asyncio.sleep(THROTTLE_S)
                return parse_day(body, day_ms, scale), True
            except (httpx.HTTPError, httpx.TimeoutException, OSError) as e:
                if attempt == MAX_ATTEMPTS - 1:
                    logger.warning("giving up on %s %s: %s", symbol, day.date(), e)
                    return [], False
                await asyncio.sleep((2 ** attempt) * 0.5 + random.random() * 0.3)
    logger.warning("giving up on %s %s: still rate limited after %d attempts",
                   symbol, day.date(), MAX_ATTEMPTS)
    return [], False


async def fetch_fx_minutes(symbol, start_ms, end_ms):
    """All 1-minute candles for `symbol` in [start_ms, end_ms), weekdays only.

    Raises FxDataIncomplete if any weekday failed to download after retries.
    """
    start = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    end = datetime.fromtimestamp(end_ms / 1000, tz=timezone.utc)

    days = []
    cur = start
    while cur <= end:
        if cur.weekday() < 5:
            days.append(cur)
        cur += timedelta(days=1)

    scale = point_scale(symbol)
    sem = asyncio.Semaphore(MAX_CONCURRENCY)
    limits = httpx.Limits(max_connections=MAX_CONCURRENCY, max_keepalive_connections=MAX_CONCURRENCY)
    async with httpx.AsyncClient(timeout=30.0, limits=limits) as client:
        results = await asyncio.gather(*(_fetch_day(client, sem, symbol, d, scale) for d in days))

    failed = [d.date() for d, (_, ok) in zip(days, results) if not ok]
    if failed:
        raise FxDataIncomplete(
            f"{symbol}: {len(failed)} of {len(days)} weekdays failed to download "
            f"(first few: {failed[:5]}). Re-run to retry just those days -- "
            f"successful days are cached."
        )

    candles = [c for chunk, _ in results for c in chunk]
    candles.sort(key=lambda c: c["open_time"])

    empty_days = sum(1 for chunk, _ in results if not chunk)
    logger.info("%s: %d weekdays fetched, %d with no data (holidays), %d minute bars",
                symbol, len(days), empty_days, len(candles))

    return [c for c in candles if start_ms <= c["open_time"] < end_ms]


def aggregate(minute_candles, interval):
    """Roll 1-minute candles up to `interval` (e.g. '5m').

    Bars are aligned to the UTC epoch, the same convention Binance uses, so a
    15m bar always starts at :00/:15/:30/:45 on every venue.
    """
    if not minute_candles:
        return []
    step_ms = {"1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000}[interval]
    if step_ms == 60_000:
        return minute_candles

    df = pd.DataFrame(minute_candles)
    df["bucket"] = (df["open_time"] // step_ms) * step_ms
    g = df.groupby("bucket", sort=True).agg(
        open=("open", "first"),
        high=("high", "max"),
        low=("low", "min"),
        close=("close", "last"),
        volume=("volume", "sum"),
    ).reset_index()
    g["open_time"] = g["bucket"]
    g["close_time"] = g["bucket"] + step_ms - 1
    return g.drop(columns=["bucket"]).to_dict("records")


def fetch_fx_candles(symbol, interval, start_ms, end_ms):
    minutes = asyncio.run(fetch_fx_minutes(symbol, start_ms, end_ms))
    return aggregate(minutes, interval)
