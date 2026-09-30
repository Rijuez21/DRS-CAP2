import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";

export const busesRouter = Router();

// GET /api/buses — powers admin/FleetManagement.jsx, plus the bus picker in
// TripScheduling.jsx, which terminal staff also use (read-only for them —
// every write below stays admin-only).
busesRouter.get("/", requireRole("admin", "staff"), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.bus_id, b.bus_number, b.plate_num, b.capacity, b.type, b.year_model, b.status,
              b.current_driver_id, b.boarding_point, d.name AS driver_name
       FROM buses b
       LEFT JOIN drivers d ON d.driver_id = b.current_driver_id
       ORDER BY b.bus_number IS NULL, b.bus_number, b.plate_num`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load buses" });
  }
});

// POST /api/buses — admin adds a bus to the fleet
busesRouter.post("/", requireRole("admin"), async (req, res) => {
  const { busNumber, plateNum, capacity, type, yearModel, currentDriverId, boardingPoint } = req.body;
  if (!plateNum) {
    return res.status(400).json({ error: "plateNum is required" });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO buses (bus_number, plate_num, capacity, type, year_model, current_driver_id, boarding_point)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [busNumber ?? null, plateNum, capacity ?? null, type ?? null, yearModel ?? null, currentDriverId ?? null, boardingPoint ?? null]
    );
    await logAudit({
      staffId: req.user.id,
      action: "create",
      entityType: "bus",
      entityId: result.insertId,
      details: { busNumber, plateNum, capacity, type, yearModel, currentDriverId, boardingPoint },
    });
    res.status(201).json({
      bus_id: result.insertId,
      busNumber,
      plateNum,
      capacity,
      type,
      yearModel,
      status: "Active",
      currentDriverId,
      boardingPoint,
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "A bus with that plate number or bus number already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to add bus" });
  }
});

// PATCH /api/buses/:id — admin edits plate/capacity/type/year/driver/etc.
// (Fleet Management's edit action, Table 4)
busesRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const { busNumber, plateNum, capacity, type, yearModel, currentDriverId, boardingPoint } = req.body;
  const fields = [];
  const params = [];
  if (busNumber !== undefined) { fields.push("bus_number = ?"); params.push(busNumber); }
  if (plateNum !== undefined) { fields.push("plate_num = ?"); params.push(plateNum); }
  if (capacity !== undefined) { fields.push("capacity = ?"); params.push(capacity); }
  if (type !== undefined) { fields.push("type = ?"); params.push(type); }
  if (yearModel !== undefined) { fields.push("year_model = ?"); params.push(yearModel); }
  if (currentDriverId !== undefined) { fields.push("current_driver_id = ?"); params.push(currentDriverId); }
  if (boardingPoint !== undefined) { fields.push("boarding_point = ?"); params.push(boardingPoint); }

  if (fields.length === 0) return res.status(400).json({ error: "No editable fields provided" });

  try {
    params.push(req.params.id);
    const [result] = await pool.query(`UPDATE buses SET ${fields.join(", ")} WHERE bus_id = ?`, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Bus not found" });
    await logAudit({ staffId: req.user.id, action: "update", entityType: "bus", entityId: req.params.id, details: req.body });
    res.json({ bus_id: Number(req.params.id), ...req.body });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "A bus with that plate number or bus number already exists" });
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
maintenanceRouter.get("/", requireRole("admin"), async (req, res) => {
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
