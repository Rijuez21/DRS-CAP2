import { Router } from "express";
import { pool } from "../db/pool.js";
import { redis, CACHE_TTL_SECONDS } from "../cache/redis.js";
import { requireRole, authenticate, identifyIfSignedIn } from "../middleware/auth.js";
import { publicTripRow, SEES_FULL_DRIVER_NAME } from "../services/driverDisplay.js";
import {
  BOARDING_OPENS_HOURS_BEFORE,
  boardingOpensAt,
  boardingClosesAt,
  findOtherActiveTrip,
  otherActiveTripMessage,
  passengersNotBoarded,
  earlyDepartureMessage,
} from "../services/tripLifecycle.js";
import { isCrewOn, whyCrewNotAssignable, NOT_YOUR_TRIP } from "../services/crew.js";

const seesFullDriverName = (req) => SEES_FULL_DRIVER_NAME.includes(req.user?.role);
import { logAudit } from "../services/audit.js";
import { notifyTripChange } from "../services/notify.js";
import { openRefundsForCancelledTrip } from "../services/paymentSweeper.js";
import { dateTime, id as parseId } from "../services/validate.js";
import { busLayout, busSeatLabels, naturalCompare, readStoredLayout } from "../services/seatLayout.js";

// Validates schedule input: ids are positive integers, times are real dates.
function parseTripBody(body, { partial }) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  for (const k of ["busId", "driverId", "routeId"]) {
    if (!partial || has(k)) {
      const v = parseId(body[k]);
      if (!v) return { error: `${k} must be a valid id` };
      out[k] = v;
    }
  }
  for (const k of ["departureTime", "arrivalTime"]) {
    if (!partial || has(k)) {
      const r = dateTime(body[k], { label: k });
      if (r.error) return r;
      out[k] = r.value;
    }
  }
  // Optional: the trip's conductor (services/crew.js). Blank/null = none,
  // the driver handles passengers and fares.
  if (has("conductorId")) {
    if (body.conductorId === null || body.conductorId === "") out.conductorId = null;
    else {
      const v = parseId(body.conductorId);
      if (!v) return { error: "conductorId must be a valid id" };
      out.conductorId = v;
    }
  }
  return { fields: out };
}

// The overlap query shared by POST and PATCH: another live trip using this
// bus, or any of this crew (as driver or as conductor), at the same time.
async function findScheduleConflicts({ excludeTripId = null, busId, driverId, conductorId, departureTime, arrivalTime }) {
  const crew = [driverId, conductorId].filter((v) => v != null);
  const [conflicts] = await pool.query(
    `SELECT trip_id, bus_id, driver_id, conductor_id FROM trips
     WHERE status NOT IN ('Cancelled', 'Completed') AND trip_id != ?
       AND (bus_id = ? OR driver_id IN (?) OR conductor_id IN (?))
       AND departure_time < ?
       AND COALESCE(arrival_time, DATE_ADD(departure_time, INTERVAL 12 HOUR)) > ?`,
    [excludeTripId ?? 0, busId, crew, crew, arrivalTime, departureTime]
  );
  return conflicts;
}

// The schedule-conflict message, naming what's in the way so the admin can
// find it: "Bus AYV 583 is already on ABATAN → Baguio, Nov 12, 6:00 AM –
// 10:00 AM (trip #45)." Before, it only said "conflicts with another trip".
const manilaShort = (d) =>
  new Date(d).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const manilaClock = (d) => new Date(d).toLocaleString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });

async function describeConflicts(conflicts, { busId, driverId, conductorId = null }) {
  const [rows] = await pool.query(
    `SELECT tr.trip_id, tr.bus_id, tr.driver_id, tr.conductor_id, tr.departure_time, tr.arrival_time,
            rt.origin, rt.destination, b.plate_num, d.name AS driver_name, c.name AS conductor_name
     FROM trips tr
     JOIN routes rt ON rt.route_id = tr.route_id
     JOIN buses b ON b.bus_id = tr.bus_id
     JOIN drivers d ON d.driver_id = tr.driver_id
     LEFT JOIN drivers c ON c.driver_id = tr.conductor_id
     WHERE tr.trip_id IN (?)
     ORDER BY tr.departure_time
     LIMIT 3`,
    [conflicts.map((c) => c.trip_id)]
  );
  const crew = [Number(driverId), conductorId == null ? null : Number(conductorId)].filter((v) => v != null);
  const lines = rows.map((t) => {
    // Who in the new trip is already busy on this one, by name.
    const names = [];
    if (t.bus_id === Number(busId)) names.push(`Bus ${t.plate_num}`);
    if (crew.includes(t.driver_id)) names.push(`${t.driver_id === Number(driverId) ? "driver" : "conductor"} ${t.driver_name}`);
    if (t.conductor_id != null && crew.includes(t.conductor_id)) names.push(`${t.conductor_id === Number(driverId) ? "driver" : "conductor"} ${t.conductor_name}`);
    const subject = names.join(" and ").replace(/^./, (ch) => ch.toUpperCase());
    const who = `${subject} ${names.length > 1 ? "are" : "is"}`;
    const until = t.arrival_time ? ` – ${manilaClock(t.arrival_time)}` : "";
    return `${who} already on ${t.origin} → ${t.destination}, ${manilaShort(t.departure_time)}${until} (trip #${t.trip_id}).`;
  });
  const more = conflicts.length > rows.length ? ` …and ${conflicts.length - rows.length} more.` : "";
  return `Schedule conflict: ${lines.join(" ")}${more} Pick another time, bus or crew.`;
}

// A departure earlier than now (with a minute's grace for the time spent
// filling in the form) can't be scheduled.
function isPast(departure) {
  return new Date(departure).getTime() < Date.now() - 60_000;
}

const TRIPS_CACHE_KEY = "cache:trips:active";
// The passenger / walk-in list (?scope=bookable) is cached on its own. It used
// to be filtered in JavaScript AFTER loading and caching every trip ever
// scheduled, so each passenger request re-parsed that whole (ever-growing)
// cached list just to keep a handful of rows. Measured with 50,000 trips:
// see the note in the query below.
const TRIPS_BOOKABLE_CACHE_KEY = "cache:trips:bookable";
// Any change to a trip must clear both cached lists — and so must a bus edit
// (fleet.js), since the lists carry each bus's capacity.
const TRIPS_COUNTER_CACHE_KEY = "cache:trips:counter"; // Walk-in Sales (scope=counter)
export const clearTripsCache = () => redis.del(TRIPS_CACHE_KEY, TRIPS_BOOKABLE_CACHE_KEY, TRIPS_COUNTER_CACHE_KEY).catch(() => {});

// Fresh (never cached) seat counts, overlaid on the cached trip list — the
// list itself changes rarely, but "seats left" changes with every booking,
// and a 15-second-stale count would let passengers pick sold-out trips.
async function attachBookedCounts(rows) {
  if (rows.length === 0) return rows;
  const [counts] = await pool.query(
    `SELECT trip_id, COUNT(*) AS booked_count FROM bookings
     WHERE trip_id IN (?) AND status NOT IN ('Cancelled', 'No-Show') GROUP BY trip_id`,
    [rows.map((r) => r.trip_id)]
  );
  const byTrip = new Map(counts.map((c) => [c.trip_id, Number(c.booked_count)]));
  return rows.map((r) => ({ ...r, booked_count: byTrip.get(r.trip_id) ?? 0 }));
}

// Trip status machine. A driver moves only their own trip forward, one step
// at a time; an admin can also cancel a trip that hasn't left yet. Before,
// anyone could set any status (Completed -> Scheduled included) with no login.
const DRIVER_NEXT = { Scheduled: "Boarding", Boarding: "In Transit", "In Transit": "Completed" };

// The timing rules (services/tripLifecycle.js) bind drivers; an admin can
// override them, and is the one who closes a missed trip (Completed if it
// ran — straight from Scheduled/Boarding — or Cancelled).
// otherActiveTrip / notBoarded are looked up by the route for drivers only.
function whyTripStatusChangeNotAllowed({ user, trip, next, otherActiveTrip, notBoarded }) {
  if (trip.status === next) return `This trip is already ${next}`;
  if (trip.status === "Completed" || trip.status === "Cancelled") return `This trip is ${trip.status.toLowerCase()} and can't be changed`;

  if (next === "Cancelled") {
    if (user.role !== "admin") return "Only an administrator can cancel a trip";
    if (trip.status === "In Transit") return "This bus is already on the road — it can't be cancelled now";
    return null;
  }
  if (["admin", "staff"].includes(user.role) && trip.missed_at && next === "Completed") return null; // "it did run"
  // Terminal staff close trips out (a missed one above, or one the driver
  // left In Transit) but don't run them — no boarding/departing for staff.
  if (user.role === "staff") {
    return next === "Completed" && trip.status === "In Transit" ? null : "Terminal staff can only mark a trip as completed";
  }
  // Either crew member moves the trip on: with a conductor aboard it's
  // usually the conductor, so the driver keeps their hands on the wheel.
  if (user.role === "driver" && !isCrewOn(trip, user.id)) return NOT_YOUR_TRIP;
  if (DRIVER_NEXT[trip.status] !== next) return `A ${trip.status} trip can only move to ${DRIVER_NEXT[trip.status]}`;
  if (user.role !== "driver") return null;

  const now = new Date();
  if (trip.missed_at) return "This trip's departure time has passed and it was sent to the admin to close. Ask the terminal office.";
  if (next === "Boarding") {
    const opens = boardingOpensAt(trip.departure_time);
    if (now < opens) return `Boarding opens ${BOARDING_OPENS_HOURS_BEFORE} hours before departure, at ${manilaShort(opens)}`;
    if (now > boardingClosesAt(trip.departure_time)) {
      return `This trip was due to leave at ${manilaShort(trip.departure_time)} — too late to start it from the app. Ask the terminal office.`;
    }
  }
  if ((next === "Boarding" || next === "In Transit") && otherActiveTrip) return otherActiveTripMessage(otherActiveTrip, trip);
  if (next === "In Transit" && now < new Date(trip.departure_time) && notBoarded?.length > 0) {
    return earlyDepartureMessage(notBoarded, trip.departure_time);
  }
  return null;
}

// Wrapped in a builder (like tracking.js/bookings.js's io-aware routes)
// since scheduling/editing a trip needs to push notify.js's live
// "notification:new" event through the same Socket.io instance index.js
// creates.
export function buildTripsRouter(io) {
  const tripsRouter = Router();

  // GET /api/trips — powers TripListings.jsx (no filter) and
  // DriverDashboard.jsx (?driverId=, plus a live booked_count per trip so
  // the driver can see how full their bus is without a second request).
  // Cache-aside through Redis: this is exactly the "active trip data" the
  // paper's Table 10 describes Redis caching to reduce MySQL load, since
  // TripListings is the page passengers hit most often. The driverId-
  // filtered path skips the cache — it's a much smaller, less-hit query.
  // GET /api/trips — ?driverId= (a driver's own schedule; admin may look up
  // any driver), ?scope=bookable (TripListings / WalkInSales: only trips a
  // seat can still be sold on), or no params (admin: everything).
  // Only the ?driverId= view needs a login (it's a person's work schedule);
  // the timetable itself is public.
  // Signed-in staff still get the driver's full name on the public view
  // (TripScheduling uses it); everyone else gets driverDisplay.publicTripRow.
  const authIfDriverQuery = (req, res, next) => (req.query.driverId ? authenticate(req, res, next) : identifyIfSignedIn(req, res, next));
  tripsRouter.get("/", authIfDriverQuery, async (req, res) => {
    const { driverId, scope } = req.query;

    if (driverId) {
      if (!(req.user.role === "admin" || (req.user.role === "driver" && req.user.id === Number(driverId)))) {
        return res.status(403).json({ error: "You can only view your own trips" });
      }
      try {
        // The crew app's schedule: trips this person drives OR conducts.
        // my_role says which, so the app shows the right screen per trip.
        const [rows] = await pool.query(
          `SELECT tr.trip_id, tr.departure_time, tr.arrival_time, tr.status, tr.missed_at,
                  rt.origin, rt.destination, rt.base_fare,
                  b.bus_id, b.plate_num, b.bus_number, b.capacity, b.type AS bus_type,
                  tr.driver_id, d.name AS driver_name, d.phoneno AS driver_phone,
                  tr.conductor_id, c.name AS conductor_name, c.phoneno AS conductor_phone,
                  IF(tr.driver_id = ?, 'driver', 'conductor') AS my_role,
                  (SELECT COUNT(*) FROM bookings bk WHERE bk.trip_id = tr.trip_id AND bk.status NOT IN ('Cancelled', 'No-Show')) AS booked_count,
                  (SELECT COALESCE(SUM(f.passenger_count), 0) FROM onboard_fares f
                     WHERE f.trip_id = tr.trip_id AND f.booking_id IS NULL AND f.voided_at IS NULL AND f.alighted_at IS NULL) AS walk_ons_aboard
           FROM trips tr
           JOIN routes rt ON rt.route_id = tr.route_id
           JOIN buses b ON b.bus_id = tr.bus_id
           JOIN drivers d ON d.driver_id = tr.driver_id
           LEFT JOIN drivers c ON c.driver_id = tr.conductor_id
           WHERE (tr.driver_id = ? OR tr.conductor_id = ?) AND tr.status != 'Cancelled'
           ORDER BY tr.departure_time ASC`,
          [driverId, driverId, driverId]
        );
        return res.json(rows.map((r) => ({ ...r, walk_ons_aboard: Number(r.walk_ons_aboard) })));
      } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to load trips" });
      }
    }

    try {
      let rows;
      // scope=bookable: online Book Ahead (stops at the departure time).
      // scope=counter: Walk-in Sales — any trip until the bus leaves, so a
      // delayed one still Scheduled after its time stays on sale until it's
      // flagged missed (bookingRules.whyTripNotBookable, counter: true).
      const counterOnly = scope === "counter";
      const bookableOnly = scope === "bookable";
      const cacheKey = counterOnly ? TRIPS_COUNTER_CACHE_KEY : bookableOnly ? TRIPS_BOOKABLE_CACHE_KEY : TRIPS_CACHE_KEY;
      const cached = await redis.get(cacheKey).catch(() => null);
      if (cached) {
        rows = JSON.parse(cached);
      } else {
        // bookableOnly narrows to Boarding trips and Scheduled ones that haven't
        // left, in SQL, so old Completed/Cancelled trips are never loaded or
        // cached for passengers. The exact per-request check (a Scheduled trip
        // whose departure time passed during the 15 s cache window) still runs
        // below, so this is only a coarser first cut of the same rule.
        [rows] = await pool.query(
          `SELECT tr.trip_id, tr.departure_time, tr.arrival_time, tr.status, tr.missed_at,
                  rt.origin, rt.destination, rt.distance, rt.base_fare,
                  b.bus_id, b.plate_num, b.bus_number, b.capacity, b.type AS bus_type,
                  tr.driver_id, tr.route_id, d.name AS driver_name,
                  tr.conductor_id, c.name AS conductor_name
           FROM trips tr
           JOIN routes rt ON rt.route_id = tr.route_id
           JOIN buses b ON b.bus_id = tr.bus_id
           JOIN drivers d ON d.driver_id = tr.driver_id
           LEFT JOIN drivers c ON c.driver_id = tr.conductor_id
           ${
             counterOnly
               ? "WHERE tr.status IN ('Scheduled', 'Boarding') AND tr.missed_at IS NULL"
               : bookableOnly
                 ? "WHERE (tr.status = 'Boarding' OR (tr.status = 'Scheduled' AND tr.departure_time > NOW())) AND tr.missed_at IS NULL"
                 : ""
           }
           ORDER BY tr.departure_time ASC`
        );
        redis.set(cacheKey, JSON.stringify(rows), "EX", CACHE_TTL_SECONDS.activeTrips).catch((err) =>
          console.error("Redis set failed (non-fatal):", err.message)
        );
      }

      if (scope === "bookable") {
        // Same rule the booking API enforces (bookingRules.whyTripNotBookable),
        // so a listed trip is always one you can actually book.
        const now = Date.now();
        rows = rows.filter(
          (t) => t.capacity != null && !t.missed_at && (t.status === "Boarding" || (t.status === "Scheduled" && new Date(t.departure_time).getTime() > now))
        );
      } else if (counterOnly) {
        // Until the bus leaves; a Scheduled trip past its boarding window is
        // dropped even before the sweeper flags it missed.
        const now = Date.now();
        rows = rows.filter(
          (t) => t.capacity != null && !t.missed_at && (t.status === "Boarding" || boardingClosesAt(t.departure_time).getTime() > now)
        );
      }

      const withCounts = await attachBookedCounts(rows);
      res.json(seesFullDriverName(req) ? withCounts : withCounts.map(publicTripRow));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load trips" });
    }
  });

  // POST /api/trips — powers TripScheduling.jsx for both admin (/admin/trips)
  // and terminal staff (/staff/trips), since staff add departures at the
  // counter too. Rejects with 409 if
  // the bus or driver is already assigned to another (non-cancelled) trip
  // whose time window overlaps this one — Table 4's Trip Scheduling
  // explicitly requires conflict prevention, not just a same-timestamp check.
  // Cancelling a trip stays admin-only (PATCH /:id/status below).
  tripsRouter.post("/", requireRole("admin", "staff"), async (req, res) => {
    if (!req.body?.busId || !req.body?.driverId || !req.body?.routeId || !req.body?.departureTime || !req.body?.arrivalTime) {
      return res.status(400).json({ error: "busId, driverId, routeId, departureTime and arrivalTime are required" });
    }
    const parsedTrip = parseTripBody(req.body, { partial: false });
    if (parsedTrip.error) return res.status(400).json({ error: parsedTrip.error });
    const { busId, driverId, routeId, departureTime, arrivalTime } = parsedTrip.fields;
    const conductorId = parsedTrip.fields.conductorId ?? null;
    if (new Date(arrivalTime) <= new Date(departureTime)) {
      return res.status(400).json({ error: "arrivalTime must be after departureTime" });
    }
    if (isPast(departureTime)) {
      return res.status(400).json({ error: "Departure can't be in the past" });
    }
    if (conductorId != null && conductorId === driverId) {
      return res.status(400).json({ error: "The driver and the conductor must be two different people" });
    }

    try {
      // Driver slot takes a Driver, conductor slot a Conductor, both Active.
      const badCrew = (await whyCrewNotAssignable(pool, driverId, "driver")) ?? (conductorId != null ? await whyCrewNotAssignable(pool, conductorId, "conductor") : null);
      if (badCrew) return res.status(400).json({ error: badCrew });

      // Overlap: existing.departure < new.arrival AND existing.arrival > new.departure
      // (falls back to treating a NULL arrival_time as "unbounded" so an
      // open-ended trip still blocks the bus/crew). Completed trips never
      // block: the bus and crew are free once a trip has finished, even if
      // its scheduled arrival (e.g. a mistyped 24-hour trip) runs later.
      // A person can't drive one bus and conduct another at the same time.
      const conflicts = await findScheduleConflicts({ busId, driverId, conductorId, departureTime, arrivalTime });
      if (conflicts.length > 0) {
        return res.status(409).json({ error: await describeConflicts(conflicts, { busId, driverId, conductorId }), conflictTripIds: conflicts.map((c) => c.trip_id) });
      }

      const [result] = await pool.query(
        `INSERT INTO trips (bus_id, driver_id, conductor_id, route_id, departure_time, arrival_time, status)
         VALUES (?, ?, ?, ?, ?, ?, 'Scheduled')`,
        [busId, driverId, conductorId, routeId, departureTime, arrivalTime]
      );
      await clearTripsCache();
      await logAudit({ staffId: req.user.id, action: "create", entityType: "trip", entityId: result.insertId, details: req.body });
      res.status(201).json({ trip_id: result.insertId, busId, driverId, conductorId, routeId, departureTime, arrivalTime, status: "Scheduled" });
    } catch (err) {
      if (err.code === "ER_NO_REFERENCED_ROW_2") return res.status(400).json({ error: "That bus, driver or route doesn't exist" });
      console.error(err);
      res.status(500).json({ error: "Failed to schedule trip" });
    }
  });

  // GET /api/trips/:id — powers TripDetail.jsx and LiveTracking.jsx. The
  // route's pin (stop_latitude/longitude, null when not pinned) is where
  // this trip's stop actually is, so LiveTracking can show the bus relative to it.
  // Passengers/visitors get driver_first_name (from the day of travel), not
  // the full name — see services/driverDisplay.js.
  tripsRouter.get("/:id", identifyIfSignedIn, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT tr.trip_id, tr.departure_time, tr.arrival_time, tr.status, tr.missed_at,
                rt.origin, rt.destination, rt.distance, rt.base_fare,
                tr.route_id, rt.latitude AS stop_latitude, rt.longitude AS stop_longitude,
                b.bus_id, b.plate_num, b.bus_number, b.capacity, b.type AS bus_type,
                tr.driver_id, d.name AS driver_name
         FROM trips tr
         JOIN routes rt ON rt.route_id = tr.route_id
         JOIN buses b ON b.bus_id = tr.bus_id
         JOIN drivers d ON d.driver_id = tr.driver_id
         WHERE tr.trip_id = ?`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Trip not found" });
      const [withCount] = await attachBookedCounts(rows);
      res.json(seesFullDriverName(req) ? withCount : publicTripRow(withCount));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load trip" });
    }
  });

  // GET /api/trips/:id/seats — powers SeatMap.jsx (booked vs available seats)
  // A seat counts as taken only if its booking is NOT Cancelled/No-Show,
  // matching the document's active-booking rule for the seat lock (3.3.5).
  tripsRouter.get("/:id/seats", async (req, res) => {
    try {
      // Read fresh from MySQL on every request (never cached), so a bus's
      // edited layout shows up immediately.
      const [[trip]] = await pool.query(
        `SELECT b.capacity, b.seat_layout FROM trips tr JOIN buses b ON b.bus_id = tr.bus_id WHERE tr.trip_id = ?`,
        [req.params.id]
      );
      if (!trip) return res.status(404).json({ error: "Trip not found" });

      const [booked] = await pool.query(
        `SELECT seat_number FROM bookings WHERE trip_id = ? AND status NOT IN ('Cancelled', 'No-Show')`,
        [req.params.id]
      );

      // layout: the bus's own seat layout, or the generated 2 · aisle · 2
      // one for a bus without one (layoutSource "legacy"; null/"none" when
      // capacity isn't known either).
      const { layout, layoutSource } = busLayout(trip);
      res.json({
        capacity: trip.capacity,
        bookedSeats: booked.map((r) => r.seat_number),
        layout,
        layoutSource,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load seat map" });
    }
  });

  // GET /api/trips/:id/manifest — powers both driver/Manifest.jsx and
  // staff/ (terminal staff checking in the same trip), built once here
  // instead of duplicating the query in two route files (Phase 4.3).
  // Passenger names are personal data: the trip's own driver, terminal
  // staff and admins only.
  tripsRouter.get("/:id/manifest", requireRole("driver", "staff", "admin"), async (req, res) => {
    try {
      if (req.user.role === "driver") {
        const [[trip]] = await pool.query(`SELECT driver_id, conductor_id FROM trips WHERE trip_id = ?`, [req.params.id]);
        if (!trip) return res.status(404).json({ error: "Trip not found" });
        if (!isCrewOn(trip, req.user.id)) return res.status(403).json({ error: NOT_YOUR_TRIP });
      }
      const [rows] = await pool.query(
        `SELECT booking_id, passenger_name, seat_number, status, channel, booked_at
         FROM bookings
         WHERE trip_id = ?
         ORDER BY CAST(seat_number AS UNSIGNED), seat_number`,
        [req.params.id]
      );
      // CAST alone puts "A1" before "1" and ties "1A"/"1B"; natural order
      // reads like the seat map: 1, 1A, 1B, 2, ... 10.
      rows.sort((a, b) => naturalCompare(a.seat_number, b.seat_number));
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load manifest" });
    }
  });

  // PATCH /api/trips/:id — admin edits schedule (bus/driver/route/times) for
  // TripScheduling.jsx. Re-runs the same overlap check as POST, and if the
  // departure/arrival time actually changes, notifies every passenger with
  // a live booking on it plus the assigned driver (Phase 0.3's Reliability
  // requirement) via notify.js.
  tripsRouter.patch("/:id", requireRole("admin", "staff"), async (req, res) => {
    const parsedTrip = parseTripBody(req.body ?? {}, { partial: true });
    if (parsedTrip.error) return res.status(400).json({ error: parsedTrip.error });
    const { busId, driverId, routeId, departureTime, arrivalTime } = parsedTrip.fields;
    if (departureTime && arrivalTime && arrivalTime <= departureTime) {
      return res.status(400).json({ error: "arrivalTime must be after departureTime" });
    }

    try {
      const [[existing]] = await pool.query(`SELECT * FROM trips WHERE trip_id = ?`, [req.params.id]);
      if (!existing) return res.status(404).json({ error: "Trip not found" });
      if (existing.status !== "Scheduled") {
        return res.status(409).json({ error: `Only a Scheduled trip can be edited (this one is ${existing.status})` });
      }
      // Only a departure that's actually being changed has to be in the
      // future (the form resends it unchanged), so other edits to a trip
      // that's about to leave still go through.
      if (departureTime && new Date(departureTime).getTime() !== new Date(existing.departure_time).getTime() && isPast(departureTime)) {
        return res.status(400).json({ error: "Departure can't be in the past" });
      }
      if (busId !== undefined && Number(busId) !== existing.bus_id) {
        // Swapping to another bus must not strand passengers whose seat
        // doesn't exist on it (a smaller bus, or a layout without that label).
        const [[bus]] = await pool.query(`SELECT capacity, seat_layout FROM buses WHERE bus_id = ?`, [busId]);
        if (!bus) return res.status(404).json({ error: "Bus not found" });
        const [held] = await pool.query(
          `SELECT seat_number FROM bookings WHERE trip_id = ? AND status NOT IN ('Cancelled', 'No-Show')`,
          [req.params.id]
        );
        const onNewBus = new Set(busSeatLabels(bus).map((l) => l.toUpperCase()));
        const stranded = held.map((r) => String(r.seat_number)).filter((s) => !onNewBus.has(s.toUpperCase())).sort(naturalCompare);
        if (stranded.length > 0) {
          const seat = stranded[stranded.length - 1];
          return res.status(409).json({
            error: readStoredLayout(bus.seat_layout)
              ? `That bus's seat layout has no seat ${seat}, but seat ${seat} is already booked on this trip`
              : `That bus has ${bus.capacity ?? "no recorded"} seats, but seat ${seat} is already booked on this trip`,
          });
        }
      }

      const { conductorId } = parsedTrip.fields; // undefined = unchanged, null = remove the conductor
      const nextBusId = busId ?? existing.bus_id;
      const nextDriverId = driverId ?? existing.driver_id;
      const nextConductorId = conductorId === undefined ? existing.conductor_id : conductorId;
      const nextDeparture = departureTime ?? existing.departure_time;
      const nextArrival = arrivalTime ?? existing.arrival_time;

      if (nextConductorId != null && nextConductorId === nextDriverId) {
        return res.status(400).json({ error: "The driver and the conductor must be two different people" });
      }
      // Only a newly assigned person is checked (an existing assignment
      // stays editable even if that person has since gone on leave).
      const badCrew =
        (driverId !== undefined && driverId !== existing.driver_id ? await whyCrewNotAssignable(pool, driverId, "driver") : null) ??
        (conductorId != null && conductorId !== existing.conductor_id ? await whyCrewNotAssignable(pool, conductorId, "conductor") : null);
      if (badCrew) return res.status(400).json({ error: badCrew });

      const conflicts = await findScheduleConflicts({
        excludeTripId: Number(req.params.id),
        busId: nextBusId,
        driverId: nextDriverId,
        conductorId: nextConductorId,
        departureTime: nextDeparture,
        arrivalTime: nextArrival,
      });
      if (conflicts.length > 0) {
        return res.status(409).json({
          error: await describeConflicts(conflicts, { busId: nextBusId, driverId: nextDriverId, conductorId: nextConductorId }),
          conflictTripIds: conflicts.map((c) => c.trip_id),
        });
      }

      const fields = [];
      const params = [];
      if (busId !== undefined) { fields.push("bus_id = ?"); params.push(busId); }
      if (driverId !== undefined) { fields.push("driver_id = ?"); params.push(driverId); }
      if (conductorId !== undefined) { fields.push("conductor_id = ?"); params.push(conductorId); }
      if (routeId !== undefined) { fields.push("route_id = ?"); params.push(routeId); }
      if (departureTime !== undefined) {
        fields.push("departure_time = ?");
        params.push(departureTime);
        // A missed trip moved to a new (future) time is back in service.
        if (new Date(departureTime).getTime() !== new Date(existing.departure_time).getTime()) fields.push("missed_at = NULL");
      }
      if (arrivalTime !== undefined) { fields.push("arrival_time = ?"); params.push(arrivalTime); }

      if (fields.length === 0) return res.status(400).json({ error: "No editable fields provided" });

      params.push(req.params.id);
      await pool.query(`UPDATE trips SET ${fields.join(", ")} WHERE trip_id = ?`, params);
      await clearTripsCache();
      await logAudit({ staffId: req.user.id, action: "update", entityType: "trip", entityId: req.params.id, details: req.body });

      const scheduleChanged =
        (departureTime !== undefined && String(departureTime) !== String(existing.departure_time)) ||
        (arrivalTime !== undefined && String(arrivalTime) !== String(existing.arrival_time));
      if (scheduleChanged) {
        await notifyTripChange(io, req.params.id, "Your trip's schedule has changed — please check the updated departure time.");
      }

      res.json({ trip_id: Number(req.params.id), ...req.body });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update trip" });
    }
  });

  // PATCH /api/trips/:id/status — powers DriverDashboard.jsx's "Mark as
  // Boarding/In Transit/Completed" and RouteSchedule.jsx, validated the same
  // way bookings.js/fleet.js validate their own enums. A Cancelled trip
  // notifies everyone holding a live booking on it.
  // PATCH /api/trips/:id/status — driver dashboard (Boarding -> In Transit
  // -> Completed) and admin trip cancellation. Rules in
  // whyTripStatusChangeNotAllowed above; side effects keep bookings honest:
  //   Cancelled: every open booking is cancelled (passengers are notified
  //              first, since notify targets still-active bookings).
  //   Completed: bookings nobody boarded become No-Show, so they stop
  //              showing as upcoming "Reserved" tickets forever.
  tripsRouter.patch("/:id/status", requireRole("driver", "admin", "staff"), async (req, res) => {
    const { status: next } = req.body;
    const allowed = ["Scheduled", "Boarding", "In Transit", "Completed", "Cancelled"];
    if (!allowed.includes(next)) {
      return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
    }

    try {
      const [[trip]] = await pool.query(
        `SELECT trip_id, status, driver_id, conductor_id, bus_id, departure_time, missed_at FROM trips WHERE trip_id = ?`,
        [req.params.id]
      );
      if (!trip) return res.status(404).json({ error: "Trip not found" });

      // Drivers: one active trip per driver and per bus; no leaving early
      // while a booked passenger hasn't boarded (services/tripLifecycle.js).
      let otherActiveTrip = null;
      let notBoarded = [];
      if (req.user.role === "driver" && (next === "Boarding" || next === "In Transit")) {
        otherActiveTrip = await findOtherActiveTrip(pool, trip);
        if (next === "In Transit") notBoarded = await passengersNotBoarded(pool, trip.trip_id);
      }
      const refusal = whyTripStatusChangeNotAllowed({ user: req.user, trip, next, otherActiveTrip, notBoarded });
      if (refusal) return res.status(409).json({ error: refusal });

      const [result] = await pool.query(
        `UPDATE trips SET status = ?, completed_at = IF(? = 'Completed', NOW(), completed_at) WHERE trip_id = ? AND status = ?`,
        [next, next, trip.trip_id, trip.status]
      );
      if (result.affectedRows === 0) return res.status(409).json({ error: "This trip was just updated by someone else — refresh and try again" });

      let refundsOpened = 0;
      if (next === "Cancelled") {
        // Told only once the cancel has gone through (before, a cancel that
        // lost a race still told everyone), but before their bookings are
        // cancelled: notifyTripChange reaches the passengers still booked.
        await notifyTripChange(io, trip.trip_id, "Your trip has been cancelled. Your booking has been cancelled too — please book another trip.", "trip_cancelled");
        await pool.query(`UPDATE bookings SET status = 'Cancelled' WHERE trip_id = ? AND status IN ('Reserved', 'Confirmed')`, [trip.trip_id]);
        // Seats paid online are owed back: Verified -> Refund Pending (audited).
        refundsOpened = await openRefundsForCancelledTrip(io, trip.trip_id, req.user);
      } else if (next === "Completed") {
        await pool.query(`UPDATE bookings SET status = 'No-Show' WHERE trip_id = ? AND status IN ('Reserved', 'Confirmed')`, [trip.trip_id]);
        // End of the line: every walk-on rider still aboard has got off.
        await pool.query(`UPDATE onboard_fares SET alighted_at = NOW() WHERE trip_id = ? AND booking_id IS NULL AND alighted_at IS NULL`, [trip.trip_id]);
      }
      await clearTripsCache();
      if (req.user.role === "admin" || req.user.role === "staff") {
        await logAudit({ staffId: req.user.id, action: "update", entityType: "trip", entityId: trip.trip_id, details: { status: next } });
      }

      res.json({ trip_id: trip.trip_id, status: next, refunds_opened: refundsOpened });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update trip status" });
    }
  });

  return tripsRouter;
}
