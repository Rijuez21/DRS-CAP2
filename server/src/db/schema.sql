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
  is_active BOOLEAN NOT NULL DEFAULT TRUE -- addition: Table 4's Route Management says admin can "deactivate" a route; past trips still FK to it, so this is a soft-delete flag rather than a DELETE
);

CREATE TABLE IF NOT EXISTS buses (
  bus_id INT AUTO_INCREMENT PRIMARY KEY, -- ERD labels this "busnum"
  plate_num VARCHAR(20) NOT NULL UNIQUE,
  capacity INT NOT NULL,
  type ENUM('ordinary', 'air_conditioned') NOT NULL,
  year_model YEAR,
  status ENUM('Active', 'Idle', 'Maintenance') NOT NULL DEFAULT 'Active'
);

CREATE TABLE IF NOT EXISTS drivers (
  driver_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  license_number VARCHAR(50) NOT NULL UNIQUE,
  phoneno VARCHAR(20),
  hire_date DATE,
  email VARCHAR(150) NOT NULL UNIQUE, -- addition: the ERD has no auth field on Driver at all, but DriverLogin.jsx (like every other role) logs in with email
  password_hash VARCHAR(255) NOT NULL, -- addition: same reason
  duty_status ENUM('Active', 'On Leave', 'Suspended') NOT NULL DEFAULT 'Active' -- addition: Table 4's Driver Management calls for a "duty status toggle", same additive spirit as routes.is_active
);

CREATE TABLE IF NOT EXISTS commuters (
  commuter_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  phoneno VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL
);

-- addition: the document's ERD scopes only Commuter + Driver accounts.
-- Terminal Staff and Admin login pages already exist in drs-bus-main, so
-- this table gives them somewhere to authenticate against.
CREATE TABLE IF NOT EXISTS staff_accounts (
  staff_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('terminal_staff', 'admin') NOT NULL
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
  FOREIGN KEY (route_id) REFERENCES routes(route_id)
);

CREATE TABLE IF NOT EXISTS bookings (
  booking_id INT AUTO_INCREMENT PRIMARY KEY,
  passenger_name VARCHAR(150) NOT NULL,
  seat_number VARCHAR(10) NOT NULL,
  status ENUM('Reserved', 'Confirmed', 'Boarded', 'Cancelled', 'No-Show') NOT NULL DEFAULT 'Reserved',
  channel ENUM('online', 'walk_in') NOT NULL DEFAULT 'online', -- addition: Table 4 says Reservations Oversight filters "by channel and status", but no channel column is in the ERD box
  passenger_id INT NOT NULL,
  trip_id INT NOT NULL,
  booked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
  UNIQUE KEY unique_active_seat_per_trip (trip_id, active_seat_number)
);

CREATE TABLE IF NOT EXISTS location_tracking (
  tracking_id INT AUTO_INCREMENT PRIMARY KEY,
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  timestamp DATETIME NOT NULL,
  bus_id INT NOT NULL,
  sync_status ENUM('buffered', 'synced') NOT NULL DEFAULT 'synced', -- addition: narrative's offline-first sync detail, not drawn in the ERD box
  FOREIGN KEY (bus_id) REFERENCES buses(bus_id)
);

CREATE TABLE IF NOT EXISTS maintenance (
  maintenance_id INT AUTO_INCREMENT PRIMARY KEY,
  service_type VARCHAR(100) NOT NULL,
  date DATE NOT NULL,
  cost DECIMAL(10,2),
  mechanic_notes TEXT, -- addition: in the narrative's attribute list, not drawn in the Figure 10 box
  next_service_date DATE,
  status ENUM('Scheduled', 'In Progress', 'Completed') NOT NULL DEFAULT 'Scheduled',
  bus_id INT NOT NULL,
  FOREIGN KEY (bus_id) REFERENCES buses(bus_id)
);

-- addition: the ERD has no table for this at all. Section 3.2.3.3 describes
-- "Pre-Trip Vehicle Checklist -- digitizes the mandatory safety inspection,
-- requiring drivers to verify engine, tires, brakes, lights, fuel, and
-- cleanliness before starting a trip" as a Driver Module feature, so it
-- needs somewhere to persist even though Figure 10 doesn't model it.
CREATE TABLE IF NOT EXISTS vehicle_checklists (
  checklist_id INT AUTO_INCREMENT PRIMARY KEY,
  trip_id INT NOT NULL,
  driver_id INT NOT NULL,
  engine_ok BOOLEAN NOT NULL DEFAULT FALSE,
  tires_ok BOOLEAN NOT NULL DEFAULT FALSE,
  brakes_ok BOOLEAN NOT NULL DEFAULT FALSE,
  lights_ok BOOLEAN NOT NULL DEFAULT FALSE,
  fuel_ok BOOLEAN NOT NULL DEFAULT FALSE,
  cleanliness_ok BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(trip_id),
  FOREIGN KEY (driver_id) REFERENCES drivers(driver_id),
  UNIQUE KEY one_checklist_per_trip (trip_id)
);

-- addition: same situation as vehicle_checklists -- needed for the Driver
-- Module's safety/incident reporting but not part of the document's ERD.
CREATE TABLE IF NOT EXISTS issue_reports (
  issue_id INT AUTO_INCREMENT PRIMARY KEY,
  trip_id INT,
  bus_id INT NOT NULL,
  driver_id INT NOT NULL,
  category ENUM('mechanical', 'safety', 'passenger', 'route', 'other') NOT NULL DEFAULT 'other',
  description TEXT NOT NULL,
  status ENUM('Open', 'Acknowledged', 'Resolved') NOT NULL DEFAULT 'Open',
  reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(trip_id),
  FOREIGN KEY (bus_id) REFERENCES buses(bus_id),
  FOREIGN KEY (driver_id) REFERENCES drivers(driver_id)
);
-- addition: not in the ERD at all. Security non-functional requirement --
-- "administrators must have audit trails for all critical actions" -- so
-- every admin create/edit/delete/status-override writes a row here.
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id INT AUTO_INCREMENT PRIMARY KEY,
  staff_id INT NOT NULL,
  action VARCHAR(50) NOT NULL, -- e.g. 'create', 'update', 'delete', 'status_change'
  entity_type VARCHAR(50) NOT NULL, -- e.g. 'bus', 'driver', 'route', 'trip', 'maintenance', 'staff'
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
  recipient_type ENUM('passenger', 'driver') NOT NULL,
  recipient_id INT NOT NULL,
  message VARCHAR(500) NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'schedule_change',
  read_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
