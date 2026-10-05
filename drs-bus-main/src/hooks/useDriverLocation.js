import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../lib/api";

// Phase 3.4 — offline GPS buffering, a named Reliability requirement, not
// polish: location_tracking.sync_status exists specifically for this.
// Strategy: watchPosition -> POST each point immediately. If the POST
// fails (offline, or the request itself throws), the point goes into an
// IndexedDB queue instead of being dropped. On "online" (and on a 30s
// safety-net interval, in case the browser's online event doesn't fire
// reliably) the whole queue flushes via POST /api/tracking/batch, tagged
// syncStatus: "buffered" so it renders distinctly on the map — both
// FleetTracking.jsx and LiveTracking.jsx already key off that flag.

const DB_NAME = "drs-driver-location-queue";
const STORE_NAME = "points";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queuePoint(point) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).add(point);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}


async function readQueue() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

// Deletes exactly the points that were uploaded. The old version cleared
// the whole store after uploading, so any point queued *during* the upload
// (still offline in a dead zone) was silently lost.
async function removeFromQueue(ids) {
  if (ids.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    ids.forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * @param {number|null} busId - the bus on the driver's Boarding / In Transit
 *   trip. Pass null to stop sharing (no active trip).
 * @returns {{ status, queuedCount, retry }} status is one of
 *   idle | locating | sharing | denied | unavailable | unsupported — shown on
 *   the driver dashboard. Before, a blocked permission failed silently:
 *   passengers saw no bus and the driver never knew why.
 */
export function useDriverLocation(busId) {
  const supported = typeof navigator !== "undefined" && "geolocation" in navigator;
  // Last result reported by the browser for the current watch; null = no
  // answer yet. Derived into the public status below rather than reset
  // inside the effect.
  const [lastResult, setLastResult] = useState(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [attempt, setAttempt] = useState(0); // bump to retry after the driver fixes permission
  const watchIdRef = useRef(null);

  const flush = useCallback(async () => {
    try {
      const points = await readQueue();
      if (points.length === 0) return;
      // eslint-disable-next-line no-unused-vars -- `id` is the IndexedDB key, not part of the API payload
      await api.postLocationBatch(points.map(({ id, ...p }) => ({ ...p, syncStatus: "buffered" })));
      await removeFromQueue(points.map((p) => p.id));
      setQueuedCount((n) => Math.max(0, n - points.length));
    } catch {
      // Still offline (or server unreachable) — keep the queue for the next try.
    }
  }, []);

  useEffect(() => {
    if (!busId || !supported) return undefined;
    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        setLastResult({ key: `${busId}:${attempt}`, value: "sharing" });
        const point = {
          busId,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          timestamp: new Date().toISOString(),
        };
        try {
          await api.postLocation({ ...point, syncStatus: "synced" });
        } catch (err) {
          // Only network trouble is worth buffering; a 4xx (e.g. the trip is
          // no longer yours) would just be rejected again later.
          if (err.status && err.status < 500) return;
          await queuePoint(point);
          setQueuedCount((n) => n + 1);
        }
      },
      (err) =>
        setLastResult({ key: `${busId}:${attempt}`, value: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable" }),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    window.addEventListener("online", flush);
    const retryInterval = setInterval(flush, 30000); // safety net if the online event doesn't fire
    const firstFlush = setTimeout(flush, 0); // pick up anything queued from a previous session
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      window.removeEventListener("online", flush);
      clearInterval(retryInterval);
      clearTimeout(firstFlush);
    };
  }, [busId, supported, flush, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  let status;
  if (!supported) status = "unsupported";
  else if (!busId) status = "idle";
  else if (lastResult?.key === `${busId}:${attempt}`) status = lastResult.value;
  else status = "locating"; // waiting for the browser prompt / first fix

  return { status, queuedCount, retry };
}
