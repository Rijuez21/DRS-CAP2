# **IMPORTANT** After working on your part, remember to update the README file

# DRS Bus Management System — Frontend

Web-based platform for D'Rising Sun Transport: online seat reservation, real-time GPS fleet tracking, and role-based dashboards for passengers, drivers, terminal staff, and administrators. Built as part of the DRS Bus Management System IT project proposal (Saint Louis University).

**Project folder:** `drs-bus-main`

**Gantt reference:**
- Module 1 — Planning & System Design: UI wireframes. Done.
- Module 2 — System / Foundation Setup: React + Tailwind project structure, shared page layout. Done.
- Module 3 — Login & User Accounts: *"Create passenger login page, driver login page, and admin login page"* — Owner: Alexander Misagal (Front-End Developer) — Deliverable: **Login Pages (3 roles)**. Done.

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
| Maps (planned) | Leaflet.js / Mapbox |

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

Also confirm `index.html` includes the Google Fonts link tags in `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
```

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
│       └── BookingSummaryCard.jsx
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
│   │   ├── LiveTracking.jsx
│   │   └── Profile.jsx
│   ├── driver/
│   │   ├── Dashboard.jsx
│   │   ├── RouteSchedule.jsx
│   │   ├── Manifest.jsx
│   │   ├── VehicleChecklist.jsx
│   │   └── IssueReports.jsx
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
│       ├── MaintenanceTracking.jsx
│       └── UserManagement.jsx
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
| Driver | `/driver` | `dashboard`, `route-schedule`, `manifest`, `vehicle-checklist`, `issue-reports` |
| Terminal Staff | `/staff` | `walk-in`, `validate` |
| Admin | `/admin` | `dashboard`, `fleet`, `routes`, `drivers`, `trips`, `reservations`, `maintenance`, `users` |

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

**Not yet done**
- [ ] Connect all forms/pages to the real backend API (still placeholder/`TODO`-marked — see comments in each file for the exact endpoint expected)
- [ ] Build remaining passenger screens: BookingConfirmed, MyBookings, BookingDetails, LiveTracking, Profile
- [ ] Build out Driver, Terminal Staff, and Admin page content (currently placeholders)

## Next Steps

Per the Gantt chart, Module 4 (Passenger / Online Reservation) connects the booking flow to real reservation APIs, and the Full Stack track wires all three login pages to the authentication API.

## Available Scripts

```bash
npm run dev       # Start local dev server
npm run build     # Production build
npm run preview   # Preview the production build locally
```