import { useEffect, useState } from 'react'
import { C, Panel } from './ui'

// Read-only render of reports/matrix.json (produced by backend/run_matrix.py).
// The point of this view is that the project's claim is "these strategies were
// tested and here is everything that came back", so the whole result set has to
// be visible in the app -- not just whichever run happened to be last.

const SYMBOL_LABELS = {
  USATECHIDXUSD: 'Nasdaq 100',
  USA500IDXUSD: 'S&P 500',
}

const num = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : v.toFixed(d))
const signed = (v, d = 2) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d))
const pctOf = (v, d = 1) => (v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%')

function Th({ children, align = 'right' }) {
  return (
    <th style={{
      textAlign: align, padding: '6px 8px', color: C.dim, fontSize: 9,
      textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700,
      borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
    }}>{children}</th>
  )
}

function Td({ children, align = 'right', color = C.text, bold }) {
  return (
    <td style={{
      textAlign: align, padding: '5px 8px', color, fontSize: 11,
      fontWeight: bold ? 700 : 400, whiteSpace: 'nowrap',
    }}>{children}</td>
  )
}

export default function MatrixView() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/matrix')
      .then(r => {
        if (!r.ok) throw new Error(r.status === 404 ? 'not_found' : `HTTP ${r.status}`)
        return r.json()
      })
      .then(setData)
      .catch(e => setError(e.message))
  }, [])

  if (error) {
    return (
      <Panel title="Test Matrisi">
        <div style={{ color: C.dim, fontSize: 12, textAlign: 'center', padding: '30px 0' }}>
          {error === 'not_found'
            ? <>Matris henüz üretilmemiş. <code style={{ color: C.text }}>backend/run_matrix.py</code> çalıştır.</>
            : <>Yüklenemedi ({error}).</>}
        </div>
      </Panel>
    )
  }
  if (!data) {
    return <Panel title="Test Matrisi"><div style={{ color: C.dim, fontSize: 12, padding: '30px 0', textAlign: 'center' }}>Yükleniyor...</div></Panel>
  }

  const groups = []
  for (const row of data.rows) {
    const last = groups[groups.length - 1]
    if (last && last.name === row.group) last.rows.push(row)
    else groups.push({ name: row.group, rows: [row] })
  }

  const netNegative = data.rows.filter(r => r.net.total_return < 0).length
  const grossPositive = data.rows.filter(r => r.gross.profit_factor > 1).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Panel title={`Test Matrisi · ${data.window.start} → ${data.window.end}`}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginBottom: 10 }}>
          {[
            { label: 'Toplam koşu', value: data.rows.length, color: C.text },
            { label: 'Net negatif', value: `${netNegative} / ${data.rows.length}`, color: C.red },
            { label: 'Brüt PF > 1', value: `${grossPositive} / ${data.rows.length}`, color: C.yellow },
            { label: 'Kaldıraç', value: `${data.leverage}x`, color: C.text },
          ].map(m => (
            <div key={m.label} style={{ background: '#0a1520', borderRadius: 4, padding: '8px 10px' }}>
              <div style={{ color: C.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>{m.label}</div>
              <div style={{ color: m.color, fontSize: 15, fontWeight: 700 }}>{m.value}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 10, color: C.dim, lineHeight: 1.6 }}>
          Her koşu iki kez: bir kez o borsanın gerçekçi maliyetiyle, bir kez sıfır maliyetle. İkisinin farkı,
          "sinyalde bir şey yok" ile "bir şey var ama maliyet yiyor" ayrımını verir — sonuçları çok farklı iki durum.
          Gidiş-dönüş maliyet varsayımı borsaya göre değişiyor (kripto 16bp, FX 1.7bp, endeks 0.8bp).
        </div>
      </Panel>

      {groups.map(g => (
        <Panel key={g.name} title={g.name}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 820 }}>
              <thead>
                <tr>
                  <Th align="left">Strateji</Th>
                  <Th align="left">Sembol</Th>
                  <Th>TF</Th>
                  <Th>Maliyet</Th>
                  <Th>İşlem</Th>
                  <Th>Win</Th>
                  <Th>Net Sharpe</Th>
                  <Th>Net PF</Th>
                  <Th>Net Getiri</Th>
                  <Th>Brüt Sharpe</Th>
                  <Th>Brüt PF</Th>
                  <Th>B&amp;H</Th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r, i) => (
                  <tr key={i} style={{ background: i % 2 ? '#0a151f55' : 'transparent' }}>
                    <Td align="left" color={C.text} bold>{r.strategy}</Td>
                    <Td align="left" color={C.dim}>{SYMBOL_LABELS[r.symbol] ?? r.symbol}</Td>
                    <Td color={C.dim}>{r.interval}</Td>
                    <Td color={C.dim}>{num(r.costs.roundtrip_bps, 1)}bp</Td>
                    <Td>{r.net.n_trades}</Td>
                    <Td>{(r.net.win_rate * 100).toFixed(1)}%</Td>
                    <Td color={r.net.sharpe >= 0 ? C.green : C.red} bold>{signed(r.net.sharpe)}</Td>
                    <Td color={r.net.profit_factor >= 1 ? C.green : C.red}>{num(r.net.profit_factor)}</Td>
                    <Td color={r.net.total_return >= 0 ? C.green : C.red}>{pctOf(r.net.total_return)}</Td>
                    <Td color={r.gross.sharpe >= 0 ? C.green : C.red} bold>{signed(r.gross.sharpe)}</Td>
                    <Td color={r.gross.profit_factor >= 1 ? C.green : C.red}>{num(r.gross.profit_factor)}</Td>
                    <Td color={C.dim}>{pctOf(r.net.buy_hold_return)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}

      <Panel title="Okuma">
        <div style={{ fontSize: 11, color: C.text, lineHeight: 1.6 }}>
          <strong>15'te 15 net negatif.</strong> Hiçbir konfigürasyon, hiçbir piyasada, hiçbir maliyet
          varsayımında pozitif net sonuç vermedi.
          <br /><br />
          Asıl örüntü brüt sütununda ve stratejinin lehine değil: stratejinin tasarlanmadığı her piyasada
          brüt PF pozitif (1.11–1.34), tasarlandığı piyasada (NQ/ES) ~1.00 veya altı. 10:00 New York
          açılışı gerçekten bilgi taşısaydı bu sıralamanın tersi olurdu. En ekonomik açıklama: kripto ve FX'teki
          brüt sayılar, edge'i olmayan bir stratejinin örneklem gürültüsü; endeks sayıları ise edge yokluğunun
          gerçek görüntüsü.
        </div>
      </Panel>
    </div>
  )
}
