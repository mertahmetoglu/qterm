// Shared design-system layer: tokens, formatters, icons and the primitives
// every view is built from. Components never hardcode a colour -- they read
// the same CSS custom properties defined in styles.css, so the palette has one
// source of truth even where Recharts needs a literal string.

const readToken = (name, fallback) => {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

export const T = {
  up: readToken('--up-mark', '#22c55e'),
  upText: readToken('--up-text', '#4ade80'),
  down: readToken('--down-mark', '#ef4444'),
  downText: readToken('--down-text', '#f87171'),
  flat: readToken('--flat-mark', '#f59e0b'),
  flatText: readToken('--flat-text', '#fbbf24'),
  accent: readToken('--accent', '#3b82f6'),
  price: readToken('--series-price', '#e2e8f0'),
  fast: readToken('--series-fast', '#3b82f6'),
  slow: readToken('--series-slow', '#f59e0b'),
  band: readToken('--series-band', '#475569'),
  rsi: readToken('--series-rsi', '#a78bfa'),
  grid: readToken('--grid', '#1b2942'),
  border: readToken('--border', '#1e293b'),
  text: readToken('--text', '#f1f5f9'),
  muted: readToken('--text-muted', '#94a3b8'),
  subtle: readToken('--text-subtle', '#7b8ea8'),
}

// ── Formatting ──────────────────────────────────────────────────────────────
// Locale-aware everywhere, and always the same number of decimals for a given
// quantity so columns of figures line up (paired with tabular figures in CSS).

const dec = (value, digits) =>
  value == null || Number.isNaN(value)
    ? '—'
    : value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })

export const fmtPrice = p => {
  if (p == null || Number.isNaN(p)) return '—'
  if (Math.abs(p) >= 1000) return dec(p, 2)
  if (Math.abs(p) >= 1) return dec(p, 4)
  return dec(p, 6)
}
export const fmtUsd = p => (p == null ? '—' : '$' + fmtPrice(p))
export const fmtNum = (v, digits = 2) => dec(v, digits)
export const fmtPct = (v, digits = 1) => (v == null ? '—' : dec(v, digits) + '%')
export const fmtSigned = (v, digits = 2) => (v == null ? '—' : (v > 0 ? '+' : '') + dec(v, digits))
export const fmtSignedPct = (v, digits = 2) => (v == null ? '—' : (v > 0 ? '+' : '') + dec(v, digits) + '%')
export const fmtTime = ts => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

export const toneOf = v => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat')
export const toneClass = v => `value-${toneOf(v)}`

// ── Icons ───────────────────────────────────────────────────────────────────
// Inline SVG rather than emoji: they inherit colour and size, and stay crisp.

const Svg = ({ children, size = 16, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
    {children}
  </svg>
)

export const IconUp = props => <Svg {...props}><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></Svg>
export const IconDown = props => <Svg {...props}><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></Svg>
export const IconFlat = props => <Svg {...props}><path d="M5 12h14" /></Svg>
export const IconClock = props => <Svg {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>
export const IconActivity = props => <Svg {...props}><path d="M3 12h4l3 8 4-16 3 8h4" /></Svg>
export const IconCheck = props => <Svg {...props}><path d="M20 6 9 17l-5-5" /></Svg>
export const IconX = props => <Svg {...props}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Svg>
export const IconAlert = props => <Svg {...props}><path d="M12 9v4" /><path d="M12 17h.01" /><circle cx="12" cy="12" r="9" /></Svg>

// ── Primitives ──────────────────────────────────────────────────────────────

export function Card({ title, meta, action, children, flush = false, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || meta || action) && (
        <header className="card__head">
          {title && <h2 className="card__title">{title}</h2>}
          {meta && <div className="card__meta">{meta}</div>}
          {action}
        </header>
      )}
      <div className={flush ? 'card__body card__body--flush' : 'card__body'}>{children}</div>
    </section>
  )
}

export function Stat({ label, value, hint, tone }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className={`stat__value num-sans ${tone ? `value-${tone}` : ''}`}>{value}</div>
      {hint && <div className="stat__hint">{hint}</div>}
    </div>
  )
}

export function Pill({ tone, live, children, title }) {
  return (
    <span className={`pill${tone ? ` pill--${tone}` : ''}`} title={title}>
      {live !== undefined && <span className={`dot${live ? ' dot--live' : ''}`} />}
      {children}
    </span>
  )
}

// Status of one connection, as text plus a dot -- never colour alone.
export function StatusPill({ label, status }) {
  const open = status === 'open'
  const text = open ? 'live' : status === 'reconnecting' ? 'reconnecting' : 'connecting'
  return (
    <Pill tone={open ? 'up' : 'flat'} live={open} title={`${label}: ${text}`}>
      {label} <span className="subtle">{text}</span>
    </Pill>
  )
}

export function Legend({ items }) {
  return (
    <div className="legend">
      {items.map(({ label, color, variant = 'line' }) => (
        <span className="legend__item" key={label} style={{ color }}>
          <span className={`legend__swatch${variant === 'dashed' ? ' legend__swatch--dashed' : ''}${variant === 'block' ? ' legend__swatch--block' : ''}`} />
          <span className="muted">{label}</span>
        </span>
      ))}
    </div>
  )
}

export function EmptyState({ title, hint, icon = <IconActivity size={20} /> }) {
  return (
    <div className="state">
      <span className="subtle">{icon}</span>
      <div className="state__title">{title}</div>
      {hint && <p className="state__hint">{hint}</p>}
    </div>
  )
}

export const Skeleton = ({ height = 220 }) => <div className="skeleton" style={{ height }} />
