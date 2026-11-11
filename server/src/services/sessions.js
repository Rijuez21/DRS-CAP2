import { randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";
import { accountKind, invalidateAccount, tokenVersion, SIGNED_IN_ELSEWHERE, TOKEN_TTL_HOURS } from "../middleware/auth.js";

// ============================================================================
// One signed-in device per account.
//
// Each login starts a new session id (sid), stored in auth_sessions and put
// in the token. middleware/auth.js only accepts the account's current sid,
// so signing in on a second phone signs the first one out ("latest login
// wins"). The other way round — refusing the new login while an old one is
// "active" — would lock people out: closing the browser tab ends a session
// on the device without ever telling the server.
//
// Before taking over, the login page warns: routes/auth.js answers 409
// SIGNED_IN_ELSEWHERE (findOtherSignedInDevice) and only signs in once the
// person confirms ("force"). The browser sends a random device id it keeps,
// so logging in again on the SAME browser (e.g. after closing the tab)
// doesn't warn about itself.
//
// The previous device finds out on its next request (401 + SIGNED_IN_ELSEWHERE),
// or straight away if it has a live socket: those are told
// "session:revoked" and disconnected.
// ============================================================================

// Socket room every signed-in socket joins (index.js), so a new login can
// find the account's other devices.
export const sessionRoom = (role, id) => `session:${accountKind(role)}:${id}`;

let io = null;
export function attachSessionsIo(server) {
  io = server;
}

const SESSION_COLUMNS_ADDED = [
  "device_id VARCHAR(64) NULL",
  "device_label VARCHAR(60) NULL",
  "token_ver VARCHAR(16) NULL",
  "last_seen_at TIMESTAMP NULL DEFAULT NULL",
];

// Same table as schema.sql / migrate.js. Also created at server start
// (index.js) because without it nobody can sign in at all, and
// `npm run db:migrate` is a manual step that's easy to miss on a redeploy.
// A no-op once the table (and its columns) exist.
export async function ensureSessionsTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS auth_sessions (
    account_kind VARCHAR(12) NOT NULL,
    account_id INT NOT NULL,
    session_id CHAR(32) NOT NULL,
    device_id VARCHAR(64) NULL,
    device_label VARCHAR(60) NULL,
    token_ver VARCHAR(16) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (account_kind, account_id)
  )`);
  // A table made by an earlier version of this file lacks these.
  for (const column of SESSION_COLUMNS_ADDED) {
    await pool.query(`ALTER TABLE auth_sessions ADD COLUMN ${column}`).catch((err) => {
      if (err.code !== "ER_DUP_FIELDNAME") throw err;
    });
  }
}

// The account's current session if it's on a DIFFERENT browser and its token
// may still work; null otherwise. { device, lastActiveAt, activeNow }.
// token_ver: a password change (or reset) already signed that device out,
// so it isn't worth a warning.
export async function findOtherSignedInDevice(role, id, { deviceId, passwordHash }) {
  const [[row]] = await pool.query(
    `SELECT session_id, device_id, device_label, token_ver, created_at, last_seen_at
     FROM auth_sessions
     WHERE account_kind = ? AND account_id = ? AND COALESCE(last_seen_at, created_at) > NOW() - INTERVAL ? HOUR`,
    [accountKind(role), id, TOKEN_TTL_HOURS]
  );
  if (!row) return null;
  if (deviceId && row.device_id === deviceId) return null;
  if (row.token_ver !== tokenVersion(passwordHash)) return null;
  // A live socket on that session = the app is open there right now.
  let activeNow = false;
  if (io) {
    const sockets = await io.in(sessionRoom(role, id)).fetchSockets().catch(() => []);
    activeNow = sockets.some((s) => s.data.sid === row.session_id);
  }
  return { device: row.device_label || "another device", lastActiveAt: row.last_seen_at ?? row.created_at, activeNow };
}

export async function startSession(role, id, { passwordHash, deviceId = null, deviceLabel = null }) {
  const sid = randomBytes(16).toString("hex");
  const ver = tokenVersion(passwordHash);
  await pool.query(
    `INSERT INTO auth_sessions (account_kind, account_id, session_id, device_id, device_label, token_ver, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE session_id = ?, device_id = ?, device_label = ?, token_ver = ?, created_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP`,
    [accountKind(role), id, sid, deviceId, deviceLabel, ver, sid, deviceId, deviceLabel, ver]
  );
  // Drop cached "token is fine" answers so the old device is refused now,
  // not up to CACHE_MS later.
  invalidateAccount(role, id);
  signOutOtherSockets(role, id, sid);
  return sid;
}

// Change password on this device: it keeps its session, under the new
// password's token version.
export async function renewSessionVersion(role, id, sid, passwordHash) {
  if (!sid) return;
  await pool.query(`UPDATE auth_sessions SET token_ver = ? WHERE account_kind = ? AND account_id = ? AND session_id = ?`, [
    tokenVersion(passwordHash),
    accountKind(role),
    id,
    sid,
  ]);
}

// Log out: only ends the session if it's still the current one (a stale
// device logging out must not sign out the device that replaced it).
export async function endSession(role, id, sid) {
  if (!sid) return;
  await pool.query(`DELETE FROM auth_sessions WHERE account_kind = ? AND account_id = ? AND session_id = ?`, [accountKind(role), id, sid]);
  invalidateAccount(role, id);
}

function signOutOtherSockets(role, id, keepSid) {
  if (!io) return;
  io.in(sessionRoom(role, id))
    .fetchSockets()
    .then((sockets) => {
      for (const socket of sockets) {
        if (socket.data.sid === keepSid) continue;
        socket.emit("session:revoked", { message: SIGNED_IN_ELSEWHERE });
        socket.disconnect(true);
      }
    })
    .catch((err) => console.error("Couldn't sign out the account's other devices (non-fatal):", err.message));
}
