import bcrypt from "bcryptjs";
import { pool } from "./pool.js";

/**
 * Populates enough sample data to actually see the app working end-to-end —
 * several buses/drivers/routes/trips/bookings so the admin Dashboard,
 * Reports & Analytics, and Reservations Oversight pages all have something
 * to show instead of a wall of empty states (Phase 6's demo-data script).
 * Safe to re-run — uses INSERT IGNORE / ON DUPLICATE KEY so it won't
 * duplicate rows on a second run.
 *
 * Passwords come from SEED_*_PASSWORD env vars (see .env.example) so
 * nothing sensitive is committed as a literal. If a var is unset, this
 * falls back to the dev-only default named below — fine for local
 * development, but set real values before seeding anything you'll deploy.
 *
 * Run via `npm run db:seed` (after `npm run db:init`, or `npm run
 * db:migrate` if you're adding this to a database that already has data).
 */
async function main() {
  const driverPassword = await bcrypt.hash(process.env.SEED_DRIVER_PASSWORD || "driver123", 10);
  const staffPassword = await bcrypt.hash(process.env.SEED_STAFF_PASSWORD || "staff123", 10);
  const adminPassword = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || "admin123", 10);
  const passengerPassword = await bcrypt.hash(process.env.SEED_PASSENGER_PASSWORD || "passenger123", 10);

  // ---- Routes ---------------------------------------------------------
  const ROUTES = [
    ["Baguio", "Manila", 250.0, 550.0],
    ["Baguio", "Sagada", 140.0, 350.0],
    ["Manila", "Vigan", 400.0, 750.0],
  ];
  for (const [origin, destination, distance, baseFare] of ROUTES) {
    await pool.query(
      `INSERT INTO routes (origin, destination, distance, base_fare)
       VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE origin = origin`,
      [origin, destination, distance, baseFare]
    );
  }
  const [routeRows] = await pool.query(`SELECT route_id, origin, destination FROM routes ORDER BY route_id`);

  // ---- Buses ---------------------------------------------------------
  const BUSES = [
    ["NXV-1234", 45, "air_conditioned", 2022, "Active"],
    ["NXV-5678", 50, "ordinary", 2019, "Active"],
    ["NXV-9012", 40, "air_conditioned", 2023, "Idle"],
    ["NXV-3456", 45, "ordinary", 2017, "Maintenance"],
  ];
  for (const [plateNum, capacity, type, yearModel, status] of BUSES) {
    await pool.query(
      `INSERT INTO buses (plate_num, capacity, type, year_model, status)
       VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE capacity = VALUES(capacity)`,
      [plateNum, capacity, type, yearModel, status]
    );
  }
  const [busRows] = await pool.query(`SELECT bus_id, plate_num FROM buses ORDER BY bus_id`);

  // ---- Drivers ---------------------------------------------------------
  const DRIVERS = [
    ["Juan Dela Cruz", "N01-23-456789", "+639171234567", "driver@drs.local"],
    ["Maria Santos", "N02-34-567890", "+639181234567", "driver2@drs.local"],
    ["Pedro Reyes", "N03-45-678901", "+639191234567", "driver3@drs.local"],
  ];
  for (const [name, licenseNumber, phoneno, email] of DRIVERS) {
    await pool.query(
      `INSERT INTO drivers (name, license_number, phoneno, hire_date, email, password_hash)
       VALUES (?, ?, ?, CURDATE(), ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [name, licenseNumber, phoneno, email, driverPassword]
    );
  }
  const [driverRows] = await pool.query(`SELECT driver_id, name FROM drivers ORDER BY driver_id`);

  // ---- Staff / admin accounts --------------------------------------------
  await pool.query(
    `INSERT INTO staff_accounts (name, email, password_hash, role)
     VALUES ('Terminal Staff Demo', 'staff@drs.local', ?, 'terminal_staff')
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [staffPassword]
  );
  await pool.query(
    `INSERT INTO staff_accounts (name, email, password_hash, role)
     VALUES ('Admin Demo', 'admin@drs.local', ?, 'admin')
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [adminPassword]
  );
  const [[adminRow]] = await pool.query(`SELECT staff_id FROM staff_accounts WHERE email = 'admin@drs.local'`);

  // ---- A demo passenger, so bookings have somewhere to attach --------
  await pool.query(
    `INSERT INTO commuters (name, email, password_hash)
     VALUES ('Demo Passenger', 'passenger@drs.local', ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [passengerPassword]
  );
  const [[passengerRow]] = await pool.query(`SELECT commuter_id FROM commuters WHERE email = 'passenger@drs.local'`);

  // ---- The walk-in placeholder (routes/bookings.js), created up front so
  // the email is taken before anyone could register it. Empty password_hash
  // = can never log in. INSERT IGNORE: an existing row is left untouched.
  await pool.query(
    `INSERT IGNORE INTO commuters (name, email, password_hash) VALUES ('Walk-in Counter', 'walk-in@drs.local', '')`
  );

  // ---- Trips: a mix of past-completed, in-transit, and future-scheduled
  // so the Dashboard/Reports pages have real variety to chart. ----------
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const tripPlan = [
    { departure: new Date(now - 3 * DAY), status: "Completed" },
    { departure: new Date(now - 2 * DAY), status: "Completed" },
    { departure: new Date(now - 1 * DAY), status: "Completed" },
    { departure: new Date(now + 2 * HOUR), status: "Scheduled" },
    { departure: new Date(now + 1 * DAY), status: "Scheduled" },
    { departure: new Date(now + 2 * DAY), status: "Scheduled" },
  ];

  const insertedTripIds = [];
  for (let i = 0; i < tripPlan.length; i++) {
    const { departure, status } = tripPlan[i];
    const bus = busRows[i % busRows.length];
    const driver = driverRows[i % driverRows.length];
    const route = routeRows[i % routeRows.length];
    const arrival = new Date(departure.getTime() + 6 * HOUR);
    const completedAt = status === "Completed" ? new Date(arrival.getTime() + (i % 2 === 0 ? 5 : 25) * 60 * 1000) : null;

    await pool.query(
      `INSERT INTO trips (departure_time, arrival_time, status, completed_at, bus_id, driver_id, route_id)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM trips WHERE departure_time = ? AND bus_id = ?)`,
      [departure, arrival, status, completedAt, bus.bus_id, driver.driver_id, route.route_id, departure, bus.bus_id]
    );
    const [[row]] = await pool.query(`SELECT trip_id FROM trips WHERE departure_time = ? AND bus_id = ?`, [departure, bus.bus_id]);
    if (row) insertedTripIds.push(row.trip_id);
  }

  // ---- A handful of bookings across a few of those trips ---------------
  if (insertedTripIds.length > 0) {
    const bookingPlan = [
      // Seat numbers are plain integers ("1".."capacity") -- the same ids
      // SeatMap.jsx renders and the booking API validates. The earlier "A1"
      // style never matched a seat on the map, so seeded seats showed as free.
      { tripId: insertedTripIds[0], seat: "1", status: "Boarded", channel: "online" },
      { tripId: insertedTripIds[0], seat: "2", status: "Boarded", channel: "walk_in" },
      { tripId: insertedTripIds[3], seat: "5", status: "Confirmed", channel: "online" },
      { tripId: insertedTripIds[3], seat: "6", status: "Reserved", channel: "online" },
      { tripId: insertedTripIds[4], seat: "1", status: "Reserved", channel: "walk_in" },
    ];
    for (const b of bookingPlan) {
      if (!b.tripId) continue;
      await pool.query(
        `INSERT INTO bookings (trip_id, passenger_id, passenger_name, seat_number, status, channel)
         SELECT ?, ?, 'Demo Passenger', ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE trip_id = ? AND seat_number = ?)`,
        [b.tripId, passengerRow.commuter_id, b.seat, b.status, b.channel, b.tripId, b.seat]
      );
    }
  }

  // ---- Audit log entry, so the Dashboard's activity feed isn't empty ----
  if (adminRow) {
    await pool.query(
      `INSERT INTO audit_log (staff_id, action, entity_type, entity_id, details)
       SELECT ?, 'create', 'bus', ?, JSON_OBJECT('seeded', true)
       WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE staff_id = ? AND entity_type = 'bus' AND action = 'create')`,
      [adminRow.staff_id, busRows[0]?.bus_id ?? null, adminRow.staff_id]
    );
  }

  console.log("Seed complete. Demo accounts (password = env var if set, else the dev default shown):");
  console.log("  Driver          — driver@drs.local / SEED_DRIVER_PASSWORD or 'driver123' (and driver2@/driver3@drs.local)");
  console.log("  Terminal Staff  — staff@drs.local / SEED_STAFF_PASSWORD or 'staff123'");
  console.log("  Admin           — admin@drs.local / SEED_ADMIN_PASSWORD or 'admin123'");
  console.log("  Passenger       — passenger@drs.local / SEED_PASSENGER_PASSWORD or 'passenger123'");

  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
