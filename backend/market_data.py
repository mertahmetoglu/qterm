"""Market data ingestion.

Two responsibilities that both backtest.py and the live feed share:
  - REST kline fetch/pagination (Binance caps a single request at 1000 candles)
  - kline row parsing

Plus the live side: a WebSocket feed with exponential-backoff reconnect,
gap detection/backfill (compare last known candle to a fresh REST fetch after
a disconnect, so a dropped connection doesn't silently leave a hole in the
chart), and latency tracking (exchange event time vs local receive time).
"""
import asyncio
import json
import logging
import time
from collections import deque

import httpx
import websockets
from websockets.exceptions import ConnectionClosed

from signal_engine import compute_signal

logger = logging.getLogger("market_data")

BASE_URL = "https://api.binance.com"
WS_BASE = "wss://stream.binance.com:9443/stream"

INTERVAL_MS = {
    "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
    "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000,
    "6h": 21_600_000, "8h": 28_800_000, "12h": 43_200_000, "1d": 86_400_000,
}

BUFFER_SIZE = 300
MAX_BACKOFF_S = 30
BROADCAST_MIN_INTERVAL_S = 0.25


def parse_kline(row):
    return {
        "open_time": row[0],
        "open": float(row[1]),
        "high": float(row[2]),
        "low": float(row[3]),
        "close": float(row[4]),
        "volume": float(row[5]),
        "close_time": row[6],
    }


async def fetch_klines(client, symbol, interval, limit=500, start_time=None, end_time=None):
    params = {"symbol": symbol, "interval": interval, "limit": limit}
    if start_time is not None:
        params["startTime"] = start_time
    if end_time is not None:
        params["endTime"] = end_time
    resp = await client.get(f"{BASE_URL}/api/v3/klines", params=params)
    resp.raise_for_status()
    return [parse_kline(row) for row in resp.json()]


async def fetch_klines_range(symbol, interval, start_time_ms, end_time_ms, client=None, delay_s=0.12):
    """Paginate past Binance's 1000-candle cap to cover an arbitrary date range.
    Shared by the live bootstrap (last 300 candles) and backtest.py (years of data).
    """
    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=20.0)
    out = []
    try:
        cursor = start_time_ms
        step_ms = INTERVAL_MS[interval]
        while cursor <= end_time_ms:
            batch = await fetch_klines(client, symbol, interval, limit=1000, start_time=cursor, end_time=end_time_ms)
            if not batch:
                break
            out.extend(batch)
            cursor = batch[-1]["open_time"] + step_ms
            if len(batch) < 1000:
                break
            await asyncio.sleep(delay_s)
    finally:
        if owns_client:
            await client.aclose()
    return out


class MarketDataFeed:
    """Owns the live candle buffer + latest signal/ticker, streams Binance
    ticker+kline over one combined WebSocket, and fans updates out to
    subscriber queues (one per connected frontend client).

    Signals are computed from Binance's own klines -- the same candles the
    backtest downloads over REST -- so a live signal and a backtested one are
    built from identical bars. The dashboard's price chart is built separately,
    in the browser, from the raw trade stream (src/hooks/useTradeCandles.js),
    and joins these indicator series onto its candles by open time.
    """

    def __init__(self, symbol="BTCUSDT", interval="15m"):
        self.symbol = symbol
        self.interval = interval
        self.times = deque(maxlen=BUFFER_SIZE)
        self.highs = deque(maxlen=BUFFER_SIZE)
        self.lows = deque(maxlen=BUFFER_SIZE)
        self.closes = deque(maxlen=BUFFER_SIZE)
        self.last_open_time = None
        self.ticker = None
        self.signal = None
        self.connected = False
        self.latencies_ms = deque(maxlen=50)
        self._subscribers = set()
        self._last_signal_broadcast = 0.0

    def subscribe(self):
        q = asyncio.Queue(maxsize=64)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q):
        self._subscribers.discard(q)

    def _publish(self, message):
        message["connected"] = self.connected
        for q in list(self._subscribers):
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                pass  # slow client -- drop rather than block ingestion for everyone else

    async def bootstrap(self):
        async with httpx.AsyncClient(timeout=20.0) as client:
            klines = await fetch_klines(client, self.symbol, self.interval, limit=BUFFER_SIZE)
        for k in klines:
            self._upsert_candle(k["open_time"], k["high"], k["low"], k["close"])
        self._recompute_signal()
        logger.info("bootstrapped %d candles (%s %s)", len(self.closes), self.symbol, self.interval)

    def _upsert_candle(self, open_time, high, low, close):
        """Update the candle in place if it's the one already at the end of the
        buffer, append it if it's newer, ignore it if it's older.

        Keyed by open time rather than by the kline's closed flag: REST
        bootstrap already includes the still-forming candle, so appending on
        `x == true` would leave that candle in the buffer twice until the next
        update overwrote the wrong slot.
        """
        if self.last_open_time is not None and open_time < self.last_open_time:
            return False
        if open_time == self.last_open_time:
            self.highs[-1], self.lows[-1], self.closes[-1] = high, low, close
            return False
        self.times.append(open_time)
        self.highs.append(high)
        self.lows.append(low)
        self.closes.append(close)
        self.last_open_time = open_time
        return True

    def _recompute_signal(self):
        if len(self.closes) >= 50:
            self.signal = compute_signal(list(self.closes), list(self.highs), list(self.lows))

    def series(self):
        return {"times": list(self.times), "closes": list(self.closes)}

    async def _backfill_gap(self):
        """After a (re)connect, check whether real time has moved further
        than one candle past what we last recorded -- i.e. we missed at
        least one closed candle while disconnected -- and fetch the gap via
        REST before trusting the stream again."""
        if self.last_open_time is None:
            return
        step_ms = INTERVAL_MS[self.interval]
        now_ms = int(time.time() * 1000)
        expected_open = self.last_open_time + step_ms
        if now_ms - expected_open < step_ms:
            return  # no full candle missed
        async with httpx.AsyncClient(timeout=20.0) as client:
            missed = await fetch_klines(client, self.symbol, self.interval, limit=1000,
                                         start_time=expected_open, end_time=now_ms)
        recovered = 0
        for k in missed:
            if self._upsert_candle(k["open_time"], k["high"], k["low"], k["close"]):
                recovered += 1
        if recovered:
            logger.warning("reconnect gap backfilled: %d missed candle(s) recovered via REST", recovered)
            self._recompute_signal()

    async def run(self):
        await self.bootstrap()
        stream = f"{self.symbol.lower()}@ticker/{self.symbol.lower()}@kline_{self.interval}"
        url = f"{WS_BASE}?streams={stream}"
        backoff = 1.0
        first_connect = True
        while True:
            try:
                async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
                    self.connected = True
                    backoff = 1.0
                    if not first_connect:
                        await self._backfill_gap()
                    first_connect = False
                    logger.info("connected to binance combined stream (%s)", stream)
                    async for raw in ws:
                        self._handle_message(raw)
            except (ConnectionClosed, OSError, asyncio.TimeoutError) as e:
                self.connected = False
                logger.warning("ws disconnected (%s), reconnecting in %.1fs", e, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF_S)
            except Exception:
                self.connected = False
                logger.exception("unexpected error in market data loop, retrying in %.1fs", backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF_S)

    def _handle_message(self, raw):
        msg = json.loads(raw)
        stream = msg.get("stream", "")
        data = msg.get("data", {})
        event_time = data.get("E")
        if event_time is not None:
            self.latencies_ms.append(max(0, int(time.time() * 1000) - event_time))

        if stream.endswith("@ticker"):
            self.ticker = {
                "price": float(data["c"]),
                "change": float(data["P"]),
                "high": float(data["h"]),
                "low": float(data["l"]),
                "vol": float(data["q"]),
            }
            self._publish({"type": "ticker", "ticker": self.ticker})

        elif "@kline_" in stream:
            k = data.get("k")
            if not k:
                return
            self._upsert_candle(k["t"], float(k["h"]), float(k["l"]), float(k["c"]))
            self._recompute_signal()
            now = time.monotonic()
            # A candle close is always published, whatever the throttle says:
            # it's the update the next bar's signal is built on.
            if k["x"] or now - self._last_signal_broadcast >= BROADCAST_MIN_INTERVAL_S:
                self._last_signal_broadcast = now
                self._publish({"type": "signal", "signal": self.signal, **self.series()})

    def latency_stats(self):
        if not self.latencies_ms:
            return {"count": 0}
        vals = list(self.latencies_ms)
        return {"count": len(vals), "min_ms": min(vals), "avg_ms": round(sum(vals) / len(vals)), "max_ms": max(vals)}
