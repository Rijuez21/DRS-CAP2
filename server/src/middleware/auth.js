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
export const TOKEN_TTL = "12h";

// Which table/row a token's role points at, and what makes it still valid.
const ACCOUNTS = {
  passenger: { sql: `SELECT commuter_id AS id, password_hash FROM commuters WHERE commuter_id = ?` },
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

export function signToken({ id, role, passwordHash }) {
  return jwt.sign({ id, role, ver: tokenVersion(passwordHash) }, JWT_SECRET, { algorithm: JWT_ALGORITHM, expiresIn: TOKEN_TTL });
}

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
  const key = `${payload.role}:${payload.id}:${payload.ver}`;
  const hit = accountCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.reason;
  const [[row]] = await pool.query(config.sql, [payload.id]);
  let reason = null;
  if (!row) reason = "This account no longer exists";
  else if (config.staffRole && row.role !== config.staffRole) reason = "Your account's role has changed. Please log in again.";
  else if (payload.role === "driver" && row.duty_status === "Suspended") reason = "This driver account is suspended";
  else if (!row.password_hash || payload.ver !== tokenVersion(row.password_hash)) reason = "Your password was changed. Please log in again.";
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
  return { user: { id: payload.id, role: payload.role } };
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
    next();
  }, next);
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
