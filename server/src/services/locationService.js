import { pool } from "../db/pool.js";
import { redis, CACHE_TTL_SECONDS } from "../cache/redis.js";

// A bus with a fitted GPS tracker (SinoTrack ST-906L via Traccar, see
// POST /api/tracking/device) reports on its own. While it does, the
// driver's phone is only a backup: its points are ignored so the map
// doesn't jump between two slightly different positions. The tracker counts
// as "reporting" for this long after its last point.
//
// It must outlast the tracker's slowest reporting interval: 10 s while
// moving but 300 s when parked (RCONF "GPRS UPLOAD TIME:10,300"). This used
// to be 90 s, so a parked or boarding bus's tracker "went quiet" between
// reports and the driver's phone took over the map for ~3½ of every 5 minutes.
// 6 minutes = one parked interval plus a margin. Keep useBusTracker.js in step.
export const DEVICE_ACTIVE_SECONDS = 360;
const deviceActiveKey = (busId) => `gps:device-active:${busId}`;

export async function deviceIsReporting(busId) {
  // If Redis is down, accept the phone's points rather than risk a blank map.
  return Boolean(await redis.exists(deviceActiveKey(busId)).catch(() => 0));
}

// A tracker was taken off this bus (moved to another bus, or unassigned):
// its driver's phone is the bus's position again, straight away.
export async function clearDeviceActive(busId) {
  await redis.del(deviceActiveKey(busId)).catch((err) => console.error("Redis del failed (non-fatal):", err.message));
}

/**
 * Single entry point for "a bus reported a GPS point", whether it came in
 * from the bus's GPS tracker (POST /api/tracking/device), live from the
 * driver's phone (POST /api/tracking) or as a buffered batch
 * flushed after the phone was offline (POST /api/tracking/batch). All
 * paths should behave identically, so this is the one place that:
 *   1. persists to MySQL (location_tracking) — the durable record
 *   2. caches the latest point in Redis — what LiveTracking.jsx's initial
 *      page load reads, per the paper's "Redis caches... bus locations"
 *   3. emits over Socket.io — what keeps an already-open map updating live,
 *      per the paper's "Socket.io... transmitting live GPS updates from
 *      buses to connected clients"
 *
 * @param {import('socket.io').Server} io
 */
// live = false: an older point (a tracker catching up on positions it
// stored without signal) — saved for route history only, so the "current
// position" cache and the live maps don't jump back to where the bus was.
export async function ingestLocation(io, { busId, latitude, longitude, timestamp, syncStatus = "synced", source = "phone", live = true }) {
  const [result] = await pool.query(
    `INSERT INTO location_tracking (bus_id, latitude, longitude, timestamp, sync_status, source)
     VALUES (?, ?, ?, ?, ?, ?)`,
    // Pass a Date, not the raw string: useDriverLocation sends ISO-8601
    // with a trailing "Z" (new Date().toISOString()), which MySQL/MariaDB
    // DATETIME can reject in strict mode ("Incorrect datetime value") —
    // that 500s every GPS point and leaves the Flag a Bus map empty.
    // mysql2 serializes a Date into a proper DATETIME literal.
    [busId, latitude, longitude, new Date(timestamp), syncStatus, source]
  );

  const point = { tracking_id: result.insertId, busId, latitude, longitude, timestamp, syncStatus, source };
  if (!live) return point;

  if (source === "device") {
    redis
      .set(deviceActiveKey(busId), "1", "EX", DEVICE_ACTIVE_SECONDS)
      .catch((err) => console.error("Redis set failed (non-fatal):", err.message));
  }

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

const MAX_HISTORY_POINTS = 20000;
const MAX_HISTORY_RANGE_MS = 7 * 24 * 3600 * 1000;

// Validates ?from=&to= for a playback request.
// Returns { from, to } or { error }.
export function parseHistoryRange(query) {
  const from = new Date(query.from);
  const to = new Date(query.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) return { error: "from and to must be valid dates, from before to" };
  if (to - from > MAX_HISTORY_RANGE_MS) return { error: "Pick a range of 7 days or less" };
  return { from, to };
}

// Validates ?busId=&from=&to= for a one-bus playback request.
// Returns { busId, from, to } or { error }.
export function parseHistoryQuery(query) {
  const busId = Number(query.busId);
  if (!Number.isInteger(busId) || busId <= 0) return { error: "busId is required" };
  const range = parseHistoryRange(query);
  return range.error ? range : { busId, ...range };
}

// The path a bus took between from and to, oldest first (route playback:
// admin GpsTracker.jsx and owner/OwnerPlayback.jsx). Tracker points only,
// unless the bus had none, then the phone's. maxPoints: lower it when
// loading several buses at once so the total stays near one bus's worth.
export async function getRouteHistory({ busId, from, to, maxPoints = MAX_HISTORY_POINTS }) {
  const [rows] = await pool.query(
    `SELECT latitude, longitude, timestamp, source, sync_status AS syncStatus
     FROM location_tracking
     WHERE bus_id = ? AND timestamp BETWEEN ? AND ?
     ORDER BY timestamp ASC LIMIT ?`,
    [busId, from, to, maxPoints + 1]
  );
  const hasDevice = rows.some((r) => r.source === "device");
  const points = (hasDevice ? rows.filter((r) => r.source === "device") : rows)
    .slice(0, maxPoints)
    .map((r) => ({ latitude: Number(r.latitude), longitude: Number(r.longitude), timestamp: r.timestamp, source: r.source, syncStatus: r.syncStatus }));
  return { busId, points, truncated: rows.length > maxPoints };
}

// Every bus in the list over the same range, for playing them back
// together. Shares one bus's point budget, but never less than 2,000 each.
export async function getFleetRouteHistory(buses, { from, to }) {
  const maxPoints = Math.max(2000, Math.floor(MAX_HISTORY_POINTS / Math.max(1, buses.length)));
  const histories = await Promise.all(buses.map((b) => getRouteHistory({ busId: b.busId, from, to, maxPoints })));
  return buses.map((b, i) => ({ ...b, points: histories[i].points, truncated: histories[i].truncated }));
}
