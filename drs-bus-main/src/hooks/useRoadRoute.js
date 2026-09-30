import { useEffect, useRef, useState } from "react";
import { distanceKm } from "../lib/geo";

// Road path + travel time between two points (the bus and the passenger's
// pickup pin), from OSRM — the free, open-source router that runs on
// OpenStreetMap data, the same map the app already shows. No API key.
//
// router.project-osrm.org is OSRM's public demo server: fine for a
// capstone/demo, but it's rate-limited and has no uptime promise. For real
// deployment, point OSRM_URL at your own OSRM instance (or another router
// that returns the same shape).
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";

// Don't ask the router on every GPS tick: only after the bus has really
// moved, or the pin changed, and never more often than every 15 s.
const REFETCH_BUS_MOVED_KM = 0.1; // 100 m
const REFETCH_PIN_MOVED_KM = 0.01; // 10 m — a moved pin is re-routed right away
const MIN_REFETCH_MS = 15000;

async function fetchRoadRoute(from, to, signal) {
  const url = `${OSRM_URL}/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Routing failed (${res.status})`);
  const data = await res.json();
  const best = data.routes?.[0];
  if (data.code !== "Ok" || !best) throw new Error("No road route found");
  return {
    path: best.geometry.coordinates.map(([lng, lat]) => [lat, lng]), // GeoJSON is [lng, lat]; Leaflet wants [lat, lng]
    distanceKm: best.distance / 1000,
    durationMin: best.duration / 60, // car speed — see etaRange() for the bus adjustment
    isFallback: false,
  };
}

// Router unreachable (offline, rate-limited): still connect bus and pin,
// drawn dashed so it's clearly not a road, and with no time estimate.
function straightLine(from, to) {
  return {
    path: [
      [from.latitude, from.longitude],
      [to.latitude, to.longitude],
    ],
    distanceKm: distanceKm(from, to),
    durationMin: null,
    isFallback: true,
  };
}

// OSRM times are for a car. A bus on mountain roads is slower and stops for
// other passengers, so show a range (like delivery apps do), not one number.
export function etaRange(route) {
  if (!route || route.durationMin == null) return null;
  if (route.distanceKm < 0.1) return { arriving: true };
  const low = Math.max(1, Math.round(route.durationMin * 1.15));
  const high = Math.max(low + 2, Math.round(route.durationMin * 1.5));
  return { low, high };
}

// from / to: { latitude, longitude } or null. routeKey identifies what is
// being routed (e.g. the trip id): when it changes — the passenger picked
// another bus — the old path is cleared and a new one fetched at once.
// Returns
// { route: { path, distanceKm, durationMin, isFallback } | null, status }
// status: "idle" (nothing to route) | "loading" | "ok" | "fallback"
export function useRoadRoute(from, to, routeKey = null) {
  const [state, setState] = useState({ key: null, route: null, status: "loading" });
  const lastRef = useRef({ key: null, from: null, to: null, at: 0 });
  const requestIdRef = useRef(0);

  const fLat = from?.latitude ?? null;
  const fLng = from?.longitude ?? null;
  const tLat = to?.latitude ?? null;
  const tLng = to?.longitude ?? null;
  const enabled = fLat != null && fLng != null && tLat != null && tLng != null;

  useEffect(() => {
    if (!enabled) {
      lastRef.current = { key: null, from: null, to: null, at: 0 };
      requestIdRef.current += 1; // ignore any answer still on its way
      return undefined;
    }
    const f = { latitude: Number(fLat), longitude: Number(fLng) };
    const t = { latitude: Number(tLat), longitude: Number(tLng) };
    const last = lastRef.current;
    const isNew = !last.to || last.key !== routeKey;
    const pinMoved = !last.to || distanceKm(last.to, t) > REFETCH_PIN_MOVED_KM;
    const busMoved = !last.from || distanceKm(last.from, f) > REFETCH_BUS_MOVED_KM;
    if (!isNew && !pinMoved && !busMoved) return undefined;

    const wait = isNew || pinMoved ? 0 : Math.max(0, MIN_REFETCH_MS - (Date.now() - last.at));
    const timer = setTimeout(() => {
      lastRef.current = { key: routeKey, from: f, to: t, at: Date.now() };
      const requestId = ++requestIdRef.current;
      if (isNew) setState({ key: routeKey, route: null, status: "loading" });
      else if (pinMoved) setState((s) => ({ ...s, status: "loading" }));
      fetchRoadRoute(f, t)
        .then((route) => {
          if (requestId === requestIdRef.current) setState({ key: routeKey, route, status: "ok" });
        })
        .catch(() => {
          if (requestId === requestIdRef.current) setState({ key: routeKey, route: straightLine(f, t), status: "fallback" });
        });
    }, wait);
    // Only the not-yet-sent timer is cancelled when the bus moves again; a
    // request already in flight finishes, and requestIdRef drops stale ones.
    return () => clearTimeout(timer);
  }, [enabled, fLat, fLng, tLat, tLng, routeKey]);

  if (!enabled) return { route: null, status: "idle" };
  // Never hand back the previous bus's path while the new one loads.
  if (state.key !== routeKey) return { route: null, status: "loading" };
  return { route: state.route, status: state.status };
}