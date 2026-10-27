import { Router } from "express";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";
import { signToken } from "../middleware/auth.js";
import { isReservedEmail } from "../services/bookingRules.js";
import { rateLimit, failureLimiter } from "../services/rateLimit.js";
import { whyPasswordWeak, cleanEmail, cleanName, cleanPhMobile, PASSWORD_MAX } from "../services/passwordPolicy.js";

export const authRouter = Router();

// The document's ERD only models Commuter and Driver as data-owning
// entities (3.3.5). Terminal Staff and Admin aren't in the ERD but both
// have login pages in drs-bus-main, so they're backed by staff_accounts
// (see schema.sql) instead of a table the document actually defines.
const ACCOUNT_TABLES = {
  passenger: { table: "commuters", idCol: "commuter_id", nameCol: "name", extra: ", phoneno" },
  driver: { table: "drivers", idCol: "driver_id", nameCol: "name", extra: ", duty_status" },
  staff: { table: "staff_accounts", idCol: "staff_id", nameCol: "name", roleFilter: "terminal_staff" },
  admin: { table: "staff_accounts", idCol: "staff_id", nameCol: "name", roleFilter: "admin" },
  owner: { table: "bus_owners", idCol: "owner_id", nameCol: "name" },
};

// Compared against when the email doesn't exist (or has no password yet),
// so a wrong email takes as long as a wrong password — the response time
// doesn't reveal which emails have accounts.
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString("hex"), 10);

// Hashed so Redis rate-limit keys don't hold email addresses.
const emailKey = (req) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  return email ? `acct:${createHash("sha256").update(`${req.body?.role}|${email}`).digest("hex").slice(0, 32)}` : null;
};

// Brute-force protection. Failed logins are counted per account (stops
// guessing one password from many IPs) and per IP (stops spraying many
// accounts from one machine); a successful login clears the account's count.
// The per-IP request cap below is a coarse backstop against floods.
const failedPerAccount = failureLimiter({ name: "login-fail-account", max: 10, windowSeconds: 15 * 60 });
const failedPerIp = failureLimiter({ name: "login-fail-ip", max: Number(process.env.LOGIN_IP_RATE_LIMIT) || 50, windowSeconds: 15 * 60 });
const loginRequestsPerIp = rateLimit({ name: "login-ip", max: (Number(process.env.LOGIN_IP_RATE_LIMIT) || 50) * 4, windowSeconds: 15 * 60, message: "Too many login attempts. Wait 15 minutes and try again." });
// Same message whether the email or the password is wrong, so it doesn't
// reveal which emails have accounts.
const INVALID_LOGIN = "Invalid password. Please try again.";
const LOCKED = "Too many failed login attempts. Wait 15 minutes and try again.";
const registerPerIp = rateLimit({ name: "register-ip", max: 10, windowSeconds: 60 * 60, message: "Too many sign-ups from this network. Try again later." });

// POST /api/auth/login — powers PassengerLogin / StaffLogin / AdminLogin
// (shared LoginForm.jsx). body: { email, password, role } where role is one
// of "passenger" | "driver" | "staff" | "admin".
authRouter.post("/login", loginRequestsPerIp, async (req, res) => {
  const { email, password, role } = req.body ?? {};
  const config = Object.prototype.hasOwnProperty.call(ACCOUNT_TABLES, role) ? ACCOUNT_TABLES[role] : null;
  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password || !config) {
    return res.status(400).json({ error: "email, password, and a valid role are required" });
  }
  if (email.length > 254 || password.length > PASSWORD_MAX) {
    return res.status(401).json({ error: INVALID_LOGIN });
  }

  const accountKey = emailKey(req);
  const ipKey = `ip:${req.ip}`;
  if ((await failedPerAccount.blocked(accountKey)) || (await failedPerIp.blocked(ipKey))) {
    return res.status(429).json({ error: LOCKED });
  }

  try {
    const roleClause = config.roleFilter ? "AND role = ?" : "";
    const params = config.roleFilter ? [email.trim(), config.roleFilter] : [email.trim()];
    const [rows] = await pool.query(
      `SELECT ${config.idCol} AS id, ${config.nameCol} AS name, email, password_hash${config.extra ?? ""}
       FROM ${config.table} WHERE email = ? ${roleClause}`,
      params
    );
    const account = rows[0];
    // Always run one bcrypt comparison (see DUMMY_HASH).
    const usable = account && account.password_hash;
    const matches = await bcrypt.compare(password, usable ? account.password_hash : DUMMY_HASH);
    if (!usable || !matches) {
      await Promise.all([failedPerAccount.fail(accountKey), failedPerIp.fail(ipKey)]);
      return res.status(401).json({ error: INVALID_LOGIN });
    }
    await failedPerAccount.reset(accountKey);
    if (role === "driver" && account.duty_status === "Suspended") {
      return res.status(403).json({ error: "This driver account is suspended. Contact an administrator." });
    }

    const token = signToken({ id: account.id, role, passwordHash: account.password_hash });
    const user = { id: account.id, name: account.name, email: account.email, role };
    // Shown on the passenger Profile page.
    if (role === "passenger") user.phoneno = account.phoneno ?? null;
    res.json({ user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

// POST /api/auth/register — passenger self-signup (Commuter), matching the
// "sign-up link for new users" noted on the login screen (Figure 13).
// Driver/staff/admin accounts are provisioned by an administrator, not
// self-registration, so there's no public register route for those roles.
authRouter.post("/register", registerPerIp, async (req, res) => {
  const body = req.body ?? {};
  const name = cleanName(body.name);
  if (name.error) return res.status(400).json({ error: name.error });
  const email = cleanEmail(body.email);
  if (email.error) return res.status(400).json({ error: email.error });
  const phone = cleanPhMobile(body.phoneno);
  if (phone.error) return res.status(400).json({ error: phone.error });
  const weak = whyPasswordWeak(body.password, { email: email.value, name: name.value });
  if (weak) return res.status(400).json({ error: weak });
  // The sign-up checkbox; when it was ticked is kept in terms_accepted_at.
  if (body.acceptedTerms !== true) {
    return res.status(400).json({ error: "Accept the Terms of Use and Privacy Policy to create an account" });
  }
  // The walk-in placeholder account (see bookingRules.js) — answered like
  // any taken email so it doesn't advertise itself.
  if (isReservedEmail(email.value)) {
    return res.status(409).json({ error: "An account with that email already exists" });
  }

  try {
    const passwordHash = await bcrypt.hash(body.password, 10);
    const [result] = await pool.query(
      `INSERT INTO commuters (name, email, phoneno, password_hash, terms_accepted_at) VALUES (?, ?, ?, ?, NOW())`,
      [name.value, email.value, phone.value, passwordHash]
    );
    res.status(201).json({ commuter_id: result.insertId, name: name.value, email: email.value, phoneno: phone.value, role: "passenger" });
  } catch (err) {
    // uq_commuters_phoneno: see schema.sql / migrate.js
    if (err.code === "ER_DUP_ENTRY" && /uq_commuters_phoneno/.test(err.sqlMessage ?? "")) {
      return res.status(409).json({ error: "An account with that mobile number already exists" });
    }
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Registration failed" });
  }
});
