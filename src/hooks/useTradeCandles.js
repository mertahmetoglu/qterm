import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CandleAggregator, INTERVAL_MS, klineToCandle, parseTrade } from '../lib/candles'
import useWebSocket from './useWebSocket'

const REST_KLINES = 'https://api.binance.com/api/v3/klines'
const WS_BASE = 'wss://stream.binance.com:9443/ws'

// BTCUSDT prints many trades a second, sometimes hundreds. Aggregation runs on
// every trade; React state is committed at most this often.
const FLUSH_MS = 250
// Give the exchange a moment to finalise a kline before fetching it as final.
const RECONCILE_DELAY_MS = 2000

// Binance's raw trade stream, aggregated into candles in the browser.
//
//   connect ──▶ seed history from REST ──▶ apply trades buffered meanwhile
//      │                                          │
//      │            every trade ──▶ CandleAggregator (bucket by trade time)
//      │                                          │
//      │                   candle closes ──▶ if it was a REST snapshot,
//      │                                     replace it with the final kline
//      ▼
//   reconnect ──▶ backfill everything since the last candle, then resume
export default function useTradeCandles({ symbol = 'BTCUSDT', interval = '15m', limit = 300 } = {}) {
  const intervalMs = INTERVAL_MS[interval]
  const agg = useMemo(() => new CandleAggregator(intervalMs, limit), [symbol, intervalMs, limit])

  const [state, setState] = useState({ candles: [], lastPrice: null, lastTradeTime: null, error: null })
  const seeding = useRef(false)
  const buffered = useRef([])
  const flushTimer = useRef(null)

  const flush = useCallback(() => {
    flushTimer.current = null
    setState(s => ({
      ...s,
      candles: agg.snapshot(),
      lastPrice: agg.lastPrice,
      lastTradeTime: agg.lastTradeTime,
    }))
  }, [agg])

  const scheduleFlush = useCallback(() => {
    if (!flushTimer.current) flushTimer.current = setTimeout(flush, FLUSH_MS)
  }, [flush])

  useEffect(() => () => clearTimeout(flushTimer.current), [])

  const fetchCandles = useCallback(async params => {
    const fetchedAt = Date.now()
    const query = new URLSearchParams({ symbol, interval, ...params })
    const res = await fetch(`${REST_KLINES}?${query}`)
    if (!res.ok) throw new Error(`klines HTTP ${res.status}`)
    return (await res.json()).map(row => klineToCandle(row, fetchedAt))
  }, [symbol, interval])

  const reconcile = useCallback(async openTime => {
    try {
      agg.merge(await fetchCandles({ startTime: openTime, limit: 1 }))
      scheduleFlush()
    } catch {
      // Keep the aggregated version; it's only volume that may be off.
    }
  }, [agg, fetchCandles, scheduleFlush])

  const apply = useCallback(trade => {
    const closed = agg.addTrade(trade)
    if (closed?.partial) setTimeout(() => reconcile(closed.openTime), RECONCILE_DELAY_MS)
  }, [agg, reconcile])

  // Runs on the first connect and on every reconnect. Trades that arrive while
  // the REST request is in flight are held back and applied after the merge,
  // so a snapshot never overwrites a trade that happened after it.
  const seed = useCallback(async () => {
    seeding.current = true
    try {
      const since = agg.lastOpenTime
      agg.merge(await fetchCandles(since == null ? { limit } : { startTime: since, limit: 1000 }))
      setState(s => (s.error ? { ...s, error: null } : s))
    } catch (e) {
      setState(s => ({ ...s, error: e.message }))
    } finally {
      seeding.current = false
      for (const trade of buffered.current.splice(0)) apply(trade)
      scheduleFlush()
    }
  }, [agg, fetchCandles, limit, apply, scheduleFlush])

  const onMessage = useCallback(event => {
    let msg
    try { msg = JSON.parse(event.data) } catch { return }
    if (msg.e !== 'trade') return
    const trade = parseTrade(msg)
    if (seeding.current) buffered.current.push(trade)
    else apply(trade)
    scheduleFlush()
  }, [apply, scheduleFlush])

  const { status, reconnects } = useWebSocket(`${WS_BASE}/${symbol.toLowerCase()}@trade`, {
    onMessage,
    onOpen: seed,
    staleAfterMs: 15_000,
  })

  return { ...state, status, reconnects, duplicateTrades: agg.duplicateTrades, lateTrades: agg.lateTrades }
}
