"""FastAPI app: owns the signal engine, streams processed signals to the React
dashboard over WebSocket. The frontend never computes an indicator or a
signal -- those come from here, so the dashboard shows exactly the strategy
the backtester runs. What the frontend does own is the price display: it
builds its own candles from Binance's raw trade stream.
"""
import asyncio
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from market_data import MarketDataFeed
from signal_engine import ATR_PERIOD, ATR_STOP_MULT, LEVERAGE, REWARD_RISK

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

SYMBOL = "BTCUSDT"
INTERVAL = "15m"
REPORTS_DIR = Path(__file__).resolve().parent / "reports"
BACKTEST_RESULT_PATH = REPORTS_DIR / "backtest_result.json"
MATRIX_PATH = REPORTS_DIR / "matrix.json"

feed = MarketDataFeed(symbol=SYMBOL, interval=INTERVAL)


def _config():
    return {
        "symbol": SYMBOL, "interval": INTERVAL, "leverage": LEVERAGE,
        "atrPeriod": ATR_PERIOD, "atrStopMult": ATR_STOP_MULT, "rewardRisk": REWARD_RISK,
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(feed.run())
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "connected": feed.connected,
        "symbol": feed.symbol,
        "interval": feed.interval,
        "candles_buffered": len(feed.closes),
        "latency_ms": feed.latency_stats(),
    }


@app.get("/api/config")
def config():
    return _config()


@app.get("/api/matrix")
def matrix_result():
    """The confluence strategy across every market run_matrix.py covers.
    Served as-is; the dashboard renders it read-only."""
    if not MATRIX_PATH.exists():
        raise HTTPException(status_code=404, detail="No matrix yet -- run backend/run_matrix.py first.")
    return json.loads(MATRIX_PATH.read_text())


@app.get("/api/backtest")
def backtest_result():
    # Reads whatever backtest.py last wrote -- the backtest itself stays an
    # offline/CLI process (see README), this just serves its output.
    if not BACKTEST_RESULT_PATH.exists():
        raise HTTPException(status_code=404, detail="No backtest result yet -- run backend/backtest.py first.")
    return json.loads(BACKTEST_RESULT_PATH.read_text())


@app.websocket("/ws/signals")
async def ws_signals(websocket: WebSocket):
    await websocket.accept()
    queue = feed.subscribe()
    try:
        await websocket.send_json({
            "type": "snapshot",
            "connected": feed.connected,
            "ticker": feed.ticker,
            "signal": feed.signal,
            **feed.series(),
            "config": _config(),
        })
        while True:
            message = await queue.get()
            await websocket.send_json(message)
    except WebSocketDisconnect:
        pass
    except Exception:
        logging.getLogger("main").exception("ws/signals handler error")
    finally:
        feed.unsubscribe(queue)
