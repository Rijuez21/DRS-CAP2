import { Router } from "express";
import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { pool } from "../db/pool.js";
import { signToken } from "../middleware/auth.js";
import { isReservedEmail } from "../services/bookingRules.js";
import { rateLimit, failureLimiter } from "../services/rateLimit.js";
import { whyPasswordWeak, cleanEmail, cleanName, cleanPhMobile, PASSWORD_MAX } from "../services/passwordPolicy.js";
import { sendMail } from "../services/mailer.js";
import { passwordResetEmail, passwordChangedEmail } from "../services/emailTemplates.js";

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
const accountKey = (role, rawEmail) => {
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  return email ? `acct:${createHash("sha256").update(`${role}|${email}`).digest("hex").slice(0, 32)}` : null;
};
const emailKey = (req) => accountKey(req.body?.role, req.body?.email);

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

// ---------------------------------------------------------------------------
// Forgot password — "Forgot password?" on every login page (LoginForm.jsx)
// ---------------------------------------------------------------------------
//   POST /forgot-password     { email, role }          -> emails a 6-digit code
//   POST /verify-reset-code   { email, role, code }    -> { resetToken }
//   POST /reset-password      { resetToken, password } -> password changed
//
// The code is the proof of owning the inbox; the reset token lets the
// "choose a new password" step happen on its own screen without sending
// the code twice. Changing password_hash also signs the account out
// everywhere (JWTs carry tokenVersion(password_hash), middleware/auth.js).
const RESET_CODE_MINUTES = 10;
const RESET_TOKEN_MINUTES = 15;
const RESET_MAX_ATTEMPTS = 5;
const RESET_SENT = `If an account with that email exists, we've sent a 6-digit code to it. It expires in ${RESET_CODE_MINUTES} minutes.`;
const RESET_CODE_INVALID = "That code is invalid or has expired. Request a new one.";
const RESET_TOKEN_INVALID = "This reset session has expired. Request a new code and try again.";

const resetRequestsPerIp = rateLimit({ name: "pwreset-ip", max: 10, windowSeconds: 15 * 60, message: "Too many reset requests from this network. Wait 15 minutes and try again." });
// At most 3 emails per account per 15 minutes, so the form can't be used
// to flood someone's inbox.
const resetRequestsPerAccount = rateLimit({ name: "pwreset-account", max: 3, windowSeconds: 15 * 60, key: emailKey, message: "A code was sent recently. Check your inbox (and spam folder), or wait 15 minutes to request another." });
const resetVerifyPerIp = rateLimit({ name: "pwreset-verify-ip", max: 30, windowSeconds: 15 * 60 });

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function findAccount(role, email) {
  const config = ACCOUNT_TABLES[role];
  const roleClause = config.roleFilter ? "AND role = ?" : "";
  const params = config.roleFilter ? [email, config.roleFilter] : [email];
  const [[row]] = await pool.query(
    `SELECT ${config.idCol} AS id, ${config.nameCol} AS name, email, password_hash FROM ${config.table} WHERE email = ? ${roleClause}`,
    params
  );
  // Accounts without a password (the walk-in placeholder, drivers not yet
  // given a login) can't be "reset" into having one.
  return row && row.password_hash && !isReservedEmail(row.email) ? row : null;
}

function resetBody(req) {
  const { email, role } = req.body ?? {};
  if (typeof email !== "string" || !email.trim() || email.length > 254 || !Object.prototype.hasOwnProperty.call(ACCOUNT_TABLES, role)) {
    return null;
  }
  return { email: email.trim(), role };
}

// Runs after the response is sent, so "no such account" and "code sent"
// take the same time to answer.
async function issueResetCode(role, email) {
  try {
    const account = await findAccount(role, email);
    if (!account) return;
    // A new code replaces any earlier one for the account.
    await pool.query(
      `UPDATE password_resets SET used_at = NOW() WHERE account_role = ? AND account_id = ? AND used_at IS NULL`,
      [role, account.id]
    );
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await pool.query(
      `INSERT INTO password_resets (account_role, account_id, code_hash, expires_at) VALUES (?, ?, ?, NOW() + INTERVAL ? MINUTE)`,
      [role, account.id, await bcrypt.hash(code, 10), RESET_CODE_MINUTES]
    );
    await sendMail({ to: account.email, ...passwordResetEmail({ name: account.name, code, minutes: RESET_CODE_MINUTES }) });
  } catch (err) {
    console.error("Password reset email failed (non-fatal):", err.message);
  }
}

authRouter.post("/forgot-password", resetRequestsPerIp, resetRequestsPerAccount, (req, res) => {
  const body = resetBody(req);
  if (!body) return res.status(400).json({ error: "Enter your email address" });
  res.json({ message: RESET_SENT });
  issueResetCode(body.role, body.email);
});

authRouter.post("/verify-reset-code", resetVerifyPerIp, async (req, res) => {
  const body = resetBody(req);
  const code = String(req.body?.code ?? "").replace(/\s+/g, "");
  if (!body || !/^\d{6}$/.test(code)) return res.status(400).json({ error: "Enter the 6-digit code from the email" });

  try {
    const account = await findAccount(body.role, body.email);
    const [[reset]] = account
      ? await pool.query(
          `SELECT reset_id, code_hash, attempts FROM password_resets
           WHERE account_role = ? AND account_id = ? AND used_at IS NULL AND verified_at IS NULL AND expires_at > NOW()
           ORDER BY reset_id DESC LIMIT 1`,
          [body.role, account.id]
        )
      : [[]];
    // Same bcrypt cost whether or not there's a live code (see DUMMY_HASH).
    const matches = await bcrypt.compare(code, reset?.code_hash ?? DUMMY_HASH);
    if (!reset || reset.attempts >= RESET_MAX_ATTEMPTS) return res.status(400).json({ error: RESET_CODE_INVALID });
    if (!matches) {
      // Counted in SQL so parallel guesses can't share one attempt.
      await pool.query(`UPDATE password_resets SET attempts = attempts + 1 WHERE reset_id = ?`, [reset.reset_id]);
      const left = RESET_MAX_ATTEMPTS - reset.attempts - 1;
      return res.status(400).json({
        error: left > 0 ? `That code isn't right. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong codes. Request a new one.",
      });
    }
    const resetToken = randomBytes(32).toString("base64url");
    const [result] = await pool.query(
      `UPDATE password_resets SET verified_at = NOW(), reset_token_hash = ?, expires_at = NOW() + INTERVAL ? MINUTE
       WHERE reset_id = ? AND verified_at IS NULL AND used_at IS NULL AND attempts < ?`,
      [sha256(resetToken), RESET_TOKEN_MINUTES, reset.reset_id, RESET_MAX_ATTEMPTS]
    );
    if (result.affectedRows !== 1) return res.status(400).json({ error: RESET_CODE_INVALID });
    res.json({ resetToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Couldn't check the code. Try again." });
  }
});

authRouter.post("/reset-password", resetVerifyPerIp, async (req, res) => {
  const { resetToken, password } = req.body ?? {};
  if (typeof resetToken !== "string" || !resetToken || resetToken.length > 100) return res.status(400).json({ error: RESET_TOKEN_INVALID });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[reset]] = await conn.query(
      `SELECT reset_id, account_role, account_id FROM password_resets
       WHERE reset_token_hash = ? AND verified_at IS NOT NULL AND used_at IS NULL AND expires_at > NOW()
       FOR UPDATE`,
      [sha256(resetToken)]
    );
    if (!reset) {
      await conn.rollback();
      return res.status(400).json({ error: RESET_TOKEN_INVALID });
    }
    const config = ACCOUNT_TABLES[reset.account_role];
    const [[account]] = await conn.query(
      `SELECT ${config.idCol} AS id, ${config.nameCol} AS name, email FROM ${config.table} WHERE ${config.idCol} = ? FOR UPDATE`,
      [reset.account_id]
    );
    if (!account) {
      await conn.rollback();
      return res.status(400).json({ error: RESET_TOKEN_INVALID });
    }
    const weak = whyPasswordWeak(password, { email: account.email, name: account.name });
    if (weak) {
      await conn.rollback();
      return res.status(400).json({ error: weak });
    }
    await conn.query(`UPDATE ${config.table} SET password_hash = ? WHERE ${config.idCol} = ?`, [await bcrypt.hash(password, 10), account.id]);
    // Spends this token and any other outstanding code for the account.
    await conn.query(
      `UPDATE password_resets SET used_at = NOW() WHERE account_role = ? AND account_id = ? AND used_at IS NULL`,
      [reset.account_role, reset.account_id]
    );
    await conn.commit();

    // A lockout from earlier wrong passwords shouldn't outlive the reset.
    await failedPerAccount.reset(accountKey(reset.account_role, account.email));
    sendMail({ to: account.email, ...passwordChangedEmail({ name: account.name, when: new Date() }) }); // not awaited; never throws
    res.json({ message: "Your password has been changed. Sign in with your new password." });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error(err);
    res.status(500).json({ error: "Couldn't change the password. Try again." });
  } finally {
    conn.release();
  }
});
