import {
  Bar, BarChart, Cell, ComposedChart, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { T, fmtNum, fmtPrice, fmtTime } from '../ui'

// Charts for the live view. All four share a syncId so hovering one candle
// highlights the same bar everywhere, and all read prices from the candles the
// browser aggregated from the trade stream.

const SYNC = 'live'
const axis = { stroke: T.border, tick: { fill: T.subtle, fontSize: 11 }, tickLine: false }
const timeAxis = {
  dataKey: 't', ...axis, minTickGap: 56, tickFormatter: fmtTime,
}

function TooltipBox({ time, rows }) {
  return (
    <div className="tooltip">
      <div className="tooltip__time">{new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
      {rows.map(([label, value, color]) => (
        <div className="tooltip__row" key={label}>
          <span className="muted">{label}</span>
          <span style={color ? { color } : undefined}>{value}</span>
        </div>
      ))}
    </div>
  )
}

const CandleTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const c = payload[0].payload
  return (
    <TooltipBox time={c.t} rows={[
      ['Open', fmtPrice(c.open)],
      ['High', fmtPrice(c.high)],
      ['Low', fmtPrice(c.low)],
      ['Close', fmtPrice(c.close), c.up ? T.upText : T.downText],
      ['Volume', `${fmtNum(c.volume)} BTC`],
      ['Trades', c.trades?.toLocaleString() ?? '—'],
      ...(c.e9 != null ? [['EMA 9', fmtPrice(c.e9), T.fast]] : []),
      ...(c.e21 != null ? [['EMA 21', fmtPrice(c.e21), T.slow]] : []),
    ]} />
  )
}

// One candle. The bar is given the [low, high] range, so `y`/`height` are the
// wick's pixel extent -- the body is interpolated inside it, which keeps the
// shape independent of the chart's scale function.
function Candle({ x, y, width, height, payload }) {
  const { open, close, high, low } = payload
  const span = high - low
  const px = value => (span === 0 ? y : y + ((high - value) / span) * height)
  const color = close >= open ? T.up : T.down
  const bodyTop = px(Math.max(open, close))
  const bodyHeight = Math.max(1, px(Math.min(open, close)) - bodyTop)
  const bodyWidth = Math.max(1, Math.min(width * 0.68, 12))
  const centre = x + width / 2
  return (
    <g>
      <line x1={centre} x2={centre} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={centre - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyHeight} fill={color} rx={1} />
    </g>
  )
}

export function PriceChart({ rows, height = 300 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} syncId={SYNC} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <XAxis {...timeAxis} />
        <YAxis
          orientation="right" width={72} domain={['dataMin', 'dataMax']} {...axis}
          tickFormatter={v => v.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        />
        <Tooltip content={<CandleTooltip />} cursor={{ stroke: T.border }} />
        <Line type="monotone" dataKey="bbU" stroke={T.band} dot={false} strokeWidth={1} strokeDasharray="4 4" isAnimationActive={false} />
        <Line type="monotone" dataKey="bbL" stroke={T.band} dot={false} strokeWidth={1} strokeDasharray="4 4" isAnimationActive={false} />
        <Line type="monotone" dataKey="bbM" stroke={T.band} dot={false} strokeWidth={1} strokeOpacity={0.5} isAnimationActive={false} />
        <Bar dataKey="wick" shape={<Candle />} isAnimationActive={false} />
        <Line type="monotone" dataKey="e9" stroke={T.fast} dot={false} strokeWidth={1.6} isAnimationActive={false} />
        <Line type="monotone" dataKey="e21" stroke={T.slow} dot={false} strokeWidth={1.6} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function VolumeChart({ rows, height = 72 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} syncId={SYNC} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
        <XAxis {...timeAxis} hide />
        <YAxis orientation="right" width={72} {...axis} tickCount={3} tickFormatter={v => fmtNum(v, 0)} />
        <Tooltip
          cursor={{ fill: T.grid, fillOpacity: 0.4 }}
          content={({ active, payload }) => (active && payload?.length
            ? <TooltipBox time={payload[0].payload.t} rows={[['Volume', `${fmtNum(payload[0].payload.volume)} BTC`]]} />
            : null)}
        />
        <Bar dataKey="volume" isAnimationActive={false}>
          {rows.map(r => <Cell key={r.t} fill={r.up ? T.up : T.down} fillOpacity={0.4} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function RsiChart({ rows, height = 104 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} syncId={SYNC} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <XAxis {...timeAxis} hide />
        <YAxis orientation="right" width={72} domain={[0, 100]} ticks={[30, 50, 70]} {...axis} />
        {/* The 30/70 bands are the scoring thresholds; the axis ticks label them,
            so the lines stay unlabelled and out of the data's way. */}
        <ReferenceLine y={70} stroke={T.down} strokeDasharray="4 4" strokeOpacity={0.5} />
        <ReferenceLine y={50} stroke={T.border} strokeOpacity={0.6} />
        <ReferenceLine y={30} stroke={T.up} strokeDasharray="4 4" strokeOpacity={0.5} />
        <Tooltip
          cursor={{ stroke: T.border }}
          content={({ active, payload }) => (active && payload?.length
            ? <TooltipBox time={payload[0].payload.t} rows={[['RSI 14', fmtNum(payload[0].payload.rsi), T.rsi]]} />
            : null)}
        />
        <Line type="monotone" dataKey="rsi" stroke={T.rsi} dot={false} strokeWidth={1.6} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function MacdChart({ rows, height = 128 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} syncId={SYNC} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <XAxis {...timeAxis} hide />
        <YAxis orientation="right" width={72} {...axis} tickCount={4} tickFormatter={v => fmtNum(v, 0)} />
        <ReferenceLine y={0} stroke={T.border} />
        <Tooltip
          cursor={{ stroke: T.border }}
          content={({ active, payload }) => (active && payload?.length
            ? <TooltipBox time={payload[0].payload.t} rows={[
                ['MACD', fmtNum(payload[0].payload.macd), T.fast],
                ['Signal', fmtNum(payload[0].payload.sig), T.slow],
                ['Histogram', fmtNum(payload[0].payload.hist)],
              ]} />
            : null)}
        />
        <Bar dataKey="hist" isAnimationActive={false}>
          {rows.map(r => <Cell key={r.t} fill={(r.hist ?? 0) >= 0 ? T.up : T.down} fillOpacity={0.55} />)}
        </Bar>
        <Line type="monotone" dataKey="macd" stroke={T.fast} dot={false} strokeWidth={1.6} isAnimationActive={false} />
        <Line type="monotone" dataKey="sig" stroke={T.slow} dot={false} strokeWidth={1.2} strokeDasharray="4 3" isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
