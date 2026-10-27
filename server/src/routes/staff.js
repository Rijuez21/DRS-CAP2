import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { requireRole, invalidateAccount } from "../middleware/auth.js";
import { whyPasswordWeak, cleanEmail, cleanName } from "../services/passwordPolicy.js";
import { cleanProfile, PROFILE_SELECT } from "../services/employeeProfile.js";

// Refuses changes that would leave the system without any administrator
// (deleting or demoting the last one). Returns an error string or null.
async function whyLosesLastAdmin(staffId) {
  const [[target]] = await pool.query(`SELECT role FROM staff_accounts WHERE staff_id = ?`, [staffId]);
  if (!target || target.role !== "admin") return null;
  const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM staff_accounts WHERE role = 'admin'`);
  return Number(n) <= 1 ? "This is the only administrator account. Create another admin first." : null;
}
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
      `SELECT staff_id, name, email, role, ${PROFILE_SELECT} FROM staff_accounts ${role ? "WHERE role = ?" : ""} ORDER BY name`,
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
  const { password, role } = req.body ?? {};
  const allowed = ["terminal_staff", "admin"];
  if (!allowed.includes(role)) {
    return res.status(400).json({ error: `name, email, password and role (one of: ${allowed.join(", ")}) are required` });
  }
  const name = cleanName(req.body?.name);
  if (name.error) return res.status(400).json({ error: name.error });
  const email = cleanEmail(req.body?.email);
  if (email.error) return res.status(400).json({ error: email.error });
  const weak = whyPasswordWeak(password, { email: email.value, name: name.value });
  if (weak) return res.status(400).json({ error: weak });
  const profile = cleanProfile(req.body);
  if (profile.error) return res.status(400).json({ error: profile.error });

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const cols = { name: name.value, email: email.value, password_hash: passwordHash, role, ...profile.columns };
    const [result] = await pool.query(
      `INSERT INTO staff_accounts (${Object.keys(cols).join(", ")}) VALUES (${Object.keys(cols).map(() => "?").join(", ")})`,
      Object.values(cols)
    );
    await logAudit({ staffId: req.user.id, action: "create", entityType: "staff", entityId: result.insertId, details: { name: name.value, email: email.value, role, ...profile.columns } });
    res.status(201).json({ staff_id: result.insertId, name: name.value, email: email.value, role, ...profile.columns });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: err.message.includes("employee_no") ? "That employee number is already in use" : "An account with that email already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to add staff account" });
  }
});

// PATCH /api/staff/:id — admin edits name/email/role and the employee profile.
staffRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const { role, password } = req.body ?? {};
  const allowed = ["terminal_staff", "admin"];
  if (role !== undefined && !allowed.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${allowed.join(", ")}` });
  }

  const fields = [];
  const params = [];
  const changes = {};
  if (req.body?.name !== undefined) {
    const name = cleanName(req.body.name);
    if (name.error) return res.status(400).json({ error: name.error });
    fields.push("name = ?"); params.push(name.value); changes.name = name.value;
  }
  if (req.body?.email !== undefined) {
    const email = cleanEmail(req.body.email);
    if (email.error) return res.status(400).json({ error: email.error });
    fields.push("email = ?"); params.push(email.value); changes.email = email.value;
  }
  if (role !== undefined) { fields.push("role = ?"); params.push(role); changes.role = role; }
  const profile = cleanProfile(req.body);
  if (profile.error) return res.status(400).json({ error: profile.error });
  for (const [column, value] of Object.entries(profile.columns)) {
    fields.push(`${column} = ?`); params.push(value); changes[column] = value;
  }
  if (password !== undefined && password !== "") {
    const weak = whyPasswordWeak(password, { email: changes.email });
    if (weak) return res.status(400).json({ error: weak });
    fields.push("password_hash = ?"); params.push(await bcrypt.hash(password, 10));
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: "No editable fields provided" });
  }

  try {
    if (role === "terminal_staff") {
      const refusal = await whyLosesLastAdmin(req.params.id);
      if (refusal) return res.status(409).json({ error: refusal });
    }
    params.push(req.params.id);
    const [result] = await pool.query(`UPDATE staff_accounts SET ${fields.join(", ")} WHERE staff_id = ?`, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Staff account not found" });
    // A role or password change must end existing sessions right away.
    invalidateAccount("staff", Number(req.params.id));
    await logAudit({
      staffId: req.user.id,
      action: "update",
      entityType: "staff",
      entityId: req.params.id,
      details: { ...changes, ...(password ? { password: "(changed)" } : {}) },
    });
    res.json({ staff_id: Number(req.params.id), ...changes });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: err.message.includes("employee_no") ? "That employee number is already in use" : "That email is already in use" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update staff account" });
  }
});

// DELETE /api/staff/:id — admin removes a terminal-staff/admin account.
staffRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(409).json({ error: "You can't delete your own account while signed in to it" });
  }
  try {
    const refusal = await whyLosesLastAdmin(req.params.id);
    if (refusal) return res.status(409).json({ error: refusal });
    const [result] = await pool.query(`DELETE FROM staff_accounts WHERE staff_id = ?`, [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Staff account not found" });
    invalidateAccount("staff", Number(req.params.id));
    await logAudit({ staffId: req.user.id, action: "delete", entityType: "staff", entityId: req.params.id });
    res.status(204).end();
  } catch (err) {
    // Accounts with audit history are referenced by audit_log and can't be
    // hard-deleted; say so instead of a generic 500.
    if (err.code === "ER_ROW_IS_REFERENCED_2" || err.code === "ER_ROW_IS_REFERENCED") {
      return res.status(409).json({ error: "This account has recorded actions in the audit log, so it can't be deleted. Change its password instead to lock it out." });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to delete staff account" });
  }
});
