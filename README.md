# QTERM — BTC Trading Algo

Gerçek Binance WebSocket verisiyle çalışan 1m BTC trading sinyal uygulaması.

## Kurulum (2 dakika)

Node.js yüklü olması gerekiyor. Yoksa: https://nodejs.org

```bash
# 1. Klasöre gir
cd btc-algo

# 2. Paketleri yükle
npm install

# 3. Çalıştır
npm run dev
```

Sonra tarayıcıda aç: **http://localhost:5173**

## Nasıl çalışıyor?

İlk açılışta ~50 dakika beklemen lazım (50 adet 1m mum birikmesi için).
Sinyal hemen başlamaz, veri biriktikçe aktifleşir.

## Sinyal mantığı

4 indikatör confluence sistemi — her biri -2 ile +2 arası puan üretir:

| İndikatör | LONG | SHORT |
|-----------|------|-------|
| EMA 9/21 | 9 > 21 crossover | 9 < 21 crossover |
| RSI 14 | < 30 oversold | > 70 overbought |
| MACD 12/26/9 | MACD > Signal crossover | MACD < Signal crossover |
| Bollinger 20 | Fiyat < lower band | Fiyat > upper band |

**Toplam ≥ +4 → STRONG BUY**  
**Toplam ≥ +2 → BUY**  
**Toplam ≤ -4 → STRONG SELL**  
**Toplam ≤ -2 → SELL**  

⚠️ Bu eğitim amaçlı. Gerçek para için backtest ve risk yönetimi şart.
