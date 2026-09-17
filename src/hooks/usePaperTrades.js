import { useEffect, useMemo, useRef, useState } from 'react'

const MAX_TRADES = 20

const pnlPct = (t, price, leverage) =>
  (t.direction === 'LONG' ? (price - t.entry) / t.entry : (t.entry - price) / t.entry) * leverage * 100

// Live paper-trade log. A forward-only simulation since the page was opened,
// NOT a backtest -- see the Backtest tab / README for cost-adjusted history.
//
// Entries use the stop and target the backend generated with the signal
// (ATR-scaled, fixed reward:risk). Exits are checked against every trade-stream
// price, and once a level is hit the result is latched: price coming back
// later doesn't reopen the trade.
export default function usePaperTrades(signal, price, leverage = 1) {
  const [trades, setTrades] = useState([])
  const prevSignal = useRef(null)

  useEffect(() => {
    if (!signal) return
    if (prevSignal.current !== signal.signal && signal.actionable && signal.exits) {
      const { direction, entry, sl, tp, atr } = signal.exits
      setTrades(prev => [{
        id: Date.now(),
        signal: signal.signal,
        strength: signal.strength,
        direction, entry, sl, tp, atr,
        time: new Date().toLocaleTimeString(),
        status: 'OPEN',
        exit: null,
      }, ...prev].slice(0, MAX_TRADES))
    }
    prevSignal.current = signal.signal
  }, [signal])

  useEffect(() => {
    if (price == null) return
    setTrades(prev => {
      let changed = false
      const next = prev.map(t => {
        if (t.status !== 'OPEN') return t
        const long = t.direction === 'LONG'
        const hitSl = long ? price <= t.sl : price >= t.sl
        const hitTp = long ? price >= t.tp : price <= t.tp
        if (!hitSl && !hitTp) return t
        changed = true
        return { ...t, status: hitSl ? 'SL' : 'TP', exit: hitSl ? t.sl : t.tp }
      })
      return changed ? next : prev
    })
  }, [price])

  const stats = useMemo(() => {
    const closed = trades.filter(t => t.status !== 'OPEN')
    return {
      total: trades.length,
      wins: closed.filter(t => t.status === 'TP').length,
      losses: closed.filter(t => t.status === 'SL').length,
      realizedPct: closed.reduce((sum, t) => sum + pnlPct(t, t.exit, leverage), 0),
    }
  }, [trades, leverage])

  return {
    trades: trades.map(t => ({
      ...t,
      pnlPct: t.status === 'OPEN' ? (price != null ? pnlPct(t, price, leverage) : null) : pnlPct(t, t.exit, leverage),
    })),
    stats,
  }
}
