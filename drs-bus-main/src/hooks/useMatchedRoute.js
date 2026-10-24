import { useEffect, useState } from "react";
import { distanceKm } from "../lib/geo";

// Turns a recorded GPS trace into the roads it was driven on, so Playback
// draws the actual road instead of straight lines between fixes that are
// 10 s – 10 min apart. Uses OSRM, the same free OpenStreetMap router as
// useRoadRoute (public demo server: rate-limited, no uptime promise — fine
// for a capstone, run your own OSRM for real use).
//
// Not OSRM's "match" service: the demo server only accepts ~10 points per
// match request, far too few for a day of driving. Instead the trace is
// thinned to fixes >= 150 m apart (so GPS jitter doesn't cause little
// detours) and routed through them in order, up to 100 per request.
const OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving";
const MIN_SPACING_KM = 0.15;
const PER_REQUEST = 100; // waypoints the demo server accepts per request
const MAX_REQUESTS = 20; // ~2,000 waypoints ≈ 300 km; longer traces are thinned more
const GAP_MS = 20 * 60 * 1000; // silent this long: unknown road taken, don't invent one
const REQUEST_SPACING_MS = 1100; // the demo server asks for at most ~1 request/second

// Stable objects, so a component's effects on `segments` don't re-run every render.
const IDLE = { segments: [], status: "idle", done: 0, total: 0 };
const LOADING = { segments: [], status: "loading", done: 0, total: 0 };

// Split at long silences, then keep fixes at least MIN_SPACING_KM apart.
function waypointRuns(points) {
  const runs = [];
  let run = [];
  for (const p of points) {
    const prev = run[run.length - 1];
    if (prev && new Date(p.timestamp) - new Date(prev.timestamp) > GAP_MS) {
      runs.push(run);
      run = [];
    }
    if (!run.length || distanceKm(run[run.length - 1], p) >= MIN_SPACING_KM) run.push(p);
  }
  runs.push(run);
  return runs.filter((r) => r.length >= 2);
}

function thin(points, max) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

async function routeThrough(waypoints, signal) {
  const coords = waypoints.map((p) => `${p.longitude},${p.latitude}`).join(";");
  const res = await fetch(`${OSRM_ROUTE_URL}/${coords}?overview=full&geometries=geojson`, { signal });
  if (!res.ok) throw new Error(`Road routing failed (${res.status})`);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.[0]) return null;
  return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
}

const wait = (ms, signal) =>
  new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => clearTimeout(id), { once: true });
  });

/**
 * @param {Array<{latitude, longitude, timestamp}>|null} points recorded trace, oldest first
 * @returns {{ segments: Array<Array<[lat, lng]>>, status, done, total }}
 *   segments: road-following pieces; status: "idle" | "loading" | "ok" |
 *   "partial" (some pieces couldn't be routed) | "failed" (router unreachable) |
 *   "none" (the bus barely moved: nothing to route)
 */
export function useMatchedRoute(points) {
  const [state, setState] = useState({ for: null, ...IDLE });

  useEffect(() => {
    if (!points || points.length < 2) return undefined;
    const controller = new AbortController();
    const { signal } = controller;

    // Requests: each run cut into overlapping 100-waypoint pieces (they share
    // an end point, so consecutive pieces meet).
    const runs = waypointRuns(points);
    const totalWaypoints = runs.reduce((n, r) => n + r.length, 0);
    const budget = PER_REQUEST * MAX_REQUESTS;
    const requests = [];
    for (const run of runs) {
      const wps = totalWaypoints > budget ? thin(run, Math.max(2, Math.floor((run.length * budget) / totalWaypoints))) : run;
      for (let i = 0; i < wps.length - 1; i += PER_REQUEST - 1) requests.push(wps.slice(i, i + PER_REQUEST));
    }

    (async () => {
      if (requests.length === 0) {
        // Parked the whole time (no two fixes 150 m apart): nothing to route.
        await Promise.resolve();
        if (!signal.aborted) setState({ for: points, segments: [], status: "none", done: 0, total: 0 });
        return;
      }
      const segments = [];
      let unrouted = 0;
      for (let i = 0; i < requests.length; i += 1) {
        if (i > 0) await wait(REQUEST_SPACING_MS, signal);
        if (signal.aborted) return;
        try {
          const path = await routeThrough(requests[i], signal);
          if (path) segments.push(path);
          else unrouted += 1;
        } catch (err) {
          if (signal.aborted) return;
          // Router down or rate-limited: stop asking; what's routed so far stays.
          setState({ for: points, segments, status: segments.length ? "partial" : "failed", done: i, total: requests.length, error: err.message });
          return;
        }
        if (signal.aborted) return;
        setState({ for: points, segments: [...segments], status: "loading", done: i + 1, total: requests.length });
      }
      setState({ for: points, segments, status: unrouted || runs.length > 1 ? "partial" : "ok", done: requests.length, total: requests.length });
    })();

    return () => controller.abort();
  }, [points]);

  // Results belong to the trace they were computed for; a new trace starts clean.
  if (!points || points.length < 2) return IDLE;
  if (state.for !== points) return LOADING;
  return state;
}
