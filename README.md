# **IMPORTANT!** After working on your part, remember to update the README file!

# DRS Bus Management System

Web platform for D' Rising Sun Transport on the Baguio–Bontoc line: online seat
reservation, manual online payment verification, real-time GPS bus tracking,
"Flag a Bus" roadside hailing, and role-based tools for passengers, drivers,
terminal staff, administrators and bus owners. Built as part of the DRS Bus
Management System IT project (Saint Louis University).

## What's in this repo

| Folder | What it is |
|---|---|
| `drs-bus-main/` | The website (React + Vite + Tailwind CSS v4). See [drs-bus-main/README.md](drs-bus-main/README.md). |
| `server/` | The API (Node.js + Express + Socket.io, MySQL, Redis). See [server/README.md](server/README.md) for setup, every setting and the API routes. |
| `postman/` | Full API test collection, run by GitHub Actions with Newman. |
| `jmeter/` | Load test (GitHub Actions, run by hand). |
| `.github/workflows/` | CI: server tests + website checks, Postman API tests, load test, ZAP security scan. |

## Tech stack

| Layer | Technology |
|---|---|
| Website | React 19 (Vite), React Router, Tailwind CSS v4, lucide-react icons |
| Maps | Leaflet with OpenStreetMap tiles; road routes from the public OSRM server |
| API | Node.js, Express, Socket.io (live bus positions and notifications) |
| Database | MySQL 8 (Railway); Redis for caching and rate limits |
| GPS | SinoTrack ST-906L trackers over TCP (`server/src/services/gpsGateway.js`), plus the driver's phone as a backup |
| Email | Brevo API (or any SMTP server) |
| Hosting | Railway: MySQL, Redis, BACKEND and FRONTEND services |

## Features by role

**Passengers** (`/login/passenger`, self sign-up with email confirmation)
- Book Ahead: search trips, pick seats on the bus's real seat layout, 20% student / PWD / senior discount after ID review.
- Pay online by GCash, bank transfer or QR Ph, then upload the receipt; staff verify it against the company account. Or pay cash at the terminal.
- Email receipt with an official receipt number once the payment is verified; QR e-ticket on every booking.
- Live tracking of their bus, departure reminders, and notifications in the app and by email.
- Flag a Bus: hail a bus that's already on the road from a roadside pickup point.
- Account & Password: edit name and mobile, change password, close the account. Forgot password by emailed code.

**Drivers** (`/login/staff`, Driver tab): today's trips, passenger manifest (Boarded / No-Show), flag-down requests, phone GPS backup.

**Terminal staff** (`/login/staff`, Terminal Staff tab): walk-in ticket sales, validate reservations, payment verification, discount ID review, trip schedules, live fleet map.

**Administrators** (`/login/admin`): dashboard, fleet, routes and fares, drivers, trip scheduling, reservations, payment verification and payment methods, ID verification, GPS trackers, reports, user accounts, passenger accounts (suspend / confirm email), activity log.

**Bus owners** (`/login/owner`): live map of their own buses.

## Running it locally

You need Node.js 22+ and the database settings from Railway (or a local MySQL 8 + Redis).

```bash
# Terminal 1: the API
cd server
cp .env.example .env      # fill in MYSQL_URL, REDIS_URL, JWT_SECRET (see server/README.md)
npm install
npm run db:migrate        # adds any new tables/columns to an existing database
npm run dev               # http://localhost:4000

# Terminal 2: the website
cd drs-bus-main
npm install
npm run dev               # http://localhost:5173
```

Without email settings, the API prints every email (sign-up and reset codes included) to Terminal 1 instead of sending it.

## Running on a Phone (HTTPS — needed for GPS)

Browsers only share a phone's location on `https://` pages, or on `localhost`
on the same computer. On a plain `http://192.168.x.x:5173` link, the app shows
**"Location needs a secure (https://) link"** and every map feature that
needs your position stops working.

The fix is a free **Cloudflare quick tunnel**. It gives your dev server a
temporary `https://….trycloudflare.com` address that works on any phone, even
one that isn't on your Wi-Fi. `vite.config.js` is already set up for it: it
allows `*.trycloudflare.com` hosts and forwards `/api` and live updates to the
backend, so you only need **one** tunnel.

### One-time setup: install cloudflared

Open PowerShell or a VS Code terminal and run:

```powershell
winget install --id Cloudflare.cloudflared -e
```

Then **close and reopen VS Code** (or your terminal) so Windows picks up the
new `cloudflared` command. Check it worked with `cloudflared --version`.

> macOS: `brew install cloudflared`. Linux: see
> https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

### Every time: three terminals

In VS Code, open each terminal with **Terminal → New Terminal** (or the **+**
button in the terminal panel), starting from the project root.

**Terminal 1: backend**

```bash
cd server
npm run dev
```

Leave it running. See `server/README.md` for the first-time database setup.

**Terminal 2: website**

```bash
cd drs-bus-main
npm run dev
```

Wait for `Local: http://localhost:5173/`, then leave it running.

**Terminal 3: HTTPS tunnel**

```bash
cloudflared tunnel --url http://localhost:5173
```

After about 10 seconds it prints a box like this:

```
Your quick Tunnel has been created! Visit it at:
https://some-random-words.trycloudflare.com
```

Copy that `https://…trycloudflare.com` link and leave this terminal running.

### On the phone

1. Send yourself the link (for example, message it to yourself) and open it in
   Chrome or Safari.
2. Log in. The tunnel counts as a different site from `localhost`, so you start
   logged out.
3. When a page asks for your location (for example **Getting to the terminal**
   on the passenger Home page), tap **Share my location**, then choose
   **Allow**. Turn on precise location if the phone offers it.

To stop everything, press **Ctrl + C** in each of the three terminals.

### Good to know

- **The link changes every time** you restart the tunnel. Send the new one to
  whoever is testing.
- The link only works while all three terminals are running and the PC is on.
- **Anyone with the link can open your dev app** while the tunnel runs, so
  don't post it publicly.
- Quick tunnels are for testing and demos only. There's no uptime guarantee.

### Troubleshooting

| What you see | What to do |
|---|---|
| `cloudflared` is "not recognized" | Close and reopen VS Code, then run Terminal 3 again. |
| The link shows a Cloudflare error page (e.g. 502) | Terminal 2 (`npm run dev` in `drs-bus-main`) has stopped. Start it again. |
| Vite says "Blocked request. This host is not allowed" | Make sure `allowedHosts: ['.trycloudflare.com']` is still in `vite.config.js`. |
| The page loads but login fails or there's no data | Terminal 1 (backend) has stopped. Start it again. |
| "Location needs a secure (https://) link" | You opened an `http://` address. Use the `https://…trycloudflare.com` link. |
| "Location is blocked for this site" | Tap the lock icon next to the address → **Permissions** → **Location** → **Allow**, then reload. |
| No location prompt ever appears | Turn on Location in the phone's settings and allow it for Chrome or Safari. |
| "We couldn't get your location" | Turn on GPS, step outside or near a window, then tap **Try again**. |

## Terminal Directions Map

The passenger Home page has a **Getting to the terminal** card. It shows the
bus terminal on a map. Once the passenger shares their location, it also shows
a blue "You" dot and the road route to the terminal, plus the distance and
approximate driving time. A **Directions** link opens Google Maps for
turn-by-turn navigation.

- **Terminal location:** set in code in `drs-bus-main/src/lib/terminal.js` (`TERMINAL.latitude` /
  `TERMINAL.longitude`, plus its name and address). To move the pin, open
  Google Maps, right-click the terminal entrance, and click the `lat, lng` line
  at the top of the menu to copy it.
- **Routing:** uses the public OSRM demo server (`drs-bus-main/src/hooks/useRoadRoute.js`),
  the same one Flag a Bus uses. It's free and needs no API key, but it's
  rate-limited and its times are for a car. If it can't be reached, the map
  draws a dashed straight line instead.
- **Location:** needs HTTPS on phones (see
  [Running on a Phone](#running-on-a-phone-https--needed-for-gps)).

## Design Tokens

Defined in `drs-bus-main/src/index.css` under `@theme`, inspired by the Cordillera setting and the "Rising Sun" name:

| Token | Use |
|---|---|
| `brand-forest-900` / `950` | Dark headers, sidebar, hero panels |
| `brand-green-600` / `500` | Primary buttons, links, active states, prices |
| `brand-sunrise-500` / `400` | Accent highlights, input fields, logo mark |
| `surface` | App background |
| `ink-900` / `600` | Primary / secondary text |
| `font-display` (Sora) | Headings, stats, prices |
| `font-body` (Inter) | Body text |

## Routing map

All routes are defined in `drs-bus-main/src/routes/AppRoutes.jsx`. Pages load on demand, so a phone only downloads the screens it opens.

| Path | Purpose |
|---|---|
| `/` | Landing page (links to the passenger login) |
| `/privacy-policy` | Privacy policy (Data Privacy Act) |
| `/login/passenger` | Passenger sign-in and sign-up |
| `/login/staff` | Driver and Terminal Staff sign-in (tab picks which) |
| `/login/admin`, `/login/owner` | Admin and Bus Owner sign-in |

| Role | Base path | Pages |
|---|---|---|
| Passenger | `/passenger` | `home`, `trips`, `trips/:tripId`, `booking-confirmed`, `my-bookings`, `my-bookings/:bookingId`, `my-bookings/:bookingId/receipt`, `payments`, `tracking/:tripId`, `flag`, `profile`, `discount`, `account` |
| Driver | `/driver` | `dashboard`, `manifest`, `assigned-bus`, `route-schedule`, `profile`, `account` |
| Terminal Staff | `/staff` | `walk-in`, `validate`, `payments`, `discounts`, `trips`, `tracking`, `account` |
| Admin | `/admin` | `dashboard`, `trips`, `reservations`, `payments`, `payment-settings`, `discounts`, `tracking`, `gps`, `fleet`, `routes`, `drivers`, `reports`, `users`, `passengers`, `activity`, `account` |
| Bus Owner | `/owner` | `tracking`, `account` |

Each base path redirects to that role's first page; unknown URLs go to `/`.

## Tests

| What | How | Where it runs |
|---|---|---|
| Server test suite (payments, security, sign-up, password reset, accounts, …) | `cd server && npm test` (needs a disposable MySQL 8 + Redis, see `server/test/helpers.js`) | GitHub Actions `Tests` workflow |
| Website lint, unit tests and build | `cd drs-bus-main && npm run lint && npm test && npm run build` | GitHub Actions `Tests` workflow |
| Full API collection | Newman, `postman/` | GitHub Actions `API tests (Postman)` workflow |
| Load test | JMeter, `jmeter/` | GitHub Actions `Load test (JMeter)`, run by hand |
| Security scan | OWASP ZAP | GitHub Actions `Security scan (ZAP)` workflow |

Turn on **Wait for CI** in each Railway service's settings so a failing run never deploys.

## Deploying (Railway)

The Railway project has four services: **MySQL**, **Redis**, **BACKEND** (`server/`) and **FRONTEND** (`drs-bus-main/`). Both app services deploy from GitHub on every push to `main`.

1. BACKEND → Variables: everything in `server/.env.example` (database URLs are linked from the MySQL and Redis services). Email must use `BREVO_API_KEY` on Railway: Railway blocks outgoing SMTP on non-Pro plans.
2. FRONTEND → Variables: `VITE_API_URL` = the BACKEND's public URL. Then redeploy FRONTEND (it's built in).
3. After a release that changes the database, run `npm run db:migrate` once against the Railway database (from `server/` with the Railway `MYSQL_URL` in `.env`).

