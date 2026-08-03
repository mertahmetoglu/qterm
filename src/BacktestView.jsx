import { useEffect, useState } from 'react'
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { C, pct, Panel, ChartTip } from './ui'

// Merge two {date, value}[] series (equity curve + buy&hold) into one
// Recharts-friendly array by date. They're both daily-resampled over the
// same backtest window so this is mostly a 1:1 zip, but merging by date
// (not index) is robust to either series having a stray extra/missing day.
function mergeSeries(equityCurve, buyHoldCurve) {
  const byDate = new Map()
  for (const { date, value } of equityCurve ?? []) {
    byDate.set(date, { date, strategy: value })
  }
  for (const { date, value } of buyHoldCurve ?? []) {
    byDate.set(date, { ...(byDate.get(date) ?? { date }), buyHold: value })
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function drawdownSeries(equityCurve) {
  let peak = -Infinity
  return (equityCurve ?? []).map(({ date, value }) => {
    peak = Math.max(peak, value)
    return { date, dd: peak > 0 ? (value / peak - 1) * 100 : 0 }
  })
}

const statFmt = {
  pct: v => pct(v * 100),        // signed -- for returns (total return, CAGR, drawdown, buy&hold)
  rate: v => (v * 100).toFixed(1) + '%',  // unsigned -- for plain rates (win rate)
  num: v => v.toLocaleString(undefined, { maximumFractionDigits: 2 }),
  int: v => v,
}

function StatTile({ label, value, format = 'num', judge }) {
  const color = judge ? (judge(value) ? C.green : C.red) : C.text
  return (
    <div style={{ background: '#0a1520', borderRadius: 4, padding: '8px 10px' }}>
      <div style={{ color: C.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ color, fontSize: 15, fontWeight: 700 }}>{statFmt[format](value)}</div>
    </div>
  )
}

export default function BacktestView() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/backtest')
      .then(r => {
        if (!r.ok) throw new Error(r.status === 404 ? 'not_found' : `HTTP ${r.status}`)
        return r.json()
      })
      .then(setData)
      .catch(e => setError(e.message))
  }, [])

  if (error) {
    return (
      <Panel title="Backtest">
        <div style={{ color: C.dim, fontSize: 12, textAlign: 'center', padding: '30px 0' }}>
          {error === 'not_found'
            ? <>Henüz backtest çalıştırılmamış. <code style={{ color: C.text }}>backend/backtest.py</code> çalıştır, sonuç burada görünecek.</>
            : <>Backtest sonucu yüklenemedi ({error}).</>}
        </div>
      </Panel>
    )
  }
  if (!data) {
    return (
      <Panel title="Backtest">
        <div style={{ color: C.dim, fontSize: 12, textAlign: 'center', padding: '30px 0' }}>Yükleniyor...</div>
      </Panel>
    )
  }

  const { stats, equity_curve: equityCurve, buy_hold_curve: buyHoldCurve } = data
  const chartData = mergeSeries(equityCurve, buyHoldCurve)
  const ddData = drawdownSeries(equityCurve)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      <Panel title={`Strateji · ${data.strategy?.name ?? 'bilinmiyor'}`}>
        {data.strategy?.description && (
          <div style={{ fontSize: 11, color: C.text, lineHeight: 1.5, marginBottom: 8 }}>
            {data.strategy.description}
          </div>
        )}
        <div style={{ fontSize: 11, color: C.text, display: 'flex', flexWrap: 'wrap', gap: '4px 20px' }}>
          <span>{data.symbol} · {data.interval}</span>
          <span style={{ color: C.dim }}>{data.start} → {data.end}</span>
          <span>{data.leverage}x kaldıraç</span>
          <span>{data.fee_bps}bp fee + {data.slippage_bps}bp slippage / işlem</span>
          <span style={{ color: C.dim }}>max hold: {data.max_hold_bars} mum</span>
        </div>
      </Panel>

      <Panel title="Equity Curve — Strateji vs Buy & Hold">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData}>
            <XAxis dataKey="date" hide />
            <YAxis width={50} tick={{ fill: C.dim, fontSize: 10 }} tickFormatter={v => v.toFixed(2)} />
            <ReferenceLine y={1} stroke={C.border} />
            <Tooltip content={<ChartTip />} />
            <Line type="monotone" dataKey="strategy" name="Strateji" stroke={C.green} dot={false} strokeWidth={1.8} />
            <Line type="monotone" dataKey="buyHold" name="Buy & Hold" stroke={C.muted} dot={false} strokeWidth={1.4} strokeDasharray="4 3" />
          </LineChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 10 }}>
          <span style={{ color: C.green }}>─ Strateji ({data.leverage}x, net)</span>
          <span style={{ color: C.dim }}>- - Buy &amp; Hold BTC</span>
        </div>
      </Panel>

      <Panel title="Drawdown">
        <ResponsiveContainer width="100%" height={130}>
          <AreaChart data={ddData}>
            <XAxis dataKey="date" hide />
            <YAxis width={50} tick={{ fill: C.dim, fontSize: 10 }} tickFormatter={v => v.toFixed(0) + '%'} />
            <ReferenceLine y={0} stroke={C.border} />
            <Tooltip content={<ChartTip />} />
            <Area type="monotone" dataKey="dd" name="Drawdown" stroke={C.red} fill={C.red} fillOpacity={0.25} strokeWidth={1.2} />
          </AreaChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Backtest Metrikleri">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
          <StatTile label="İşlem Sayısı" value={stats.n_trades} format="int" />
          <StatTile label="Win Rate" value={stats.win_rate} format="rate" />
          <StatTile label="Sharpe" value={stats.sharpe} format="num" judge={v => v > 0} />
          <StatTile label="Sortino" value={stats.sortino} format="num" judge={v => v > 0} />
          <StatTile label="Max Drawdown" value={stats.max_drawdown} format="pct" judge={() => false} />
          <StatTile label="Profit Factor" value={stats.profit_factor} format="num" judge={v => v >= 1} />
          <StatTile label="Toplam Getiri" value={stats.total_return} format="pct" judge={v => v > 0} />
          <StatTile label="CAGR" value={stats.cagr} format="pct" judge={v => v > 0} />
          <StatTile label="Buy & Hold" value={stats.buy_hold_return} format="pct" judge={v => v > 0} />
        </div>
      </Panel>

      {data.strategy?.name === 'confluence' && (
        <Panel title="Backtest'in Yakaladığı Şey">
          <div style={{ fontSize: 11, color: C.text, lineHeight: 1.5 }}>
            Orijinal uygulamadaki işlem eşiği (<code>strength ≥ 60</code>) matematiksel olarak ulaşılamazdı --
            4 indikatörün skorlama tasarımıyla pratikte ulaşılabilen maksimum 50'ydi. Backtest 2 yılda 0 işlem
            üretince fark edildi. Eşik, gerçekten ulaşılabilir olana (<code>STRONG BUY/SELL</code>, strength ≥ 50)
            hizalanarak düzeltildi -- hem canlı hem backtest artık aynı, paylaşılan eşiği kullanıyor.
          </div>
        </Panel>
      )}

      {data.strategy?.name === 'powell_1000' && (
        <Panel title="Backtest'in Yakaladığı Şey">
          <div style={{ fontSize: 11, color: C.text, lineHeight: 1.5 }}>
            Strateji 1R riske karşı 2R hedefliyor, yani maliyetsiz başabaş için %33.3 win rate gerekiyor --
            ve sonuçlanan işlemlerde %34.7 tutturuyor (85 TP / 160 SL). Yani <strong>brütte edge var</strong>:
            maliyetsiz kontrol koşusunda Sharpe +0.58, Profit Factor 1.15, getiri +%15.1.
            Ama işlem başına brüt edge ~<strong>5.2bp</strong>, gidiş-dönüş maliyet ~<strong>16bp</strong> --
            maliyet edge'in üç katı, ve net sonuç bu yüzden negatif.
            <br /><br />
            <span style={{ color: C.dim }}>
              Dürüst okuma: brüt edge de istatistiksel olarak anlamlı değil (2 yılda Sharpe 0.58 → t ≈ 0.83).
              "Çalışıyor ama ucuz execution lazım" değil; "bu pencerede brütte sıfırdan ayırt edilemiyor,
              nette kesin negatif."
            </span>
          </div>
        </Panel>
      )}

      <Panel title="Ne Modellenmedi">
        <div style={{ fontSize: 10, color: C.dim, lineHeight: 1.6 }}>
          Perpetual funding rate · parametre optimizasyonu / walk-forward validasyon · kısmi fill'ler ·
          SL öncesi likidasyon mekaniği. Ücret ve slippage varsayımları sabit ({data.fee_bps}bp + {data.slippage_bps}bp)
          — gerçek borsa koşullarında değişebilir. Detaylar için README.
        </div>
      </Panel>
    </div>
  )
}
