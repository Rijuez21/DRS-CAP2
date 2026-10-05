import { useCallback, useEffect, useRef, useState } from "react";

// The one place the app asks for the user's real position (FlagBus pickup
// point, LiveTracking "show me", LocationPermissionCard). Rules the brief
// set for every location feature:
//   - never assume or fake a position; only a real browser fix is used
//   - ask through the normal browser prompt, but only after the user taps a
//     clear button (or silently if they already granted it earlier) — a
//     permission prompt on page load, with no context, is usually refused
//   - denied / unavailable / unsupported are distinct states with their own
//     message and a retry, never a silent failure
//
// status: "idle"        not asked yet (show the explanation + button)
//         "locating"    prompt showing, or waiting for the first fix
//         "ok"          position is live
//         "denied"      the user (or site settings) blocked location
//         "unavailable" allowed, but no fix (GPS off, indoors, timed out)
//         "unsupported" this browser has no geolocation at all
//         "insecure"    page opened over plain http:// (e.g. a phone on
//                       http://192.168.x.x:5173) — browsers refuse
//                       location there without asking, which used to show
//                       up as "denied" even though nothing was blocked
export function useGeolocation({ highAccuracy = true } = {}) {
  const insecure = typeof window !== "undefined" && window.isSecureContext === false;
  const supported = !insecure && typeof navigator !== "undefined" && "geolocation" in navigator;
  const [status, setStatus] = useState(insecure ? "insecure" : supported ? "idle" : "unsupported");
  const [position, setPosition] = useState(null); // { latitude, longitude, accuracy, timestamp }
  const watchIdRef = useRef(null);

  const stop = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const request = useCallback(() => {
    if (!supported) return;
    stop();
    setStatus("locating");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        });
        setStatus("ok");
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          stop();
          setStatus("denied");
        } else {
          // Keep watching: a timeout or lost signal often recovers on its own.
          setStatus((prev) => (prev === "ok" ? "ok" : "unavailable"));
        }
      },
      { enableHighAccuracy: highAccuracy, maximumAge: 10000, timeout: 20000 }
    );
  }, [supported, highAccuracy, stop]);

  // If permission was already granted on an earlier visit, start without
  // making the user tap again. Browsers without the Permissions API just
  // stay "idle" until the button is tapped.
  useEffect(() => {
    if (!supported || !navigator.permissions?.query) return undefined;
    let permission;
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((p) => {
        if (cancelled) return;
        permission = p;
        if (p.state === "granted") request();
        else if (p.state === "denied") setStatus("denied");
        // Re-enabling in browser settings takes effect without a reload.
        p.onchange = () => {
          if (p.state === "granted") request();
          else if (p.state === "denied") {
            stop();
            setStatus("denied");
          }
        };
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (permission) permission.onchange = null;
    };
  }, [supported, request, stop]);

  useEffect(() => stop, [stop]);

  return { status, position, request, stop };
}
