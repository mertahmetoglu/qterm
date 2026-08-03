// One-off manual smoke test for /ws/signals -- connects, prints the first
// few messages (trimming the long indicator arrays for readability), exits.
const url = process.argv[2] || 'ws://127.0.0.1:8123/ws/signals'
const ws = new WebSocket(url)
let count = 0

function trim(msg) {
  const clone = JSON.parse(JSON.stringify(msg))
  if (clone.signal) {
    for (const k of ['ema9', 'ema21', 'rsiArr', 'macdLine', 'signalLine', 'histogram', 'bb']) {
      if (clone.signal[k]) clone.signal[k] = `[${clone.signal[k].length} points]`
    }
  }
  return clone
}

ws.addEventListener('open', () => console.log('[open]'))
ws.addEventListener('error', (e) => console.log('[error]', e.message))
ws.addEventListener('message', (e) => {
  count++
  console.log(`[message ${count}]`, JSON.stringify(trim(JSON.parse(e.data))))
  if (count >= 3) {
    ws.close()
    process.exit(0)
  }
})

setTimeout(() => {
  console.log('[timeout] no 3 messages within 15s, closing')
  ws.close()
  process.exit(1)
}, 15000)
