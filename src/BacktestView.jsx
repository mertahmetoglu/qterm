import { useCallback, useEffect, useState } from 'react'
import {
  Area, AreaChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  Card, EmptyState, IconAlert, Legend, Skeleton, Stat, T,
  fmtNum, fmtPct, fmtSigned, fmtSignedPct, toneOf,
} from './ui'

// Renders whatever backend/backtest.py last wrote, served by GET /api/backtest.
// The backtest itself stays an offline CLI process; this view only reports it.

// Merge the equity curve and the buy & hold curve by date (not by index, so a
// stray missing day in either series can't shift one against the other).
function mergeSeries(equityCurve, buyHoldCurve) {
  const byDate = new Map()
  for (const { date, value } of equityCurve ?? []) byDate.set(date, { date, strategy: value })
  for (const { date, value } of buyHoldCurve ?? []) byDate.set(date, { ...(byDate.get(date) ?? { date }), buyHold: value })
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function drawdownSeries(equityCurve) {
  let peak = -Infinity
  return (equityCurve ?? []).map(({ date, value }) => {
    peak = Math.max(peak, value)
    return { date, dd: peak > 0 ? (value / peak - 1) * 100 : 0 }
  })
}

const axis = { stroke: T.border, tick: { fill: T.subtle, fontSize: 11 }, tickLine: false }
const fmtDate = d => new Date(d).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })

const CurveTooltip = ({ active, payload, label, suffix = '' }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="tooltip">
      <div className="tooltip__time">{new Date(label).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
      {payload.map(p => (
        <div className="tooltip__row" key={p.dataKey}>
          <span className="muted">{p.name}</span>
          <span style={{ color: p.stroke }}>{fmtNum(p.value)}{suffix}</span>
        </div>
      ))}
    </div>
  )
}

export default function BacktestView() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    setError(null)
    fetch('/api/backtest')
      .then(r => {
        if (!r.ok) throw new Error(r.status === 404 ? 'not_found' : `HTTP ${r.status}`)
        return r.json()
      })
      .then(setData)
      .catch(e => setError(e.message))
  }, [])

  useEffect(load, [load])

  if (error) {
    return (
      <Card title="Backtest">
        <EmptyState
          icon={<IconAlert size={20} />}
          title={error === 'not_found' ? 'No backtest has been run yet' : `Could not load the backtest (${error})`}
          hint={error === 'not_found'
            ? 'Run backend/backtest.py, then reload — the result is served straight from reports/backtest_result.json.'
            : 'Check that the backend is running on port 8123.'}
        />
        <div style={{ textAlign: 'center' }}>
          <button className="tab" onClick={load}>Retry</button>
        </div>
      </Card>
    )
  }
  if (!data) {
    return <Card title="Backtest"><Skeleton height={320} /></Card>
  }

  const { stats, strategy, equity_curve: equityCurve, buy_hold_curve: buyHoldCurve } = data
  const curve = mergeSeries(equityCurve, buyHoldCurve)
  const ddData = drawdownSeries(equityCurve)
  const params = strategy?.params ?? {}

  return (
    <div className="layout__col">
      <Card
        title={`Strategy · ${strategy?.name ?? 'unknown'}`}
        meta={
          <>
            <span>{data.symbol} · {data.interval}</span>
            <span>{data.start} → {data.end}</span>
            <span>{data.leverage}x</span>
            <span>{data.fee_bps}bp fee + {data.slippage_bps}bp slippage per fill</span>
            <span>max hold {data.max_hold_bars} bars</span>
            {params.atr_stop_mult != null && <span>stop {params.atr_stop_mult}× ATR({params.atr_period}) · target {params.reward_risk}R</span>}
          </>
        }
      >
        {strategy?.description && <p className="note">{strategy.description}</p>}
        <div className="stats" style={{ marginTop: 16 }}>
          <Stat label="Trades" value={stats.n_trades} />
          <Stat label="Win rate" value={fmtPct(stats.win_rate * 100)} />
          <Stat label="Sharpe" value={fmtSigned(stats.sharpe)} tone={toneOf(stats.sharpe)} />
          <Stat label="Sortino" value={fmtSigned(stats.sortino)} tone={toneOf(stats.sortino)} />
          <Stat label="Max drawdown" value={fmtSignedPct(stats.max_drawdown * 100, 1)} tone="down" />
          <Stat label="Profit factor" value={fmtNum(stats.profit_factor)} tone={stats.profit_factor >= 1 ? 'up' : 'down'} />
          <Stat label="Total return" value={fmtSignedPct(stats.total_return * 100, 1)} tone={toneOf(stats.total_return)} />
          <Stat label="CAGR" value={fmtSignedPct(stats.cagr * 100, 1)} tone={toneOf(stats.cagr)} />
          <Stat label="Buy & hold" value={fmtSignedPct(stats.buy_hold_return * 100, 1)} tone={toneOf(stats.buy_hold_return)}
            hint="same window" />
        </div>
      </Card>

      <Card title="Equity curve" meta={<span>strategy vs buy &amp; hold, normalised to 1.00</span>} flush>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={curve} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="date" {...axis} minTickGap={64} tickFormatter={fmtDate} />
            <YAxis orientation="right" width={64} {...axis} tickFormatter={v => fmtNum(v)} />
            <ReferenceLine y={1} stroke={T.border} />
            <Tooltip content={<CurveTooltip />} cursor={{ stroke: T.border }} />
            <Line type="monotone" dataKey="strategy" name="Strategy" stroke={T.accent} dot={false} strokeWidth={2} isAnimationActive={false} />
            <Line type="monotone" dataKey="buyHold" name="Buy & hold" stroke={T.muted} dot={false} strokeWidth={1.4} strokeDasharray="5 4" isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        <Legend items={[
          { label: `Strategy (${data.leverage}x, net of costs)`, color: T.accent },
          { label: `Buy & hold ${data.symbol}`, color: T.muted, variant: 'dashed' },
        ]} />
      </Card>

      <Card title="Drawdown" meta={<span>peak to trough, %</span>} flush>
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={ddData} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="date" {...axis} minTickGap={64} tickFormatter={fmtDate} />
            <YAxis orientation="right" width={64} {...axis} tickFormatter={v => `${fmtNum(v, 0)}%`} />
            <ReferenceLine y={0} stroke={T.border} />
            <Tooltip content={<CurveTooltip suffix="%" />} cursor={{ stroke: T.border }} />
            <Area type="monotone" dataKey="dd" name="Drawdown" stroke={T.down} fill={T.down} fillOpacity={0.18} strokeWidth={1.4} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {strategy?.name === 'confluence' && (
        <Card title="What the backtest caught">
          <p className="note">
            The original app required <code>strength ≥ 60</code> to trade. With four indicators scored in
            [−2, +2], the EMA component only reaches ±2 on the exact crossover bar and the others essentially
            never hit their extreme on that same bar — so strength tops out at 50 in real BTCUSDT data.
            The threshold was unreachable: <strong>one trade in two years</strong>. A 60-day dry run returning
            zero trades is what surfaced it. The live dashboard and the backtest now share the corrected,
            reachable threshold.
          </p>
        </Card>
      )}

      <Card title="Not modelled">
        <p className="note">
          Perpetual funding · parameter optimisation and walk-forward validation · partial fills ·
          liquidation ahead of the stop. Fees and slippage are fixed assumptions
          ({data.fee_bps}bp + {data.slippage_bps}bp per fill) and real venue conditions vary.
          Full method and caveats are in the README.
        </p>
      </Card>
    </div>
  )
}
