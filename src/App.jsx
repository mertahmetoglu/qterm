import { useMemo } from 'react'
import {
  Card, EmptyState, IconActivity, IconAlert, IconCheck, IconClock, IconDown, IconFlat, IconUp, IconX,
  Legend, Pill, Skeleton, Stat, StatusPill, T,
  fmtNum, fmtPrice, fmtSignedPct, fmtUsd, toneOf,
} from './ui'
import { MacdChart, PriceChart, RsiChart, VolumeChart } from './components/charts'
import BacktestView from './BacktestView'
import MatrixView from './MatrixView'
import useTradeCandles from './hooks/useTradeCandles'
import useSignalStream from './hooks/useSignalStream'
import usePaperTrades from './hooks/usePaperTrades'
import useHealth from './hooks/useHealth'
import useClock from './hooks/useClock'
import useHashTab from './hooks/useHashTab'

// Two live streams, two owners:
//   - useTradeCandles: Binance's raw trade stream, aggregated into candles in
//     the browser. Drives the price/volume charts and the last price.
//   - useSignalStream: the backend's signal engine (backend/signal_engine.py,
//     the same code the backtester runs). Drives every indicator, the signal
//     and its ATR stop/target.
// The two are joined per candle by open time.

const SYMBOL = 'BTCUSDT'
const INTERVAL = '15m'
const WINDOW = 120
const TABS = [['live', 'Live'], ['backtest', 'Backtest'], ['research', 'Research']]

const SIGNAL_TONE = {
  'STRONG BUY': 'up', BUY: 'up', HOLD: 'flat', SELL: 'down', 'STRONG SELL': 'down',
}

function useChartRows(candles, times, signal) {
  const indexByTime = useMemo(() => new Map(times.map((t, i) => [t, i])), [times])
  return useMemo(() => candles.slice(-WINDOW).map(c => {
    const k = indexByTime.get(c.openTime)
    const at = arr => (k == null || !arr ? null : arr[k] ?? null)
    const bb = k == null ? null : signal?.bb?.[k]
    return {
      t: c.openTime,
      open: c.open, high: c.high, low: c.low, close: c.close,
      wick: [c.low, c.high],
      volume: c.volume,
      trades: c.trades,
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

function TradeRow({ trade }) {
  const closed = trade.status !== 'OPEN'
  const tone = trade.status === 'TP' ? 'up' : trade.status === 'SL' ? 'down' : 'open'
  const StatusIcon = trade.status === 'TP' ? IconCheck : trade.status === 'SL' ? IconX : IconClock
  return (
    <article className={`trade trade--${tone}`}>
      <div className="trade__head">
        <span className={`trade__dir ${trade.direction === 'LONG' ? 'value-up' : 'value-down'}`}>
          {trade.direction === 'LONG' ? <IconUp size={14} /> : <IconDown size={14} />} {trade.direction} · {trade.signal}
        </span>
        <Pill tone={trade.status === 'TP' ? 'up' : trade.status === 'SL' ? 'down' : 'flat'}>
          <StatusIcon size={13} /> {closed ? `${trade.status} hit` : 'Open'}
        </Pill>
      </div>
      <div className="trade__grid">
        <span>Entry <b>{fmtUsd(trade.entry)}</b></span>
        <span>ATR <b>{fmtUsd(trade.atr)}</b></span>
        <span className="value-down">Stop <b>{fmtUsd(trade.sl)}</b></span>
        <span className="value-up">Target <b>{fmtUsd(trade.tp)}</b></span>
        <span>Opened <b>{trade.time}</b></span>
        {trade.pnlPct != null && (
          <span>
            {closed ? 'P&L' : 'Unrealised'} <b className={trade.pnlPct >= 0 ? 'value-up' : 'value-down'}>{fmtSignedPct(trade.pnlPct)}</b>
          </span>
        )}
      </div>
    </article>
  )
}

function SignalCard({ signal, config }) {
  if (!signal) {
    return (
      <Card title="Signal">
        <EmptyState title="Warming up" hint="The engine needs 50 closed candles before it scores a signal." />
      </Card>
    )
  }
  const tone = SIGNAL_TONE[signal.signal] ?? 'flat'
  const width = (Math.abs(signal.total) / 8) * 50
  const left = signal.total >= 0 ? 50 : 50 - width
  return (
    <Card title="Signal" meta={<span>{SYMBOL} · {INTERVAL}</span>}>
      <div className="signal">
        <div className="signal__label">Confluence</div>
        <div className={`signal__value value-${tone}`} aria-live="polite">{signal.signal}</div>
        <div className="score">
          <div className="score__track" role="img"
            aria-label={`Composite score ${signal.total} out of 8, strength ${signal.strength} percent`}>
            <span className="score__fill" style={{ left: `${left}%`, width: `${width}%`, background: `var(--${tone}-mark)` }} />
            <span className="score__zero" />
          </div>
          <div className="score__scale"><span>−8</span><span>0</span><span>+8</span></div>
        </div>
        <div className="signal__note">
          Score <strong className="mono">{signal.total > 0 ? '+' : ''}{signal.total}</strong> · strength {signal.strength}%
        </div>
        <div className="signal__note" style={{ marginTop: 8 }}>
          {signal.actionable
            ? <Pill tone={tone}><IconAlert size={13} /> Entry condition met</Pill>
            : <>Only STRONG BUY / STRONG SELL opens a trade</>}
        </div>
      </div>
      {signal.exits && (
        <div className="levels">
          <div className="levels__row">
            <span className="muted">Entry</span><span className="mono">{fmtUsd(signal.exits.entry)}</span>
          </div>
          <div className="levels__row">
            <span className="muted">Stop · {config.atrStopMult}× ATR({config.atrPeriod})</span>
            <span className="mono value-down">{fmtUsd(signal.exits.sl)}</span>
          </div>
          <div className="levels__row">
            <span className="muted">Target · {config.rewardRisk}R</span>
            <span className="mono value-up">{fmtUsd(signal.exits.tp)}</span>
          </div>
          <div className="levels__row">
            <span className="muted">ATR({config.atrPeriod})</span><span className="mono">{fmtUsd(signal.atr)}</span>
          </div>
        </div>
      )}
    </Card>
  )
}

function Breakdown({ signal }) {
  if (!signal) return null
  const rows = [
    { name: 'EMA 9 / 21', score: signal.scores.ema, value: `${fmtPrice(signal.e9)} / ${fmtPrice(signal.e21)}` },
    { name: 'RSI 14', score: signal.scores.rsi, value: fmtNum(signal.rsi, 1) },
    { name: 'MACD 12/26/9', score: signal.scores.macd, value: fmtNum(signal.macdHist) },
    { name: 'Bollinger 20', score: signal.scores.bb, value: fmtUsd(signal.price) },
  ]
  return (
    <Card title="Indicator score" meta={<span>each −2 … +2</span>}>
      <div className="breakdown">
        {rows.map(row => {
          const tone = toneOf(row.score)
          const Icon = row.score > 0 ? IconUp : row.score < 0 ? IconDown : IconFlat
          return (
            <div className="breakdown__row" key={row.name}>
              <span className="breakdown__name">{row.name}</span>
              <span className="breakdown__value">
                <span className="mono muted">{row.value}</span>
                <span className={`chip chip--${tone}`}>
                  <Icon size={11} /> {row.score > 0 ? '+' : ''}{row.score}
                </span>
              </span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function LiveView({ market, signal, times, config, paper }) {
  const rows = useChartRows(market.candles, times, signal)
  const current = market.candles[market.candles.length - 1]
  const { trades, stats } = paper

  return (
    <div className="layout">
      <div className="layout__col">
        <Card
          title={`${SYMBOL} · ${INTERVAL}`}
          meta={current && (
            <>
              <span>Open candle: <span className="mono">{current.trades.toLocaleString()}</span> trades · <span className="mono">{fmtNum(current.volume)}</span> BTC</span>
              {current.partial && <span className="subtle">seeded from REST snapshot</span>}
            </>
          )}
          flush
        >
          {rows.length === 0 ? (
            market.error
              ? <EmptyState title="Could not load candle history" hint={market.error} icon={<IconAlert size={20} />} />
              : <Skeleton height={300} />
          ) : (
            <>
              <PriceChart rows={rows} />
              <VolumeChart rows={rows} />
              <Legend items={[
                { label: 'Candles from trade stream', color: T.price, variant: 'block' },
                { label: 'EMA 9', color: T.fast },
                { label: 'EMA 21', color: T.slow },
                { label: 'Bollinger 20, 2σ', color: T.band, variant: 'dashed' },
                { label: 'Volume', color: T.muted, variant: 'block' },
              ]} />
            </>
          )}
        </Card>

        <Card title="RSI 14" meta={signal && <span className="mono">{fmtNum(signal.rsi, 1)}</span>}>
          {rows.length ? <RsiChart rows={rows} /> : <Skeleton height={104} />}
        </Card>

        <Card title="MACD 12 / 26 / 9" meta={signal && <span className="mono">histogram {fmtNum(signal.macdHist)}</span>}>
          {rows.length ? <MacdChart rows={rows} /> : <Skeleton height={128} />}
          <Legend items={[
            { label: 'MACD', color: T.fast },
            { label: 'Signal', color: T.slow, variant: 'dashed' },
            { label: 'Histogram', color: T.muted, variant: 'block' },
          ]} />
        </Card>
      </div>

      <div className="layout__col">
        <SignalCard signal={signal} config={config} />
        <Breakdown signal={signal} />

        <Card title="Paper trades" meta={<span>forward simulation · not a backtest</span>}>
          <div className="stats">
            <Stat label="Opened" value={stats.total} />
            <Stat label="Target hit" value={stats.wins} tone={stats.wins ? 'up' : undefined} />
            <Stat label="Stopped out" value={stats.losses} tone={stats.losses ? 'down' : undefined} />
            <Stat label="Realised" value={fmtSignedPct(stats.realizedPct)} tone={toneOf(stats.realizedPct)} />
          </div>
          <p className="note" style={{ marginTop: 12 }}>
            Simulated since this tab was opened, using the stop and target generated with each signal.
            For cost-adjusted history see the <a href="#backtest">Backtest</a> and <a href="#research">Research</a> tabs.
          </p>
        </Card>

        <Card title="Trade log">
          {trades.length === 0
            ? <EmptyState title="No trades yet" hint="A trade opens when the score first reaches STRONG BUY or STRONG SELL." icon={<IconClock size={20} />} />
            : <div className="trades">{trades.map(t => <TradeRow key={t.id} trade={t} />)}</div>}
        </Card>
      </div>
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useHashTab(TABS.map(([id]) => id))
  const now = useClock()
  const health = useHealth()
  const market = useTradeCandles({ symbol: SYMBOL, interval: INTERVAL })
  const { booting, config, ticker, signal, times, status, connected } = useSignalStream()

  const price = market.lastPrice ?? ticker?.price ?? null
  const change = ticker?.change ?? null
  const latency = health?.latency_ms?.avg_ms
  // Held here, not in LiveView: switching tabs must not wipe the trade log.
  const paper = usePaperTrades(signal, price, config?.leverage ?? 1)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark">QTERM</span>
          <span className="brand__sub">{SYMBOL} · {INTERVAL} · {config?.leverage ?? 1}x</span>
        </div>

        <div className="topbar__status">
          <StatusPill label="Signals" status={connected ? 'open' : status} />
          <StatusPill label="Trades" status={market.status} />
          <Pill tone={latency == null ? 'flat' : latency < 400 ? 'up' : 'flat'} title="Binance event time vs local receive time">
            <IconActivity size={13} /> {latency != null ? `${latency} ms` : '—'}
          </Pill>
        </div>

        <div className="topbar__spacer" />

        <div className="topbar__price">
          <span className="topbar__price-value mono">{price ? fmtUsd(price) : '—'}</span>
          {change != null && (
            <span className={change >= 0 ? 'value-up' : 'value-down'}>
              {change >= 0 ? <IconUp size={14} /> : <IconDown size={14} />} {fmtSignedPct(change)}
              <span className="subtle"> 24h</span>
            </span>
          )}
        </div>

        <nav className="tabs" role="tablist" aria-label="Views">
          {TABS.map(([id, label]) => (
            <button key={id} className="tab" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>

        <span className="topbar__clock mono">{now.toLocaleTimeString()}</span>
      </header>

      <main className="main">
        {tab === 'backtest' ? <BacktestView />
          : tab === 'research' ? <MatrixView />
          : booting
            ? <Card title="Live"><EmptyState title="Connecting to the signal service" hint="Start the backend with uvicorn on port 8123 if this does not clear." /></Card>
            : <LiveView market={market} signal={signal} times={times} config={config} paper={paper} />}
      </main>
    </div>
  )
}
