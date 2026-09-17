import { useCallback, useEffect, useState } from 'react'
import {
  Card, EmptyState, IconAlert, Skeleton, Stat,
  fmtNum, fmtPct, fmtSigned, fmtSignedPct, toneOf,
} from './ui'

// Read-only render of reports/matrix.json (produced by backend/run_matrix.py):
// the confluence strategy, unchanged, on every market it was run on. The whole
// result set is shown -- not just the market that happened to look best.

const SYMBOL_LABELS = {
  USATECHIDXUSD: 'Nasdaq 100 CFD',
  USA500IDXUSD: 'S&P 500 CFD',
}

export default function MatrixView() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    setError(null)
    fetch('/api/matrix')
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
      <Card title="Research">
        <EmptyState
          icon={<IconAlert size={20} />}
          title={error === 'not_found' ? 'The matrix has not been generated yet' : `Could not load the matrix (${error})`}
          hint={error === 'not_found'
            ? 'Run backend/run_matrix.py to regenerate every run from cached market data.'
            : 'Check that the backend is running on port 8123.'}
        />
        <div style={{ textAlign: 'center' }}>
          <button className="tab" onClick={load}>Retry</button>
        </div>
      </Card>
    )
  }
  if (!data) return <Card title="Research"><Skeleton height={320} /></Card>

  const groups = []
  for (const row of data.rows) {
    const last = groups[groups.length - 1]
    if (last && last.name === row.group) last.rows.push(row)
    else groups.push({ name: row.group, rows: [row] })
  }

  const total = data.rows.length
  const netNegative = data.rows.filter(r => r.net.total_return < 0).length
  const grossPositive = data.rows.filter(r => r.gross.profit_factor > 1).length
  const beatBuyHold = data.rows.filter(r => r.net.total_return > r.net.buy_hold_return).length

  return (
    <div className="layout__col">
      <Card
        title="Cross-market test"
        meta={<><span>confluence, identical rules</span><span>{data.window.start} → {data.window.end}</span><span>{data.leverage}x</span></>}
      >
        <div className="stats">
          <Stat label="Runs" value={total} hint="each run twice: net and gross" />
          <Stat label="Net negative" value={`${netNegative} / ${total}`} tone={netNegative ? 'down' : undefined} />
          <Stat label="Gross PF > 1" value={`${grossPositive} / ${total}`} tone="flat" />
          <Stat label="Beat buy & hold" value={`${beatBuyHold} / ${total}`} tone={beatBuyHold ? 'flat' : 'down'} />
        </div>
        <p className="note" style={{ marginTop: 16 }}>
          Same rules on every market: 15m candles, entry on STRONG BUY / STRONG SELL, stop at 1.5× ATR(14),
          target 3R. Volatility-scaled exits are what make the comparison meaningful — a fixed 0.5% stop is
          days of range on EURUSD and minutes on SOLUSDT. Each run is executed twice, once at realistic cost
          for that venue and once at zero cost, because <strong>"the signal has nothing"</strong> and
          <strong> "the signal is eaten by costs"</strong> are different failures. Round-trip cost:
          crypto 16bp, FX 1.7bp, index 0.8bp.
        </p>
      </Card>

      {groups.map(group => (
        <Card key={group.name} title={group.name} flush>
          <div className="table-wrap">
            <table className="data">
              <caption className="sr-only">{group.name}: net and gross results per market</caption>
              <thead>
                <tr>
                  <th scope="col">Market</th>
                  <th scope="col">TF</th>
                  <th scope="col">RT cost</th>
                  <th scope="col">Trades</th>
                  <th scope="col">Win</th>
                  <th scope="col">Net Sharpe</th>
                  <th scope="col">Net PF</th>
                  <th scope="col">Net return</th>
                  <th scope="col">Gross Sharpe</th>
                  <th scope="col">Gross PF</th>
                  <th scope="col">Buy &amp; hold</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map(r => (
                  <tr key={r.symbol}>
                    <td>{SYMBOL_LABELS[r.symbol] ?? r.symbol}</td>
                    <td className="subtle">{r.interval}</td>
                    <td className="subtle">{fmtNum(r.costs.roundtrip_bps, 1)}bp</td>
                    <td>{r.net.n_trades}</td>
                    <td>{fmtPct(r.net.win_rate * 100)}</td>
                    <td className={`value-${toneOf(r.net.sharpe)}`}>{fmtSigned(r.net.sharpe)}</td>
                    <td className={r.net.profit_factor >= 1 ? 'value-up' : 'value-down'}>{fmtNum(r.net.profit_factor)}</td>
                    <td className={`value-${toneOf(r.net.total_return)}`}>{fmtSignedPct(r.net.total_return * 100, 1)}</td>
                    <td className={`value-${toneOf(r.gross.sharpe)}`}>{fmtSigned(r.gross.sharpe)}</td>
                    <td className={r.gross.profit_factor >= 1 ? 'value-up' : 'value-down'}>{fmtNum(r.gross.profit_factor)}</td>
                    <td className="subtle">{fmtSignedPct(r.net.buy_hold_return * 100, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <Card title="Reading the table">
        <p className="note">
          <strong>Seven of nine markets are net-negative</strong>, including BTCUSDT, the market the strategy
          was built for and the one the live dashboard trades. At zero cost BTCUSDT still only reaches
          Sharpe +0.22 and profit factor 1.05 — this is not an edge that costs are eating, there is barely
          an edge to eat.
        </p>
        <p className="note">
          The two positive rows are the US index CFDs (net Sharpe ≈ +0.55, PF 1.18). Three reasons not to
          read that as an edge: the two indices' daily returns correlate at 0.96, so they are one observation
          rather than two; a Sharpe of 0.57 over two years is t ≈ 0.8, far below significance; and with nine
          markets tried, the best one landing there is what chance alone predicts. Both also trail buy &amp;
          hold on the same instrument by 28–37 points.
        </p>
        <p className="note subtle">
          The honest next step would be to rerun the index result, unchanged, on a window nobody has looked
          at yet. This matrix cannot be that window, because its result is already known.
        </p>
      </Card>
    </div>
  )
}
