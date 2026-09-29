import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";

export const driversRouter = Router();

// GET /api/drivers — powers admin/DriverManagement.jsx. Never returns
// password_hash.
driversRouter.get("/", requireRole("admin", "staff"), async (req, res) => {
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

// POST /api/drivers — admin adds a driver to the roster. Only name is
// required: license number, email and password can be filled in later
// (via PATCH) once they're actually known, instead of being faked to
// satisfy a NOT NULL constraint. If email+password ARE given up front,
// the account is login-ready immediately.
// GET /api/drivers/:id — admin, or a driver viewing their own profile
// (driver/Profile.jsx). This route was missing, so that page always failed.
driversRouter.get("/:id", requireRole("admin", "driver"), async (req, res) => {
  if (req.user.role === "driver" && req.user.id !== Number(req.params.id)) {
    return res.status(403).json({ error: "You can only view your own profile" });
  }
  try {
    const [[row]] = await pool.query(
      `SELECT driver_id, name, license_number, phoneno, hire_date, email, duty_status FROM drivers WHERE driver_id = ?`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: "Driver not found" });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load driver" });
  }
});

driversRouter.post("/", requireRole("admin"), async (req, res) => {
  const { name, licenseNumber, phoneno, hireDate, email, password } = req.body;
  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }
  if ((email && !password) || (password && !email)) {
    return res.status(400).json({ error: "email and password must be provided together, or not at all" });
  }

  try {
    const passwordHash = password ? await bcrypt.hash(password, 10) : null;
    const [result] = await pool.query(
      `INSERT INTO drivers (name, license_number, phoneno, hire_date, email, password_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, licenseNumber ?? null, phoneno ?? null, hireDate ?? null, email ?? null, passwordHash]
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
// (Active/On Leave/Suspended toggle in DriverManagement.jsx), and can
// now also complete licenseNumber/email/password once they're known —
// this is the "finish the profile" path instead of seeding fake values.
driversRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const { name, phoneno, email, licenseNumber, password, dutyStatus } = req.body;
  const allowedDutyStatus = ["Active", "On Leave", "Suspended"];
  if (dutyStatus !== undefined && !allowedDutyStatus.includes(dutyStatus)) {
    return res.status(400).json({ error: `dutyStatus must be one of: ${allowedDutyStatus.join(", ")}` });
  }

  const fields = [];
  const params = [];
  if (name !== undefined) { fields.push("name = ?"); params.push(name); }
  if (phoneno !== undefined) { fields.push("phoneno = ?"); params.push(phoneno); }
  if (email !== undefined) { fields.push("email = ?"); params.push(email); }
  if (licenseNumber !== undefined) { fields.push("license_number = ?"); params.push(licenseNumber); }
  if (dutyStatus !== undefined) { fields.push("duty_status = ?"); params.push(dutyStatus); }
  if (password) {
    fields.push("password_hash = ?");
    params.push(await bcrypt.hash(password, 10));
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: "No editable fields provided" });
  }

  try {
    params.push(req.params.id);
    const [result] = await pool.query(`UPDATE drivers SET ${fields.join(", ")} WHERE driver_id = ?`, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Driver not found" });
    await logAudit({ staffId: req.user.id, action: "update", entityType: "driver", entityId: req.params.id, details: { ...req.body, password: password ? "(changed)" : undefined } });
    res.json({ driver_id: Number(req.params.id), name, phoneno, email, licenseNumber, dutyStatus });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "That email or license number is already in use" });
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
