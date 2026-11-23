import { pool } from "../db/pool.js";

// ============================================================================
// Bus crew: the driver and (optionally) a conductor.
//
// Both sign in to the same crew app (/driver, token role "driver"; both are
// rows in the drivers table, told apart by drivers.crew_role). A trip names
// its driver (trips.driver_id) and may name a conductor (trips.conductor_id).
//
// Who does what on a trip:
//
//   Conductor   passengers and money only: boarding / no-show on the
//               manifest, answering Flag a Bus hails, walk-on riders and
//               their fares, the remittance. Never the trip itself: a
//               conductor can't start boarding, depart, complete the trip
//               or share GPS (routes/trips.js, routes/tracking.js).
//   Driver      the trip itself (board, depart, arrive) and GPS. With a
//               conductor on board, the driver's screen is a read-only
//               "drive mode" (where to stop next) while on the road; the
//               server still lets the driver do the conductor's jobs, so a
//               conductor with a flat phone doesn't stop the trip.
//   No conductor  the driver does everything, exactly as before.
// ============================================================================

export const CREW_ROLES = ["Driver", "Conductor"];

// drivers.crew_role as stored can be 'Conductor' (this repo's schema) or
// 'conductor' (the shared Railway database was given a lowercase
// enum('driver','conductor') column before this code ran, and the startup
// ALTER then skips an existing column). MySQL stores either spelling in
// either column, so writes are fine; every READ goes through here.
export const normalizeCrewRole = (value) => (String(value ?? "").toLowerCase() === "conductor" ? "Conductor" : "Driver");
// SQL form of the same, for SELECT lists (enum comparison ignores case).
export const CREW_ROLE_SQL = (column = "crew_role") => `IF(${column} = 'conductor', 'Conductor', 'Driver')`;

// The columns may be missing on a database that hasn't run
// `npm run db:migrate` since this was added; every trip query reads them,
// so they're created at start-up too (same as tripLifecycle's missed_at).
export async function ensureCrewColumns() {
  const add = async (sql) =>
    pool.query(sql).catch((err) => {
      if (!["ER_DUP_FIELDNAME", "ER_FK_DUP_NAME", "ER_DUP_KEYNAME"].includes(err.code)) throw err;
    });
  await add(`ALTER TABLE drivers ADD COLUMN crew_role ENUM('driver', 'conductor') NOT NULL DEFAULT 'driver'`);
  await add(`ALTER TABLE trips ADD COLUMN conductor_id INT NULL`);
  await add(`ALTER TABLE trips ADD CONSTRAINT fk_trips_conductor FOREIGN KEY (conductor_id) REFERENCES drivers(driver_id)`);
  await add(`ALTER TABLE onboard_fares ADD COLUMN alighted_at TIMESTAMP NULL DEFAULT NULL`);
}

// "driver" | "conductor" | null — this crew account's job on this trip.
// trip needs driver_id and conductor_id.
export function crewRoleOn(trip, userId) {
  if (!trip || !Number.isInteger(userId)) return null;
  if (trip.driver_id === userId) return "driver";
  if (trip.conductor_id != null && trip.conductor_id === userId) return "conductor";
  return null;
}

export const isCrewOn = (trip, userId) => crewRoleOn(trip, userId) !== null;

// Same message everywhere a crew account opens someone else's trip.
export const NOT_YOUR_TRIP = "This trip isn't assigned to you";

// Socket.io rooms of everyone crewing a trip (each signed-in crew phone
// joins driver:<its id> through the notification bell).
export function crewRooms(trip) {
  const rooms = [`driver:${trip.driver_id}`];
  if (trip.conductor_id != null && trip.conductor_id !== trip.driver_id) rooms.push(`driver:${trip.conductor_id}`);
  return rooms;
}

// The crew member answerable for the cash collected on board: the
// conductor when there is one, else the driver.
export const cashHolderId = (trip) => trip.conductor_id ?? trip.driver_id;

// Walk-on riders (no app, no seat number) still on the bus: they take up
// seats just like booked passengers until the conductor marks them off.
export async function walkOnsAboard(conn, tripId) {
  const [[row]] = await conn.query(
    `SELECT COALESCE(SUM(passenger_count), 0) AS n FROM onboard_fares
     WHERE trip_id = ? AND booking_id IS NULL AND voided_at IS NULL AND alighted_at IS NULL`,
    [tripId]
  );
  return Number(row.n);
}

// How full the bus is right now. seated = bookings holding a seat (any
// channel); walkOns = walk-on riders not yet off. seatsLeft never goes
// below 0 (walk-ons can stand when the seats are gone).
export async function tripOccupancy(conn, trip) {
  const [[booked]] = await conn.query(
    `SELECT COUNT(*) AS n FROM bookings WHERE trip_id = ? AND status NOT IN ('Cancelled', 'No-Show')`,
    [trip.trip_id]
  );
  const seated = Number(booked.n);
  const walkOns = await walkOnsAboard(conn, trip.trip_id);
  const capacity = trip.capacity == null ? null : Number(trip.capacity);
  return {
    capacity,
    seated,
    walk_ons_aboard: walkOns,
    aboard: seated + walkOns,
    seats_left: capacity == null ? null : Math.max(0, capacity - seated - walkOns),
  };
}

// Why this crew account can't be put in this slot of a trip, or null.
// slot: "driver" | "conductor". Only Active crew of the right kind.
export async function whyCrewNotAssignable(conn, crewId, slot) {
  const [[row]] = await conn.query(`SELECT name, crew_role, duty_status FROM drivers WHERE driver_id = ?`, [crewId]);
  const want = slot === "conductor" ? "Conductor" : "Driver";
  if (!row) return `That ${want.toLowerCase()} doesn't exist`;
  const role = normalizeCrewRole(row.crew_role);
  if (role !== want) return `${row.name} is a ${role.toLowerCase()}, not a ${want.toLowerCase()}`;
  if (row.duty_status !== "Active") return `${row.name} is ${row.duty_status.toLowerCase()}`;
  return null;
}
