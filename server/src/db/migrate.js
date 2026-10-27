import { pool } from "./pool.js";
import {
  PAYMENT_TABLE_STATEMENTS,
  PAYMENT_ALTER_STATEMENTS,
  PAYMENT_UNIQUE_STATEMENTS,
  checkLegacyDuplicates,
  backfillPayments,
} from "./paymentMigration.js";

// For a DB that already has data you don't want to lose (reset-db.js +
// db:init wipes everything). This only ever ADDs — new columns, new
// tables — matching this phase's "extend, don't restructure" constraint.
// Each statement is wrapped individually so re-running this after it's
// already been applied is a harmless no-op (ER_DUP_FIELDNAME /
// ER_TABLE_EXISTS_ERROR are swallowed; anything else is surfaced).
const STATEMENTS = [
  `ALTER TABLE routes ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE`,
  `ALTER TABLE drivers ADD COLUMN duty_status ENUM('Active', 'On Leave', 'Suspended') NOT NULL DEFAULT 'Active'`,
  `ALTER TABLE trips ADD COLUMN completed_at TIMESTAMP NULL DEFAULT NULL`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    audit_id INT AUTO_INCREMENT PRIMARY KEY,
    staff_id INT NOT NULL,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id INT,
    details JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (staff_id) REFERENCES staff_accounts(staff_id)
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    notification_id INT AUTO_INCREMENT PRIMARY KEY,
    recipient_type ENUM('passenger', 'driver') NOT NULL,
    recipient_id INT NOT NULL,
    message VARCHAR(500) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'schedule_change',
    read_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // ---- Baguio–Bontoc roster + fare matrix additions ----------------
  // addition: the terminal-facing "queue number" (108, 208, ...) used to
  // call/identify a bus, separate from the internal bus_id.
  `ALTER TABLE buses ADD COLUMN bus_number VARCHAR(10) UNIQUE`,
  // addition: the driver currently assigned to this bus, so Fleet
  // Management can show it without needing a trip record first.
  `ALTER TABLE buses ADD COLUMN current_driver_id INT NULL`,
  // addition: a named pickup point distinct from the route's official
  // origin/destination terminals.
  `ALTER TABLE buses ADD COLUMN boarding_point VARCHAR(150) NULL`,
  `ALTER TABLE buses
     ADD CONSTRAINT fk_buses_current_driver
     FOREIGN KEY (current_driver_id) REFERENCES drivers(driver_id)`,
  // addition: the printed fare charts show a two-tier REGULAR / SPECIAL
  // (student/discounted) fare per route, on top of routes.base_fare.
  `ALTER TABLE routes ADD COLUMN special_fare DECIMAL(8,2) NULL`,
  // addition: routes now holds one row per km post directly (see
  // seed-baguio-bontoc.js), so the separate fare_matrix table this used
  // to create is superseded — drop it if an earlier run of this script
  // already created it.
  `DROP TABLE IF EXISTS fare_matrix`,

  // ---- Stop faking unknown data — relax these to nullable ------------
  // These were previously getting placeholder/guessed values (fake
  // license numbers, fake emails, guessed capacities, a guessed bus
  // type) just to satisfy NOT NULL. That's worse than just allowing the
  // record to exist with the field blank until the real value is known.
  // No UNIQUE here: the columns are already unique (schema.sql), and
  // "MODIFY ... UNIQUE" adds a brand-new duplicate index on every run —
  // repeated runs piled up 60+ copies until MySQL's 64-key limit stopped
  // the migration. These two only relax the columns to nullable.
  `ALTER TABLE drivers MODIFY COLUMN license_number VARCHAR(50)`,
  `ALTER TABLE drivers MODIFY COLUMN email VARCHAR(150)`,
  `ALTER TABLE drivers MODIFY COLUMN password_hash VARCHAR(255)`,
  `ALTER TABLE buses MODIFY COLUMN capacity INT`,
  `ALTER TABLE buses MODIFY COLUMN type ENUM('ordinary', 'air_conditioned')`,

  // ---- Passenger "Flag a Bus" mode ------------------------------------
  // addition: a new channel value for bookings created when a driver
  // acknowledges a roadside hail. Appended LAST so every existing row's
  // stored enum index ('online' = 1, 'walk_in' = 2) is untouched -- this
  // is a metadata-only change in InnoDB and safe to re-run.
  `ALTER TABLE bookings MODIFY COLUMN channel ENUM('online', 'walk_in', 'flagged') NOT NULL DEFAULT 'online'`,
  // addition: the pending hail itself, kept out of bookings until the
  // driver acknowledges it -- see the flag_requests comment in schema.sql
  // for why it isn't just a bookings row from the start.
  `CREATE TABLE IF NOT EXISTS flag_requests (
    flag_id INT AUTO_INCREMENT PRIMARY KEY,
    trip_id INT NOT NULL,
    passenger_id INT NOT NULL,
    passenger_name VARCHAR(150) NOT NULL,
    pickup_latitude DECIMAL(10,7) NULL,
    pickup_longitude DECIMAL(10,7) NULL,
    pickup_landmark VARCHAR(150) NULL,
    status ENUM('Pending', 'Acknowledged', 'Declined', 'Cancelled', 'Expired') NOT NULL DEFAULT 'Pending',
    decline_reason VARCHAR(150) NULL,
    booking_id INT NULL,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    responded_at TIMESTAMP NULL DEFAULT NULL,
    pending_passenger_id INT GENERATED ALWAYS AS (
      CASE WHEN status = 'Pending' THEN passenger_id ELSE NULL END
    ) STORED,
    FOREIGN KEY (trip_id) REFERENCES trips(trip_id),
    FOREIGN KEY (passenger_id) REFERENCES commuters(commuter_id),
    FOREIGN KEY (booking_id) REFERENCES bookings(booking_id),
    UNIQUE KEY one_pending_flag_per_passenger (pending_passenger_id),
    KEY idx_flag_trip_status (trip_id, status)
  )`,
  // addition: "where is this bus right now?" (LiveTracking, FlagBus, fleet
  // map) picks each bus's newest location_tracking row. Without an index on
  // (bus_id, timestamp) MySQL sorts every point that bus ever reported --
  // a phone posting every few seconds makes that grow fast. Measured at
  // ~300k rows (about 3.5 days of 3 buses): 785 ms without, 6 ms with.
  // Additive only; re-running is a no-op (ER_DUP_KEYNAME is ignored above).
  `CREATE INDEX idx_location_bus_time ON location_tracking (bus_id, timestamp)`,
  // addition: GET /api/trips?scope=bookable (every passenger's trip list and
  // walk-in sales) filters on status and departure_time. At 50,000 trips the
  // query took ~80 ms without this index and ~8 ms with it (routes/trips.js).
  // Additive only; re-running is a no-op (ER_DUP_KEYNAME is ignored above).
  `CREATE INDEX idx_trips_status_departure ON trips (status, departure_time)`,

  // ---- QR Ph online payment (routes/payments.js) ----------------------
  // addition: the admin-uploaded QR (always exactly one row, setting_id 1)
  // and one proof-of-payment row per seat. See the matching comments in
  // schema.sql. New tables only -- nothing existing is altered.
  `CREATE TABLE IF NOT EXISTS payment_settings (
    setting_id INT PRIMARY KEY DEFAULT 1,
    qr_image LONGTEXT NOT NULL,
    label VARCHAR(150) NULL,
    instructions VARCHAR(500) NULL,
    updated_by INT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (updated_by) REFERENCES staff_accounts(staff_id)
  )`,
  `CREATE TABLE IF NOT EXISTS payments (
    payment_id INT AUTO_INCREMENT PRIMARY KEY,
    booking_id INT NOT NULL,
    amount DECIMAL(8,2) NOT NULL,
    reference_number VARCHAR(100) NOT NULL,
    proof_image LONGTEXT NULL,
    status ENUM('Pending', 'Verified', 'Rejected') NOT NULL DEFAULT 'Pending',
    rejection_reason VARCHAR(255) NULL,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    verified_at TIMESTAMP NULL DEFAULT NULL,
    verified_by INT NULL,
    FOREIGN KEY (booking_id) REFERENCES bookings(booking_id),
    FOREIGN KEY (verified_by) REFERENCES staff_accounts(staff_id),
    KEY idx_payments_booking (booking_id),
    KEY idx_payments_status (status)
  )`,

  // ---- Bus stop pins (routes/routes.js PATCH /:id/pin) -----------------
  // addition: each routes row is one stop (km post) on the Baguio–Bontoc
  // line; these hold where that stop actually is on the map. Nullable
  // because every existing row starts unpinned, and nothing may guess a
  // position for it. Re-running is a no-op (ER_DUP_FIELDNAME is ignored).
  `ALTER TABLE routes ADD COLUMN latitude DECIMAL(10,7) NULL`,
  `ALTER TABLE routes ADD COLUMN longitude DECIMAL(10,7) NULL`,
  `ALTER TABLE routes ADD COLUMN pinned_at TIMESTAMP NULL DEFAULT NULL`,

  // ---- Hardware GPS tracker (routes/tracking.js POST /device) ----------
  // addition: which tracker is fitted to which bus, and whether a point came
  // from that tracker or the driver's phone. Both nullable/defaulted, so
  // existing rows are untouched. Re-running is a no-op.
  `ALTER TABLE buses ADD COLUMN gps_device_id VARCHAR(32) NULL UNIQUE`,
  `ALTER TABLE location_tracking ADD COLUMN source ENUM('phone', 'device') NOT NULL DEFAULT 'phone'`,

  // ---- Seat layout editor (Fleet Management, services/seatLayout.js) ---
  // addition: the admin-designed seat map. NULL = the bus keeps the
  // generated 2 · aisle · 2 layout numbered 1..capacity, so every existing
  // bus is untouched — nothing is backfilled. Re-running is a no-op.
  `ALTER TABLE buses ADD COLUMN seat_layout JSON NULL`,

  // ---- Student / PWD / senior fare discount (routes/discounts.js) -------
  // addition: the passenger's currently verified discount (NULL = regular
  // fare). discount_expires_at is one year after approval for students and
  // NULL (no expiry) for PWD / senior citizens. Re-running is a no-op.
  `ALTER TABLE commuters ADD COLUMN discount_category ENUM('student', 'pwd', 'senior') NULL`,
  `ALTER TABLE commuters ADD COLUMN discount_verified_at DATETIME NULL`,
  `ALTER TABLE commuters ADD COLUMN discount_expires_at DATETIME NULL`,
  // addition: the discount a seat was booked with, fixed at booking time so
  // the fare due can't change while the passenger is paying. NULL = full fare.
  `ALTER TABLE bookings ADD COLUMN discount_category ENUM('student', 'pwd', 'senior') NULL`,
  // addition: each ID a passenger submits for staff to check. See the
  // matching comment in schema.sql.
  `CREATE TABLE IF NOT EXISTS discount_applications (
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
  )`,

  // ---- Employee profiles (services/employeeProfile.js) ------------------
  // addition: the HR details the admin records when creating staff, admin
  // and driver accounts in UserManagement.jsx. All nullable, nothing is
  // backfilled. Re-running is a no-op.
  `ALTER TABLE staff_accounts ADD COLUMN employee_no VARCHAR(30) NULL UNIQUE`,
  `ALTER TABLE staff_accounts ADD COLUMN phoneno VARCHAR(20) NULL`,
  `ALTER TABLE staff_accounts ADD COLUMN birth_date DATE NULL`,
  `ALTER TABLE staff_accounts ADD COLUMN sex ENUM('Male', 'Female') NULL`,
  `ALTER TABLE staff_accounts ADD COLUMN address VARCHAR(255) NULL`,
  `ALTER TABLE staff_accounts ADD COLUMN hire_date DATE NULL`,
  `ALTER TABLE staff_accounts ADD COLUMN emergency_contact_name VARCHAR(150) NULL`,
  `ALTER TABLE staff_accounts ADD COLUMN emergency_contact_phone VARCHAR(20) NULL`,
  `ALTER TABLE drivers ADD COLUMN license_expiry DATE NULL`,
  `ALTER TABLE drivers ADD COLUMN employee_no VARCHAR(30) NULL UNIQUE`,
  `ALTER TABLE drivers ADD COLUMN birth_date DATE NULL`,
  `ALTER TABLE drivers ADD COLUMN sex ENUM('Male', 'Female') NULL`,
  `ALTER TABLE drivers ADD COLUMN address VARCHAR(255) NULL`,
  `ALTER TABLE drivers ADD COLUMN emergency_contact_name VARCHAR(150) NULL`,
  `ALTER TABLE drivers ADD COLUMN emergency_contact_phone VARCHAR(20) NULL`,

  // ---- Bus owners (routes/owners.js, Owner portal) ----------------------
  // addition: owner accounts and which buses are theirs. The foreign key is
  // named so a re-run fails with ER_FK_DUP_NAME (ignored) instead of adding
  // another copy. Nothing is backfilled. Re-running is a no-op.
  `CREATE TABLE IF NOT EXISTS bus_owners (
    owner_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    phoneno VARCHAR(20) NULL,
    address VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `ALTER TABLE buses ADD COLUMN owner_id INT NULL`,
  `ALTER TABLE buses ADD CONSTRAINT fk_buses_owner FOREIGN KEY (owner_id) REFERENCES bus_owners(owner_id) ON DELETE SET NULL`,
];

const IGNORABLE = new Set(["ER_DUP_FIELDNAME", "ER_TABLE_EXISTS_ERROR", "ER_DUP_KEYNAME", "ER_FK_DUP_NAME", "ER_DUP_KEY"]);

async function apply(statements) {
  for (const statement of statements) {
    try {
      await pool.query(statement);
      console.log("Applied:", statement.split("\n")[0].slice(0, 70), "...");
    } catch (err) {
      if (IGNORABLE.has(err.code)) {
        console.log("Already applied, skipping:", statement.split("\n")[0].slice(0, 70), "...");
      } else {
        throw err;
      }
    }
  }
}

async function main() {
  await apply(STATEMENTS);

  // ---- Manual payment verification (db/paymentMigration.js) -----------
  // New tables, then additive columns, then the legacy backfill, then the
  // unique keys (only once the data is known to satisfy them).
  await apply(PAYMENT_TABLE_STATEMENTS);
  await apply(PAYMENT_ALTER_STATEMENTS);
  await backfillPayments(pool);
  const problems = await checkLegacyDuplicates(pool);
  if (problems.length > 0) {
    console.error("Can't add the payment uniqueness keys until these are resolved by hand:");
    problems.forEach((p) => console.error("  -", p));
    console.error("Everything else was applied. Fix the rows above, then run `npm run db:migrate` again.");
    process.exitCode = 1;
  } else {
    await apply(PAYMENT_UNIQUE_STATEMENTS);
  }
  console.log("Migration complete.");
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
