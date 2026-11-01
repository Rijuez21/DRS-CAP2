# DRS Bus — website

The React website for the DRS Bus Management System: every role's screens
(passenger, driver, terminal staff, admin, bus owner) in one app. Project
overview, features and deployment: [../README.md](../README.md). The API it
talks to: [../server/README.md](../server/README.md).

## Scripts

```bash
npm install
npm run dev       # http://localhost:5173 — forwards /api and /socket.io to the API on :4000
npm run lint      # ESLint
npm test          # Vitest unit tests (src/**/*.test.js / .jsx)
npm run build     # production build in dist/
npm run preview   # serve the production build locally
```

## Settings

Only one, read when the site is built (see `.env.example`):

| Variable | What it does |
|---|---|
| `VITE_API_URL` | The API's public URL on a deployed build. Leave it unset for `npm run dev`. |

## Where things are

```
src/
├── routes/AppRoutes.jsx    every URL; pages load on demand (React.lazy)
├── context/AuthContext.jsx signed-in user + token (localStorage)
├── lib/api.js              one function per API endpoint
├── lib/socket.js           Socket.io client (live bus positions, notifications)
├── components/
│   ├── auth/               login / sign-up, email code step, forgot password
│   ├── layout/RoleLayout   the shared shell: sidebar, phone tabs, menu, Account link
│   ├── common/             buttons, tables, alerts, error screen, page loader
│   ├── passenger/          seat map, payment panel, e-ticket QR, …
│   ├── staff/              cash payment dialog
│   └── admin/, payments/, driver/
└── pages/
    ├── passenger/ driver/ staff/ admin/ auth/
    ├── AccountSettings.jsx "Account & Password" for every role
    └── DataPolicy.jsx      privacy policy — keep its retention promises in
                            step with server/src/services/retentionSweeper.js
public/
├── manifest.json, icon-*.png   installable app (Add to Home Screen)
├── sw.js, offline.html         shows an offline page when there's no signal
└── _redirects                  SPA fallback for Netlify-style hosts
Caddyfile                       how Railway serves dist/, with the security headers
```

## Notes

- **Security headers.** The Content-Security-Policy is a `<meta>` tag written at build time (`vite.config.js`). Headers a `<meta>` can't set (no framing by other sites, HTTPS-only, permissions) are in `Caddyfile` for Railway.
- **Service worker.** `public/sw.js` only serves `offline.html` when a page can't load. It caches nothing else on purpose, so a deploy is never hidden behind an old copy; `hooks/useReloadOnNewVersion.js` reloads open tabs after a deploy.
- **Camera and location** need HTTPS on phones. For phone testing over Wi-Fi, use the tunnel in the main README ("Running on a Phone").
