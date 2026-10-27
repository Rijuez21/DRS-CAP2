import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { requireRole, invalidateAccount } from "../middleware/auth.js";
import { whyPasswordWeak, cleanEmail, cleanName } from "../services/passwordPolicy.js";
import { cleanProfile, cleanDate, PROFILE_SELECT } from "../services/employeeProfile.js";
import { logAudit } from "../services/audit.js";

export const driversRouter = Router();

// Never includes password_hash.
const DRIVER_SELECT = `SELECT driver_id, name, license_number, DATE_FORMAT(license_expiry, '%Y-%m-%d') AS license_expiry,
  email, duty_status, ${PROFILE_SELECT} FROM drivers`;

// GET /api/drivers — powers admin/DriverManagement.jsx and the driver rows
// of admin/UserManagement.jsx.
driversRouter.get("/", requireRole("admin", "staff"), async (req, res) => {
  try {
    const [rows] = await pool.query(`${DRIVER_SELECT} ORDER BY name`);
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
    const [[row]] = await pool.query(`${DRIVER_SELECT} WHERE driver_id = ?`, [req.params.id]);
    if (!row) return res.status(404).json({ error: "Driver not found" });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load driver" });
  }
});

driversRouter.post("/", requireRole("admin"), async (req, res) => {
  const { licenseNumber, password } = req.body ?? {};
  const nameR = cleanName(req.body?.name);
  if (nameR.error) return res.status(400).json({ error: "name is required" });
  const name = nameR.value;
  const emailRaw = req.body?.email;
  if ((emailRaw && !password) || (password && !emailRaw)) {
    return res.status(400).json({ error: "email and password must be provided together, or not at all" });
  }
  let email = null;
  if (emailRaw) {
    const e = cleanEmail(emailRaw);
    if (e.error) return res.status(400).json({ error: e.error });
    email = e.value;
    const weak = whyPasswordWeak(password, { email, name });
    if (weak) return res.status(400).json({ error: weak });
  }
  const profile = cleanProfile(req.body);
  if (profile.error) return res.status(400).json({ error: profile.error });
  if (licenseNumber != null && (typeof licenseNumber !== "string" || licenseNumber.length > 50)) {
    return res.status(400).json({ error: "License number must be text up to 50 characters" });
  }
  const expiry = cleanDate(req.body?.licenseExpiry, "License expiry");
  if (expiry.error) return res.status(400).json({ error: expiry.error });

  try {
    const passwordHash = password ? await bcrypt.hash(password, 10) : null;
    const cols = { name, license_number: licenseNumber?.trim() || null, license_expiry: expiry.value, email, password_hash: passwordHash, ...profile.columns };
    const [result] = await pool.query(
      `INSERT INTO drivers (${Object.keys(cols).join(", ")}) VALUES (${Object.keys(cols).map(() => "?").join(", ")})`,
      Object.values(cols)
    );
    await logAudit({ staffId: req.user.id, action: "create", entityType: "driver", entityId: result.insertId, details: { name, licenseNumber, email, ...profile.columns } });
    res.status(201).json({ driver_id: result.insertId, name, licenseNumber, licenseExpiry: expiry.value, email, ...profile.columns });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "A driver with that license number, email or employee number already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to add driver" });
  }
});

// PATCH /api/drivers/:id — admin edits basic fields, the employee profile
// and duty status (Active/On Leave/Suspended toggle in DriverManagement.jsx),
// and can also complete licenseNumber/email/password once they're known —
// this is the "finish the profile" path instead of seeding fake values.
driversRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const { name, email, licenseNumber, licenseExpiry, password, dutyStatus } = req.body;
  const allowedDutyStatus = ["Active", "On Leave", "Suspended"];
  if (dutyStatus !== undefined && !allowedDutyStatus.includes(dutyStatus)) {
    return res.status(400).json({ error: `dutyStatus must be one of: ${allowedDutyStatus.join(", ")}` });
  }

  const fields = [];
  const params = [];
  if (name !== undefined) {
    const n = cleanName(name);
    if (n.error) return res.status(400).json({ error: n.error });
    fields.push("name = ?"); params.push(n.value);
  }
  const profile = cleanProfile(req.body);
  if (profile.error) return res.status(400).json({ error: profile.error });
  for (const [column, value] of Object.entries(profile.columns)) {
    fields.push(`${column} = ?`); params.push(value);
  }
  if (email !== undefined) {
    if (email === null || email === "") { fields.push("email = ?"); params.push(null); }
    else {
      const e = cleanEmail(email);
      if (e.error) return res.status(400).json({ error: e.error });
      fields.push("email = ?"); params.push(e.value);
    }
  }
  if (licenseNumber !== undefined) {
    if (licenseNumber !== null && (typeof licenseNumber !== "string" || licenseNumber.length > 50)) {
      return res.status(400).json({ error: "License number must be text up to 50 characters" });
    }
    fields.push("license_number = ?"); params.push(licenseNumber?.trim() || null);
  }
  if (licenseExpiry !== undefined) {
    const expiry = cleanDate(licenseExpiry, "License expiry");
    if (expiry.error) return res.status(400).json({ error: expiry.error });
    fields.push("license_expiry = ?"); params.push(expiry.value);
  }
  if (dutyStatus !== undefined) { fields.push("duty_status = ?"); params.push(dutyStatus); }
  if (password) {
    const weak = whyPasswordWeak(password, { email: typeof email === "string" ? email : undefined, name });
    if (weak) return res.status(400).json({ error: weak });
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
    // Suspension or a new password ends the driver's existing sessions now.
    invalidateAccount("driver", Number(req.params.id));
    await logAudit({ staffId: req.user.id, action: "update", entityType: "driver", entityId: req.params.id, details: { ...req.body, password: password ? "(changed)" : undefined } });
    res.json({ driver_id: Number(req.params.id), name, email, licenseNumber, licenseExpiry, dutyStatus, ...profile.columns });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "That email, license number or employee number is already in use" });
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
    invalidateAccount("driver", Number(req.params.id));
    await logAudit({ staffId: req.user.id, action: "delete", entityType: "driver", entityId: req.params.id });
    res.status(204).end();
  } catch (err) {
    if (err.code === "ER_ROW_IS_REFERENCED_2" || err.code === "ER_ROW_IS_REFERENCED") {
      return res.status(409).json({ error: "This driver has past trips on record, so they can't be deleted. Set them to Suspended instead." });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to delete driver" });
  }
});
