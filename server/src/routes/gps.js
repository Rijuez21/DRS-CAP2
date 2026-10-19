import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";
import { getListener, getDevice, listDevices, GPS_ONLINE_MS } from "../services/gpsGateway.js";

// Admin "GPS Tracker" page (admin/GpsTracker.jsx) — the SinoTrack-style
// device view: is the tracker connected, what did it last send, where has
// the bus been. Live changes arrive over the "gps:admin" Socket.io room.
export const gpsRouter = Router();
gpsRouter.use(requireRole("admin"));

const DEVICE_ID = /^[0-9A-Za-z]{1,32}$/;
const MAX_HISTORY_POINTS = 20000;

// Where the tracker must be pointed (SMS "8040000 <host> <port>"). Only the
// deployment knows its public address, so it comes from env.
function publicAddress() {
  const host = process.env.GPS_PUBLIC_HOST?.trim() || null;
  const port = Number(process.env.GPS_PUBLIC_PORT) || getListener().port;
  return { host, port };
}

async function busesWithTrackers() {
  const [rows] = await pool.query(
    `SELECT bus_id AS busId, bus_number AS busNumber, plate_num AS plateNum, gps_device_id AS deviceId
     FROM buses WHERE gps_device_id IS NOT NULL`
  );
  return rows;
}

function emptyDevice(deviceId) {
  return { deviceId, connected: false, online: false, messageCount: 0, fix: null, lastValidFix: null, link: null, lastIngest: null };
}

// GET /api/gps/status — listener + every tracker that has connected since
// the server started, plus any assigned in Fleet Management that hasn't.
gpsRouter.get("/status", async (req, res) => {
  try {
    const assigned = await busesWithTrackers();
    const byId = new Map(listDevices().map((d) => [d.deviceId, d]));
    for (const b of assigned) if (!byId.has(b.deviceId)) byId.set(b.deviceId, emptyDevice(b.deviceId));
    const devices = [...byId.values()].map((d) => {
      const bus = assigned.find((b) => b.deviceId === d.deviceId);
      return { ...d, bus: bus ? { busId: bus.busId, busNumber: bus.busNumber, plateNum: bus.plateNum } : null };
    });
    res.json({ listener: getListener(), publicAddress: publicAddress(), devices });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load GPS tracker status" });
  }
});

// GET /api/gps/devices/:deviceId — one tracker, with its recent trail and
// raw message log.
gpsRouter.get("/devices/:deviceId", async (req, res) => {
  const { deviceId } = req.params;
  if (!DEVICE_ID.test(deviceId)) return res.status(400).json({ error: "Invalid device ID" });
  try {
    const [[bus]] = await pool.query(
      `SELECT bus_id AS busId, bus_number AS busNumber, plate_num AS plateNum FROM buses WHERE gps_device_id = ?`,
      [deviceId]
    );
    const d = getDevice(deviceId);
    if (!d && !bus) return res.status(404).json({ error: "This tracker hasn't connected and isn't assigned to a bus" });
    res.json({ ...(d ?? { ...emptyDevice(deviceId), trail: [], log: [] }), bus: bus ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load tracker" });
  }
});

// GET /api/gps/devices/:deviceId/verify — step-by-step connection check,
// each step pass / warn / fail with what to do about it.
gpsRouter.get("/devices/:deviceId/verify", async (req, res) => {
  const { deviceId } = req.params;
  if (!DEVICE_ID.test(deviceId)) return res.status(400).json({ error: "Invalid device ID" });
  try {
    const listener = getListener();
    const d = getDevice(deviceId);
    const [[bus]] = await pool.query(`SELECT bus_id AS busId, plate_num AS plateNum FROM buses WHERE gps_device_id = ?`, [deviceId]);
    const now = Date.now();
    const ago = (iso) => {
      const s = Math.round((now - new Date(iso).getTime()) / 1000);
      return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
    };
    const checks = [];

    checks.push(
      listener.running
        ? { key: "listener", status: "pass", label: "Server is listening for trackers", detail: `TCP port ${listener.port}` }
        : { key: "listener", status: "fail", label: "Server is listening for trackers", detail: listener.error ?? "The tracker listener is turned off (GPS_TCP_PORT)." }
    );

    if (!d) {
      checks.push({
        key: "connected",
        status: "fail",
        label: "Tracker has connected",
        detail: `No connection from tracker ${deviceId} yet. Check that it has power, its SIM has load or a data plan, and the bus has mobile signal.`,
      });
    } else if (d.connected) {
      checks.push({ key: "connected", status: "pass", label: "Tracker has connected", detail: `Connected from ${d.remoteAddress ?? "unknown address"} since ${ago(d.connectedAt)}` });
    } else {
      checks.push({ key: "connected", status: "fail", label: "Tracker has connected", detail: `Disconnected ${ago(d.disconnectedAt)}. Check the tracker has power and mobile signal.` });
    }

    if (d?.lastMessageAt) {
      checks.push(
        d.online
          ? { key: "data", status: "pass", label: "Tracker is sending data", detail: `${d.messageCount} messages, last ${ago(d.lastMessageAt)}` }
          : { key: "data", status: "fail", label: "Tracker is sending data", detail: `Silent since ${ago(d.lastMessageAt)}. It may be asleep (engine off) or out of signal.` }
      );
    } else {
      checks.push({ key: "data", status: "fail", label: "Tracker is sending data", detail: "Nothing received yet." });
    }

    const fixAge = d?.lastValidFix ? now - new Date(d.lastValidFix.time).getTime() : Infinity;
    if (d?.lastValidFix && fixAge < GPS_ONLINE_MS) {
      checks.push({ key: "fix", status: "pass", label: "GPS has a satellite fix", detail: `${d.lastValidFix.latitude.toFixed(5)}, ${d.lastValidFix.longitude.toFixed(5)} — ${ago(d.lastValidFix.time)}` });
    } else if (d?.fix && !d.fix.valid) {
      checks.push({ key: "fix", status: "warn", label: "GPS has a satellite fix", detail: "Connected, but no satellite fix yet. Move the bus outdoors with a clear view of the sky; the first fix can take a few minutes." });
    } else if (d?.lastValidFix) {
      checks.push({ key: "fix", status: "warn", label: "GPS has a satellite fix", detail: `Last fix was ${ago(d.lastValidFix.time)}.` });
    } else {
      checks.push({ key: "fix", status: "fail", label: "GPS has a satellite fix", detail: "No position received yet." });
    }

    checks.push(
      bus
        ? { key: "assigned", status: "pass", label: "Tracker is assigned to a bus", detail: `Bus ${bus.plateNum}` }
        : { key: "assigned", status: "fail", label: "Tracker is assigned to a bus", detail: "Assign it to a bus below so its positions reach the maps." }
    );

    if (bus) {
      const [[latest]] = await pool.query(
        `SELECT timestamp FROM location_tracking WHERE bus_id = ? AND source = 'device' ORDER BY timestamp DESC LIMIT 1`,
        [bus.busId]
      );
      const age = latest ? now - new Date(latest.timestamp).getTime() : Infinity;
      checks.push(
        age < GPS_ONLINE_MS
          ? { key: "maps", status: "pass", label: "Positions reach the live maps", detail: `Saved and broadcast ${ago(latest.timestamp)} — passengers, drivers, staff and admin see it.` }
          : {
              key: "maps",
              status: "fail",
              label: "Positions reach the live maps",
              detail: latest ? `Last saved tracker position was ${ago(latest.timestamp)}.` : d?.lastIngest?.error ?? "No tracker position saved for this bus yet.",
            }
      );
    }

    const overall = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "pass";
    res.json({ deviceId, checkedAt: new Date().toISOString(), overall, checks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to verify the tracker" });
  }
});

// POST /api/gps/devices/:deviceId/assign — body { busId } (null = unassign).
// A tracker belongs to at most one bus, so it's taken off any other first.
gpsRouter.post("/devices/:deviceId/assign", async (req, res) => {
  const { deviceId } = req.params;
  if (!DEVICE_ID.test(deviceId)) return res.status(400).json({ error: "Invalid device ID" });
  const busId = req.body?.busId == null || req.body.busId === "" ? null : Number(req.body.busId);
  if (busId !== null && (!Number.isInteger(busId) || busId <= 0)) return res.status(400).json({ error: "busId must be a bus id or null" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`UPDATE buses SET gps_device_id = NULL WHERE gps_device_id = ?`, [deviceId]);
    if (busId !== null) {
      const [result] = await conn.query(`UPDATE buses SET gps_device_id = ? WHERE bus_id = ?`, [deviceId, busId]);
      if (result.affectedRows === 0) {
        await conn.rollback();
        return res.status(404).json({ error: "Bus not found" });
      }
    }
    await conn.commit();
    await logAudit({ staffId: req.user.id, action: busId ? "assign_gps" : "unassign_gps", entityType: "bus", entityId: busId, details: { deviceId } });
    res.json({ deviceId, busId });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error(err);
    res.status(500).json({ error: "Failed to assign tracker" });
  } finally {
    conn.release();
  }
});

// GET /api/gps/history?busId=&from=&to= — the path a bus took (playback).
// Tracker points only, unless the bus had none, then the phone's.
gpsRouter.get("/history", async (req, res) => {
  const busId = Number(req.query.busId);
  const from = new Date(req.query.from);
  const to = new Date(req.query.to);
  if (!Number.isInteger(busId) || busId <= 0) return res.status(400).json({ error: "busId is required" });
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) return res.status(400).json({ error: "from and to must be valid dates, from before to" });
  if (to - from > 7 * 24 * 3600 * 1000) return res.status(400).json({ error: "Pick a range of 7 days or less" });
  try {
    const [rows] = await pool.query(
      `SELECT latitude, longitude, timestamp, source, sync_status AS syncStatus
       FROM location_tracking
       WHERE bus_id = ? AND timestamp BETWEEN ? AND ?
       ORDER BY timestamp ASC LIMIT ?`,
      [busId, from, to, MAX_HISTORY_POINTS + 1]
    );
    const hasDevice = rows.some((r) => r.source === "device");
    const points = (hasDevice ? rows.filter((r) => r.source === "device") : rows)
      .slice(0, MAX_HISTORY_POINTS)
      .map((r) => ({ latitude: Number(r.latitude), longitude: Number(r.longitude), timestamp: r.timestamp, source: r.source, syncStatus: r.syncStatus }));
    res.json({ busId, points, truncated: rows.length > MAX_HISTORY_POINTS });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load the route history" });
  }
});
