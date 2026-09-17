import { useMemo, useState } from 'react'
import {
  LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { C, fmt, cc, pct, Panel, ChartTip, Pill } from './ui'
import BacktestView from './BacktestView'
import MatrixView from './MatrixView'
import useTradeCandles from './hooks/useTradeCandles'
import useSignalStream from './hooks/useSignalStream'
import usePaperTrades from './hooks/usePaperTrades'
import useHealth from './hooks/useHealth'
import useClock from './hooks/useClock'

// Two live streams, two owners:
//   - useTradeCandles: Binance's raw trade stream, aggregated into candles in
//     the browser. Drives the price chart, volume and last price.
//   - useSignalStream: the backend's signal engine (backend/signal_engine.py,
//     the same code the backtester runs). Drives every indicator, the signal
//     and its ATR stop/target.
// The two are joined per candle by open time.

const SYMBOL = 'BTCUSDT'
const INTERVAL = '15m'
const WINDOW = 100

const STATUS_LABEL = { OPEN: 'OPEN', TP: 'TP ✓', SL: 'SL ✗' }

function TradeRow({ trade, leverage }) {
  const statusColor = trade.status === 'TP' ? C.green : trade.status === 'SL' ? C.red : C.yellow
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
        <span style={{ color: statusColor, fontWeight: 700 }}>{STATUS_LABEL[trade.status]}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 10px', color: C.dim }}>
        <span>Giriş: <span style={{ color: C.text }}>${fmt(trade.entry)}</span></span>
        <span>ATR: <span style={{ color: C.text }}>${fmt(trade.atr)}</span></span>
        <span style={{ color: C.red }}>SL: ${fmt(trade.sl)}</span>
        <span style={{ color: C.green }}>TP: ${fmt(trade.tp)}</span>
        <span>Zaman: <span style={{ color: C.text }}>{trade.time}</span></span>
        {trade.pnlPct !== null && (
          <span>P&L: <span style={{ color: trade.pnlPct >= 0 ? C.green : C.red, fontWeight: 700 }}>
            {pct(trade.pnlPct)} ({leverage}x)
          </span></span>
        )}
      </div>
    </div>
  )
}

function useChartRows(candles, times, signal) {
  const indexByTime = useMemo(() => new Map(times.map((t, i) => [t, i])), [times])
  return useMemo(() => candles.slice(-WINDOW).map(c => {
    const k = indexByTime.get(c.openTime)
    const at = arr => (k == null || !arr ? null : arr[k] ?? null)
    const bb = k == null ? null : signal?.bb?.[k]
    return {
      t: c.openTime,
      v: c.close,
      vol: c.volume,
      up: c.close >= c.open,
      e9: at(signal?.ema9),
      e21: at(signal?.ema21),
      bbU: bb?.upper ?? null,
      bbL: bb?.lower ?? null,
      bbM: bb?.middle ?? null,
      rsi: at(signal?.rsiArr),
      macd: at(signal?.macdLine),
      sig: at(signal?.signalLine),
      hist: at(signal?.histogram),
    }
  }), [candles, indexByTime, signal])
}

export default function App() {
  const [view, setView] = useState('live')
  const now = useClock()
  const health = useHealth()
  const market = useTradeCandles({ symbol: SYMBOL, interval: INTERVAL })
  const { booting, config, ticker, signal, times, connected } = useSignalStream()

  const price = market.lastPrice ?? ticker?.price ?? null
  const change = ticker?.change ?? 0
  const leverage = config?.leverage ?? 1
  const { trades, stats } = usePaperTrades(signal, price, leverage)

  const rows = useChartRows(market.candles, times, signal)
  const current = market.candles[market.candles.length - 1]

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
          <span style={{ color: C.muted, fontSize: 10, letterSpacing: 2 }}>
            BTC/USDT · {INTERVAL.toUpperCase()} · {leverage}x
          </span>
          <Pill color={connected ? C.green : C.red} blink={connected}>
            {connected ? '● SİNYAL' : '○ SİNYAL...'}
          </Pill>
          <Pill color={market.status === 'open' ? C.green : C.red} blink={market.status === 'open'}>
            {market.status === 'open' ? '● TRADES' : '○ TRADES...'}
          </Pill>
          {(() => {
            const avg = health?.latency_ms?.avg_ms
            const latColor = avg == null ? C.red : avg < 300 ? C.green : avg < 800 ? C.yellow : C.red
            return <Pill color={latColor}>⟳ {avg != null ? `${avg}ms` : '--'}</Pill>
          })()}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {[['live', 'CANLI'], ['backtest', 'BACKTEST'], ['matrix', 'MATRİS']].map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} style={{
                background: view === v ? C.green : 'transparent',
                color: view === v ? C.bg : C.dim,
                border: `1px solid ${view === v ? C.green : C.border}`,
                fontFamily: 'inherit', fontSize: 9, fontWeight: 700, letterSpacing: 1,
                padding: '4px 10px', borderRadius: 2, cursor: 'pointer',
              }}>
                {label}
              </button>
            ))}
          </div>
          <div>
            <span style={{ fontSize: 22, fontWeight: 700 }}>{price ? '$' + fmt(price) : '—'}</span>
            {ticker && <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 700, color: cc(change) }}>{change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%</span>}
          </div>
          <span style={{ color: C.dim, fontSize: 11 }}>{now.toLocaleTimeString()}</span>
        </div>
      </div>

      {view === 'matrix' ? (
        <MatrixView />
      ) : view === 'backtest' ? (
        <BacktestView />
      ) : booting ? (
        <div style={{ textAlign: 'center', color: C.dim, marginTop: 80, fontSize: 13 }}>Backend'e bağlanılıyor...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 12 }}>

          {/* LEFT */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            <Panel title={`BTC/USDT — ${INTERVAL} · trade stream → mum · EMA(9,21) · Bollinger(20,2)`}>
              {rows.length === 0 ? (
                <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dim, fontSize: 12 }}>
                  {market.error ? `Mum geçmişi alınamadı (${market.error})` : 'Trade stream\'e bağlanılıyor...'}
                </div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={rows} syncId="live">
                      <XAxis dataKey="t" hide />
                      <YAxis domain={['auto', 'auto']} width={85} tick={{ fill: C.dim, fontSize: 10 }}
                        tickFormatter={v => '$' + v.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
                      <Tooltip content={<ChartTip />} />
                      <Line type="monotone" dataKey="bbU" stroke={C.muted}  dot={false} strokeWidth={1} strokeDasharray="3 3" isAnimationActive={false} />
                      <Line type="monotone" dataKey="bbL" stroke={C.muted}  dot={false} strokeWidth={1} strokeDasharray="3 3" isAnimationActive={false} />
                      <Line type="monotone" dataKey="bbM" stroke="#1a3050"  dot={false} strokeWidth={1} isAnimationActive={false} />
                      <Line type="monotone" dataKey="e9"  stroke={C.blue}   dot={false} strokeWidth={1.5} isAnimationActive={false} />
                      <Line type="monotone" dataKey="e21" stroke={C.orange} dot={false} strokeWidth={1.5} isAnimationActive={false} />
                      <Line type="monotone" dataKey="v"   stroke={signal ? signal.color : C.text} dot={false} strokeWidth={2} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                  <ResponsiveContainer width="100%" height={40}>
                    <BarChart data={rows} syncId="live">
                      <XAxis dataKey="t" hide />
                      <YAxis width={85} tick={false} axisLine={false} />
                      <Bar dataKey="vol" isAnimationActive={false}>
                        {rows.map(r => <Cell key={r.t} fill={r.up ? C.green : C.red} fillOpacity={0.45} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )}
              <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 10, flexWrap: 'wrap' }}>
                {[['─ Fiyat', signal?.color ?? C.text], ['─ EMA9', C.blue], ['─ EMA21', C.orange], ['- - BB', C.muted], ['▮ Hacim', C.dim]].map(([l, col]) => (
                  <span key={l} style={{ color: col }}>{l}</span>
                ))}
                {current && (
                  <span style={{ color: C.dim, marginLeft: 'auto' }}>
                    Açık mum: <span style={{ color: C.text }}>{current.trades.toLocaleString()}</span> işlem ·{' '}
                    <span style={{ color: C.text }}>{current.volume.toFixed(2)}</span> BTC
                    {current.partial && ' · REST snapshot + canlı'}
                  </span>
                )}
              </div>
            </Panel>

            <Panel title={`RSI (14)${signal ? ' · ' + signal.rsi.toFixed(1) : ''}`}>
              <ResponsiveContainer width="100%" height={75}>
                <LineChart data={rows} syncId="live">
                  <XAxis dataKey="t" hide />
                  <YAxis domain={[0, 100]} width={28} tick={{ fill: C.dim, fontSize: 9 }} />
                  <Tooltip content={<ChartTip />} />
                  <ReferenceLine y={70} stroke={C.red}   strokeDasharray="3 3" />
                  <ReferenceLine y={30} stroke={C.green} strokeDasharray="3 3" />
                  <ReferenceLine y={50} stroke={C.muted} strokeDasharray="1 3" />
                  <Line type="monotone" dataKey="rsi" stroke={C.purple} dot={false} strokeWidth={1.5} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="MACD (12, 26, 9)">
              <ResponsiveContainer width="100%" height={65}>
                <BarChart data={rows} syncId="live">
                  <XAxis dataKey="t" hide />
                  <YAxis width={40} tick={{ fill: C.dim, fontSize: 9 }} tickFormatter={v => v.toFixed(0)} />
                  <ReferenceLine y={0} stroke={C.border} />
                  <Bar dataKey="hist" isAnimationActive={false}>
                    {rows.map(r => <Cell key={r.t} fill={(r.hist ?? 0) >= 0 ? C.green : C.red} fillOpacity={0.7} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <ResponsiveContainer width="100%" height={50}>
                <LineChart data={rows} syncId="live">
                  <XAxis dataKey="t" hide />
                  <YAxis width={40} tick={{ fill: C.dim, fontSize: 9 }} tickFormatter={v => v.toFixed(1)} />
                  <ReferenceLine y={0} stroke={C.border} />
                  <Line type="monotone" dataKey="macd" stroke={C.blue}   dot={false} strokeWidth={1.5} isAnimationActive={false} />
                  <Line type="monotone" dataKey="sig"  stroke={C.orange} dot={false} strokeWidth={1} strokeDasharray="4 2" isAnimationActive={false} />
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
                <div style={{ color: C.dim, fontSize: 10, letterSpacing: 2, marginBottom: 6 }}>ALGO SİNYALİ · {INTERVAL.toUpperCase()}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: signal.color }}>{signal.signal}</div>
                <div style={{ margin: '10px 0 4px', color: C.dim, fontSize: 10 }}>Confluence Skoru {signal.total > 0 ? '+' : ''}{signal.total} / ±8</div>
                <div style={{ background: C.muted, borderRadius: 3, height: 6, marginBottom: 4 }}>
                  <div style={{ width: signal.strength + '%', height: '100%', borderRadius: 3, background: signal.color, transition: 'width 0.5s' }} />
                </div>
                <div style={{ color: signal.color, fontWeight: 700, fontSize: 14 }}>{signal.strength}%</div>
                {signal.atr != null && (
                  <div style={{ marginTop: 8, fontSize: 10, color: C.dim }}>
                    ATR({config.atrPeriod}): <span style={{ color: C.text }}>${fmt(signal.atr)}</span>
                    {signal.exits && (
                      <>
                        {' · '}<span style={{ color: C.red }}>SL ${fmt(signal.exits.sl)}</span>
                        {' · '}<span style={{ color: C.green }}>TP ${fmt(signal.exits.tp)}</span>
                      </>
                    )}
                  </div>
                )}
                <div style={{ marginTop: 6, color: C.dim, fontSize: 10 }}>
                  {signal.actionable
                    ? '⚡ İŞLEM KOŞULU SAĞLANDI'
                    : 'Sadece STRONG BUY/SELL işlem açar — bekle'}
                </div>
              </div>
            ) : (
              <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20, textAlign: 'center' }}>
                <div style={{ color: C.dim, fontSize: 12 }}>Hesaplanıyor... {times.length}/50</div>
              </div>
            )}

            {/* Indicator breakdown */}
            {signal && (
              <Panel title="İndikatör Skoru (her biri -2 … +2)">
                {[
                  { name: 'EMA (9/21)', score: signal.scores.ema, val: `${fmt(signal.e9)} / ${fmt(signal.e21)}` },
                  { name: 'RSI (14)',   score: signal.scores.rsi, val: signal.rsi.toFixed(1) },
                  { name: 'MACD',       score: signal.scores.macd, val: signal.macdHist.toFixed(2) },
                  { name: 'Bollinger',  score: signal.scores.bb, val: `$${fmt(signal.price)}` },
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
            <Panel title={`Canlı Paper-Trade · ${leverage}x (backtest değil)`}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                {[
                  { label: 'Toplam', value: stats.total, color: C.text },
                  { label: 'Win', value: stats.wins, color: C.green },
                  { label: 'Loss', value: stats.losses, color: C.red },
                  { label: 'Gerçekleşen P&L', value: pct(stats.realizedPct), color: stats.realizedPct >= 0 ? C.green : C.red },
                ].map(m => (
                  <div key={m.label} style={{ background: '#0a1520', borderRadius: 4, padding: '6px 8px' }}>
                    <div style={{ color: C.dim, fontSize: 9 }}>{m.label}</div>
                    <div style={{ color: m.color, fontSize: 13, fontWeight: 700 }}>{m.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 9, color: C.muted, padding: '4px 0' }}>
                SL: {config.atrStopMult}×ATR({config.atrPeriod}) · TP: {config.rewardRisk}×risk · R/R 1:{config.rewardRisk}
              </div>
              <div style={{ fontSize: 9, color: C.dim, padding: '2px 0 0' }}>
                Canlı simülasyon, sayfa açıldığından beri. Geçmiş performans için Backtest sekmesine bakın.
              </div>
            </Panel>

            {/* Trade log */}
            <Panel title="Trade Kaydı" style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {trades.length === 0 ? (
                  <div style={{ color: C.dim, fontSize: 11, textAlign: 'center', padding: '10px 0' }}>
                    STRONG BUY/SELL sinyali bekleniyor...
                  </div>
                ) : trades.map(t => (
                  <TradeRow key={t.id} trade={t} leverage={leverage} />
                ))}
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}
