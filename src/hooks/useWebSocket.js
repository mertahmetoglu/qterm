import { useEffect, useRef, useState } from 'react'

const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30_000

// One WebSocket's whole lifecycle: connect, exponential-backoff reconnect with
// jitter, an optional stale-connection watchdog, and teardown on unmount.
//
// Handlers are read through a ref, so passing new callbacks on every render
// never tears the socket down -- only a change of `url` or `enabled` does.
//
// status: 'connecting' (first attempt) | 'open' | 'reconnecting' | 'closed'
export default function useWebSocket(url, { onMessage, onOpen, onClose, enabled = true, staleAfterMs } = {}) {
  const [status, setStatus] = useState(enabled ? 'connecting' : 'closed')
  const [reconnects, setReconnects] = useState(0)
  const handlers = useRef({ onMessage, onOpen, onClose })

  useEffect(() => {
    handlers.current = { onMessage, onOpen, onClose }
  })

  useEffect(() => {
    if (!enabled || !url) {
      setStatus('closed')
      return
    }

    let ws = null
    let retryTimer = null
    let staleTimer = null
    let attempt = 0
    let hasOpened = false
    let disposed = false

    // A socket can stay "open" while delivering nothing (a half-dead TCP
    // connection behind a NAT or proxy never sends a close frame). For a feed
    // that should always be busy, silence is the failure signal.
    const armStaleTimer = () => {
      if (!staleAfterMs) return
      clearTimeout(staleTimer)
      staleTimer = setTimeout(() => ws?.close(), staleAfterMs)
    }

    const scheduleReconnect = () => {
      // Jitter so several tabs (or a server restart) don't reconnect in lockstep.
      const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt) * (0.8 + Math.random() * 0.4)
      attempt += 1
      setStatus('reconnecting')
      retryTimer = setTimeout(connect, delay)
    }

    function connect() {
      if (disposed) return
      setStatus(hasOpened || attempt > 0 ? 'reconnecting' : 'connecting')
      ws = new WebSocket(url)

      ws.onopen = () => {
        const reconnect = hasOpened
        hasOpened = true
        attempt = 0
        setStatus('open')
        if (reconnect) setReconnects(n => n + 1)
        armStaleTimer()
        handlers.current.onOpen?.({ reconnect })
      }
      ws.onmessage = event => {
        armStaleTimer()
        handlers.current.onMessage?.(event)
      }
      ws.onerror = () => ws.close()
      ws.onclose = () => {
        clearTimeout(staleTimer)
        if (disposed) return
        handlers.current.onClose?.()
        scheduleReconnect()
      }
    }

    connect()

    return () => {
      disposed = true
      clearTimeout(retryTimer)
      clearTimeout(staleTimer)
      if (ws) {
        // Detach before closing: an intentional close must not schedule a
        // reconnect on top of whatever replaces this socket.
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
        ws.close()
      }
    }
  }, [url, enabled, staleAfterMs])

  return { status, reconnects }
}
