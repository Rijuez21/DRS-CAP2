import jwt from "jsonwebtoken";
import { createHmac } from "node:crypto";
import { pool } from "../db/pool.js";

import "dotenv/config";

// Signs every login token. The fallback below is in the public source code,
// so a server using it lets anyone forge a token — including an admin one.
// Local development may use it (with a warning); a deployed server refuses
// to start until JWT_SECRET is set (Railway -> server service -> Variables).
const DEV_FALLBACK_SECRET = "drs-bus-dev-secret";
export const isDeployed =
  process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT);
const configured = process.env.JWT_SECRET?.trim();

if (!configured || configured === DEV_FALLBACK_SECRET) {
  if (isDeployed) {
    console.error(
      "FATAL: JWT_SECRET is not set. Add a long random value in Railway -> server service -> Variables, then redeploy.\n" +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
    );
    process.exit(1);
  }
  console.warn("WARNING: JWT_SECRET is not set — using the insecure development secret. Set JWT_SECRET in server/.env.");
} else if (configured.length < 32) {
  if (isDeployed) {
    console.error("FATAL: JWT_SECRET is too short. Use at least 32 random characters.");
    process.exit(1);
  }
  console.warn("WARNING: JWT_SECRET is short. Use at least 32 random characters.");
}

export const JWT_SECRET = configured || DEV_FALLBACK_SECRET;
const JWT_ALGORITHM = "HS256";
export const TOKEN_TTL_HOURS = 12;
export const TOKEN_TTL = `${TOKEN_TTL_HOURS}h`;

// Which table/row a token's role points at, and what makes it still valid.
const ACCOUNTS = {
  passenger: { sql: `SELECT commuter_id AS id, password_hash, suspended_at FROM commuters WHERE commuter_id = ?` },
  driver: { sql: `SELECT driver_id AS id, password_hash, duty_status FROM drivers WHERE driver_id = ?` },
  staff: { sql: `SELECT staff_id AS id, password_hash, role FROM staff_accounts WHERE staff_id = ?`, staffRole: "terminal_staff" },
  admin: { sql: `SELECT staff_id AS id, password_hash, role FROM staff_accounts WHERE staff_id = ?`, staffRole: "admin" },
  owner: { sql: `SELECT owner_id AS id, password_hash FROM bus_owners WHERE owner_id = ?` },
};

// A token carries a short fingerprint of the account's password hash. When
// the password changes, the fingerprint no longer matches and every token
// issued before the change stops working (no extra column needed).
export function tokenVersion(passwordHash) {
  return createHmac("sha256", JWT_SECRET).update(String(passwordHash ?? "")).digest("base64url").slice(0, 16);
}

// sid = the login session the token belongs to (services/sessions.js). Only
// the account's current session is accepted, so one device at a time.
export function signToken({ id, role, passwordHash, sid }) {
  return jwt.sign({ id, role, ver: tokenVersion(passwordHash), sid }, JWT_SECRET, { algorithm: JWT_ALGORITHM, expiresIn: TOKEN_TTL });
}

// Staff and admins share staff_accounts (one id space), so they share one
// session row per account.
export const accountKind = (role) => (role === "admin" ? "staff" : role);

export const SIGNED_IN_ELSEWHERE = "You were signed out because your account was signed in on another device.";

// Short cache so every API call doesn't cost an extra query; account
// changes (role, suspension, deletion, password) take effect within this
// window, and immediately on the instance that made the change.
const CACHE_MS = 10000;
const accountCache = new Map(); // `${role}:${id}` -> { at, ok, reason }

export function invalidateAccount(role, id) {
  const prefixes = (role === "staff" || role === "admin" ? ["staff", "admin"] : [role]).map((r) => `${r}:${id}:`);
  for (const key of accountCache.keys()) if (prefixes.some((p) => key.startsWith(p))) accountCache.delete(key);
}

async function checkAccount(payload) {
  const config = ACCOUNTS[payload.role];
  if (!config || !Number.isInteger(payload.id)) return "Invalid token";
  // Tokens from before one-device sessions existed have no sid.
  if (typeof payload.sid !== "string" || !payload.sid) return "Your session has ended. Please log in again.";
  const key = `${payload.role}:${payload.id}:${payload.ver}:${payload.sid}`;
  const hit = accountCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.reason;
  const [[row]] = await pool.query(config.sql, [payload.id]);
  const [[session]] = await pool.query(
    `SELECT session_id, last_seen_at < NOW() - INTERVAL 1 MINUTE OR last_seen_at IS NULL AS seen_stale
     FROM auth_sessions WHERE account_kind = ? AND account_id = ?`,
    [accountKind(payload.role), payload.id]
  );
  let reason = null;
  if (!row) reason = "This account no longer exists";
  else if (config.staffRole && row.role !== config.staffRole) reason = "Your account's role has changed. Please log in again.";
  else if (payload.role === "driver" && row.duty_status === "Suspended") reason = "This driver account is suspended";
  else if (payload.role === "passenger" && row.suspended_at) reason = "This account is suspended. Contact the terminal office.";
  else if (!row.password_hash || payload.ver !== tokenVersion(row.password_hash)) reason = "Your password was changed. Please log in again.";
  // No row: they logged out (or never logged in since this was added).
  else if (!session) reason = "Your session has ended. Please log in again.";
  else if (session.session_id !== payload.sid) reason = SIGNED_IN_ELSEWHERE;
  // "Last active" for the login page's other-device warning. At most one
  // write a minute per signed-in device (and only on a cache miss).
  if (!reason && session.seen_stale) {
    pool
      .query(`UPDATE auth_sessions SET last_seen_at = NOW() WHERE account_kind = ? AND account_id = ? AND session_id = ?`, [
        accountKind(payload.role),
        payload.id,
        payload.sid,
      ])
      .catch((err) => console.error("Couldn't record session activity (non-fatal):", err.message));
  }
  if (accountCache.size > 5000) accountCache.clear();
  accountCache.set(key, { at: Date.now(), reason });
  return reason;
}

// Shared by HTTP requests and the Socket.io handshake. Returns { user } or
// { error }. The signature alone isn't enough: the account must still
// exist, hold the same role, not be suspended, and not have changed its
// password since the token was issued.
export async function verifyToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
  } catch {
    return { error: "Invalid or expired token" };
  }
  try {
    const reason = await checkAccount(payload);
    if (reason) return { error: reason };
  } catch (err) {
    console.error("Account check failed:", err.message);
    return { error: "Couldn't verify your session. Try again.", status: 503 };
  }
  // sid is kept beside user, not in it: req.user is passed around as an
  // audit "actor" and the session id has no business in those logs.
  return { user: { id: payload.id, role: payload.role }, sid: payload.sid };
}

// Verifies the `Authorization: Bearer <token>` header and attaches
// { id, role } to req.user. Standalone "must be logged in" gate, and the
// building block requireRole() composes below.
export function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }
  verifyToken(token).then((result) => {
    if (result.error) return res.status(result.status ?? 401).json({ error: result.error });
    req.user = result.user;
    req.sessionId = result.sid;
    next();
  }, next);
}

// For public endpoints that show more to some signed-in roles (the trip
// timetable gives staff the driver's full name). Sets req.user when a valid
// token comes with the request; anything else just carries on as anonymous
// — never a 401 on a public page.
export function identifyIfSignedIn(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return next();
  verifyToken(header.slice(7)).then(
    (result) => {
      if (result.user) {
        req.user = result.user;
        req.sessionId = result.sid;
      }
      next();
    },
    () => next()
  );
}

// requireRole('admin'), requireRole('admin', 'staff'), etc. — authenticates
// first, then rejects if the token's role isn't one of the allowed roles.
export function requireRole(...roles) {
  return (req, res, next) => {
    authenticate(req, res, () => {
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ error: "Forbidden: insufficient role" });
      }
      next();
    });
  };
}
