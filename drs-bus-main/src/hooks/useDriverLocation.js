import { useEffect, useRef, useState } from "react";
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

async function drainQueue() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const points = [];
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        points.push(cursor.value);
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve(points);
    tx.onerror = () => reject(tx.error);
    // Clear happens only after a successful flush (caller's responsibility)
  });
}

async function clearQueue() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * @param {number|null} busId - the bus this driver is currently assigned to.
 *   Pass null/undefined to disable tracking (e.g. no active trip).
 */
export function useDriverLocation(busId) {
  const [status, setStatus] = useState("idle"); // idle | tracking | error
  const [queuedCount, setQueuedCount] = useState(0);
  const watchIdRef = useRef(null);

  async function flush() {
    try {
      const points = await drainQueue();
      if (points.length === 0) return;
      await api.postLocationBatch(points.map((p) => ({ ...p, syncStatus: "buffered" })));
      await clearQueue();
      setQueuedCount(0);
    } catch {
      // still offline or the batch call failed — leave the queue intact, try again later
    }
  }

  useEffect(() => {
    if (!busId || !("geolocation" in navigator)) return;

    setStatus("tracking");

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const point = {
          busId,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          timestamp: new Date().toISOString(),
        };
        try {
          await api.postLocation({ ...point, syncStatus: "synced" });
        } catch {
          await queuePoint(point);
          setQueuedCount((n) => n + 1);
        }
      },
      () => setStatus("error"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    window.addEventListener("online", flush);
    const retryInterval = setInterval(flush, 30000); // safety net if the online event doesn't fire
    flush(); // pick up anything queued from a previous session

    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      window.removeEventListener("online", flush);
      clearInterval(retryInterval);
    };
  }, [busId]);

  return { status, queuedCount };
}
