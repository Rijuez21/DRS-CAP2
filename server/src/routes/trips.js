import { Router } from "express";
import { pool } from "../db/pool.js";
import { redis, CACHE_TTL_SECONDS } from "../cache/redis.js";
import { requireRole } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";
import { notifyTripChange } from "../services/notify.js";

const TRIPS_CACHE_KEY = "cache:trips:active";

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
  tripsRouter.get("/", async (req, res) => {
    const { driverId } = req.query;

    if (driverId) {
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
      const cached = await redis.get(TRIPS_CACHE_KEY).catch(() => null);
      if (cached) {
        return res.json(JSON.parse(cached));
      }

      const [rows] = await pool.query(
        `SELECT tr.trip_id, tr.departure_time, tr.arrival_time, tr.status,
                rt.origin, rt.destination, rt.base_fare,
                b.plate_num, b.capacity, b.type AS bus_type,
                d.name AS driver_name
         FROM trips tr
         JOIN routes rt ON rt.route_id = tr.route_id
         JOIN buses b ON b.bus_id = tr.bus_id
         JOIN drivers d ON d.driver_id = tr.driver_id
         ORDER BY tr.departure_time ASC`
      );

      redis.set(TRIPS_CACHE_KEY, JSON.stringify(rows), "EX", CACHE_TTL_SECONDS.activeTrips).catch((err) =>
        console.error("Redis set failed (non-fatal):", err.message)
      );

      res.json(rows);
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
      await redis.del(TRIPS_CACHE_KEY).catch(() => {});
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
                b.bus_id, b.plate_num, b.capacity, b.type AS bus_type,
                d.name AS driver_name
         FROM trips tr
         JOIN routes rt ON rt.route_id = tr.route_id
         JOIN buses b ON b.bus_id = tr.bus_id
         JOIN drivers d ON d.driver_id = tr.driver_id
         WHERE tr.trip_id = ?`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Trip not found" });
      res.json(rows[0]);
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
  tripsRouter.get("/:id/manifest", async (req, res) => {
    try {
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
      await redis.del(TRIPS_CACHE_KEY).catch(() => {});
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
  tripsRouter.patch("/:id/status", async (req, res) => {
    const { status } = req.body;
    const allowed = ["Scheduled", "Boarding", "In Transit", "Completed", "Cancelled"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
    }

    try {
      const [result] = await pool.query(
        `UPDATE trips SET status = ?, completed_at = IF(? = 'Completed', NOW(), completed_at) WHERE trip_id = ?`,
        [status, status, req.params.id]
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: "Trip not found" });
      await redis.del(TRIPS_CACHE_KEY).catch(() => {});

      if (status === "Cancelled") {
        await notifyTripChange(io, req.params.id, "Your trip has been cancelled. Please check your bookings for details.", "trip_cancelled");
      }

      res.json({ trip_id: Number(req.params.id), status });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update trip status" });
    }
  });

  return tripsRouter;
}
