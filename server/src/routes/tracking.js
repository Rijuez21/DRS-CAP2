import { Router } from "express";
import { pool } from "../db/pool.js";
import { redis, CACHE_TTL_SECONDS } from "../cache/redis.js";
import { ingestLocation } from "../services/locationService.js";
import { requireRole } from "../middleware/auth.js";

const FLEET_CACHE_KEY = "cache:fleet:latest";

export function buildTrackingRouter(io) {
  const trackingRouter = Router();

  // POST /api/tracking — a driver device posts a GPS point. Accepts a
  // syncStatus of 'buffered' when the point was recorded during a Cordillera
  // dead-zone and is being flushed after reconnecting (the offline-first
  // behavior described in 1.2.4 and 3.2.3.3), defaulting to 'synced' for a
  // point sent live.
  trackingRouter.post("/", async (req, res) => {
    const { busId, latitude, longitude, timestamp, syncStatus } = req.body;
    if (!busId || latitude == null || longitude == null || !timestamp) {
      return res.status(400).json({ error: "busId, latitude, longitude and timestamp are required" });
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
  trackingRouter.post("/batch", async (req, res) => {
    const { points } = req.body;
    if (!Array.isArray(points) || points.length === 0) {
      return res.status(400).json({ error: "points must be a non-empty array" });
    }

    try {
      const inserted = [];
      for (const p of points) {
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
      res.status(201).json({ inserted: inserted.length });
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
