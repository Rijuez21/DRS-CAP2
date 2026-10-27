-- Schema aligned to the official Entity-Relationship Diagram in the DRS Bus
-- Management System proposal (Chapter 3.3.4 / 3.3.5, Figure 10).
--
-- Entities and column names below (route_id, plate_num, license_number,
-- commuter_id, etc.) are taken directly from the document. Columns marked
-- "-- addition:" are not in the ERD and were added because the frontend
-- (drs-bus-main) or basic auth needs them to function -- flagged so it's
-- clear which parts are the document's design vs. implementation glue.
--
-- Run via `npm run db:init`.

CREATE TABLE IF NOT EXISTS routes (
  route_id INT AUTO_INCREMENT PRIMARY KEY,
  origin VARCHAR(150) NOT NULL,
  destination VARCHAR(150) NOT NULL,
  distance DECIMAL(6,2),
  base_fare DECIMAL(8,2) NOT NULL, -- addition: in Table 4's narrative ("base fare and distance centrally stored") but not drawn in the Figure 10 box
  special_fare DECIMAL(8,2) NULL, -- addition: the printed fare charts show a two-tier REGULAR / SPECIAL (student/discounted) fare per route
  is_active BOOLEAN NOT NULL DEFAULT TRUE, -- addition: Table 4's Route Management says admin can "deactivate" a route; past trips still FK to it, so this is a soft-delete flag rather than a DELETE
  latitude DECIMAL(10,7) NULL, -- addition: exact map position of this stop (the km post a route row ends at), pinned by the admin in RouteManagement. NULL = not pinned yet; nothing guesses a position
  longitude DECIMAL(10,7) NULL, -- addition: see latitude. Always set or cleared together with it (PATCH /api/routes/:id/pin)
  pinned_at TIMESTAMP NULL DEFAULT NULL -- addition: when the pin was last placed, so the admin can tell an old pin from a fresh one
);

CREATE TABLE IF NOT EXISTS drivers (
  driver_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  license_number VARCHAR(50) UNIQUE, -- nullable: a driver record can exist before their license # is on file (see Fleet/Driver Management "complete profile" flow) rather than being seeded with a fake one
  phoneno VARCHAR(20),
  hire_date DATE,
  email VARCHAR(150) UNIQUE, -- addition: the ERD has no auth field on Driver at all, but DriverLogin.jsx (like every other role) logs in with email. Nullable for the same reason as license_number — no login until a real email is on file.
  password_hash VARCHAR(255), -- nullable until email is set (a password is meaningless without something to log in with)
  duty_status ENUM('Active', 'On Leave', 'Suspended') NOT NULL DEFAULT 'Active', -- addition: Table 4's Driver Management calls for a "duty status toggle", same additive spirit as routes.is_active
  license_expiry DATE NULL, -- addition: so the admin can see when a driver's license is due for renewal
  -- addition: employee profile, same columns as staff_accounts (services/employeeProfile.js). All nullable, filled in once known
  employee_no VARCHAR(30) NULL UNIQUE,
  birth_date DATE NULL,
  sex ENUM('Male', 'Female') NULL,
  address VARCHAR(255) NULL,
  emergency_contact_name VARCHAR(150) NULL,
  emergency_contact_phone VARCHAR(20) NULL
);

-- addition: bus owners (operators whose buses run out of the terminal).
-- Their only access is the Owner portal's live map of their own buses —
-- not an employee account, so it isn't in staff_accounts. Created by an
-- admin in UserManagement.jsx; buses.owner_id says which buses are theirs.
CREATE TABLE IF NOT EXISTS bus_owners (
  owner_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  phoneno VARCHAR(20) NULL,
  address VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS buses (
  bus_id INT AUTO_INCREMENT PRIMARY KEY, -- ERD labels this "busnum"
  bus_number VARCHAR(10) UNIQUE, -- addition: the terminal-facing "queue number" (108, 208, ...) used to call/identify a bus, separate from the internal bus_id
  plate_num VARCHAR(20) NOT NULL UNIQUE,
  capacity INT, -- nullable: unknown capacity shouldn't be seeded as a guessed number — the bus record can exist, capacity gets filled in via Fleet Management once it's on hand. With a seat_layout it is that layout's seat count (set by the server)
  seat_layout JSON NULL, -- addition: the admin-designed seat map ({version, cols, rows: [[{t, l}]]}, see services/seatLayout.js); NULL = generated 2 · aisle · 2 layout, seats 1..capacity
  type ENUM('ordinary', 'air_conditioned'), -- nullable, same reasoning as capacity
  year_model YEAR,
  status ENUM('Active', 'Idle', 'Maintenance') NOT NULL DEFAULT 'Active',
  current_driver_id INT NULL, -- addition: the driver currently assigned to this bus, so Fleet Management can show it without needing a trip record first
  boarding_point VARCHAR(150) NULL, -- addition: a named pickup point distinct from the route's official origin/destination
  gps_device_id VARCHAR(32) NULL UNIQUE, -- addition: the ID of the GPS tracker fitted to this bus (SinoTrack ST-906L), as registered in Traccar; positions forwarded to POST /api/tracking/device are matched to the bus by it
  owner_id INT NULL, -- addition: the bus owner who can track this bus in the Owner portal; NULL = no owner account linked
  FOREIGN KEY (current_driver_id) REFERENCES drivers(driver_id),
  CONSTRAINT fk_buses_owner FOREIGN KEY (owner_id) REFERENCES bus_owners(owner_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS commuters (
  commuter_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  phoneno VARCHAR(20), -- sign-up stores +639XXXXXXXXX (cleanPhMobile); NULL for older accounts and the walk-in placeholder
  password_hash VARCHAR(255) NOT NULL,
  discount_category ENUM('student', 'pwd', 'senior') NULL, -- addition: verified fare discount (20%), NULL = regular fare
  discount_verified_at DATETIME NULL,
  discount_expires_at DATETIME NULL, -- addition: one year after approval for students, NULL (no expiry) for PWD / senior citizens
  terms_accepted_at DATETIME NULL, -- addition: when the passenger ticked "I agree to the Terms of Use and Privacy Policy" at sign-up
  UNIQUE KEY uq_commuters_phoneno (phoneno) -- addition: one account per mobile number (NULLs don't collide)
);

-- addition: the document's ERD scopes only Commuter + Driver accounts.
-- Terminal Staff and Admin login pages already exist in drs-bus-main, so
-- this table gives them somewhere to authenticate against.
CREATE TABLE IF NOT EXISTS staff_accounts (
  staff_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('terminal_staff', 'admin') NOT NULL,
  -- addition: employee profile recorded by the admin in UserManagement.jsx
  -- (services/employeeProfile.js). All nullable, filled in once known.
  employee_no VARCHAR(30) NULL UNIQUE,
  phoneno VARCHAR(20) NULL,
  birth_date DATE NULL,
  sex ENUM('Male', 'Female') NULL,
  address VARCHAR(255) NULL,
  hire_date DATE NULL,
  emergency_contact_name VARCHAR(150) NULL,
  emergency_contact_phone VARCHAR(20) NULL
);

CREATE TABLE IF NOT EXISTS trips (
  trip_id INT AUTO_INCREMENT PRIMARY KEY,
  departure_time DATETIME NOT NULL,
  arrival_time DATETIME, -- addition: narrative text mentions it (needed for TripDetail's ETA) though Figure 10's box only shows departure_time
  status ENUM('Scheduled', 'Boarding', 'In Transit', 'Completed', 'Cancelled') NOT NULL DEFAULT 'Scheduled',
  completed_at TIMESTAMP NULL DEFAULT NULL, -- addition: on-time-performance reporting (Phase 5) needs an *actual* completion timestamp to compare against the *scheduled* arrival_time; set when status transitions to 'Completed'
  bus_id INT NOT NULL,
  driver_id INT NOT NULL,
  route_id INT NOT NULL,
  FOREIGN KEY (bus_id) REFERENCES buses(bus_id),
  FOREIGN KEY (driver_id) REFERENCES drivers(driver_id),
  FOREIGN KEY (route_id) REFERENCES routes(route_id),
  KEY idx_trips_status_departure (status, departure_time) -- addition: the passenger / walk-in list only wants Boarding trips and Scheduled ones that haven't left; without this MySQL scans every trip ever scheduled. Measured at 50,000 trips: ~80 ms -> ~8 ms. See migrate.js
);

CREATE TABLE IF NOT EXISTS bookings (
  booking_id INT AUTO_INCREMENT PRIMARY KEY,
  passenger_name VARCHAR(150) NOT NULL,
  seat_number VARCHAR(10) NOT NULL,
  status ENUM('Reserved', 'Confirmed', 'Boarded', 'Cancelled', 'No-Show') NOT NULL DEFAULT 'Reserved',
  channel ENUM('online', 'walk_in', 'flagged') NOT NULL DEFAULT 'online', -- addition: Table 4 says Reservations Oversight filters "by channel and status", but no channel column is in the ERD box. 'flagged' = a roadside passenger who hailed an in-transit bus (see flag_requests below); appended last so existing rows keep their stored enum index
  passenger_id INT NOT NULL,
  trip_id INT NOT NULL,
  booked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  payment_deadline DATETIME NULL, -- addition: online seat hold. A Reserved online booking with no proof under review is released (Cancelled, cancellation_reason 'payment_expired') once this passes. NULL = no hold (walk-ins, flagged rides, and bookings created before holds existed)
  expiry_warned_at TIMESTAMP NULL DEFAULT NULL, -- addition: when the passenger was warned their hold is about to lapse (sent once)
  discount_category ENUM('student', 'pwd', 'senior') NULL, -- addition: the discount this seat was booked with, fixed at booking time so the fare due can't change mid-payment. NULL = full fare
  cancellation_reason VARCHAR(50) NULL, -- addition: why a booking became Cancelled when the system did it ('payment_expired'); NULL for ordinary cancels
  -- The document specifies: "UNIQUE constraint on (trip_id, seat_number)
  -- with status NOT IN ('Cancelled', 'No-Show')". MySQL has no native
  -- partial/filtered unique index, so a generated column reproduces the
  -- same guarantee: cancelled/no-show rows collapse to NULL, and MySQL
  -- allows unlimited NULLs in a unique index, so only "live" seat holds
  -- are actually enforced as unique.
  active_seat_number VARCHAR(10) GENERATED ALWAYS AS (
    CASE WHEN status IN ('Cancelled', 'No-Show') THEN NULL ELSE seat_number END
  ) STORED,
  FOREIGN KEY (passenger_id) REFERENCES commuters(commuter_id),
  FOREIGN KEY (trip_id) REFERENCES trips(trip_id),
  UNIQUE KEY unique_active_seat_per_trip (trip_id, active_seat_number),
  KEY idx_bookings_payment_hold (status, payment_deadline)
);

CREATE TABLE IF NOT EXISTS location_tracking (
  tracking_id INT AUTO_INCREMENT PRIMARY KEY,
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  timestamp DATETIME NOT NULL,
  bus_id INT NOT NULL,
  sync_status ENUM('buffered', 'synced') NOT NULL DEFAULT 'synced', -- addition: narrative's offline-first sync detail, not drawn in the ERD box
  source ENUM('phone', 'device') NOT NULL DEFAULT 'phone', -- addition: 'device' = the bus's GPS tracker, 'phone' = the driver's phone (backup when the tracker is silent)
  FOREIGN KEY (bus_id) REFERENCES buses(bus_id),
  KEY idx_location_bus_time (bus_id, timestamp) -- addition: "latest point per bus" lookups; see migrate.js for the measured reason
);


-- addition: not in the ERD at all. Security non-functional requirement --
-- "administrators must have audit trails for all critical actions" -- so
-- every admin create/edit/delete/status-override writes a row here.
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id INT AUTO_INCREMENT PRIMARY KEY,
  staff_id INT NOT NULL,
  action VARCHAR(50) NOT NULL, -- e.g. 'create', 'update', 'delete', 'status_change'
  entity_type VARCHAR(50) NOT NULL, -- e.g. 'bus', 'driver', 'route', 'trip', 'staff'
  entity_id INT,
  details JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (staff_id) REFERENCES staff_accounts(staff_id)
);

-- addition: not in the ERD. Reliability requirement -- passengers/drivers
-- must be notified when a trip's schedule or status changes after they
-- already hold a booking/assignment on it. recipient_type+recipient_id is
-- a loose polymorphic reference (commuters.commuter_id or
-- drivers.driver_id) rather than two nullable FK columns, since exactly
-- one of the two recipient tables applies per row.
CREATE TABLE IF NOT EXISTS notifications (
  notification_id INT AUTO_INCREMENT PRIMARY KEY,
  recipient_type ENUM('passenger', 'driver', 'staff') NOT NULL, -- 'staff' = staff_accounts.staff_id (terminal staff and admins): payment review alerts
  recipient_id INT NOT NULL,
  message VARCHAR(500) NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'schedule_change',
  read_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- addition: not in the ERD. Passenger "Flag a Bus" mode -- a commuter
-- standing along the route (not at the terminal) hails a bus that is
-- already In Transit. This is deliberately NOT a bookings row from the
-- start: a hail is unconfirmed intent (the driver may not see it in time,
-- may already be full by the time they reach the passenger, or the
-- passenger may catch another ride). Writing it straight into bookings
-- would inflate booked_count for terminal seat sales, put riders who never
-- boarded on the manifest and in the reservation-trends report, and force
-- either a fake seat_number or relaxing the NOT NULL + unique seat lock
-- that the terminal booking flow depends on. Instead the hail lives here
-- until the driver acknowledges it, at which point a real bookings row
-- (channel = 'flagged', status = 'Confirmed') is created and linked back
-- via booking_id -- from then on the normal booking lifecycle (Boarded /
-- No-Show on the driver's manifest) takes over.
CREATE TABLE IF NOT EXISTS flag_requests (
  flag_id INT AUTO_INCREMENT PRIMARY KEY,
  trip_id INT NOT NULL,
  passenger_id INT NOT NULL,
  passenger_name VARCHAR(150) NOT NULL, -- snapshot at hail time, same reason bookings.passenger_name exists alongside passenger_id
  pickup_latitude DECIMAL(10,7) NULL, -- where the driver stops: the passenger's own GPS fix, required by the API (bookings.js, MAX_PICKUP_ACCURACY_M) and kept current while the flag is open. Left NULL-able only so any rows from before that rule stay valid -- the API never writes NULL here
  pickup_longitude DECIMAL(10,7) NULL,
  pickup_landmark VARCHAR(150) NULL, -- optional note to help the driver spot the passenger ("yellow umbrella, KM 42 waiting shed"); never a substitute for the coordinates
  status ENUM('Pending', 'Acknowledged', 'Declined', 'Cancelled', 'Expired') NOT NULL DEFAULT 'Pending',
  decline_reason VARCHAR(150) NULL, -- shown to the passenger ("Bus is full") so a decline isn't a silent dead end
  booking_id INT NULL, -- set when the driver acknowledges and the real bookings row is created
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP NULL DEFAULT NULL, -- when it left Pending (acknowledged/declined/cancelled/expired)
  -- Same generated-column trick bookings uses for its seat lock: only a
  -- Pending row keeps a non-NULL value, so the unique key below allows at
  -- most one open hail per passenger while any number of past
  -- (Acknowledged/Declined/Cancelled/Expired) rows collapse to NULL.
  pending_passenger_id INT GENERATED ALWAYS AS (
    CASE WHEN status = 'Pending' THEN passenger_id ELSE NULL END
  ) STORED,
  FOREIGN KEY (trip_id) REFERENCES trips(trip_id),
  FOREIGN KEY (passenger_id) REFERENCES commuters(commuter_id),
  FOREIGN KEY (booking_id) REFERENCES bookings(booking_id),
  UNIQUE KEY one_pending_flag_per_passenger (pending_passenger_id),
  KEY idx_flag_trip_status (trip_id, status)
);

-- Note: an earlier revision of this schema had a separate `fare_matrix`
-- table (one row per km post, referencing a single summary route). That's
-- been superseded: `routes` itself now holds one row per km post (each
-- "Baguio -> <stop>" carrying its own distance/regular/special fare), so
-- there's no separate fare table anymore — see db/seed-baguio-bontoc.js.

-- addition: not in the ERD. QR Ph online payment for Book Ahead bookings.
-- There is no payment gateway behind this: the admin uploads a static image
-- of the operator's own GCash / Maya / bank QR, the passenger pays it in
-- their own app and reports the reference number, and staff verify it by
-- hand against the receiving account (routes/payments.js). Verifying is
-- the one manual step; confirming the booking happens automatically in the
-- same transaction.
--
-- Exactly one row (setting_id = 1), upserted on save. The image is a base64
-- data: URL in the database rather than a file on disk, because Railway's
-- default filesystem is wiped on every redeploy.
CREATE TABLE IF NOT EXISTS payment_settings (
  setting_id INT PRIMARY KEY DEFAULT 1,
  qr_image LONGTEXT NOT NULL,
  label VARCHAR(150) NULL,
  instructions VARCHAR(500) NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by) REFERENCES staff_accounts(staff_id)
);

-- addition: configurable payment instructions (Payment Methods admin
-- page). Account details are entered by an administrator; nothing real is
-- hard-coded. Only is_active rows are shown to passengers.
CREATE TABLE IF NOT EXISTS payment_methods (
  method_id INT AUTO_INCREMENT PRIMARY KEY,
  method_type ENUM('gcash', 'bank_transfer', 'qr_ph') NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  account_name VARCHAR(150) NULL,
  account_number VARCHAR(60) NULL,
  bank_name VARCHAR(100) NULL,
  qr_image LONGTEXT NULL,
  instructions VARCHAR(1000) NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  updated_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by) REFERENCES staff_accounts(staff_id) ON DELETE SET NULL
);

-- addition: one row per actual money transfer a passenger reports (one
-- GCash send can cover several seats). Holds the claim (method, reference,
-- amount, time), the private receipt image (base64 in the database, not on
-- disk, because Railway's filesystem is wiped on redeploy; only served
-- through an authorized endpoint), and what staff confirmed (amount_received).
CREATE TABLE IF NOT EXISTS payment_submissions (
  submission_id INT AUTO_INCREMENT PRIMARY KEY,
  passenger_id INT NOT NULL,
  method_id INT NULL,
  payment_method ENUM('gcash', 'bank_transfer', 'qr_ph') NOT NULL,
  reference_number VARCHAR(100) NOT NULL,
  reference_normalized VARCHAR(100) NOT NULL,
  amount_due DECIMAL(10,2) NOT NULL,
  amount_claimed DECIMAL(10,2) NULL,
  paid_at DATETIME NULL,
  receipt_data LONGTEXT NULL,
  receipt_mime VARCHAR(20) NULL,
  receipt_bytes INT NULL,
  receipt_sha256 CHAR(64) NULL,
  amount_received DECIMAL(10,2) NULL,
  ledger_reference VARCHAR(100) NULL,
  assigned_to INT NULL,
  assigned_at TIMESTAMP NULL DEFAULT NULL,
  departure_alert_sent_at TIMESTAMP NULL DEFAULT NULL,
  is_legacy BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (passenger_id) REFERENCES commuters(commuter_id),
  FOREIGN KEY (method_id) REFERENCES payment_methods(method_id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_to) REFERENCES staff_accounts(staff_id) ON DELETE SET NULL,
  KEY idx_submissions_reference (reference_normalized),
  KEY idx_submissions_receipt_hash (receipt_sha256),
  KEY idx_submissions_passenger (passenger_id),
  KEY idx_submissions_submitted (submitted_at)
);

-- One row per seat (same granularity as bookings), linked to the submission
-- that paid for it. A booking can collect several rows over time (Rejected /
-- Needs Resubmission, then resubmitted) -- the latest is the current one.
-- amount is a server-side snapshot of that seat's route fare, never a
-- client-sent number. proof_image is legacy (pre-submission rows only).
CREATE TABLE IF NOT EXISTS payments (
  payment_id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  submission_id INT NULL,
  amount DECIMAL(8,2) NOT NULL,
  reference_number VARCHAR(100) NOT NULL,
  proof_image LONGTEXT NULL,
  status ENUM('Pending', 'Verified', 'Rejected', 'Needs Resubmission', 'Escalated', 'Refund Pending', 'Refunded') NOT NULL DEFAULT 'Pending',
  rejection_reason VARCHAR(255) NULL,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  verified_at TIMESTAMP NULL DEFAULT NULL,
  verified_by INT NULL,
  refund_reason VARCHAR(255) NULL,
  refund_requested_at TIMESTAMP NULL DEFAULT NULL,
  refund_requested_by INT NULL,
  refund_reference VARCHAR(100) NULL,
  refunded_at TIMESTAMP NULL DEFAULT NULL,
  refunded_by INT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  open_booking_id INT GENERATED ALWAYS AS (
    CASE WHEN status IN ('Pending', 'Escalated') THEN booking_id ELSE NULL END
  ) STORED,
  verified_booking_id INT GENERATED ALWAYS AS (
    CASE WHEN status = 'Verified' THEN booking_id ELSE NULL END
  ) STORED,
  FOREIGN KEY (booking_id) REFERENCES bookings(booking_id),
  FOREIGN KEY (verified_by) REFERENCES staff_accounts(staff_id),
  CONSTRAINT fk_payments_submission FOREIGN KEY (submission_id) REFERENCES payment_submissions(submission_id),
  KEY idx_payments_booking (booking_id),
  KEY idx_payments_status (status),
  KEY idx_payments_submission (submission_id),
  UNIQUE KEY uq_payments_open_booking (open_booking_id),
  UNIQUE KEY uq_payments_verified_booking (verified_booking_id)
);

-- One real transaction can be verified once, ever: inserted in the same
-- transaction as a verification, and the unique key makes a second
-- (concurrent or later) verification of the same reference fail.
CREATE TABLE IF NOT EXISTS payment_reference_claims (
  claim_id INT AUTO_INCREMENT PRIMARY KEY,
  payment_method ENUM('gcash', 'bank_transfer', 'qr_ph') NOT NULL,
  reference_normalized VARCHAR(100) NOT NULL,
  submission_id INT NOT NULL,
  claimed_by INT NULL,
  claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reference_claim (payment_method, reference_normalized),
  FOREIGN KEY (submission_id) REFERENCES payment_submissions(submission_id)
);

-- Append-only history of every payment action (submissions, staff
-- decisions, refunds, system expiries). actor_id has no FK on purpose: it
-- points at commuters or staff_accounts depending on actor_role, and logs
-- must survive a staff account being deleted. Never holds secrets.
CREATE TABLE IF NOT EXISTS payment_audit_logs (
  audit_log_id INT AUTO_INCREMENT PRIMARY KEY,
  payment_id INT NULL,
  submission_id INT NULL,
  booking_id INT NULL,
  actor_id INT NULL,
  actor_role ENUM('passenger', 'staff', 'admin', 'system') NOT NULL,
  previous_status VARCHAR(30) NULL,
  new_status VARCHAR(30) NULL,
  action VARCHAR(40) NOT NULL,
  reason VARCHAR(500) NULL,
  internal_note VARCHAR(1000) NULL,
  details JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pal_payment (payment_id),
  KEY idx_pal_submission (submission_id),
  KEY idx_pal_booking (booking_id),
  KEY idx_pal_created (created_at)
);

-- addition: student / PWD / senior citizen fare discount (routes/discounts.js).
-- One row per ID a passenger submits. Terminal staff or an admin check the
-- ID is real and legible, then approve (sets commuters.discount_*) or reject
-- with a reason. id_image is a base64 data: URL like payment receipts.
-- expires_at: one year after approval for students, NULL for PWD / senior.
-- pending_commuter_id allows at most one Pending application per passenger.
CREATE TABLE IF NOT EXISTS discount_applications (
  application_id INT AUTO_INCREMENT PRIMARY KEY,
  commuter_id INT NOT NULL,
  category ENUM('student', 'pwd', 'senior') NOT NULL,
  id_number VARCHAR(50) NULL,
  id_image LONGTEXT NOT NULL,
  status ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',
  rejection_reason VARCHAR(255) NULL,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  reviewed_by INT NULL,
  expires_at DATETIME NULL,
  pending_commuter_id INT GENERATED ALWAYS AS (
    CASE WHEN status = 'Pending' THEN commuter_id ELSE NULL END
  ) STORED,
  FOREIGN KEY (commuter_id) REFERENCES commuters(commuter_id),
  FOREIGN KEY (reviewed_by) REFERENCES staff_accounts(staff_id),
  UNIQUE KEY one_pending_discount_per_commuter (pending_commuter_id),
  KEY idx_discount_status (status, submitted_at)
);
