import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import process from 'node:process'

// The backend the dev server forwards to. Change only if your server runs
// on a different port.
const BACKEND = 'http://127.0.0.1:4000'

// Content-Security-Policy for the production build. Only this app's own
// scripts may run, so even if some text slipped through unescaped it can't
// execute, and a stolen-token script can't be loaded from elsewhere.
// Network access is limited to the API (VITE_API_URL, plus its WebSocket),
// the OpenStreetMap tiles, the OSRM routing server and Google Fonts.
// Not applied in `npm run dev` (Vite's dev server needs inline scripts).
function buildCsp(apiUrl) {
  let api = ''
  if (apiUrl) {
    const u = new URL(apiUrl)
    api = ` ${u.origin} ${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    // Leaflet and React set inline style attributes; styles can't run code.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
    `connect-src 'self'${api} https://router.project-osrm.org`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ')
}

// Adds the CSP as a <meta> tag (works on any static host) and writes a
// `_headers` file (Netlify / Cloudflare Pages) with the same policy plus the
// headers a <meta> can't set (clickjacking protection, nosniff, …).
function securityHeaders(apiUrl) {
  const csp = buildCsp(apiUrl)
  const metaCsp = csp.replace(/; frame-ancestors 'none'/, '') // ignored in <meta>, header only
  return {
    name: 'drs-security-headers',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${metaCsp}" />`)
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: [
          '/*',
          `  Content-Security-Policy: ${csp}`,
          '  X-Frame-Options: DENY',
          '  X-Content-Type-Options: nosniff',
          '  Referrer-Policy: strict-origin-when-cross-origin',
          '  Permissions-Policy: geolocation=(self), camera=(), microphone=()',
          '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
          '',
        ].join('\n'),
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), tailwindcss(), securityHeaders(env.VITE_API_URL)],
    build: {
      // No source maps in production: they'd publish the full source.
      sourcemap: false,
    },
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
  }
})
