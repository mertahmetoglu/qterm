import { useEffect, useState } from 'react'

// Views are addressable (#live, #backtest, #research) so a view can be linked
// to and the browser's back button moves between views instead of leaving the
// app.
export default function useHashTab(tabs, fallback = tabs[0]) {
  const read = () => {
    const hash = location.hash.replace('#', '')
    return tabs.includes(hash) ? hash : fallback
  }
  const [tab, setTab] = useState(read)

  useEffect(() => {
    const onHashChange = () => setTab(read())
    addEventListener('hashchange', onHashChange)
    return () => removeEventListener('hashchange', onHashChange)
  })

  return [tab, next => { location.hash = next }]
}
