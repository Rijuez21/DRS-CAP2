import { randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";
import { accountKind, invalidateAccount, SIGNED_IN_ELSEWHERE } from "../middleware/auth.js";

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

// Same table as schema.sql / migrate.js. Also created at server start
// (index.js) because without it nobody can sign in at all, and
// `npm run db:migrate` is a manual step that's easy to miss on a redeploy.
// A no-op once the table exists.
export async function ensureSessionsTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS auth_sessions (
    account_kind VARCHAR(12) NOT NULL,
    account_id INT NOT NULL,
    session_id CHAR(32) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (account_kind, account_id)
  )`);
}

export async function startSession(role, id) {
  const sid = randomBytes(16).toString("hex");
  await pool.query(
    `INSERT INTO auth_sessions (account_kind, account_id, session_id) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE session_id = ?, created_at = CURRENT_TIMESTAMP`,
    [accountKind(role), id, sid, sid]
  );
  // Drop cached "token is fine" answers so the old device is refused now,
  // not up to CACHE_MS later.
  invalidateAccount(role, id);
  signOutOtherSockets(role, id, sid);
  return sid;
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
