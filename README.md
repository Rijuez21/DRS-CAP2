# **IMPORTANT!** After working on your part, remember to update the README file

# DRS Bus Management System

Web-based platform for D'Rising Sun Transport: online seat reservation, real-time GPS fleet tracking, and role-based dashboards for passengers, drivers, terminal staff, and administrators. Built as part of the DRS Bus Management System IT project proposal.

## Tech Stack

| Layer | Technology |
|---|---|
| UI Library | React (via Vite) |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) |
| Routing | React Router v6 |
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

Also confirm index.html includes the Google Fonts link tags in `<head>`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
```

## Folder Structure
```
src/
├── assets/
├── components/
│   ├── common/
│   │   ├── EmptyState.jsx      # dashed-border placeholder for empty lists/sections
│   │   └── StatusBadge.jsx     # color-coded trip status pill
│   ├── layout/
│   │   ├── PassengerLayout.jsx # mobile: bottom tab bar · desktop (lg:): sidebar
│   │   ├── DriverLayout.jsx
│   │   ├── StaffLayout.jsx
│   │   └── AdminLayout.jsx
│   └── passenger/
│       ├── TripSearchPanel.jsx     # From / To / Date search form
│       ├── StatsRow.jsx            # Routes / Trips Today / My Bookings counters
│       ├── TripCard.jsx            # trip listing card
│       ├── SeatMap.jsx             # interactive clickable seat map grid
│       └── BookingSummaryCard.jsx  # selected seats, passenger info, confirm button
├── pages/
│   ├── auth/
│   │   └── Login.jsx
│   ├── passenger/
│   │   ├── Home.jsx             # built — dashboard + trip search
│   │   ├── TripListings.jsx     # built — All Routes
│   │   ├── TripDetail.jsx       # built — bus info + seat picker + booking
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
**Note**: page-level files (the ones users navigate to via a URL) live in pages/passenger/. Reusable pieces that pages assemble (SeatMap, TripCard, TripSearchPanel, StatsRow, BookingSummaryCard) live in components/passenger/ — keep new reusable UI there, not inside pages/.
## Design Tokens
Defined in src/index.css under @theme, inspired by the Cordillera setting and the "Rising Sun" name:

| Token | Use |
|---|---|
| `brand-forest-900` / `950`	| Dark headers, sidebar, hero panels |
| `brand-green-600` / `500`	| Primary buttons, links, active states, prices |
| `brand-sunrise-500` / `400`	| Accent highlights, input fields, "Boarding" status 
| `surface`	| `App background` |
| `ink-900` / `600` | Primary / secondary text |
| `font-display (Sora)` |	Headings, stats, prices |
| `font-body (Inter)`	| Body text |
## Routing Map

All routes are defined centrally in `src/routes/AppRoutes.jsx`. Each role has its own nested layout (sidebar nav + `<Outlet />`) so pages within a role share a consistent shell.

| Role | Base Path | Routes |
|---|---|---|
| — | `/` | Login |
| Passenger | `/passenger` | `home`, `trips`, `trips/:tripId`, `booking-confirmed`, `my-bookings`, `my-bookings/:bookingId`, `tracking/:tripId`, `profile` |
| Driver | `/driver` | `dashboard`, `route-schedule`, `manifest`, `vehicle-checklist`, `issue-reports` |
| Terminal Staff | `/staff` | `walk-in`, `validate` |
| Admin | `/admin` | `dashboard`, `fleet`, `routes`, `drivers`, `trips`, `reservations`, `maintenance`, `users` |

Visiting a role's base path (e.g. `/admin`) redirects to that role's default page (e.g. `/admin/dashboard`). Unmatched URLs redirect to `/`.

## Setup Log (Foundation Phase)

- [x] Scaffolded project with Vite (`react` template)
- [x] Installed and configured Tailwind CSS v4 via the Vite plugin
- [x] Verified Tailwind utility classes render correctly
- [x] Installed React Router (`react-router-dom`)
- [x] Built role-based folder structure (`pages/`, `components/layout/`)
- [x] Wired up `AppRoutes.jsx` with nested routes for all 4 roles
- [x] Built `PassengerLayout`, `DriverLayout`, `StaffLayout`, `AdminLayout` with sidebar nav + `Outlet`
- [x] Created placeholder components for all 21 pages
- [ ] Git initialized and "UI Foundation" commit made

## Next Steps

Per the project Gantt chart, the next task (Module 3, Sep 7–14) builds out the **Passenger Interface UI**: the real trip search panel, seat picker, and passenger dashboard content inside `pages/passenger/`.

## Available Scripts

```bash
npm run dev       # Start local dev server
npm run build     # Production build
npm run preview   # Preview the production build locally
```
