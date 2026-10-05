import { Router } from "express";
import { pool } from "../db/pool.js";
import { redis, CACHE_TTL_SECONDS } from "../cache/redis.js";
import { ingestLocation } from "../services/locationService.js";
import { requireRole, authenticate } from "../middleware/auth.js";

const FLEET_CACHE_KEY = "cache:fleet:latest";

export function buildTrackingRouter(io) {
  const trackingRouter = Router();

  // POST /api/tracking — a driver device posts a GPS point. Accepts a
  // syncStatus of 'buffered' when the point was recorded during a Cordillera
  // dead-zone and is being flushed after reconnecting (the offline-first
  // behavior described in 1.2.4 and 3.2.3.3), defaulting to 'synced' for a
  // point sent live.
  // Only the driver actually driving that bus may report its position.
  // Before, anyone could POST any coordinates for any bus — passengers
  // hailing a bus would have been sent to a fake location. Buffered points
  // uploaded after reconnecting may arrive shortly after the trip ends, so a
  // trip completed in the last 12 hours still counts.
  async function driverMayReportBus(driverId, busId) {
    const [[row]] = await pool.query(
      `SELECT trip_id FROM trips
       WHERE driver_id = ? AND bus_id = ?
         AND (status IN ('Boarding', 'In Transit') OR (status = 'Completed' AND completed_at > NOW() - INTERVAL 12 HOUR))
       LIMIT 1`,
      [driverId, busId]
    );
    return Boolean(row);
  }

  trackingRouter.post("/", requireRole("driver"), async (req, res) => {
    const { busId, latitude, longitude, timestamp, syncStatus } = req.body;
    if (!busId || latitude == null || longitude == null || !timestamp) {
      return res.status(400).json({ error: "busId, latitude, longitude and timestamp are required" });
    }
    if (!(await driverMayReportBus(req.user.id, busId))) {
      return res.status(403).json({ error: "You can only share location for the bus on your current trip" });
    }

    try {
      const point = await ingestLocation(io, { busId, latitude, longitude, timestamp, syncStatus });
      res.status(201).json(point);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to record location" });
    }
  });

  // POST /api/tracking/batch — flush a batch of buffered points at once,
  // which is the actual shape offline sync takes (many points arrive
  // together once signal returns) rather than one at a time.
  trackingRouter.post("/batch", requireRole("driver"), async (req, res) => {
    const { points } = req.body;
    if (!Array.isArray(points) || points.length === 0) {
      return res.status(400).json({ error: "points must be a non-empty array" });
    }

    try {
      // Points for a bus this driver isn't (or no longer) on are dropped,
      // not rejected: rejecting would make the phone's offline queue retry
      // the same stale batch forever.
      const allowedBuses = new Map();
      for (const busId of new Set(points.map((p) => String(p.busId)))) {
        allowedBuses.set(busId, await driverMayReportBus(req.user.id, busId));
      }
      const inserted = [];
      let skipped = 0;
      for (const p of points) {
        if (!allowedBuses.get(String(p.busId))) { skipped += 1; continue; }
        inserted.push(
          await ingestLocation(io, {
            busId: p.busId,
            latitude: p.latitude,
            longitude: p.longitude,
            timestamp: p.timestamp,
            syncStatus: p.syncStatus ?? "buffered",
          })
        );
      }
      res.status(201).json({ inserted: inserted.length, skipped });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to sync buffered locations" });
    }
  });

  // GET /api/tracking/fleet/latest — powers admin/FleetTracking.jsx (the
  // whole-fleet map), as opposed to /:busId/latest which powers the
  // single-bus passenger view. Registered ahead of /:busId/latest so
  // "fleet" doesn't get swallowed as a :busId param. Admin/staff only —
  // this is dispatcher tooling, not something a passenger or driver hits.
  // Same Redis-first / MySQL-fallback shape as the single-bus cache above.
  trackingRouter.get("/fleet/latest", requireRole("admin", "staff"), async (req, res) => {
    try {
      const cached = await redis.get(FLEET_CACHE_KEY).catch(() => null);
      if (cached) return res.json(JSON.parse(cached));

      const [rows] = await pool.query(
        `SELECT b.bus_id AS busId, b.plate_num AS plateNum, b.status,
                lt.latitude, lt.longitude, lt.timestamp, lt.sync_status AS syncStatus,
                rt.origin, rt.destination, d.name AS driverName
         FROM buses b
         JOIN location_tracking lt ON lt.tracking_id = (
           SELECT lt2.tracking_id FROM location_tracking lt2
           WHERE lt2.bus_id = b.bus_id
           ORDER BY lt2.timestamp DESC LIMIT 1
         )
         LEFT JOIN trips tr ON tr.trip_id = (
           SELECT tr2.trip_id FROM trips tr2
           WHERE tr2.bus_id = b.bus_id AND DATE(tr2.departure_time) = CURDATE()
           ORDER BY tr2.departure_time ASC LIMIT 1
         )
         LEFT JOIN routes rt ON rt.route_id = tr.route_id
         LEFT JOIN drivers d ON d.driver_id = tr.driver_id
         WHERE b.status = 'Active'
         ORDER BY b.plate_num`
      );

      redis.set(FLEET_CACHE_KEY, JSON.stringify(rows), "EX", CACHE_TTL_SECONDS.fleetLocations).catch((err) =>
        console.error("Redis set failed (non-fatal):", err.message)
      );

      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load fleet locations" });
    }
  });

  // GET /api/tracking/in-transit?origin=&minDistance= — powers the
  // passenger FlagBus.jsx map (Flag a Bus mode). Only trips whose status
  // is 'In Transit' — a Scheduled/Boarding bus is still at the terminal,
  // which is the Book Ahead flow's job, not this one. Each row carries the
  // bus's last known point (NULL if it hasn't reported yet) and a live
  // booked_count so the page can show seats left without a second request;
  // live movement after first paint comes over the existing per-bus
  // "location:update" Socket.io rooms, same as LiveTracking.jsx.
  //
  // "On my route/direction": routes holds one row per km post (see
  // seed-baguio-bontoc.js), so a trip's route.distance is how far that bus
  // is going. origin filters direction (e.g. only buses leaving Baguio);
  // minDistance keeps only buses that travel at least as far as the
  // passenger's own stop — a bus terminating at KM 30 is no use to someone
  // going to KM 90. Registered ahead of /:busId/latest for the same reason
  // /fleet/latest is. Any logged-in role (not admin-only like
  // /fleet/latest) and deliberately without driver names — it's the
  // passenger-safe subset of the fleet view.
  trackingRouter.get("/in-transit", authenticate, async (req, res) => {
    const { origin, minDistance } = req.query;
    const conditions = ["tr.status = 'In Transit'"];
    const params = [];
    if (origin) { conditions.push("rt.origin = ?"); params.push(origin); }
    if (minDistance !== undefined && minDistance !== "") {
      const km = Number(minDistance);
      if (!Number.isFinite(km) || km < 0) return res.status(400).json({ error: "minDistance must be a non-negative number" });
      conditions.push("rt.distance >= ?");
      params.push(km);
    }

    try {
      const [rows] = await pool.query(
        `SELECT tr.trip_id, tr.departure_time, tr.arrival_time,
                rt.origin, rt.destination, rt.distance, rt.base_fare,
                b.bus_id, b.bus_number, b.plate_num, b.capacity, b.type AS bus_type,
                (SELECT COUNT(*) FROM bookings bk WHERE bk.trip_id = tr.trip_id AND bk.status NOT IN ('Cancelled', 'No-Show')) AS booked_count,
                lt.latitude, lt.longitude, lt.timestamp, lt.sync_status
         FROM trips tr
         JOIN routes rt ON rt.route_id = tr.route_id
         JOIN buses b ON b.bus_id = tr.bus_id
         LEFT JOIN location_tracking lt ON lt.tracking_id = (
           SELECT lt2.tracking_id FROM location_tracking lt2
           WHERE lt2.bus_id = b.bus_id
           ORDER BY lt2.timestamp DESC LIMIT 1
         )
         WHERE ${conditions.join(" AND ")}
         ORDER BY tr.departure_time ASC`,
        params
      );
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load in-transit buses" });
    }
  });

  // GET /api/tracking/:busId/latest — powers LiveTracking.jsx's initial
  // render (Socket.io then takes over for live updates on an open page).
  // Redis-first since this is the exact "bus locations" cache case in the
  // paper's Table 10; falls back to MySQL on a cache miss.
  trackingRouter.get("/:busId/latest", async (req, res) => {
    try {
      const cached = await redis.get(`cache:bus:${req.params.busId}:location`).catch(() => null);
      if (cached) return res.json(JSON.parse(cached));

      const [rows] = await pool.query(
        `SELECT tracking_id, latitude, longitude, timestamp, sync_status
         FROM location_tracking WHERE bus_id = ? ORDER BY timestamp DESC LIMIT 1`,
        [req.params.busId]
      );
      if (rows.length === 0) return res.status(404).json({ error: "No location data for this bus yet" });
      res.json(rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load location" });
    }
  });

  return trackingRouter;
}
