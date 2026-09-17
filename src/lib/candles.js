// Trade -> candle aggregation. Plain JS with no React and no network, so the
// same code the dashboard runs can be checked offline against Binance's own
// klines (backend/scripts/check_candle_aggregation.mjs).
//
// Candles are keyed by open time, aligned to the UTC epoch the way Binance
// aligns klines: a 15m candle covers [openTime, openTime + 15m).

export const INTERVAL_MS = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
  '30m': 1_800_000, '1h': 3_600_000, '4h': 14_400_000,
}

export const bucketStart = (time, intervalMs) => Math.floor(time / intervalMs) * intervalMs

// Binance @trade event -> trade. `id` is Binance's per-symbol trade id, which
// only ever increases, so it doubles as a sequence number for dedupe.
export const parseTrade = msg => ({ id: msg.t, price: +msg.p, qty: +msg.q, time: msg.T })

// Binance REST kline row -> candle. A kline still open when it was fetched is
// marked `partial`: its OHLCV is a snapshot, and live trades applied on top of
// it can overlap trades the snapshot already counted (prices are unaffected --
// high/low are max/min and close is the latest trade -- but volume and trade
// count can come out slightly high). A partial candle is replaced by the
// exchange's final kline once it closes.
export function klineToCandle(row, fetchedAt) {
  return {
    openTime: row[0],
    open: +row[1],
    high: +row[2],
    low: +row[3],
    close: +row[4],
    volume: +row[5],
    closeTime: row[6],
    trades: row[8],
    partial: row[6] >= fetchedAt,
  }
}

export class CandleAggregator {
  constructor(intervalMs, limit = 300) {
    this.intervalMs = intervalMs
    this.limit = limit
    this.candles = []
    this.lastTradeId = -1
    this.lastPrice = null
    this.lastTradeTime = null
    this.duplicateTrades = 0
    this.lateTrades = 0
  }

  get lastOpenTime() {
    return this.candles.length ? this.candles[this.candles.length - 1].openTime : null
  }

  // Upsert candles from REST (initial history, reconnect backfill, or the
  // final version of a partial candle). Incoming candles replace existing ones
  // with the same open time.
  merge(incoming) {
    if (!incoming.length) return
    const byTime = new Map(this.candles.map(c => [c.openTime, c]))
    for (const c of incoming) byTime.set(c.openTime, { ...c })
    this.candles = [...byTime.values()]
      .sort((a, b) => a.openTime - b.openTime)
      .slice(-this.limit)
  }

  // Apply one trade. Returns the candle this trade closed, if it opened a new
  // bucket, otherwise null.
  addTrade(trade) {
    if (trade.id <= this.lastTradeId) {
      this.duplicateTrades++          // redelivered after a reconnect
      return null
    }
    this.lastTradeId = trade.id

    const openTime = bucketStart(trade.time, this.intervalMs)
    const last = this.candles[this.candles.length - 1]

    if (last && openTime < last.openTime) {
      // Belongs to a candle that has already closed. Only happens around a
      // reconnect, where that candle is backfilled from REST anyway, so the
      // trade is counted and dropped rather than patched in twice.
      this.lateTrades++
      return null
    }

    this.lastPrice = trade.price
    this.lastTradeTime = trade.time

    if (last && openTime === last.openTime) {
      last.high = Math.max(last.high, trade.price)
      last.low = Math.min(last.low, trade.price)
      last.close = trade.price
      last.volume += trade.qty
      last.trades += 1
      return null
    }

    this.candles.push({
      openTime,
      closeTime: openTime + this.intervalMs - 1,
      open: trade.price,
      high: trade.price,
      low: trade.price,
      close: trade.price,
      volume: trade.qty,
      trades: 1,
      partial: false,
    })
    if (this.candles.length > this.limit) this.candles.shift()
    return last ?? null
  }

  // A copy React can treat as immutable. Only the newest candle is mutated in
  // place by addTrade (merge always builds new objects), so that's the only
  // one that needs cloning.
  snapshot() {
    const n = this.candles.length
    if (!n) return []
    const out = this.candles.slice()
    out[n - 1] = { ...out[n - 1] }
    return out
  }
}
