import { useEffect, useState } from "react";
import * as api from "../lib/api";
import { getSocket } from "../lib/socket";

// Must match DEVICE_ACTIVE_SECONDS in server/src/services/locationService.js:
// for this long after the bus's GPS tracker last reported, the server
// ignores the driver's phone.
const TRACKER_ONLINE_MS = 90 * 1000;

/**
 * Is this bus's own GPS tracker (SinoTrack, forwarded by Traccar) reporting?
 * Reads the bus's latest point, then follows its live updates.
 *
 * @param {number|null} busId
 * @returns {{ online: boolean, lastFix: string|null }} lastFix = timestamp of
 *   the tracker's newest point seen here
 */
export function useBusTracker(busId) {
  const [lastFix, setLastFix] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!busId) return undefined;
    let cancelled = false;
    api
      .getLatestLocation(busId)
      .then((point) => {
        if (!cancelled && point?.source === "device") setLastFix(point.timestamp);
      })
      .catch(() => {});

    const socket = getSocket();
    const join = () => socket.emit("subscribe:bus", busId);
    join();
    function handleUpdate(point) {
      if (Number(point.busId) === Number(busId) && point.source === "device") setLastFix(point.timestamp);
    }
    socket.on("location:update", handleUpdate);
    socket.on("connect", join);
    return () => {
      cancelled = true;
      setLastFix(null);
      socket.emit("unsubscribe:bus", busId);
      socket.off("location:update", handleUpdate);
      socket.off("connect", join);
    };
  }, [busId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  const online = Boolean(busId && lastFix && now - new Date(lastFix).getTime() < TRACKER_ONLINE_MS);
  return { online, lastFix };
}
