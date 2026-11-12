import { pool } from "../db/pool.js";
import { notifyStaff } from "./notify.js";

// ============================================================================
// When a driver may move a trip forward, and what happens to trips nobody
// moved. (routes/trips.js applies the rules; the sweeper below runs on a
// timer from index.js.)
//
//   Boarding window   opens BOARDING_OPENS_HOURS_BEFORE before departure,
//                     closes BOARDING_CLOSES_MINUTES_AFTER after it.
//   One at a time     a driver, and a bus, has at most one trip Boarding or
//                     In Transit.
//   Leaving early     allowed ("alis kapag puno"), but only once every
//                     booked passenger is marked Boarded — nobody who
//                     reserved a seat is left at the terminal.
//   Missed trips      Scheduled/Boarding and past the boarding window without
//                     departing: flagged (missed_at), taken off the driver's
//                     list and off sale, and the terminal staff and admins are
//                     asked to close it — Completed if it really ran (staff
//                     or admin), Cancelled if it didn't (admin).
//                     Never cancelled automatically: the bus may well have
//                     left with the driver forgetting to tap Depart, and a
//                     cancel would refund passengers who rode.
//   Forgotten arrival In Transit and AUTO_COMPLETE_HOURS_AFTER_ARRIVAL past
//                     the scheduled arrival: marked Completed.
//
// Admins can override all of this from Trip Scheduling.
// ============================================================================

export const BOARDING_OPENS_HOURS_BEFORE = 3;
// Generous on purpose: on the Halsema a bus can be held up for hours by a
// landslide or roadwork, and a delayed trip shouldn't be pulled off sale.
export const BOARDING_CLOSES_MINUTES_AFTER = 180;
export const AUTO_COMPLETE_HOURS_AFTER_ARRIVAL = 3;
const SWEEP_EVERY_MS = 5 * 60 * 1000;

const manila = (d) =>
  new Date(d).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const manilaClock = (d) => new Date(d).toLocaleString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });

export function boardingOpensAt(departureTime) {
  return new Date(new Date(departureTime).getTime() - BOARDING_OPENS_HOURS_BEFORE * 3600 * 1000);
}
export function boardingClosesAt(departureTime) {
  return new Date(new Date(departureTime).getTime() + BOARDING_CLOSES_MINUTES_AFTER * 60 * 1000);
}

// The trip's column is new; created at start-up too, like auth_sessions,
// because every trip query reads it.
export async function ensureTripLifecycleColumns() {
  await pool.query(`ALTER TABLE trips ADD COLUMN missed_at DATETIME NULL`).catch((err) => {
    if (err.code !== "ER_DUP_FIELDNAME") throw err;
  });
}

// Another trip this driver or bus is busy with (Boarding / In Transit), or
// null. Missed trips don't count — they're waiting for an admin, not running.
export async function findOtherActiveTrip(conn, trip) {
  const [[other]] = await conn.query(
    `SELECT tr.trip_id, tr.status, tr.departure_time, tr.bus_id, tr.driver_id, rt.origin, rt.destination
     FROM trips tr JOIN routes rt ON rt.route_id = tr.route_id
     WHERE tr.trip_id != ? AND (tr.driver_id = ? OR tr.bus_id = ?)
       AND tr.status IN ('Boarding', 'In Transit') AND tr.missed_at IS NULL
     ORDER BY tr.status = 'In Transit' DESC, tr.departure_time
     LIMIT 1`,
    [trip.trip_id, trip.driver_id, trip.bus_id]
  );
  return other ?? null;
}

export function otherActiveTripMessage(other, trip) {
  const whose = other.driver_id === trip.driver_id ? "You're" : "This bus is";
  const doing = other.status === "In Transit" ? "still on" : "still boarding";
  const finish = other.status === "In Transit" ? "Complete it first." : "Depart or finish it first.";
  return `${whose} ${doing} ${other.origin} → ${other.destination} (${manila(other.departure_time)}). ${finish}`;
}

// Booked passengers not yet marked Boarded — they block an early departure.
export async function passengersNotBoarded(conn, tripId) {
  const [rows] = await conn.query(
    `SELECT seat_number, passenger_name FROM bookings WHERE trip_id = ? AND status IN ('Reserved', 'Confirmed') ORDER BY seat_number`,
    [tripId]
  );
  return rows;
}

export function earlyDepartureMessage(waiting, departureTime) {
  const names = waiting.slice(0, 5).map((b) => `Seat ${b.seat_number} ${b.passenger_name}`).join(", ");
  const more = waiting.length > 5 ? ` and ${waiting.length - 5} more` : "";
  const who = waiting.length === 1 ? "1 booked passenger hasn't" : `${waiting.length} booked passengers haven't`;
  return `${who} boarded yet: ${names}${more}. Mark them Boarded on the passenger list to leave early, or wait until ${manilaClock(departureTime)}.`;
}

// ---------------------------------------------------------------------------
// Sweeper
// ---------------------------------------------------------------------------
export async function sweepTrips(io, { clearTripsCache }) {
  const out = { completed: [], missed: [] };

  // 1. In Transit long after arrival: the driver forgot "Arrived".
  const [stuck] = await pool.query(
    `SELECT trip_id FROM trips
     WHERE status = 'In Transit'
       AND COALESCE(arrival_time, departure_time + INTERVAL 12 HOUR) + INTERVAL ? HOUR < NOW()
     LIMIT 200`,
    [AUTO_COMPLETE_HOURS_AFTER_ARRIVAL]
  );
  for (const { trip_id } of stuck) {
    const [r] = await pool.query(`UPDATE trips SET status = 'Completed', completed_at = NOW() WHERE trip_id = ? AND status = 'In Transit'`, [trip_id]);
    if (r.affectedRows !== 1) continue;
    // Same as a driver completing it: unboarded bookings become No-Show.
    await pool.query(`UPDATE bookings SET status = 'No-Show' WHERE trip_id = ? AND status IN ('Reserved', 'Confirmed')`, [trip_id]);
    out.completed.push(trip_id);
  }

  // 2. Never departed and the boarding window has closed: flag for the admins.
  const [missed] = await pool.query(
    `SELECT tr.trip_id, tr.status, tr.departure_time, rt.origin, rt.destination, b.plate_num, d.name AS driver_name
     FROM trips tr
     JOIN routes rt ON rt.route_id = tr.route_id
     JOIN buses b ON b.bus_id = tr.bus_id
     JOIN drivers d ON d.driver_id = tr.driver_id
     WHERE tr.status IN ('Scheduled', 'Boarding') AND tr.missed_at IS NULL
       AND tr.departure_time + INTERVAL ? MINUTE < NOW()
     LIMIT 200`,
    [BOARDING_CLOSES_MINUTES_AFTER]
  );
  for (const t of missed) {
    const [r] = await pool.query(`UPDATE trips SET missed_at = NOW() WHERE trip_id = ? AND missed_at IS NULL AND status IN ('Scheduled', 'Boarding')`, [t.trip_id]);
    if (r.affectedRows !== 1) continue;
    out.missed.push(t.trip_id);
    await notifyStaff(
      io,
      `Trip #${t.trip_id} (${t.origin} → ${t.destination}, ${manila(t.departure_time)}, bus ${t.plate_num}, driver ${t.driver_name}) was never marked as departed. In Trips, mark it completed if it ran, or ask an admin to cancel it.`,
      "trip_missed"
    );
  }

  if (out.completed.length || out.missed.length) await clearTripsCache();
  return out;
}

let sweeping = false;
export function startTripSweeper(io, deps) {
  const run = async () => {
    if (sweeping) return; // never overlap runs
    sweeping = true;
    try {
      await sweepTrips(io, deps);
    } catch (err) {
      console.error("Trip sweep failed (non-fatal):", err.message);
    } finally {
      sweeping = false;
    }
  };
  const every = Number(process.env.TRIP_SWEEP_INTERVAL_MS) || SWEEP_EVERY_MS;
  // Soon after start-up (unless an interval is configured), then on the timer.
  setTimeout(run, process.env.TRIP_SWEEP_INTERVAL_MS ? every : 10_000).unref?.();
  const timer = setInterval(run, every);
  timer.unref?.();
  return timer;
}
