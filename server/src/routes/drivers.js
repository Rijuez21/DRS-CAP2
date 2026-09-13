import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";

export const driversRouter = Router();

// GET /api/drivers — powers admin/DriverManagement.jsx. Never returns
// password_hash.
driversRouter.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT driver_id, name, license_number, phoneno, hire_date, email, duty_status FROM drivers ORDER BY name`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load drivers" });
  }
});

// POST /api/drivers — admin provisions a new driver account, same
// password-hashing approach as auth.js's register.
driversRouter.post("/", requireRole("admin"), async (req, res) => {
  const { name, licenseNumber, phoneno, hireDate, email, password } = req.body;
  if (!name || !licenseNumber || !email || !password) {
    return res.status(400).json({ error: "name, licenseNumber, email and password are required" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      `INSERT INTO drivers (name, license_number, phoneno, hire_date, email, password_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, licenseNumber, phoneno ?? null, hireDate ?? null, email, passwordHash]
    );
    await logAudit({ staffId: req.user.id, action: "create", entityType: "driver", entityId: result.insertId, details: { name, licenseNumber, email } });
    res.status(201).json({ driver_id: result.insertId, name, licenseNumber, phoneno, hireDate, email });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "A driver with that license number or email already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to add driver" });
  }
});

// PATCH /api/drivers/:id — admin edits basic fields + duty status
// (Active/On Leave/Suspended toggle in DriverManagement.jsx). Password
// isn't editable here — that'd be a separate reset flow, not a field edit.
driversRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const { name, phoneno, email, dutyStatus } = req.body;
  const allowedDutyStatus = ["Active", "On Leave", "Suspended"];
  if (dutyStatus !== undefined && !allowedDutyStatus.includes(dutyStatus)) {
    return res.status(400).json({ error: `dutyStatus must be one of: ${allowedDutyStatus.join(", ")}` });
  }

  const fields = [];
  const params = [];
  if (name !== undefined) { fields.push("name = ?"); params.push(name); }
  if (phoneno !== undefined) { fields.push("phoneno = ?"); params.push(phoneno); }
  if (email !== undefined) { fields.push("email = ?"); params.push(email); }
  if (dutyStatus !== undefined) { fields.push("duty_status = ?"); params.push(dutyStatus); }

  if (fields.length === 0) {
    return res.status(400).json({ error: "No editable fields provided" });
  }

  try {
    params.push(req.params.id);
    const [result] = await pool.query(`UPDATE drivers SET ${fields.join(", ")} WHERE driver_id = ?`, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Driver not found" });
    await logAudit({ staffId: req.user.id, action: "update", entityType: "driver", entityId: req.params.id, details: req.body });
    res.json({ driver_id: Number(req.params.id), ...req.body });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "That email is already in use" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update driver" });
  }
});

// DELETE /api/drivers/:id — blocked (409) if assigned to any future trip.
driversRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  try {
    const [[futureTrip]] = await pool.query(
      `SELECT trip_id FROM trips WHERE driver_id = ? AND departure_time > NOW() AND status != 'Cancelled' LIMIT 1`,
      [req.params.id]
    );
    if (futureTrip) {
      return res.status(409).json({ error: "This driver has upcoming trips assigned — reassign them first" });
    }

    const [result] = await pool.query(`DELETE FROM drivers WHERE driver_id = ?`, [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Driver not found" });
    await logAudit({ staffId: req.user.id, action: "delete", entityType: "driver", entityId: req.params.id });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete driver" });
  }
});
