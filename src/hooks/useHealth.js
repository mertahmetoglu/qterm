import { useEffect, useState } from 'react'

// Backend health/latency poll. Separate from the signal WebSocket on purpose --
// it changes slowly and doesn't belong in the hot stream. Surfaces the
// reconnect/backfill/latency work in backend/market_data.py, which is otherwise
// invisible in the UI.
export default function useHealth(pollMs = 7000) {
  const [health, setHealth] = useState(null)

  useEffect(() => {
    let cancelled = false
    const poll = () => fetch('/health')
      .then(r => r.json())
      .then(h => { if (!cancelled) setHealth(h) })
      .catch(() => { if (!cancelled) setHealth(null) })
    poll()
    const iv = setInterval(poll, pollMs)
    return () => { cancelled = true; clearInterval(iv) }
  }, [pollMs])

  return health
}
