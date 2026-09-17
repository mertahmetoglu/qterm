import { useCallback, useReducer } from 'react'
import useWebSocket from './useWebSocket'

// The backend's /ws/signals stream: signal, indicator series and 24h ticker.
// Everything here is computed server-side by backend/signal_engine.py -- the
// same code the backtester runs -- and only rendered by the dashboard.

const initial = {
  booting: true,
  config: null,
  ticker: null,
  signal: null,
  times: [],
  feedConnected: false,   // backend <-> Binance, as reported by the backend
}

function reducer(state, msg) {
  const feedConnected = !!msg.connected
  switch (msg.type) {
    case 'snapshot':
      return { ...state, booting: false, feedConnected, config: msg.config, ticker: msg.ticker, signal: msg.signal, times: msg.times ?? [] }
    case 'ticker':
      return { ...state, feedConnected, ticker: msg.ticker }
    case 'signal':
      return { ...state, feedConnected, signal: msg.signal, times: msg.times ?? state.times }
    case 'disconnected':
      return { ...state, feedConnected: false }
    default:
      return state
  }
}

export default function useSignalStream(path = '/ws/signals') {
  const [state, dispatch] = useReducer(reducer, initial)
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`

  const onMessage = useCallback(event => {
    try { dispatch(JSON.parse(event.data)) } catch { /* ignore malformed frame */ }
  }, [])
  const onClose = useCallback(() => dispatch({ type: 'disconnected' }), [])

  const { status, reconnects } = useWebSocket(url, { onMessage, onClose })

  return { ...state, status, reconnects, connected: status === 'open' && state.feedConnected }
}
