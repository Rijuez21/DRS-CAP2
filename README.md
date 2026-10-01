# **IMPORTANT!** After working on your part, remember to update the README file!

# DRS Bus Management System — Frontend

Web-based platform for D'Rising Sun Transport: online seat reservation, real-time GPS fleet tracking, and role-based dashboards for passengers, drivers, terminal staff, and administrators. Built as part of the DRS Bus Management System IT project proposal (Saint Louis University).

**Project folder:** `drs-bus-main`

**Gantt reference:**
- Module 1 — Planning & System Design: UI wireframes. Done.
- Module 2 — System / Foundation Setup: React + Tailwind project structure, shared page layout. Done.
- Module 3 — Login & User Accounts: Create passenger login page, driver login page, and admin login page. Done.
- Module 6 — GPS / Live Bus Tracking: Build the live map showing bus location markers. Done.

## Tech Stack

| Layer | Technology |
|---|---|
| UI Library | React (via Vite) |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) |
| Routing | React Router v6 |
| Icons | lucide-react |
| Fonts | Sora (display), Inter (body) — via Google Fonts |
| Backend (planned) | Node.js + Express.js |
| Real-time | Socket.io |
| Database (planned) | MySQL + Redis |
| Maps | Leaflet.js |

## Prerequisites

- Node.js v18+ (`node -v` to check)
- npm v7+
- VS Code, with recommended extensions:
  - ES7+ React/Redux/React-Native snippets
  - Tailwind CSS IntelliSense
  - Prettier

## Getting Started

```bash
#before installing the npm
cd drs-bus-main

#then install
npm install
npm install lucide-react
npm run dev
```

App runs at `http://localhost:5173`.

To try it on a phone, don't open `http://<your PC's IP>:5173`. Location (GPS) is
blocked on plain `http://` links, so the terminal map, Flag a Bus and live
tracking won't work. Use the HTTPS tunnel in
[Running on a Phone](#running-on-a-phone-https--needed-for-gps) instead.

Also confirm `index.html` includes the Google Fonts link tags in `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
```

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

- **Terminal location:** set in code in `src/lib/terminal.js` (`TERMINAL.latitude` /
  `TERMINAL.longitude`, plus its name and address). To move the pin, open
  Google Maps, right-click the terminal entrance, and click the `lat, lng` line
  at the top of the menu to copy it.
- **Routing:** uses the public OSRM demo server (`src/hooks/useRoadRoute.js`),
  the same one Flag a Bus uses. It's free and needs no API key, but it's
  rate-limited and its times are for a car. If it can't be reached, the map
  draws a dashed straight line instead.
- **Location:** needs HTTPS on phones (see
  [Running on a Phone](#running-on-a-phone-https--needed-for-gps)).

## Folder Structure

```
src/
├── assets/
│   └── logo-sun.svg            # sunburst logo mark, used on all 3 login pages
├── components/
│   ├── auth/
│   │   ├── AuthShell.jsx       # shared chrome: logo, wordmark, card wrapper
│   │   └── LoginForm.jsx       # shared email/password form + validation
│   ├── common/
│   │   ├── EmptyState.jsx
│   │   └── StatusBadge.jsx
│   ├── layout/
│   │   ├── PassengerLayout.jsx # mobile: bottom tab bar · desktop (lg:): sidebar
│   │   ├── DriverLayout.jsx
│   │   ├── StaffLayout.jsx
│   │   └── AdminLayout.jsx
│   └── passenger/
│       ├── TripSearchPanel.jsx
│       ├── StatsRow.jsx
│       ├── TripCard.jsx
│       ├── SeatMap.jsx
│       ├── BookingSummaryCard.jsx
│       └── TerminalDirectionsCard.jsx  # Home: map + route from you to the terminal
├── pages/
│   ├── auth/
│   │   ├── RoleSelect.jsx      # built — landing page, pick a role to log in as
│   │   ├── PassengerLogin.jsx  # built
│   │   ├── DriverLogin.jsx     # built
│   │   └── AdminLogin.jsx      # built
│   ├── passenger/
│   │   ├── Home.jsx
│   │   ├── TripListings.jsx
│   │   ├── TripDetail.jsx
│   │   ├── BookingConfirmed.jsx
│   │   ├── MyBookings.jsx
│   │   ├── BookingDetails.jsx
│   │   ├── LiveTracking.jsx    # built — live single-bus map (Module 6)
│   │   └── Profile.jsx
│   ├── driver/
│   │   ├── Dashboard.jsx
│   │   ├── RouteSchedule.jsx
│   │   └── Manifest.jsx
│   ├── staff/
│   │   ├── WalkInSales.jsx
│   │   └── ReservationValidation.jsx
│   └── admin/
│       ├── Dashboard.jsx
│       ├── FleetManagement.jsx
│       ├── RouteManagement.jsx
│       ├── DriverManagement.jsx
│       ├── TripScheduling.jsx
│       ├── ReservationsManagement.jsx
│       └── UserManagement.jsx
├── lib/
│   └── terminal.js         # bus terminal name + coordinates (edit to move the pin)
├── routes/
│   └── AppRoutes.jsx
├── index.css       # Tailwind import + brand design tokens (@theme)
├── App.jsx
└── main.jsx
```

> **Note:** page-level files live in `pages/`. Reusable pieces those pages assemble live in `components/`, grouped by the same role/domain name (`auth/`, `passenger/`, etc.). Keep new reusable UI in `components/`, not inside `pages/`.

## Design Tokens

Defined in `src/index.css` under `@theme`, inspired by the Cordillera setting and the "Rising Sun" name:

| Token | Use |
|---|---|
| `brand-forest-900` / `950` | Dark headers, sidebar, hero panels |
| `brand-green-600` / `500` | Primary buttons, links, active states, prices |
| `brand-sunrise-500` / `400` | Accent highlights, input fields, logo mark |
| `surface` | App background |
| `ink-900` / `600` | Primary / secondary text |
| `font-display` (Sora) | Headings, stats, prices |
| `font-body` (Inter) | Body text |

## Routing Map

All routes are defined centrally in `src/routes/AppRoutes.jsx`.

| Path | Purpose |
|---|---|
| `/` | Role select — choose Passenger, Driver, or Admin |
| `/login/passenger` | Passenger login (has "Sign up" — passengers self-register) |
| `/login/driver` | Driver login (accounts created by an admin) |
| `/login/admin` | Admin login (accounts created by an admin) |

| Role | Base Path | Routes |
|---|---|---|
| Passenger | `/passenger` | `home`, `trips`, `trips/:tripId`, `booking-confirmed`, `my-bookings`, `my-bookings/:bookingId`, `tracking/:tripId`, `profile` |
| Driver | `/driver` | `dashboard`, `route-schedule`, `manifest` |
| Terminal Staff | `/staff` | `walk-in`, `validate` |
| Admin | `/admin` | `dashboard`, `fleet`, `routes`, `drivers`, `trips`, `reservations`, `users` |

Each role's base path redirects to that role's default page. Unmatched URLs redirect to `/`. `PassengerLayout` is mobile-first: bottom tab bar below the `lg` breakpoint, fixed left sidebar at `lg` and above.

## Setup Log

**Foundation Phase (Modules 1–2)**
- [x] Scaffolded project with Vite (`react` template)
- [x] Installed and configured Tailwind CSS v4 via the Vite plugin
- [x] Installed React Router (`react-router-dom`)
- [x] Built role-based folder structure (`pages/`, `components/layout/`)
- [x] Wired up `AppRoutes.jsx` with nested routes for all 4 roles
- [x] Built `DriverLayout`, `StaffLayout`, `AdminLayout` with sidebar nav + `Outlet`
- [x] Created placeholder components for all 21 pages

**Passenger Interface UI Phase**
- [x] Installed `lucide-react`, added Sora/Inter fonts
- [x] Added brand design tokens (`@theme` in `index.css`)
- [x] Built `Home.jsx`, `TripListings.jsx`, `TripDetail.jsx`
- [x] Built `SeatMap.jsx` — visual, clickable seat grid
- [x] Rebuilt `PassengerLayout.jsx` as mobile-first (bottom tabs → sidebar at `lg`)

**Login & User Accounts Phase (Module 3)**
- [x] Built `RoleSelect.jsx` — landing page at `/`, replaces the old single `Login.jsx`
- [x] Built `PassengerLogin.jsx`, `DriverLogin.jsx`, `AdminLogin.jsx`
- [x] Built shared `AuthShell.jsx` and `LoginForm.jsx` (validation, error state, loading state)
- [x] Added `logo-sun.svg` asset
- [x] Updated `AppRoutes.jsx` with the 4 new auth routes

**GPS / Live Bus Tracking Phase (Module 6)**
- [x] Built `LiveTracking.jsx` — single-bus live map (`/passenger/tracking/:tripId`), using Leaflet
- [x] Follows the same real-time pattern as the admin's `FleetTracking.jsx`: REST snapshot first (`getLatestLocation`) to seed the initial marker, then a Socket.io subscription for live updates, moving the existing marker instead of recreating the map on every tick
- [x] Shows the same "buffered/offline" indicator `FleetTracking.jsx` uses, keyed off the `syncStatus` flag set by `useDriverLocation.js`'s offline queue

**Not yet done**
- [ ] Connect all forms/pages to the real backend API (still placeholder/`TODO`-marked — see comments in each file for the exact endpoint expected)
- [ ] Build remaining passenger screens: BookingConfirmed, MyBookings, BookingDetails, Profile
- [ ] Build out Driver, Terminal Staff, and Admin page content (currently placeholders)
- [ ] Confirm `subscribe:bus`/`unsubscribe:bus` socket event names against the actual backend handler — `LiveTracking.jsx` currently assumes symmetry with `FleetTracking.jsx`'s `subscribe:fleet` pattern, but this hasn't been verified against real backend code yet
- [ ] Add a "Track this bus" entry point — nothing currently links to `/passenger/tracking/:tripId` yet, since `MyBookings`/`BookingDetails` are still placeholders

## Next Steps

Per the Gantt chart, Module 7 (Admin Module) is next up. Module 4 (Passenger / Online Reservation) and Module 5 (Driver Module) still need their own status updates here from whoever owns those parts.

## Available Scripts

```bash
npm run dev       # Start local dev server
npm run build     # Production build
npm run preview   # Preview the production build locally
```
