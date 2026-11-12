import { useEffect, useState } from "react";
import ConfirmDialog from "../common/ConfirmDialog";
import { useAuth } from "../../context/AuthContext";
import { checkSession } from "../../lib/api";
import { IDLE_LIMIT_MINUTES, markActive, lastActivity, onActivity, isHeldAwake } from "../../lib/idle";

const WARN_SECONDS = 60; // "Still there?" shows this long before sign-out
const HEARTBEAT_MS = 4 * 60 * 1000; // tell the server we're here at most this often
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll", "mousemove"];

// Signs the user out after IDLE_LIMIT_MINUTES (per role) without using the
// app: no tap, click, key, scroll or mouse movement in any open tab. A
// minute before, it asks "Still there?". The server enforces the same limit
// (middleware/auth.js) for tabs that were simply closed; the heartbeat below
// keeps it from expiring a session someone is actively using on pages that
// make no signed-in requests of their own.
export default function IdleSignOut() {
  const { user, signOutForInactivity } = useAuth();
  const role = user?.role ?? null;
  const [secondsLeft, setSecondsLeft] = useState(null); // null = no warning showing

  // Count real use of the page as activity.
  useEffect(() => {
    if (!role) return undefined;
    let lastMark = 0;
    const handler = () => {
      const now = Date.now();
      if (now - lastMark < 5000) return; // plenty precise; keeps mousemove cheap
      lastMark = now;
      markActive();
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, handler, { passive: true, capture: true }));
    markActive(); // signing in / opening the app counts
    return () => ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, handler, { capture: true }));
  }, [role]);

  // Heartbeat: activity keeps the server-side session fresh too.
  useEffect(() => {
    if (!role) return undefined;
    let lastBeat = Date.now();
    return onActivity((at) => {
      if (at - lastBeat < HEARTBEAT_MS) return;
      lastBeat = at;
      checkSession().catch(() => {}); // a 401 here signs out with the server's reason
    });
  }, [role]);

  // The clock: warn, then sign out.
  useEffect(() => {
    if (!role) return undefined;
    const limitMs = (IDLE_LIMIT_MINUTES[role] ?? 30) * 60 * 1000;
    let askingServer = false;
    const tick = () => {
      if (isHeldAwake()) markActive(); // someone's watching their bus / payment / trip
      const left = Math.ceil((limitMs - (Date.now() - lastActivity())) / 1000);
      if (left <= 0) {
        setSecondsLeft(null);
        if (role === "driver") {
          // A driver on a trip is never signed out, whatever page they're on —
          // the server knows whether they are (204 = still signed in). If not,
          // its 401 signs them out with the inactivity reason.
          if (askingServer) return;
          askingServer = true;
          checkSession()
            .then(() => markActive())
            .catch(() => {})
            .finally(() => {
              askingServer = false;
            });
          return;
        }
        signOutForInactivity();
      } else {
        setSecondsLeft(left <= WARN_SECONDS ? left : null);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [role, signOutForInactivity]);

  if (!role || secondsLeft == null) return null; // signed out: never a stale warning
  return (
    <ConfirmDialog
      title="Still there?"
      confirmLabel="Sign out"
      cancelLabel="Stay signed in"
      onConfirm={signOutForInactivity}
      onCancel={() => {
        markActive();
        setSecondsLeft(null);
      }}
    >
      <p>
        For your security, you'll be signed out in <strong>{secondsLeft} second{secondsLeft === 1 ? "" : "s"}</strong> because you haven&apos;t
        used the app for a while.
      </p>
    </ConfirmDialog>
  );
}
