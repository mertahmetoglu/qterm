// Checks the dashboard's trade -> candle aggregation (src/lib/candles.js, the
// exact module the React hook runs) against Binance's own klines.
//
//   node scripts/check_candle_aggregation.mjs            historical: rebuild the
//                                                        last 3 closed 15m candles
//                                                        from REST aggTrades
//   node scripts/check_candle_aggregation.mjs --live 4   live: aggregate the real
//                                                        @trade stream into 1m
//                                                        candles for ~4 minutes
//
// Every candle must match the exchange kline exactly on open/high/low/close and
// to float precision on volume. Exits non-zero on any mismatch.
import { CandleAggregator, INTERVAL_MS, parseTrade } from '../../src/lib/candles.js'

const REST = 'https://api.binance.com/api/v3'
const SYMBOL = 'BTCUSDT'

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function getJson(path, params) {
  const res = await fetch(`${REST}/${path}?${new URLSearchParams({ symbol: SYMBOL, ...params })}`)
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

const klines = (interval, startTime, limit) =>
  getJson('klines', { interval, startTime, limit }).then(rows => rows.map(r => ({
    openTime: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5], trades: r[8],
  })))

function compare(label, mine, ref) {
  const problems = []
  for (const k of ['open', 'high', 'low', 'close']) {
    if (mine[k] !== ref[k]) problems.push(`${k} ${mine[k]} != ${ref[k]}`)
  }
  if (Math.abs(mine.volume - ref.volume) > 1e-6 * Math.max(1, ref.volume)) {
    problems.push(`volume ${mine.volume} != ${ref.volume}`)
  }
  const t = new Date(ref.openTime).toISOString().slice(11, 16)
  console.log(`${problems.length ? '[FAIL]' : '[ OK ]'} ${label} ${t} UTC  o=${ref.open} h=${ref.high} l=${ref.low} c=${ref.close} v=${ref.volume}` +
    (problems.length ? `\n       ${problems.join('; ')}` : ''))
  return problems.length === 0
}

// Every aggregate trade in [start, end), oldest first. An aggTrade is one or
// more fills at the same price by the same taker order, so its quantity is the
// sum of those fills -- OHLCV built from aggTrades must equal OHLCV built from
// individual trades.
async function aggTradesBetween(start, end) {
  const out = []
  let batch = await getJson('aggTrades', { startTime: start, endTime: end - 1, limit: 1000 })
  while (batch.length) {
    out.push(...batch)
    if (batch.length < 1000) break
    await sleep(100)
    batch = (await getJson('aggTrades', { fromId: batch[batch.length - 1].a + 1, limit: 1000 }))
      .filter(t => t.T < end)
  }
  return out
}

async function historical(count = 3) {
  const ms = INTERVAL_MS['15m']
  const lastClosed = Math.floor(Date.now() / ms) * ms - ms
  const start = lastClosed - (count - 1) * ms
  const refs = await klines('15m', start, count)

  const agg = new CandleAggregator(ms, 10)
  let fills = 0
  for (const ref of refs) {
    const trades = await aggTradesBetween(ref.openTime, ref.openTime + ms)
    fills += trades.reduce((n, t) => n + (t.l - t.f + 1), 0)
    for (const t of trades) agg.addTrade({ id: t.a, price: +t.p, qty: +t.q, time: t.T })
    console.log(`  ${trades.length} aggTrades (${trades.reduce((n, t) => n + (t.l - t.f + 1), 0)} fills; kline reports ${ref.trades})`)
  }

  let ok = true
  for (const ref of refs) {
    const mine = agg.candles.find(c => c.openTime === ref.openTime)
    ok = (mine ? compare('15m', mine, ref) : (console.log(`[FAIL] missing candle ${ref.openTime}`), false)) && ok
  }
  return ok
}

async function live(minutes) {
  const ms = INTERVAL_MS['1m']
  const agg = new CandleAggregator(ms, 50)
  const closed = []
  let received = 0
  // The candle in progress when the socket opened is missing its first trades,
  // so only candles that started after the open are compared. Taken from the
  // open event, not from before connecting: the handshake can cross a boundary.
  let firstFull = Infinity

  const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${SYMBOL.toLowerCase()}@trade`)
  ws.onmessage = e => {
    const msg = JSON.parse(e.data)
    if (msg.e !== 'trade') return
    received++
    const done = agg.addTrade(parseTrade(msg))
    if (done && done.openTime >= firstFull) closed.push({ ...done })
  }
  await new Promise((resolve, reject) => {
    ws.onopen = () => { firstFull = Math.floor(Date.now() / ms) * ms + ms; resolve() }
    ws.onerror = reject
  })
  console.log(`connected to ${SYMBOL}@trade, aggregating 1m candles for ~${minutes} min ...`)
  const deadline = Date.now() + minutes * 60_000
  while (Date.now() < deadline) await sleep(1000)
  await new Promise(resolve => { ws.onclose = resolve; ws.close() })

  console.log(`${received} trades received, ${agg.duplicateTrades} duplicates, ${agg.lateTrades} late`)
  if (!closed.length) {
    console.log('[FAIL] no fully observed candle closed -- run for longer')
    return false
  }
  await sleep(2000)
  const refs = await klines('1m', closed[0].openTime, closed.length)
  let ok = true
  for (const mine of closed) {
    const ref = refs.find(r => r.openTime === mine.openTime)
    ok = (ref ? compare('1m ', mine, ref) : (console.log(`[FAIL] no kline for ${mine.openTime}`), false)) && ok
  }
  return ok
}

const liveIdx = process.argv.indexOf('--live')
const ok = liveIdx >= 0 ? await live(Number(process.argv[liveIdx + 1] ?? 4)) : await historical()
console.log(ok ? 'AGGREGATION OK -- every candle matches the exchange kline' : 'AGGREGATION FAILED')
process.exitCode = ok ? 0 : 1
