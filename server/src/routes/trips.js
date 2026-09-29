import { Router } from "express";
import { pool } from "../db/pool.js";
import { redis, CACHE_TTL_SECONDS } from "../cache/redis.js";
import { requireRole, authenticate } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";
import { notifyTripChange } from "../services/notify.js";

const TRIPS_CACHE_KEY = "cache:trips:active";
// The passenger / walk-in list (?scope=bookable) is cached on its own. It used
// to be filtered in JavaScript AFTER loading and caching every trip ever
// scheduled, so each passenger request re-parsed that whole (ever-growing)
// cached list just to keep a handful of rows. Measured with 50,000 trips:
// see the note in the query below.
const TRIPS_BOOKABLE_CACHE_KEY = "cache:trips:bookable";
// Any change to a trip must clear both cached lists.
const clearTripsCache = () => redis.del(TRIPS_CACHE_KEY, TRIPS_BOOKABLE_CACHE_KEY).catch(() => {});

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
const BOARDING_OPENS_HOURS_BEFORE = 3; // a driver can't start boarding a trip that leaves tomorrow

function whyTripStatusChangeNotAllowed({ user, trip, next, otherActiveTrip }) {
  if (trip.status === next) return `This trip is already ${next}`;
  if (trip.status === "Completed" || trip.status === "Cancelled") return `This trip is ${trip.status.toLowerCase()} and can't be changed`;

  if (next === "Cancelled") {
    if (user.role !== "admin") return "Only an administrator can cancel a trip";
    if (trip.status === "In Transit") return "This bus is already on the road — it can't be cancelled now";
    return null;
  }
  if (user.role === "driver" && trip.driver_id !== user.id) return "This trip isn't assigned to you";
  if (DRIVER_NEXT[trip.status] !== next) return `A ${trip.status} trip can only move to ${DRIVER_NEXT[trip.status]}`;
  if (next === "Boarding") {
    const opensAt = new Date(new Date(trip.departure_time).getTime() - BOARDING_OPENS_HOURS_BEFORE * 3600 * 1000);
    if (new Date() < opensAt) return `Boarding opens ${BOARDING_OPENS_HOURS_BEFORE} hours before departure`;
  }
  if (next === "In Transit" && otherActiveTrip) return "You already have a trip in transit. Complete it first.";
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
  const authIfDriverQuery = (req, res, next) => (req.query.driverId ? authenticate(req, res, next) : next());
  tripsRouter.get("/", authIfDriverQuery, async (req, res) => {
    const { driverId, scope } = req.query;

    if (driverId) {
      if (!(req.user.role === "admin" || (req.user.role === "driver" && req.user.id === Number(driverId)))) {
        return res.status(403).json({ error: "You can only view your own trips" });
      }
      try {
        const [rows] = await pool.query(
          `SELECT tr.trip_id, tr.departure_time, tr.arrival_time, tr.status,
                  rt.origin, rt.destination, rt.base_fare,
                  b.bus_id, b.plate_num, b.capacity, b.type AS bus_type,
                  d.name AS driver_name,
                  (SELECT COUNT(*) FROM bookings bk WHERE bk.trip_id = tr.trip_id AND bk.status NOT IN ('Cancelled', 'No-Show')) AS booked_count
           FROM trips tr
           JOIN routes rt ON rt.route_id = tr.route_id
           JOIN buses b ON b.bus_id = tr.bus_id
           JOIN drivers d ON d.driver_id = tr.driver_id
           WHERE tr.driver_id = ? AND tr.status != 'Cancelled'
           ORDER BY tr.departure_time ASC`,
          [driverId]
        );
        return res.json(rows);
      } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to load trips" });
      }
    }

    try {
      let rows;
      const bookableOnly = scope === "bookable";
      const cacheKey = bookableOnly ? TRIPS_BOOKABLE_CACHE_KEY : TRIPS_CACHE_KEY;
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
          `SELECT tr.trip_id, tr.departure_time, tr.arrival_time, tr.status,
                  rt.origin, rt.destination, rt.distance, rt.base_fare,
                  b.bus_id, b.plate_num, b.bus_number, b.capacity, b.type AS bus_type,
                  tr.driver_id, tr.route_id, d.name AS driver_name
           FROM trips tr
           JOIN routes rt ON rt.route_id = tr.route_id
           JOIN buses b ON b.bus_id = tr.bus_id
           JOIN drivers d ON d.driver_id = tr.driver_id
           ${bookableOnly ? "WHERE tr.status = 'Boarding' OR (tr.status = 'Scheduled' AND tr.departure_time > NOW())" : ""}
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
          (t) => t.capacity != null && (t.status === "Boarding" || (t.status === "Scheduled" && new Date(t.departure_time).getTime() > now))
        );
      }

      res.json(await attachBookedCounts(rows));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load trips" });
    }
  });

  // POST /api/trips — powers admin/TripScheduling.jsx. Rejects with 409 if
  // the bus or driver is already assigned to another (non-cancelled) trip
  // whose time window overlaps this one — Table 4's Trip Scheduling
  // explicitly requires conflict prevention, not just a same-timestamp check.
  tripsRouter.post("/", requireRole("admin"), async (req, res) => {
    const { busId, driverId, routeId, departureTime, arrivalTime } = req.body;
    if (!busId || !driverId || !routeId || !departureTime || !arrivalTime) {
      return res.status(400).json({ error: "busId, driverId, routeId, departureTime and arrivalTime are required" });
    }
    if (new Date(arrivalTime) <= new Date(departureTime)) {
      return res.status(400).json({ error: "arrivalTime must be after departureTime" });
    }

    try {
      // Overlap: existing.departure < new.arrival AND existing.arrival > new.departure
      // (falls back to treating a NULL arrival_time as "unbounded" so an
      // open-ended trip still blocks the bus/driver).
      const [conflicts] = await pool.query(
        `SELECT trip_id, bus_id, driver_id FROM trips
         WHERE status != 'Cancelled'
           AND (bus_id = ? OR driver_id = ?)
           AND departure_time < ?
           AND COALESCE(arrival_time, DATE_ADD(departure_time, INTERVAL 12 HOUR)) > ?`,
        [busId, driverId, arrivalTime, departureTime]
      );
      if (conflicts.length > 0) {
        const busConflict = conflicts.find((c) => c.bus_id === Number(busId));
        const driverConflict = conflicts.find((c) => c.driver_id === Number(driverId));
        return res.status(409).json({
          error: busConflict && driverConflict
            ? "Both the bus and driver are already scheduled during this time window"
            : busConflict
              ? "This bus is already scheduled during this time window"
              : "This driver is already scheduled during this time window",
        });
      }

      const [result] = await pool.query(
        `INSERT INTO trips (bus_id, driver_id, route_id, departure_time, arrival_time, status)
         VALUES (?, ?, ?, ?, ?, 'Scheduled')`,
        [busId, driverId, routeId, departureTime, arrivalTime]
      );
      await clearTripsCache();
      await logAudit({ staffId: req.user.id, action: "create", entityType: "trip", entityId: result.insertId, details: req.body });
      res.status(201).json({ trip_id: result.insertId, busId, driverId, routeId, departureTime, arrivalTime, status: "Scheduled" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to schedule trip" });
    }
  });

  // GET /api/trips/:id — powers TripDetail.jsx
  tripsRouter.get("/:id", async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT tr.trip_id, tr.departure_time, tr.arrival_time, tr.status,
                rt.origin, rt.destination, rt.distance, rt.base_fare,
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
      res.json(withCount);
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
      const [[trip]] = await pool.query(
        `SELECT b.capacity FROM trips tr JOIN buses b ON b.bus_id = tr.bus_id WHERE tr.trip_id = ?`,
        [req.params.id]
      );
      if (!trip) return res.status(404).json({ error: "Trip not found" });

      const [booked] = await pool.query(
        `SELECT seat_number FROM bookings WHERE trip_id = ? AND status NOT IN ('Cancelled', 'No-Show')`,
        [req.params.id]
      );

      res.json({
        capacity: trip.capacity,
        bookedSeats: booked.map((r) => r.seat_number),
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
        const [[trip]] = await pool.query(`SELECT driver_id FROM trips WHERE trip_id = ?`, [req.params.id]);
        if (!trip) return res.status(404).json({ error: "Trip not found" });
        if (trip.driver_id !== req.user.id) return res.status(403).json({ error: "This trip isn't assigned to you" });
      }
      const [rows] = await pool.query(
        `SELECT booking_id, passenger_name, seat_number, status, channel, booked_at
         FROM bookings
         WHERE trip_id = ?
         ORDER BY CAST(seat_number AS UNSIGNED), seat_number`,
        [req.params.id]
      );
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
  tripsRouter.patch("/:id", requireRole("admin"), async (req, res) => {
    const { busId, driverId, routeId, departureTime, arrivalTime } = req.body;

    try {
      const [[existing]] = await pool.query(`SELECT * FROM trips WHERE trip_id = ?`, [req.params.id]);
      if (!existing) return res.status(404).json({ error: "Trip not found" });
      if (existing.status !== "Scheduled") {
        return res.status(409).json({ error: `Only a Scheduled trip can be edited (this one is ${existing.status})` });
      }
      if (busId !== undefined && Number(busId) !== existing.bus_id) {
        // Swapping to a smaller bus must not strand passengers whose seat
        // number doesn't exist on it.
        const [[bus]] = await pool.query(`SELECT capacity FROM buses WHERE bus_id = ?`, [busId]);
        if (!bus) return res.status(404).json({ error: "Bus not found" });
        const [[top]] = await pool.query(
          `SELECT MAX(CAST(seat_number AS UNSIGNED)) AS highest FROM bookings WHERE trip_id = ? AND status NOT IN ('Cancelled', 'No-Show')`,
          [req.params.id]
        );
        if (top.highest != null && (bus.capacity == null || top.highest > bus.capacity)) {
          return res.status(409).json({ error: `That bus has ${bus.capacity ?? "no recorded"} seats, but seat ${top.highest} is already booked on this trip` });
        }
      }

      const nextBusId = busId ?? existing.bus_id;
      const nextDriverId = driverId ?? existing.driver_id;
      const nextDeparture = departureTime ?? existing.departure_time;
      const nextArrival = arrivalTime ?? existing.arrival_time;

      const [conflicts] = await pool.query(
        `SELECT trip_id, bus_id, driver_id FROM trips
         WHERE status != 'Cancelled' AND trip_id != ?
           AND (bus_id = ? OR driver_id = ?)
           AND departure_time < ?
           AND COALESCE(arrival_time, DATE_ADD(departure_time, INTERVAL 12 HOUR)) > ?`,
        [req.params.id, nextBusId, nextDriverId, nextArrival, nextDeparture]
      );
      if (conflicts.length > 0) {
        return res.status(409).json({ error: "The updated schedule conflicts with another trip for this bus or driver" });
      }

      const fields = [];
      const params = [];
      if (busId !== undefined) { fields.push("bus_id = ?"); params.push(busId); }
      if (driverId !== undefined) { fields.push("driver_id = ?"); params.push(driverId); }
      if (routeId !== undefined) { fields.push("route_id = ?"); params.push(routeId); }
      if (departureTime !== undefined) { fields.push("departure_time = ?"); params.push(departureTime); }
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
  tripsRouter.patch("/:id/status", requireRole("driver", "admin"), async (req, res) => {
    const { status: next } = req.body;
    const allowed = ["Scheduled", "Boarding", "In Transit", "Completed", "Cancelled"];
    if (!allowed.includes(next)) {
      return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
    }

    try {
      const [[trip]] = await pool.query(`SELECT trip_id, status, driver_id, departure_time FROM trips WHERE trip_id = ?`, [req.params.id]);
      if (!trip) return res.status(404).json({ error: "Trip not found" });

      let otherActiveTrip = null;
      if (next === "In Transit") {
        [[otherActiveTrip]] = await pool.query(
          `SELECT trip_id FROM trips WHERE driver_id = ? AND status = 'In Transit' AND trip_id != ? LIMIT 1`,
          [trip.driver_id, trip.trip_id]
        );
      }
      const refusal = whyTripStatusChangeNotAllowed({ user: req.user, trip, next, otherActiveTrip });
      if (refusal) return res.status(409).json({ error: refusal });

      if (next === "Cancelled") {
        await notifyTripChange(io, trip.trip_id, "Your trip has been cancelled. Your booking has been cancelled too — please book another trip.", "trip_cancelled");
      }

      const [result] = await pool.query(
        `UPDATE trips SET status = ?, completed_at = IF(? = 'Completed', NOW(), completed_at) WHERE trip_id = ? AND status = ?`,
        [next, next, trip.trip_id, trip.status]
      );
      if (result.affectedRows === 0) return res.status(409).json({ error: "This trip was just updated by someone else — refresh and try again" });

      if (next === "Cancelled") {
        await pool.query(`UPDATE bookings SET status = 'Cancelled' WHERE trip_id = ? AND status IN ('Reserved', 'Confirmed')`, [trip.trip_id]);
      } else if (next === "Completed") {
        await pool.query(`UPDATE bookings SET status = 'No-Show' WHERE trip_id = ? AND status IN ('Reserved', 'Confirmed')`, [trip.trip_id]);
      }
      await clearTripsCache();
      if (req.user.role === "admin") {
        await logAudit({ staffId: req.user.id, action: "update", entityType: "trip", entityId: trip.trip_id, details: { status: next } });
      }

      res.json({ trip_id: trip.trip_id, status: next });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update trip status" });
    }
  });

  return tripsRouter;
}
