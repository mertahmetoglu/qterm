export function ema(prices, period) {
  if (prices.length < period) return new Array(prices.length).fill(null)
  const k = 2 / (period + 1)
  const result = new Array(prices.length).fill(null)
  let e = prices.slice(0, period).reduce((a, b) => a + b, 0) / period
  result[period - 1] = e
  for (let i = period; i < prices.length; i++) {
    e = prices[i] * k + e * (1 - k)
    result[i] = e
  }
  return result
}

export function calcRSI(prices, period = 14) {
  const result = new Array(prices.length).fill(null)
  if (prices.length < period + 1) return result
  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const d = prices[i] - prices[i - 1]
    if (d > 0) gains += d; else losses -= d
  }
  let avgGain = gains / period, avgLoss = losses / period
  result[period] = 100 - 100 / (1 + (avgLoss === 0 ? 1e9 : avgGain / avgLoss))
  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period
    result[i] = 100 - 100 / (1 + (avgLoss === 0 ? 1e9 : avgGain / avgLoss))
  }
  return result
}

export function calcMACD(prices, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(prices, fast)
  const emaSlow = ema(prices, slow)
  const macdLine = prices.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  )
  const validMacd = macdLine.filter(v => v != null)
  const sigEma = ema(validMacd, signal)
  let idx = 0
  const signalLine = macdLine.map(v => v == null ? null : sigEma[idx++] ?? null)
  const histogram = macdLine.map((v, i) =>
    v != null && signalLine[i] != null ? v - signalLine[i] : null
  )
  return { macdLine, signalLine, histogram }
}

export function calcBollinger(prices, period = 20, mult = 2) {
  return prices.map((_, i) => {
    if (i < period - 1) return { upper: null, middle: null, lower: null }
    const slice = prices.slice(i - period + 1, i + 1)
    const mean = slice.reduce((a, b) => a + b, 0) / period
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period)
    return { upper: mean + mult * std, middle: mean, lower: mean - mult * std }
  })
}

export function computeSignal(closes) {
  if (closes.length < 50) return null
  const ema9  = ema(closes, 9)
  const ema21 = ema(closes, 21)
  const rsiArr = calcRSI(closes, 14)
  const { macdLine, signalLine, histogram } = calcMACD(closes)
  const bb = calcBollinger(closes, 20)
  const n = closes.length - 1
  const price = closes[n]
  const e9 = ema9[n], e9p = ema9[n-1]
  const e21 = ema21[n], e21p = ema21[n-1]
  const r = rsiArr[n]
  const m = macdLine[n], mp = macdLine[n-1]
  const sig = signalLine[n], sigp = signalLine[n-1]
  const h = histogram[n]
  const { upper: bbu, lower: bbl, middle: bbm } = bb[n]
  if ([e9, e21, r, m, sig, h, bbu, bbl].some(v => v == null)) return null

  const scores = {
    ema:  (e9 > e21 && e9p <= e21p) ? 2 : (e9 > e21) ? 1 : (e9 < e21 && e9p >= e21p) ? -2 : -1,
    rsi:  r < 30 ? 2 : r < 45 ? 1 : r > 70 ? -2 : r > 55 ? -1 : 0,
    macd: (m > sig && mp <= sigp) ? 2 : (m > sig && h > 0) ? 1 : (m < sig && mp >= sigp) ? -2 : (m < sig && h < 0) ? -1 : 0,
    bb:   price < bbl ? 2 : price > bbu ? -2 : price < bbm ? 1 : price > bbm ? -1 : 0,
  }
  const total = Object.values(scores).reduce((a, b) => a + b, 0)
  const strength = Math.round(Math.abs(total) / 8 * 100)
  let signal, color
  if      (total >= 4)  { signal = 'STRONG BUY';  color = '#00ff88' }
  else if (total >= 2)  { signal = 'BUY';          color = '#00cc66' }
  else if (total <= -4) { signal = 'STRONG SELL';  color = '#ff3355' }
  else if (total <= -2) { signal = 'SELL';          color = '#cc2244' }
  else                  { signal = 'HOLD';          color = '#ffd700' }

  return { signal, color, strength, total, scores, price, e9, e21, rsi: r, macdHist: h, bbUpper: bbu, bbLower: bbl, bbMid: bbm, ema9, ema21, rsiArr, macdLine, signalLine, histogram, bb }
}
