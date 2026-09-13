import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";

export const busesRouter = Router();

// GET /api/buses — powers admin/FleetManagement.jsx
busesRouter.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT bus_id, plate_num, capacity, type, year_model, status FROM buses ORDER BY plate_num`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load buses" });
  }
});

// POST /api/buses — admin adds a bus to the fleet
busesRouter.post("/", requireRole("admin"), async (req, res) => {
  const { plateNum, capacity, type, yearModel } = req.body;
  if (!plateNum || !capacity || !type) {
    return res.status(400).json({ error: "plateNum, capacity and type are required" });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO buses (plate_num, capacity, type, year_model) VALUES (?, ?, ?, ?)`,
      [plateNum, capacity, type, yearModel ?? null]
    );
    await logAudit({
      staffId: req.user.id,
      action: "create",
      entityType: "bus",
      entityId: result.insertId,
      details: { plateNum, capacity, type, yearModel },
    });
    res.status(201).json({ bus_id: result.insertId, plateNum, capacity, type, yearModel, status: "Active" });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "A bus with that plate number already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to add bus" });
  }
});

// PATCH /api/buses/:id — admin edits plate/capacity/type/year (Fleet
// Management's edit action, Table 4)
busesRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const { plateNum, capacity, type, yearModel } = req.body;
  const fields = [];
  const params = [];
  if (plateNum !== undefined) { fields.push("plate_num = ?"); params.push(plateNum); }
  if (capacity !== undefined) { fields.push("capacity = ?"); params.push(capacity); }
  if (type !== undefined) { fields.push("type = ?"); params.push(type); }
  if (yearModel !== undefined) { fields.push("year_model = ?"); params.push(yearModel); }

  if (fields.length === 0) return res.status(400).json({ error: "No editable fields provided" });

  try {
    params.push(req.params.id);
    const [result] = await pool.query(`UPDATE buses SET ${fields.join(", ")} WHERE bus_id = ?`, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Bus not found" });
    await logAudit({ staffId: req.user.id, action: "update", entityType: "bus", entityId: req.params.id, details: req.body });
    res.json({ bus_id: Number(req.params.id), ...req.body });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "A bus with that plate number already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update bus" });
  }
});

// DELETE /api/buses/:id — blocked (409) if the bus has any future trip, so
// deleting it can't orphan a schedule (Table 4's Fleet Management scope).
busesRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  try {
    const [[futureTrip]] = await pool.query(
      `SELECT trip_id FROM trips WHERE bus_id = ? AND departure_time > NOW() AND status != 'Cancelled' LIMIT 1`,
      [req.params.id]
    );
    if (futureTrip) {
      return res.status(409).json({ error: "This bus has upcoming trips scheduled — reassign or cancel them first" });
    }

    const [result] = await pool.query(`DELETE FROM buses WHERE bus_id = ?`, [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Bus not found" });
    await logAudit({ staffId: req.user.id, action: "delete", entityType: "bus", entityId: req.params.id });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete bus" });
  }
});

// PATCH /api/buses/:id/status — e.g. flip to 'Maintenance', drives the
// dashboard alerts and trip-scheduling conflict prevention noted in 3.2.3.1
busesRouter.patch("/:id/status", requireRole("admin"), async (req, res) => {
  const { status } = req.body;
  const allowed = ["Active", "Idle", "Maintenance"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
  }

  try {
    await pool.query(`UPDATE buses SET status = ? WHERE bus_id = ?`, [status, req.params.id]);
    await logAudit({ staffId: req.user.id, action: "status_change", entityType: "bus", entityId: req.params.id, details: { status } });
    res.json({ bus_id: Number(req.params.id), status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update bus status" });
  }
});

export const maintenanceRouter = Router();

// GET /api/maintenance — powers admin/MaintenanceTracking.jsx
maintenanceRouter.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT m.maintenance_id, m.service_type, m.date, m.cost, m.mechanic_notes,
              m.next_service_date, m.status, m.bus_id, b.plate_num
       FROM maintenance m
       JOIN buses b ON b.bus_id = m.bus_id
       ORDER BY m.date DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load maintenance records" });
  }
});

// POST /api/maintenance — admin logs a service event
maintenanceRouter.post("/", requireRole("admin"), async (req, res) => {
  const { busId, serviceType, date, cost, mechanicNotes, nextServiceDate } = req.body;
  if (!busId || !serviceType || !date) {
    return res.status(400).json({ error: "busId, serviceType and date are required" });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO maintenance (bus_id, service_type, date, cost, mechanic_notes, next_service_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [busId, serviceType, date, cost ?? null, mechanicNotes ?? null, nextServiceDate ?? null]
    );
    await logAudit({ staffId: req.user.id, action: "create", entityType: "maintenance", entityId: result.insertId, details: req.body });
    res.status(201).json({ maintenance_id: result.insertId, busId, serviceType, date, status: "Scheduled" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to log maintenance" });
  }
});

// PATCH /api/maintenance/:id — move a service event through
// Scheduled -> In Progress -> Completed, and log actual cost once done
// (Table 4's Maintenance Tracking scope).
maintenanceRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const { status, cost, mechanicNotes, nextServiceDate } = req.body;
  const allowedStatus = ["Scheduled", "In Progress", "Completed"];
  if (status !== undefined && !allowedStatus.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowedStatus.join(", ")}` });
  }

  const fields = [];
  const params = [];
  if (status !== undefined) { fields.push("status = ?"); params.push(status); }
  if (cost !== undefined) { fields.push("cost = ?"); params.push(cost); }
  if (mechanicNotes !== undefined) { fields.push("mechanic_notes = ?"); params.push(mechanicNotes); }
  if (nextServiceDate !== undefined) { fields.push("next_service_date = ?"); params.push(nextServiceDate); }

  if (fields.length === 0) return res.status(400).json({ error: "No editable fields provided" });

  try {
    params.push(req.params.id);
    const [result] = await pool.query(`UPDATE maintenance SET ${fields.join(", ")} WHERE maintenance_id = ?`, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Maintenance record not found" });
    await logAudit({ staffId: req.user.id, action: "update", entityType: "maintenance", entityId: req.params.id, details: req.body });
    res.json({ maintenance_id: Number(req.params.id), ...req.body });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update maintenance record" });
  }
});
