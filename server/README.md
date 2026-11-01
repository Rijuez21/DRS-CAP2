# DRS Bus Backend

Backend for the DRS Bus Management System, built with the stack the proposal
document specifies (Ch. 2.4.3 / Tables 9–11): **Node.js + Express** for the
API, **Socket.io** for real-time GPS push, **MySQL** as the primary database,
and **Redis** caching active trips and bus locations.

## 1. Create the services on Railway

1. **New → Database → MySQL** → open it → **Variables** tab → copy `MYSQL_URL`.
2. **New → Database → Redis** → same thing → copy `REDIS_URL`.

## 2. Local setup

```bash
cd server
npm install
cp .env.example .env
# paste MYSQL_URL and REDIS_URL into .env, and set JWT_SECRET
npm run db:init      # new, empty database only: creates the tables from src/db/schema.sql
npm run db:migrate   # existing database: adds any new tables/columns (safe to re-run)
npm run db:seed      # optional demo data — never against the live database
npm run dev          # starts the API + Socket.io server on http://localhost:4000
```

Visit `http://localhost:4000/api/health` — you should see
`{"status":"ok","database":"connected","redis":"connected"}`.

The website (`drs-bus-main`, `npm run dev`) forwards `/api` and `/socket.io`
to this server on port 4000, so locally it needs no settings at all.

## 3. Settings

Every setting is explained in [.env.example](.env.example). The ones that matter most:

| Variable | Required | What it does |
|---|---|---|
| `MYSQL_URL`, `REDIS_URL` | yes | Database and cache. On Railway these come from the MySQL and Redis services. |
| `JWT_SECRET` | yes | Signs logins. The server refuses to start in production without a random value of 32+ characters. |
| `CORS_ORIGIN` | yes | The website's address(es), comma-separated. Requests from anywhere else are refused. |
| `APP_URL` | recommended | The website's address, for links in emails. Defaults to the first `CORS_ORIGIN`. |
| `BREVO_API_KEY` | for email on Railway | Sends email through Brevo's API. See "Email" below. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | email elsewhere | Plain SMTP (e.g. Gmail + App Password). Ignored when `BREVO_API_KEY` is set. |
| `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME` | optional | The From line. The email defaults to `SMTP_USER`. With Brevo it must be a verified sender. |
| `REQUIRE_EMAIL_VERIFICATION` | optional | `1` (default): new passengers confirm their email with a code. `0` turns it off. |
| `GPS_TCP_PORT`, `GPS_PUBLIC_HOST`, `GPS_PUBLIC_PORT`, `GPS_DEVICE_KEY` | GPS trackers | See `.env.example`. |

## 4. Deploy to Railway

1. Push this `server/` folder to GitHub.
2. In your Railway project: **New → GitHub Repo**, set **Root Directory**
   to `server` if it's part of the monorepo.
3. Because this service lives in the same Railway project as MySQL and
   Redis, Railway auto-injects `MYSQL_URL` and `REDIS_URL` — no manual
   copying needed.
4. Set `JWT_SECRET`, `CORS_ORIGIN` (your deployed frontend URL) and `APP_URL`.
5. Update `VITE_API_URL` in the frontend to the backend's Railway public URL.
6. For email, set `BREVO_API_KEY` (and `MAIL_FROM_EMAIL` if it isn't the
   same as `SMTP_USER`). See "Email" below.
7. After a release that changes the database, run `npm run db:migrate` once
   against the Railway database.

On every redeploy Railway sends the old server SIGTERM; it stops taking new
requests, lets running ones finish and closes its connections before exiting.

## Email

`src/services/mailer.js` sends these automated emails:

- **Payment successful + receipt** — when staff verify an online payment
  (Payment Verification) or collect cash for an online booking at the
  terminal, with the OR number, trip, seat, amount and a link to the
  printable receipt page (`services/receiptEmail.js`).
- **Sign-up confirmation code** — new passengers enter a 6-digit code
  (valid 30 minutes, 5 tries) before they can sign in. An admin can confirm
  an email by hand on the Passengers page.
- **Password reset code** — the "Forgot password?" link on every login page
  emails a 6-digit code (valid 10 minutes, 5 tries). After any password
  change, a "your password was changed" notice is sent and other sessions
  are signed out.
- **Copies of important notifications** — payment rejected or needs more
  details, payment window closing, seat released, refunds, trip cancelled or
  rescheduled, departure reminder, discount approved or rejected
  (`services/notify.js` decides which).

Email is best-effort: if sending fails, payments and notifications still go
through and the failure is only logged. Two ways to send:

- **Brevo API** (`BREVO_API_KEY`) — use this on Railway. Railway blocks
  outbound SMTP on non-Pro plans, so SMTP there fails with
  `Connection timeout`. Brevo is free for 300 emails/day; verify
  `MAIL_FROM_EMAIL` as a sender in the Brevo dashboard first, and turn off
  Brevo's IP blocking for API keys (Railway's address changes).
- **SMTP** (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) — e.g. Gmail
  with an [App Password](https://myaccount.google.com/apppasswords)
  (`smtp.gmail.com`, port 465). Works from a PC.

With neither set (local development) nothing is sent — each email is
printed to the server console, so you can read codes there. Reset and
confirmation codes are never written to the logs on a deployed server.

## Background jobs

Started by `src/index.js`, all safe to run on more than one server:

| Job | Every | What it does |
|---|---|---|
| `services/paymentSweeper.js` | 1 min (`PAYMENT_SWEEP_INTERVAL_MS`) | Warns passengers before an unpaid seat hold lapses, releases expired holds, alerts staff about proofs on trips leaving soon. |
| `services/departureReminders.js` | 5 min | Reminds passengers with a confirmed seat about an hour before departure (once per trip). |
| `services/retentionSweeper.js` | 6 h | Deletes data past the privacy policy's retention periods: GPS points after 1 year, ID photos 1 year after expiry/rejection, read notifications after 6 months, codes after 7 days, never-confirmed sign-ups after 7 days. Keep it in step with `drs-bus-main/src/pages/DataPolicy.jsx`. |
| Flag a Bus expiry (`routes/bookings.js`) | 1 min | Expires roadside hails nobody answered. |

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

Every route is under `/api`. "Who" is the role required (`requireRole` in
`middleware/auth.js`); the route files have the details of each endpoint.

| Area | Routes | Who | Used by |
|---|---|---|---|
| Health | `GET /health` | anyone | uptime checks |
| Sign-in | `POST /auth/login`, `POST /auth/register` | anyone | LoginForm |
| Email confirmation | `POST /auth/verify-email`, `POST /auth/resend-verification` | anyone | LoginForm (code step) |
| Forgot password | `POST /auth/forgot-password`, `/auth/verify-reset-code`, `/auth/reset-password` | anyone | ForgotPasswordForm |
| Own account | `POST /auth/change-password` (any role), `PATCH /auth/me`, `DELETE /auth/me` (passenger) | signed in | AccountSettings |
| Trips | `GET /trips`, `GET /trips/:id`, `/:id/seats`, `/:id/manifest`; `POST`, `PATCH /trips/:id`, `/:id/status` | public reads; staff, admin, driver writes | trip pages, TripScheduling, Manifest |
| Routes & fares | `GET /routes`; `POST`, `PATCH /routes/:id`, `/:id/deactivate`, `/:id/pin` | public reads; admin writes | RouteManagement |
| Bookings | `GET /bookings`, `/bookings/search`, `/bookings/:id`; `POST /bookings`, `/walk-in`, `/:id/counter-payment`; `PATCH /:id/status` | passenger, staff, admin, driver | booking pages, WalkInSales, ReservationValidation |
| Flag a Bus | `/bookings/flags` (create, list, location, acknowledge, decline, cancel) | passenger, driver | FlagBus, FlagRequestsPanel |
| Payments | `/payments` (methods, QR, submit, booking status, queue, verify, reject, escalate, refunds, audit) | passenger, staff, admin | PaymentPanel, PaymentReview, PaymentSettings |
| Discounts | `/discounts` (mine, submit, queue, ID image, approve, reject) | passenger, staff, admin | FareDiscount, DiscountReview |
| Fleet | `/buses` (list, add, edit, delete, status) | staff reads; admin writes | FleetManagement |
| Tracking | `POST /tracking`, `/tracking/batch` (driver phone), `/tracking/device` (Traccar); `GET /tracking/:busId/latest`, `/fleet/latest`, `/in-transit` | driver; signed in | LiveTracking, FleetTracking |
| GPS trackers | `/gps` (status, device, verify, assign, history) | admin | GpsTracker |
| People | `/drivers`, `/staff`, `/owners`, `/passengers` | admin (drivers: staff can read) | UserManagement, DriverManagement, Passengers |
| Notifications | `GET /notifications`, `PATCH /:id/read`, `/read-all` | signed in | NotificationBell |
| Dashboard | `GET /dashboard/summary`, `GET /dashboard/audit-log` | admin, staff / admin | Dashboard, ActivityLog |
| Reports | `/reports` (on-time performance, fleet utilization, reservation trends, CSV export) | admin | ReportsAnalytics |

Live updates go over Socket.io: `location:update` (bus positions),
`notification:new` (the bell), `flag:*` (Flag a Bus) and `payments:changed`
(Payment Verification). A client only joins the rooms its login allows (see
`io.use` / `io.on("connection")` in `src/index.js`).

## Security notes

- Logins are JWTs (`middleware/auth.js`) that stop working the moment the
  account's password changes, the account is suspended or deleted, or a
  staff member's role changes.
- Rate limits on login, sign-up, codes, payments and staff actions
  (`services/rateLimit.js`, in Redis when it's up).
- Strict security headers on every response; uploads are checked by their
  real file type; errors never reveal internals.
- `npm audit` should report 0 vulnerabilities: keep it that way before a release.

## Tests

`npm test` runs `test/*.test.js` against a throwaway MySQL 8 + Redis (see
`test/helpers.js` for the connection settings; never point it at Railway —
the test database is dropped and recreated). GitHub Actions runs it on every
push (`.github/workflows/tests.yml`).
