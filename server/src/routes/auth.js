import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";
import { JWT_SECRET } from "../middleware/auth.js";
import { isReservedEmail } from "../services/bookingRules.js";

export const authRouter = Router();

// The document's ERD only models Commuter and Driver as data-owning
// entities (3.3.5). Terminal Staff and Admin aren't in the ERD but both
// have login pages in drs-bus-main, so they're backed by staff_accounts
// (see schema.sql) instead of a table the document actually defines.
const ACCOUNT_TABLES = {
  passenger: { table: "commuters", idCol: "commuter_id", nameCol: "name" },
  driver: { table: "drivers", idCol: "driver_id", nameCol: "name" },
  staff: { table: "staff_accounts", idCol: "staff_id", nameCol: "name", roleFilter: "terminal_staff" },
  admin: { table: "staff_accounts", idCol: "staff_id", nameCol: "name", roleFilter: "admin" },
};

// POST /api/auth/login — powers PassengerLogin / DriverLogin / StaffLogin /
// AdminLogin (shared LoginForm.jsx). body: { email, password, role } where
// role is one of "passenger" | "driver" | "staff" | "admin".
authRouter.post("/login", async (req, res) => {
  const { email, password, role } = req.body;
  const config = ACCOUNT_TABLES[role];
  if (!email || !password || !config) {
    return res.status(400).json({ error: "email, password, and a valid role are required" });
  }

  try {
    const roleClause = config.roleFilter ? "AND role = ?" : "";
    const params = config.roleFilter ? [email, config.roleFilter] : [email];
    const [rows] = await pool.query(
      `SELECT ${config.idCol} AS id, ${config.nameCol} AS name, email, password_hash
       FROM ${config.table} WHERE email = ? ${roleClause}`,
      params
    );
    const account = rows[0];
    if (!account) return res.status(401).json({ error: "Invalid credentials" });

    const matches = await bcrypt.compare(password, account.password_hash);
    if (!matches) return res.status(401).json({ error: "Invalid credentials" });

    const { password_hash, ...safeAccount } = account;
    // Signed JWT carrying { id, role } is what requireRole()/authenticate()
    // in middleware/auth.js verify on subsequent requests — previously this
    // route just returned the user object with no way to prove who you are.
    const token = jwt.sign({ id: account.id, role }, JWT_SECRET, { expiresIn: "12h" });
    res.json({ user: { ...safeAccount, role }, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

// POST /api/auth/register — passenger self-signup (Commuter), matching the
// "sign-up link for new users" noted on the login screen (Figure 13).
// Driver/staff/admin accounts are provisioned by an administrator, not
// self-registration, so there's no public register route for those roles.
authRouter.post("/register", async (req, res) => {
  const { name, email, phoneno, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "name, email and password are required" });
  }
  // The walk-in placeholder account (see bookingRules.js) — answered like
  // any taken email so it doesn't advertise itself.
  if (isReservedEmail(email)) {
    return res.status(409).json({ error: "An account with that email already exists" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      `INSERT INTO commuters (name, email, phoneno, password_hash) VALUES (?, ?, ?, ?)`,
      [name, email, phoneno ?? null, passwordHash]
    );
    res.status(201).json({ commuter_id: result.insertId, name, email, role: "passenger" });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Registration failed" });
  }
});
