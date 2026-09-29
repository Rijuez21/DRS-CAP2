import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";

export const staffRouter = Router();

// GET /api/staff?role= — powers admin/UserManagement.jsx, which covers
// both terminal_staff and admin rows since both live in staff_accounts
// (see schema.sql's note on why the ERD's Commuter/Driver-only scope
// needed this table added).
staffRouter.get("/", requireRole("admin"), async (req, res) => {
  const { role } = req.query;
  const allowed = ["terminal_staff", "admin"];
  if (role && !allowed.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${allowed.join(", ")}` });
  }

  try {
    const [rows] = await pool.query(
      `SELECT staff_id, name, email, role FROM staff_accounts ${role ? "WHERE role = ?" : ""} ORDER BY name`,
      role ? [role] : []
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load staff accounts" });
  }
});

// POST /api/staff — admin provisions a terminal-staff or admin account.
staffRouter.post("/", requireRole("admin"), async (req, res) => {
  const { name, email, password, role } = req.body;
  const allowed = ["terminal_staff", "admin"];
  if (!name || !email || !password || !allowed.includes(role)) {
    return res.status(400).json({ error: `name, email, password and role (one of: ${allowed.join(", ")}) are required` });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      `INSERT INTO staff_accounts (name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
      [name, email, passwordHash, role]
    );
    await logAudit({ staffId: req.user.id, action: "create", entityType: "staff", entityId: result.insertId, details: { name, email, role } });
    res.status(201).json({ staff_id: result.insertId, name, email, role });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to add staff account" });
  }
});

// PATCH /api/staff/:id — admin edits basic fields (name/email/role).
staffRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const { name, email, role } = req.body;
  const allowed = ["terminal_staff", "admin"];
  if (role !== undefined && !allowed.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${allowed.join(", ")}` });
  }

  const fields = [];
  const params = [];
  if (name !== undefined) { fields.push("name = ?"); params.push(name); }
  if (email !== undefined) { fields.push("email = ?"); params.push(email); }
  if (role !== undefined) { fields.push("role = ?"); params.push(role); }

  if (fields.length === 0) {
    return res.status(400).json({ error: "No editable fields provided" });
  }

  try {
    params.push(req.params.id);
    const [result] = await pool.query(`UPDATE staff_accounts SET ${fields.join(", ")} WHERE staff_id = ?`, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Staff account not found" });
    await logAudit({ staffId: req.user.id, action: "update", entityType: "staff", entityId: req.params.id, details: req.body });
    res.json({ staff_id: Number(req.params.id), ...req.body });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "That email is already in use" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update staff account" });
  }
});

// DELETE /api/staff/:id — admin removes a terminal-staff/admin account.
staffRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  try {
    const [result] = await pool.query(`DELETE FROM staff_accounts WHERE staff_id = ?`, [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Staff account not found" });
    await logAudit({ staffId: req.user.id, action: "delete", entityType: "staff", entityId: req.params.id });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete staff account" });
  }
});
