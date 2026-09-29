import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";

export const busRoutesRouter = Router();

// GET /api/routes — powers TripSearchPanel.jsx and admin/RouteManagement.jsx.
// Admin's table needs to see deactivated routes too (to reactivate them),
// so ?includeInactive=1 skips the is_active filter; the passenger-facing
// search never passes that flag.
busRoutesRouter.get("/", async (req, res) => {
  const { includeInactive } = req.query;
  try {
    const [rows] = await pool.query(
      `SELECT route_id, origin, destination, distance, base_fare, special_fare, is_active FROM routes
       ${includeInactive ? "" : "WHERE is_active = TRUE"}
       ORDER BY origin`
    );
    res.json(rows);
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
