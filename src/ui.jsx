// Shared visual language for both the live dashboard (App.jsx) and the
// backtest view (BacktestView.jsx) -- one palette, one panel chrome, one
// tooltip, so the new view reads as part of the same product instead of
// being bolted on.

export const C = {
  bg: '#060a0d', panel: '#0c1218', border: '#162030',
  green: '#00ff88', red: '#ff3355', yellow: '#ffd700',
  blue: '#00aaff', purple: '#aa55ff', orange: '#ff8800',
  muted: '#2a4060', text: '#c8dde8', dim: '#4a6a7a',
}

export const fmt = p => {
  if (p == null) return '—'
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (p >= 1)    return p.toFixed(4)
  return p.toFixed(6)
}
export const cc = n => n >= 0 ? C.green : C.red
export const pct = n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%'

export function Panel({ title, children, style }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: '12px 14px', ...style }}>
      <div style={{ color: C.dim, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10, borderBottom: `1px solid ${C.border}`, paddingBottom: 6 }}>{title}</div>
      {children}
    </div>
  )
}

export const ChartTip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#0d1a22', border: `1px solid ${C.border}`, padding: '5px 10px', borderRadius: 4 }}>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color ?? C.green, fontFamily: 'monospace', fontSize: 11 }}>
          {p.name ? `${p.name}: ` : ''}{typeof p.value === 'number' ? p.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
        </div>
      ))}
    </div>
  )
}

export function Pill({ children, color, blink }) {
  return (
    <span style={{
      background: color, color: C.bg, fontSize: 9, padding: '2px 6px', borderRadius: 2,
      fontWeight: 700, letterSpacing: 1, animation: blink ? 'blink 2s infinite' : 'none',
    }}>
      {children}
    </span>
  )
}
