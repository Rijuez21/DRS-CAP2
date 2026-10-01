# DRS Bus Backend

Backend for the DRS Bus Management System, built with the stack the proposal
document specifies (Ch. 2.4.3 / Tables 9–11): **Node.js + Express** for the
API, **Socket.io** for real-time GPS push, **MySQL** as the primary database,
**Redis** caching active trips and bus locations, and an optional **MQTT**
listener for telemetry (the paper frames MQTT as "evaluated", not committed
to — see below).

## 1. Create the services on Railway

1. **New → Database → MySQL** → open it → **Variables** tab → copy `MYSQL_URL`.
2. **New → Database → Redis** → same thing → copy `REDIS_URL`.

## 2. Local setup

```bash
cd server
npm install
cp .env.example .env
# paste MYSQL_URL and REDIS_URL into .env
npm run db:init   # creates the tables from src/db/schema.sql
npm run dev        # starts the API + Socket.io server on http://localhost:4000
```

Visit `http://localhost:4000/api/health` — you should see
`{"status":"ok","database":"connected","redis":"connected"}`.

## 3. Point the frontend at it

In `drs-bus-main/.env`:

```
VITE_API_URL=http://localhost:4000
```

REST calls work as before:

```js
const res = await fetch(`${import.meta.env.VITE_API_URL}/api/trips`);
const trips = await res.json();
```

For live GPS on `LiveTracking.jsx`, use Socket.io instead of polling — this
is the "real-time, bidirectional communication" the paper assigns to
Socket.io (Table 9):

```bash
npm install socket.io-client
```

```js
import { io } from "socket.io-client";

const socket = io(import.meta.env.VITE_API_URL);
socket.emit("subscribe:bus", busId);
socket.on("location:update", (point) => setBusPosition(point));

// on unmount:
socket.emit("unsubscribe:bus", busId);
socket.disconnect();
```

Feed that position into Leaflet/Mapbox exactly as the paper specifies
(Table 11) — this backend doesn't touch map rendering, it just supplies
`{ latitude, longitude, timestamp }` over the socket.

## 4. Deploy to Railway

1. Push this `server/` folder to GitHub.
2. In your Railway project: **New → GitHub Repo**, set **Root Directory**
   to `server` if it's part of the monorepo.
3. Because this service lives in the same Railway project as MySQL and
   Redis, Railway auto-injects `MYSQL_URL` and `REDIS_URL` — no manual
   copying needed.
4. Set `CORS_ORIGIN` to your deployed frontend URL.
5. Update `VITE_API_URL` in the frontend to the backend's Railway public URL.

## Schema source

`src/db/schema.sql` is built directly from the DRS Bus Management System
proposal document, Chapter 3.3.4 (Entity-Relationship Diagram, Figure 10)
and 3.3.5 (Database Design): 7 tables — `routes`, `buses`, `drivers`,
`commuters`, `trips`, `bookings`, `location_tracking` — using
the exact primary keys and column names the document specifies (`plate_num`,
`license_number`, `commuter_id`, etc.), including the document's specific
`Booking.status` enum (`Reserved/Confirmed/Boarded/Cancelled/No-Show`) and
its seat-lock rule (unique `(trip_id, seat_number)` among non-cancelled
bookings).

A handful of columns/tables aren't in the document's ERD but were added
because the frontend needs them to actually work — each is commented
`-- addition:` in `schema.sql` so it's clear what's the document's design
vs. implementation glue:
- `staff_accounts` table — the ERD only models Commuter + Driver; Terminal
  Staff and Admin logins needed somewhere to authenticate against.
- `drivers.password_hash` — the ERD's Driver box has no auth field, but
  DriverLogin.jsx needs one.
- `routes.base_fare`, `trips.arrival_time`, `location_tracking.sync_status` —
  but not drawn in the Figure 10 boxes; kept since the frontend already has
  UI for them (fares, ETAs, offline sync).

## API routes

| Method | Path                          | Powers                            |
|--------|-------------------------------|------------------------------------|
| GET    | `/api/health`                 | connection check                   |
| POST   | `/api/auth/login`             | Passenger/Driver/Staff/Admin login |
| POST   | `/api/auth/register`          | passenger self sign-up             |
| GET    | `/api/trips`                  | TripListings                       |
| GET    | `/api/trips/:id`              | TripDetail                         |
| GET    | `/api/trips/:id/seats`        | SeatMap                            |
| GET    | `/api/routes`                 | TripSearchPanel, RouteManagement   |
| POST   | `/api/routes`                 | admin: create route                |
| GET    | `/api/bookings?passengerId=`  | MyBookings                         |
| GET    | `/api/bookings/:id`           | BookingDetails/BookingConfirmed    |
| POST   | `/api/bookings`               | seat selection → reserve a seat    |
| PATCH  | `/api/bookings/:id/status`    | ReservationValidation, Manifest    |
| GET    | `/api/buses`                  | FleetManagement                    |
| POST   | `/api/buses`                  | admin: add a bus                   |
| PATCH  | `/api/buses/:id/status`       | admin: flip Active/Idle/Maintenance|
| POST   | `/api/tracking`               | driver device: post one GPS point  |
| POST   | `/api/tracking/batch`         | driver device: flush buffered points after reconnecting |
| GET    | `/api/tracking/:busId/latest` | LiveTracking (passenger map)       |

This still doesn't cover every page (e.g. `DriverManagement`, `UserManagement`
admin screens are simple CRUD over `drivers`/`staff_accounts` you can add the
same way).

## Notes / next steps

- Auth here is intentionally minimal (no sessions/JWT yet) — enough to prove
  the DB connection works end-to-end. Add `jsonwebtoken` or a session store
  before this handles real users.
- `npm run db:init` is safe to re-run — it uses `CREATE TABLE IF NOT EXISTS`.
- **Redis** is wired up for the two cases the paper names (Table 10): the
  active trips list (`/api/trips`, 15s TTL) and latest bus location
  (`/api/tracking/:busId/latest`, 30s TTL). Both fail open — if Redis is
  unreachable, routes fall back to querying MySQL directly instead of
  erroring.
- **Socket.io** is live: posting to `/api/tracking` (or a message arriving
  over MQTT) immediately emits `location:update` to any client subscribed
  to that bus's room. This is what makes `LiveTracking.jsx` "real-time"
  rather than a page that needs manual refreshing.
- **MQTT** is implemented but dormant unless `MQTT_BROKER_URL` is set —
  matching the paper's framing of MQTT as evaluated rather than committed.
  The primary GPS path is still the driver's phone posting to
  `/api/tracking` directly (2.5.2).
