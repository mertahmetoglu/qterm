"""Targeted test for MarketDataFeed._backfill_gap -- the piece that can't be
exercised reliably by just killing a process, since it fires specifically
when the backend's Binance WebSocket (not the whole backend) drops and
reconnects. Bootstraps normally, artificially rewinds last_open_time to
simulate having missed a few candles, then confirms the gap actually gets
recovered via REST before the stream would be trusted again.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from market_data import MarketDataFeed, INTERVAL_MS


async def main():
    feed = MarketDataFeed(symbol="BTCUSDT", interval="15m")
    await feed.bootstrap()

    before_len = len(feed.closes)
    real_last_open = feed.last_open_time
    missed = 3
    feed.last_open_time = real_last_open - missed * INTERVAL_MS["15m"]
    print(f"bootstrapped {before_len} candles, real last_open_time={real_last_open}")
    print(f"simulating a disconnect that missed {missed} candles "
          f"(rewound last_open_time to {feed.last_open_time})")

    await feed._backfill_gap()

    after_len = len(feed.closes)
    print(f"after backfill: {after_len} candles, last_open_time={feed.last_open_time}")

    ok = feed.last_open_time >= real_last_open and after_len >= before_len
    if not ok:
        print("FAIL: gap backfill did not recover the missing candle(s)")
        sys.exit(1)
    print(f"OK: last_open_time advanced back to (or past) the real latest candle, "
          f"buffer length {before_len} -> {after_len}")


if __name__ == "__main__":
    asyncio.run(main())
