import { useEffect, useState } from 'react'

export default function useClock(tickMs = 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), tickMs)
    return () => clearInterval(iv)
  }, [tickMs])
  return now
}
