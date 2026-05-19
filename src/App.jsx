import { useState, useEffect, useRef, useCallback } from 'react'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { computeSignal } from './indicators'

const C = {
  bg: '#060a0d', panel: '#0c1218', border: '#162030',
  green: '#00ff88', red: '#ff3355', yellow: '#ffd700',
  blue: '#00aaff', purple: '#aa55ff', orange: '#ff8800',
  muted: '#2a4060', text: '#c8dde8', dim: '#4a6a7a',
}

const LEVERAGE = 10
const STOP_PCT = 0.005   // 0.5% fiyat hareketi = 5% capital loss with 10x
const TP_PCT   = 0.015   // 1.5% fiyat hareketi = 15% capital gain with 10x (1:3 R/R)

const fmt = p => {
  if (p == null) return '—'
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (p >= 1)    return p.toFixed(4)
  return p.toFixed(6)
}
const cc = n => n >= 0 ? C.green : C.red
const pct = n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%'

function Panel({ title, children, style }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: '12px 14px', ...style }}>
      <div style={{ color: C.dim, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10, borderBottom: `1px solid ${C.border}`, paddingBottom: 6 }}>{title}</div>
      {children}
    </div>
  )
}

const ChartTip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const v = payload[0].value
  return (
    <div style={{ background: '#0d1a22', border: `1px solid ${C.border}`, padding: '5px 10px', borderRadius: 4 }}>
      <span style={{ color: C.green, fontFamily: 'monospace', fontSize: 11 }}>
        {typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
      </span>
    </div>
  )
}

function TradeRow({ trade, currentPrice }) {
  // Check if TP or SL hit
  let status = trade.status
  let pnlPct = null

  if (status === 'OPEN' && currentPrice) {
    if (trade.direction === 'LONG') {
      if (currentPrice >= trade.tp)       status = 'TP ✓'
      else if (currentPrice <= trade.sl)  status = 'SL ✗'
    } else {
      if (currentPrice <= trade.tp)       status = 'TP ✓'
      else if (currentPrice >= trade.sl)  status = 'SL ✗'
    }
  }

  if (status === 'TP ✓') pnlPct = TP_PCT * LEVERAGE * 100
  else if (status === 'SL ✗') pnlPct = -STOP_PCT * LEVERAGE * 100
  else if (currentPrice) {
    // unrealized
    const raw = trade.direction === 'LONG'
      ? (currentPrice - trade.entry) / trade.entry
      : (trade.entry - currentPrice) / trade.entry
    pnlPct = raw * LEVERAGE * 100
  }

  const statusColor = status === 'TP ✓' ? C.green : status === 'SL ✗' ? C.red : C.yellow

  return (
    <div style={{
      marginBottom: 8, padding: '8px 10px',
      background: statusColor + '0d', borderRadius: 4,
      borderLeft: `3px solid ${statusColor}`,
      fontSize: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ color: trade.direction === 'LONG' ? C.green : C.red, fontWeight: 700 }}>
          {trade.direction} · {trade.signal}
        </span>
        <span style={{ color: statusColor, fontWeight: 700 }}>{status}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 10px', color: C.dim }}>
        <span>Giriş: <span style={{ color: C.text }}>${fmt(trade.entry)}</span></span>
        <span>Güç: <span style={{ color: C.text }}>{trade.strength}%</span></span>
        <span style={{ color: C.red }}>SL: ${fmt(trade.sl)}</span>
        <span style={{ color: C.green }}>TP: ${fmt(trade.tp)}</span>
        <span>Zaman: <span style={{ color: C.text }}>{trade.time}</span></span>
        {pnlPct !== null && (
          <span>P&L: <span style={{ color: pnlPct >= 0 ? C.green : C.red, fontWeight: 700 }}>
            {pct(pnlPct)} ({LEVERAGE}x)
          </span></span>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [closes, setCloses]       = useState([])
  const [ticker, setTicker]       = useState(null)
  const [connected, setConnected] = useState(false)
  const [signal, setSignal]       = useState(null)
  const [trades, setTrades]       = useState([])
  const [booting, setBooting]     = useState(true)
  const [time, setTime]           = useState(new Date())
  const prevSig                   = useRef(null)
  const wsPrice                   = useRef(null)
  const wsKline                   = useRef(null)

  // ── Fetch 300 historical 15m klines on boot ────────────────────────────────
  useEffect(() => {
    fetch('/binance/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=300')
      .then(r => r.json())
      .then(data => {
        setCloses(data.map(k => parseFloat(k[4])))
        setBooting(false)
      })
      .catch(() => setBooting(false))
  }, [])

  // ── WebSocket: live ticker ─────────────────────────────────────────────────
  const connectTicker = useCallback(() => {
    if (wsPrice.current) wsPrice.current.close()
    const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@ticker')
    wsPrice.current = ws
    ws.onopen  = () => setConnected(true)
    ws.onclose = () => { setConnected(false); setTimeout(connectTicker, 3000) }
    ws.onerror = () => ws.close()
    ws.onmessage = e => {
      try {
        const d = JSON.parse(e.data)
        setTicker({ price: parseFloat(d.c), change: parseFloat(d.P), high: parseFloat(d.h), low: parseFloat(d.l), vol: parseFloat(d.q) })
      } catch {}
    }
  }, [])

  // ── WebSocket: 15m kline ───────────────────────────────────────────────────
  const connectKline = useCallback(() => {
    if (wsKline.current) wsKline.current.close()
    const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@kline_15m')
    wsKline.current = ws
    ws.onerror = () => ws.close()
    ws.onclose = () => setTimeout(connectKline, 3000)
    ws.onmessage = e => {
      try {
        const k = JSON.parse(e.data).k
        if (!k) return
        const close = parseFloat(k.c)
        setCloses(prev => {
          if (prev.length === 0) return [close]
          return k.x ? [...prev, close].slice(-300) : [...prev.slice(0, -1), close]
        })
      } catch {}
    }
  }, [])

  useEffect(() => {
    connectTicker()
    connectKline()
    return () => { wsPrice.current?.close(); wsKline.current?.close() }
  }, [connectTicker, connectKline])

  useEffect(() => {
    const iv = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(iv)
  }, [])

  // ── Signal engine ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (closes.length < 50) return
    const s = computeSignal(closes)
    if (!s) return
    setSignal(s)

    const isStrong = s.signal === 'STRONG BUY' || s.signal === 'STRONG SELL'
    const isActionable = (s.signal === 'BUY' || s.signal === 'SELL' || isStrong) && s.strength >= 60

    if (prevSig.current !== s.signal && isActionable) {
      const entry = closes[closes.length - 1]
      const direction = (s.signal === 'BUY' || s.signal === 'STRONG BUY') ? 'LONG' : 'SHORT'
      const sl = direction === 'LONG' ? entry * (1 - STOP_PCT) : entry * (1 + STOP_PCT)
      const tp = direction === 'LONG' ? entry * (1 + TP_PCT)   : entry * (1 - TP_PCT)

      setTrades(prev => [{
        id: Date.now(),
        signal: s.signal,
        direction,
        entry,
        sl,
        tp,
        strength: s.strength,
        time: new Date().toLocaleTimeString(),
        status: 'OPEN',
      }, ...prev].slice(0, 20))
    }
    prevSig.current = s.signal
  }, [closes])

  // ── Chart data ─────────────────────────────────────────────────────────────
  const WINDOW = 100
  const start  = Math.max(0, closes.length - WINDOW)
  const chartData = closes.slice(start).map((v, i) => {
    const idx = start + i
    return {
      i, v,
      e9:  signal?.ema9?.[idx]  ?? null,
      e21: signal?.ema21?.[idx] ?? null,
      bbU: signal?.bb?.[idx]?.upper  ?? null,
      bbL: signal?.bb?.[idx]?.lower  ?? null,
      bbM: signal?.bb?.[idx]?.middle ?? null,
    }
  })
  const rsiData  = (signal?.rsiArr ?? []).slice(start).map((v, i) => ({ i, v }))
  const macdData = closes.slice(start).map((_, i) => {
    const idx = start + i
    return { i, macd: signal?.macdLine?.[idx] ?? null, sig: signal?.signalLine?.[idx] ?? null, hist: signal?.histogram?.[idx] ?? null }
  })

  const price  = ticker?.price ?? closes[closes.length - 1]
  const change = ticker?.change ?? 0

  // Stats from trades
  const closedTrades = trades.filter(t => {
    if (!price) return false
    if (t.direction === 'LONG') return price >= t.tp || price <= t.sl
    return price <= t.tp || price >= t.sl
  })
  const wins   = trades.filter(t => { if (!price) return false; return t.direction === 'LONG' ? price >= t.tp : price <= t.tp }).length
  const losses = trades.filter(t => { if (!price) return false; return t.direction === 'LONG' ? price <= t.sl : price >= t.sl }).length
  const totalPnl = wins * TP_PCT * LEVERAGE * 100 - losses * STOP_PCT * LEVERAGE * 100

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: "'JetBrains Mono','Fira Code',monospace", color: C.text, padding: 16, boxSizing: 'border-box' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Syne:wght@700;800&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-thumb { background: ${C.muted}; border-radius: 2px; }
        @keyframes blink  { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes pulse  { 0%,100%{transform:scale(1)} 50%{transform:scale(1.03)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 10, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, color: C.green, letterSpacing: -1 }}>QTERM</span>
          <span style={{ color: C.muted, fontSize: 10, letterSpacing: 2 }}>BTC/USD · 15M · {LEVERAGE}x</span>
          <span style={{ background: connected ? C.green : C.red, color: C.bg, fontSize: 9, padding: '2px 6px', borderRadius: 2, fontWeight: 700, animation: connected ? 'blink 2s infinite' : 'none' }}>
            {connected ? '● LIVE' : '○ BAĞLANIYOR...'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div>
            <span style={{ fontSize: 22, fontWeight: 700 }}>{price ? '$' + fmt(price) : '—'}</span>
            {ticker && <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 700, color: cc(change) }}>{change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%</span>}
          </div>
          <span style={{ color: C.dim, fontSize: 11 }}>{time.toLocaleTimeString()}</span>
        </div>
      </div>

      {booting ? (
        <div style={{ textAlign: 'center', color: C.dim, marginTop: 80, fontSize: 13 }}>Binance'ten 300 mum yükleniyor...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 12 }}>

          {/* LEFT */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            <Panel title="BTC/USD — 15m · EMA(9,21) · Bollinger(20,2)">
              {closes.length < 50 ? (
                <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dim, fontSize: 12 }}>
                  Sinyal hesaplanıyor... ({closes.length}/50)
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData}>
                    <XAxis dataKey="i" hide />
                    <YAxis domain={['auto','auto']} width={85} tick={{ fill: C.dim, fontSize: 10 }}
                      tickFormatter={v => '$' + v.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
                    <Tooltip content={<ChartTip />} />
                    <Line type="monotone" dataKey="bbU" stroke={C.muted}   dot={false} strokeWidth={1} strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="bbL" stroke={C.muted}   dot={false} strokeWidth={1} strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="bbM" stroke="#1a3050"   dot={false} strokeWidth={1} />
                    <Line type="monotone" dataKey="e9"  stroke={C.blue}    dot={false} strokeWidth={1.5} />
                    <Line type="monotone" dataKey="e21" stroke={C.orange}  dot={false} strokeWidth={1.5} />
                    <Line type="monotone" dataKey="v"   stroke={signal ? signal.color : C.text} dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              )}
              <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 10 }}>
                {[['─ Fiyat', signal?.color ?? C.text], ['─ EMA9', C.blue], ['─ EMA21', C.orange], ['- - BB', C.muted]].map(([l, col]) => (
                  <span key={l} style={{ color: col }}>{l}</span>
                ))}
              </div>
            </Panel>

            <Panel title={`RSI (14)${signal ? ' · ' + signal.rsi.toFixed(1) : ''}`}>
              <ResponsiveContainer width="100%" height={75}>
                <LineChart data={rsiData}>
                  <XAxis dataKey="i" hide />
                  <YAxis domain={[0, 100]} width={28} tick={{ fill: C.dim, fontSize: 9 }} />
                  <Tooltip content={<ChartTip />} />
                  <ReferenceLine y={70} stroke={C.red}   strokeDasharray="3 3" />
                  <ReferenceLine y={30} stroke={C.green} strokeDasharray="3 3" />
                  <ReferenceLine y={50} stroke={C.muted} strokeDasharray="1 3" />
                  <Line type="monotone" dataKey="v" stroke={C.purple} dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="MACD (12, 26, 9)">
              <ResponsiveContainer width="100%" height={65}>
                <BarChart data={macdData}>
                  <XAxis dataKey="i" hide />
                  <YAxis width={40} tick={{ fill: C.dim, fontSize: 9 }} tickFormatter={v => v.toFixed(0)} />
                  <ReferenceLine y={0} stroke={C.border} />
                  <Bar dataKey="hist" isAnimationActive={false}
                    shape={(props) => {
                      const v = props.hist ?? 0
                      return <rect x={props.x} y={props.y} width={props.width} height={props.height} fill={v >= 0 ? C.green : C.red} opacity={0.7} />
                    }} />
                </BarChart>
              </ResponsiveContainer>
              <ResponsiveContainer width="100%" height={50}>
                <LineChart data={macdData}>
                  <XAxis dataKey="i" hide />
                  <YAxis width={40} tick={{ fill: C.dim, fontSize: 9 }} tickFormatter={v => v.toFixed(1)} />
                  <ReferenceLine y={0} stroke={C.border} />
                  <Line type="monotone" dataKey="macd" stroke={C.blue}   dot={false} strokeWidth={1.5} />
                  <Line type="monotone" dataKey="sig"  stroke={C.orange} dot={false} strokeWidth={1} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', gap: 16, fontSize: 10 }}>
                <span style={{ color: C.blue }}>— MACD</span>
                <span style={{ color: C.orange }}>- - Signal</span>
                {signal && <span style={{ color: C.yellow, fontWeight: 700 }}>Hist: {signal.macdHist.toFixed(2)}</span>}
              </div>
            </Panel>
          </div>

          {/* RIGHT */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Signal card */}
            {signal ? (
              <div style={{
                background: signal.color + '14', border: `2px solid ${signal.color}`,
                borderRadius: 8, padding: '14px', textAlign: 'center',
                animation: 'pulse 2s infinite',
              }}>
                <div style={{ color: C.dim, fontSize: 10, letterSpacing: 2, marginBottom: 6 }}>ALGO SİNYALİ · 15M</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: signal.color }}>{signal.signal}</div>
                <div style={{ margin: '10px 0 4px', color: C.dim, fontSize: 10 }}>Confluence Gücü</div>
                <div style={{ background: C.muted, borderRadius: 3, height: 6, marginBottom: 4 }}>
                  <div style={{ width: signal.strength + '%', height: '100%', borderRadius: 3, background: signal.color, transition: 'width 0.5s' }} />
                </div>
                <div style={{ color: signal.color, fontWeight: 700, fontSize: 14 }}>{signal.strength}%</div>
                <div style={{ marginTop: 6, color: C.dim, fontSize: 10 }}>
                  {signal.strength >= 60 && (signal.signal.includes('BUY') || signal.signal.includes('SELL'))
                    ? '⚡ İŞLEM KOŞULU SAĞLANDI'
                    : 'Güç %60 altı — bekle'}
                </div>
              </div>
            ) : (
              <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20, textAlign: 'center' }}>
                <div style={{ color: C.dim, fontSize: 12 }}>Hesaplanıyor... {closes.length}/50</div>
              </div>
            )}

            {/* Indicator breakdown */}
            {signal && (
              <Panel title="İndikatör Skoru">
                {[
                  { name: 'EMA (9/21)', score: signal.scores.ema, val: `${fmt(signal.e9)} / ${fmt(signal.e21)}` },
                  { name: 'RSI (14)',   score: signal.scores.rsi, val: signal.rsi.toFixed(1) },
                  { name: 'MACD',       score: signal.scores.macd, val: signal.macdHist.toFixed(2) },
                  { name: 'Bollinger',  score: signal.scores.bb, val: `$${fmt(price)}` },
                ].map(ind => {
                  const col = ind.score > 0 ? C.green : ind.score < 0 ? C.red : C.yellow
                  const lbl = ind.score >= 2 ? '▲▲' : ind.score === 1 ? '▲' : ind.score <= -2 ? '▼▼' : ind.score === -1 ? '▼' : '◆'
                  return (
                    <div key={ind.name} style={{ marginBottom: 7, padding: '6px 8px', background: col + '10', borderRadius: 4, border: `1px solid ${col}30` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 10, fontWeight: 700 }}>{ind.name}</span>
                        <span style={{ fontSize: 11, color: col, fontWeight: 700 }}>{lbl} {ind.val}</span>
                      </div>
                    </div>
                  )
                })}
              </Panel>
            )}

            {/* Trade stats */}
            <Panel title={`Trade İstatistik · ${LEVERAGE}x Leverage`}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                {[
                  { label: 'Toplam', value: trades.length, color: C.text },
                  { label: 'Win', value: wins, color: C.green },
                  { label: 'Loss', value: losses, color: C.red },
                  { label: 'Toplam P&L', value: pct(totalPnl), color: totalPnl >= 0 ? C.green : C.red },
                ].map(m => (
                  <div key={m.label} style={{ background: '#0a1520', borderRadius: 4, padding: '6px 8px' }}>
                    <div style={{ color: C.dim, fontSize: 9 }}>{m.label}</div>
                    <div style={{ color: m.color, fontSize: 13, fontWeight: 700 }}>{m.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 9, color: C.muted, padding: '4px 0' }}>
                SL: -{(STOP_PCT * LEVERAGE * 100).toFixed(0)}% · TP: +{(TP_PCT * LEVERAGE * 100).toFixed(0)}% · R/R 1:3
              </div>
            </Panel>

            {/* Trade log */}
            <Panel title="Trade Kaydı" style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {trades.length === 0 ? (
                  <div style={{ color: C.dim, fontSize: 11, textAlign: 'center', padding: '10px 0' }}>
                    BUY/SELL + %60↑ sinyali bekleniyor...
                  </div>
                ) : trades.map(t => (
                  <TradeRow key={t.id} trade={t} currentPrice={price} />
                ))}
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}
