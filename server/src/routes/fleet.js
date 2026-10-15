import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";
import { optionalText, requiredText, integer } from "../services/validate.js";

const BUS_TYPES = ["ordinary", "air_conditioned"];

// Capacity decides which seat numbers can be sold, so it must be a sane
// whole number; plate/bus numbers are shown on passenger maps and tickets.
function parseBusBody(body, { partial }) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has("plateNum")) {
    const r = requiredText(body.plateNum, { max: 20, label: "Plate number" });
    if (r.error) return r;
    if (!/^[A-Za-z0-9 \-]+$/.test(r.value)) return { error: "Plate number may only contain letters, numbers, spaces and dashes" };
    out.plate_num = r.value;
  }
  if (has("busNumber")) {
    const r = optionalText(body.busNumber, { max: 10, label: "Bus number" });
    if (r.error) return r;
    if (r.value && !/^[A-Za-z0-9\-]+$/.test(r.value)) return { error: "Bus number may only contain letters, numbers and dashes" };
    out.bus_number = r.value;
  }
  if (has("capacity")) {
    const r = integer(body.capacity, { label: "Capacity", min: 1, max: 120, nullable: true });
    if (r.error) return r;
    out.capacity = r.value;
  }
  if (has("type")) {
    if (body.type !== null && body.type !== "" && !BUS_TYPES.includes(body.type)) return { error: `type must be one of: ${BUS_TYPES.join(", ")}` };
    out.type = body.type || null;
  }
  if (has("yearModel")) {
    const r = integer(body.yearModel, { label: "Year model", min: 1950, max: 2100, nullable: true });
    if (r.error) return r;
    out.year_model = r.value;
  }
  if (has("currentDriverId")) {
    const r = integer(body.currentDriverId, { label: "Driver", min: 1, max: 2147483646, nullable: true });
    if (r.error) return r;
    out.current_driver_id = r.value;
  }
  if (has("boardingPoint")) {
    const r = optionalText(body.boardingPoint, { max: 150, label: "Boarding point" });
    if (r.error) return r;
    out.boarding_point = r.value;
  }
  return { fields: out };
}

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
  const { busNumber, plateNum, capacity, type, yearModel, currentDriverId, boardingPoint } = req.body ?? {};
  if (!plateNum) {
    return res.status(400).json({ error: "plateNum is required" });
  }
  const parsed = parseBusBody(req.body, { partial: false });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const f = parsed.fields;

  try {
    const [result] = await pool.query(
      `INSERT INTO buses (bus_number, plate_num, capacity, type, year_model, current_driver_id, boarding_point)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [f.bus_number ?? null, f.plate_num, f.capacity ?? null, f.type ?? null, f.year_model ?? null, f.current_driver_id ?? null, f.boarding_point ?? null]
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
    if (err.code === "ER_NO_REFERENCED_ROW_2") return res.status(400).json({ error: "That driver doesn't exist" });
    console.error(err);
    res.status(500).json({ error: "Failed to add bus" });
  }
});

// PATCH /api/buses/:id — admin edits plate/capacity/type/year/driver/etc.
// (Fleet Management's edit action, Table 4)
busesRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const parsed = parseBusBody(req.body ?? {}, { partial: true });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const fields = Object.keys(parsed.fields).map((c) => `${c} = ?`);
  const params = Object.values(parsed.fields);

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
    if (err.code === "ER_NO_REFERENCED_ROW_2") return res.status(400).json({ error: "That driver doesn't exist" });
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

    const [result] = await pool.query(`DELETE FROM buses WHERE bus_id = ?`, [req.params.id]).catch((err) => {
      if (err.code === "ER_ROW_IS_REFERENCED_2") throw Object.assign(new Error("in use"), { inUse: true });
      throw err;
    });
    if (result.affectedRows === 0) return res.status(404).json({ error: "Bus not found" });
    await logAudit({ staffId: req.user.id, action: "delete", entityType: "bus", entityId: req.params.id });
    res.status(204).end();
  } catch (err) {
    if (err.inUse) return res.status(409).json({ error: "This bus has past trips on record, so it can't be deleted. Set it to Maintenance or Idle instead." });
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
