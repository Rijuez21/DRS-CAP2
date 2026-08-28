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
npm run dev
```

App runs at `http://localhost:5173`.

## Folder Structure

```
src/
├── assets/
├── components/
│   ├── common/          # Shared UI: Button, Input, Card, Modal, StatusBadge...
│   └── layout/
│       ├── PassengerLayout.jsx
│       ├── DriverLayout.jsx
│       ├── StaffLayout.jsx
│       └── AdminLayout.jsx
├── pages/
│   ├── auth/
│   │   └── Login.jsx
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
├── App.jsx
└── main.jsx
```

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
