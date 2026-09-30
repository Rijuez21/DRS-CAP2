import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";

export const busRoutesRouter = Router();

// Rough box around the Baguio–Bontoc corridor (Halsema Highway, Benguet to
// Mountain Province) with a generous margin. A pin outside it is almost
// certainly a typo — swapped lat/lng, a dropped digit, or a click after
// zooming out — so it's refused with a clear message rather than saved and
// shown to passengers in the wrong province. Widen this if service expands.
// Mirrors STOP_CORRIDOR_BOUNDS in drs-bus-main/src/lib/stopMarkers.js.
const CORRIDOR_BOUNDS = { minLat: 16.2, maxLat: 17.3, minLng: 120.4, maxLng: 121.15 };

// mysql2 returns DECIMAL columns as strings; pins go out as numbers (or
// null) so every map can use them directly.
function withPin(row) {
  return {
    ...row,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
  };
}

// GET /api/routes — powers TripSearchPanel.jsx and admin/RouteManagement.jsx.
// Admin's table needs to see deactivated routes too (to reactivate them),
// so ?includeInactive=1 skips the is_active filter; the passenger-facing
// search never passes that flag.
busRoutesRouter.get("/", async (req, res) => {
  const { includeInactive } = req.query;
  try {
    const [rows] = await pool.query(
      `SELECT route_id, origin, destination, distance, base_fare, special_fare, is_active,
              latitude, longitude, pinned_at
       FROM routes
       ${includeInactive ? "" : "WHERE is_active = TRUE"}
       ORDER BY origin`
    );
    res.json(rows.map(withPin));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load routes" });
  }
});

// Note: this used to also expose GET /:id/fare-matrix, backed by a
// separate fare_matrix table. That's gone — routes now holds one row per
// km post directly (base_fare/special_fare ARE the per-stop fare), so
// there's nothing left to look up separately.

// POST /api/routes — admin creates a new route
busRoutesRouter.post("/", requireRole("admin"), async (req, res) => {
  const { origin, destination, distance, baseFare, specialFare } = req.body;
  if (!origin || !destination || baseFare == null) {
    return res.status(400).json({ error: "origin, destination and baseFare are required" });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO routes (origin, destination, distance, base_fare, special_fare) VALUES (?, ?, ?, ?, ?)`,
      [origin, destination, distance ?? null, baseFare, specialFare ?? null]
    );
    await logAudit({ staffId: req.user.id, action: "create", entityType: "route", entityId: result.insertId, details: req.body });
    res.status(201).json({ route_id: result.insertId, origin, destination, distance, baseFare, specialFare, is_active: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create route" });
  }
});

// PATCH /api/routes/:id — admin edits fare/distance/origin/destination
busRoutesRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const { origin, destination, distance, baseFare, specialFare } = req.body;
  const fields = [];
  const params = [];
  if (origin !== undefined) { fields.push("origin = ?"); params.push(origin); }
  if (destination !== undefined) { fields.push("destination = ?"); params.push(destination); }
  if (distance !== undefined) { fields.push("distance = ?"); params.push(distance); }
  if (baseFare !== undefined) { fields.push("base_fare = ?"); params.push(baseFare); }
  if (specialFare !== undefined) { fields.push("special_fare = ?"); params.push(specialFare); }

  if (fields.length === 0) return res.status(400).json({ error: "No editable fields provided" });

  try {
    params.push(req.params.id);
    const [result] = await pool.query(`UPDATE routes SET ${fields.join(", ")} WHERE route_id = ?`, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Route not found" });
    await logAudit({ staffId: req.user.id, action: "update", entityType: "route", entityId: req.params.id, details: req.body });
    res.json({ route_id: Number(req.params.id), ...req.body });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update route" });
  }
});

// PATCH /api/routes/:id/deactivate — soft-delete (Table 4 says "deactivate",
// not delete, since past trips still FK to the route). Reversible: pass
// { isActive: true } to reinstate.
busRoutesRouter.patch("/:id/deactivate", requireRole("admin"), async (req, res) => {
  const isActive = req.body?.isActive === true;
  try {
    const [result] = await pool.query(`UPDATE routes SET is_active = ? WHERE route_id = ?`, [isActive, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Route not found" });
    await logAudit({
      staffId: req.user.id,
      action: "status_change",
      entityType: "route",
      entityId: req.params.id,
      details: { isActive },
    });
    res.json({ route_id: Number(req.params.id), is_active: isActive });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update route status" });
  }
});

// PATCH /api/routes/:id/pin — admin sets (or clears) where this stop is on
// the map. body: { latitude, longitude } — both numbers to pin, both null to
// clear. One at a time isn't accepted: a stop with only a latitude isn't a
// place, and every map treats "either is null" as unpinned.
busRoutesRouter.patch("/:id/pin", requireRole("admin"), async (req, res) => {
  const { latitude, longitude } = req.body ?? {};
  const clearing = latitude === null && longitude === null;

  let lat = null;
  let lng = null;
  if (!clearing) {
    if (latitude === undefined || longitude === undefined || latitude === null || longitude === null) {
      return res.status(400).json({ error: "Send both latitude and longitude to pin a stop, or both as null to clear the pin" });
    }
    // Numbers only — Number("") is 0 and Number(true) is 1, both of which
    // would quietly pin a stop off the coast of Africa.
    if (typeof latitude === "boolean" || typeof longitude === "boolean" || latitude === "" || longitude === "") {
      return res.status(400).json({ error: "Latitude and longitude must be numbers" });
    }
    lat = Number(latitude);
    lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "Latitude and longitude must be numbers" });
    }
    if (lat < -90 || lat > 90) return res.status(400).json({ error: "Latitude must be between -90 and 90" });
    if (lng < -180 || lng > 180) return res.status(400).json({ error: "Longitude must be between -180 and 180" });
    const b = CORRIDOR_BOUNDS;
    if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) {
      return res.status(400).json({
        error:
          `That point (${lat.toFixed(5)}, ${lng.toFixed(5)}) is outside the Baguio–Bontoc area ` +
          `(latitude ${b.minLat}–${b.maxLat}, longitude ${b.minLng}–${b.maxLng}). ` +
          "Check for swapped latitude/longitude or a missing digit.",
      });
    }
    // DECIMAL(10,7): keep what the column can hold, so the response matches what's stored.
    lat = Math.round(lat * 1e7) / 1e7;
    lng = Math.round(lng * 1e7) / 1e7;
  }

  try {
    const [[before]] = await pool.query(`SELECT route_id, destination, latitude, longitude FROM routes WHERE route_id = ?`, [req.params.id]);
    if (!before) return res.status(404).json({ error: "Route not found" });

    await pool.query(
      `UPDATE routes SET latitude = ?, longitude = ?, pinned_at = ${clearing ? "NULL" : "NOW()"} WHERE route_id = ?`,
      [lat, lng, before.route_id]
    );
    await logAudit({
      staffId: req.user.id,
      action: clearing ? "unpin" : "pin",
      entityType: "route",
      entityId: before.route_id,
      details: {
        destination: before.destination,
        from: before.latitude != null ? { latitude: Number(before.latitude), longitude: Number(before.longitude) } : null,
        to: clearing ? null : { latitude: lat, longitude: lng },
      },
    });

    const [[row]] = await pool.query(
      `SELECT route_id, origin, destination, distance, base_fare, special_fare, is_active, latitude, longitude, pinned_at
       FROM routes WHERE route_id = ?`,
      [before.route_id]
    );
    res.json(withPin(row));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save the bus stop pin" });
  }
});
