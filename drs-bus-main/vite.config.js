import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The backend the dev server forwards to. Change only if your server runs
// on a different port.
const BACKEND = 'http://127.0.0.1:4000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Reachable from other devices (phone on the same Wi-Fi, or a tunnel).
    host: true,
    // Allow opening the dev server through a Cloudflare quick tunnel
    // (HTTPS, which phones require for GPS). See README "Running on a Phone".
    allowedHosts: ['.trycloudflare.com'],
    // The dev server forwards API and live-update traffic to the backend, so
    // the phone only ever talks to ONE address. That means one tunnel, no
    // VITE_API_URL to set, and no CORS_ORIGIN to update for local testing.
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/socket.io': { target: BACKEND, changeOrigin: true, ws: true },
    },
  },
})
