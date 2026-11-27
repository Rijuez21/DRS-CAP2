import { useEffect, useState } from "react";
import * as api from "../lib/api";
import { getSocket } from "../lib/socket";

/**
 * The bus's latest position (tracker or phone), kept live: the last saved
 * point first, then every "location:update" pushed to the bus's room.
 * Used by the conductor's pickup map to show where the bus is relative to
 * the passengers who flagged it.
 *
 * @param {number|null} busId
 * @returns {{ latitude, longitude, timestamp, source } | null}
 */
export function useBusPosition(busId) {
  const [position, setPosition] = useState(null);

  useEffect(() => {
    if (!busId) return undefined;
    let cancelled = false;
    const keepNewest = (point) =>
      setPosition((prev) =>
        prev && new Date(point.timestamp) < new Date(prev.timestamp)
          ? prev
          : { latitude: Number(point.latitude), longitude: Number(point.longitude), timestamp: point.timestamp, source: point.source }
      );

    api
      .getLatestLocation(busId)
      .then((point) => {
        if (!cancelled && point?.latitude != null) keepNewest(point);
      })
      .catch(() => {});

    const socket = getSocket();
    // Joining is idempotent. Deliberately no "unsubscribe:bus" on cleanup:
    // the dashboard's useBusTracker shares this socket room and leaves it
    // itself when the trip changes.
    const join = () => socket.emit("subscribe:bus", busId);
    join();
    function handleUpdate(point) {
      if (Number(point.busId) === Number(busId) && point.latitude != null) keepNewest(point);
    }
    socket.on("location:update", handleUpdate);
    socket.on("connect", join);
    return () => {
      cancelled = true;
      setPosition(null);
      socket.off("location:update", handleUpdate);
      socket.off("connect", join);
    };
  }, [busId]);

  return position;
}
