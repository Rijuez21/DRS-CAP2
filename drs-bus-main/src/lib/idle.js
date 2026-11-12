// "Someone is using the app" — for the inactivity sign-out
// (components/auth/IdleSignOut.jsx). Activity in any open tab counts for all
// of them (BroadcastChannel), so working in one tab never signs out another.

// Minutes of inactivity before sign-out, per role. Same numbers as the
// server (middleware/auth.js IDLE_LIMIT_MINUTES), which has the final say.
export const IDLE_LIMIT_MINUTES = { admin: 30, staff: 30, owner: 30, passenger: 60, driver: 120 };
export const idleMessage = (role) => `You were signed out after ${IDLE_LIMIT_MINUTES[role] ?? 30} minutes of inactivity.`;

let last = Date.now();
let lastShared = 0;
const listeners = new Set();
const holds = new Map(); // id -> { evenWhenHidden }

let channel = null;
try {
  channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("drs-activity") : null;
} catch {
  channel = null;
}
if (channel) {
  channel.onmessage = ({ data }) => {
    if (data?.type === "active" && typeof data.at === "number") note(data.at, false);
  };
}

function note(at, share) {
  if (at <= last) return;
  last = at;
  listeners.forEach((fn) => fn(at));
  if (share && channel && at - lastShared > 15000) {
    lastShared = at;
    try {
      channel.postMessage({ type: "active", at });
    } catch {
      // channel closed — other tabs just won't hear about this one
    }
  }
}

export function markActive() {
  note(Date.now(), true);
}
export function lastActivity() {
  return last;
}
export function onActivity(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// A page someone watches without touching (Live Tracking, the payment step,
// a driver's running trip) keeps the session alive while it's open.
// evenWhenHidden: also with the screen off / app in the background (drivers).
export function holdAwake(id, { evenWhenHidden = false } = {}) {
  holds.set(id, { evenWhenHidden });
  return () => holds.delete(id);
}
export function isHeldAwake() {
  const visible = typeof document === "undefined" || document.visibilityState === "visible";
  for (const h of holds.values()) if (h.evenWhenHidden || visible) return true;
  return false;
}
