# QTERM - Live BTC Trading Signal Dashboard

A real-time BTC/USDT trading signal application powered by live Binance WebSocket data, built with React and Recharts.

## Features

- **Live market data** via Binance WebSocket (1-minute candles)
- **Multi-indicator confluence system** - 4 indicators, each scoring -2 to +2
- **Real-time signal generation** with configurable thresholds
- **Interactive dashboard** with live price chart, indicator panels, and trade log
- **Risk management** built-in with ATR-based stop-loss and take-profit levels (1:3 R/R)

## Signal Logic

| Indicator | LONG Signal | SHORT Signal |
|-----------|-------------|--------------|
| EMA 9/21 | 9 crosses above 21 | 9 crosses below 21 |
| RSI 14 | < 30 (oversold) | > 70 (overbought) |
| MACD 12/26/9 | MACD crosses above signal | MACD crosses below signal |
| Bollinger Bands 20 | Price below lower band | Price above upper band |

**Score ≥ +4 → STRONG BUY**
**Score ≥ +2 → BUY**
**Score ≤ -4 → STRONG SELL**
**Score ≤ -2 → SELL**

## Tech Stack

- **React** + Vite
- **Recharts** for real-time data visualization
- **Binance WebSocket API** for live market data
- Custom indicator engine (EMA, RSI, MACD, Bollinger Bands)

## Getting Started

Node.js required. Download at [nodejs.org](https://nodejs.org)

```bash
npm install
npm run dev
```

Open in browser: **http://localhost:5173**

> Note: Allow ~50 minutes on first launch for 50 candles to accumulate before signals activate.

## Disclaimer

This project is for educational purposes only. Past performance does not guarantee future results. Always backtest and apply proper risk management before trading with real capital.
