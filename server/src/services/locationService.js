import { pool } from "../db/pool.js";
import { redis, CACHE_TTL_SECONDS } from "../cache/redis.js";

/**
 * Single entry point for "a bus reported a GPS point", regardless of
 * whether it arrived via the REST endpoint (driver's phone, online) or the
 * MQTT listener (Table 11's IoT/telemetry path). Both write paths should
 * behave identically, so this is the one place that:
 *   1. persists to MySQL (location_tracking) — the durable record
 *   2. caches the latest point in Redis — what LiveTracking.jsx's initial
 *      page load reads, per the paper's "Redis caches... bus locations"
 *   3. emits over Socket.io — what keeps an already-open map updating live,
 *      per the paper's "Socket.io... transmitting live GPS updates from
 *      buses to connected clients"
 *
 * @param {import('socket.io').Server} io
 */
export async function ingestLocation(io, { busId, latitude, longitude, timestamp, syncStatus = "synced" }) {
  const [result] = await pool.query(
    `INSERT INTO location_tracking (bus_id, latitude, longitude, timestamp, sync_status)
     VALUES (?, ?, ?, ?, ?)`,
    // Pass a Date, not the raw string: useDriverLocation sends ISO-8601
    // with a trailing "Z" (new Date().toISOString()), which MySQL/MariaDB
    // DATETIME can reject in strict mode ("Incorrect datetime value") —
    // that 500s every GPS point and leaves the Flag a Bus map empty.
    // mysql2 serializes a Date into a proper DATETIME literal.
    [busId, latitude, longitude, new Date(timestamp), syncStatus]
  );

  const point = { tracking_id: result.insertId, busId, latitude, longitude, timestamp, syncStatus };

  redis
    .set(`cache:bus:${busId}:location`, JSON.stringify(point), "EX", CACHE_TTL_SECONDS.busLocation)
    .catch((err) => console.error("Redis set failed (non-fatal):", err.message));

  // Room-per-bus so a passenger tracking bus #7 doesn't receive every other
  // bus's updates too. Frontend: socket.emit('subscribe:bus', busId).
  io?.to(`bus:${busId}`).emit("location:update", point);

  // Same payload, also broadcast to the single "fleet" room the admin
  // FleetTracking.jsx panel subscribes to — lets a dispatcher watch every
  // bus move without joining N individual per-bus rooms. Keyed off
  // point.busId client-side to know which marker to move.
  io?.to("fleet").emit("location:update", point);

  return point;
}
