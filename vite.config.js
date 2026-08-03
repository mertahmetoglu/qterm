import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Frontend no longer talks to Binance directly -- the backend/ FastAPI service
// owns market data + the signal engine and streams processed signals here.
const BACKEND = 'http://127.0.0.1:8123'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: BACKEND,
        changeOrigin: true,
      },
      '/health': {
        target: BACKEND,
        changeOrigin: true,
      },
      '/ws': {
        target: BACKEND,
        ws: true,
      },
    }
  }
})
