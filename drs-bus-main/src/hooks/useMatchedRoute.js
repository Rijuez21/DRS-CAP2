import { useEffect, useMemo, useState } from "react";
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
const NO_SEGMENTS = [];
const IDLE = { segments: NO_SEGMENTS, byTrace: [], status: "idle", done: 0, total: 0 };
const LOADING = { segments: NO_SEGMENTS, byTrace: [], status: "loading", done: 0, total: 0 };

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
 * Several traces at once (Owner portal "All buses" playback). Their
 * requests go out one after another, so together they still keep to the
 * demo server's ~1 request/second, and share the same request budget.
 *
 * @param {Array<Array<{latitude, longitude, timestamp}>>|null} traces recorded traces, each oldest first
 * @returns {{ byTrace: Array<Array<Array<[lat, lng]>>>, status, done, total }}
 *   byTrace[i]: road-following pieces of traces[i], in order; status: "idle" |
 *   "loading" | "ok" | "partial" (some pieces couldn't be routed) | "failed"
 *   (router unreachable) | "none" (no bus moved: nothing to route)
 */
export function useMatchedRoutes(traces) {
  const [state, setState] = useState({ for: null, ...IDLE });
  const hasTrace = Boolean(traces?.some((t) => t?.length >= 2));

  useEffect(() => {
    if (!hasTrace) return undefined;
    const controller = new AbortController();
    const { signal } = controller;

    // Requests: each run cut into overlapping 100-waypoint pieces (they share
    // an end point, so consecutive pieces meet), tagged with their trace.
    const runsByTrace = traces.map((t) => (t?.length >= 2 ? waypointRuns(t) : []));
    const totalWaypoints = runsByTrace.flat().reduce((n, r) => n + r.length, 0);
    const budget = PER_REQUEST * MAX_REQUESTS;
    const requests = [];
    runsByTrace.forEach((runs, trace) => {
      for (const run of runs) {
        const wps = totalWaypoints > budget ? thin(run, Math.max(2, Math.floor((run.length * budget) / totalWaypoints))) : run;
        for (let i = 0; i < wps.length - 1; i += PER_REQUEST - 1) requests.push({ trace, waypoints: wps.slice(i, i + PER_REQUEST) });
      }
    });
    const gapped = runsByTrace.some((runs) => runs.length > 1);

    (async () => {
      if (requests.length === 0) {
        // Parked the whole time (no two fixes 150 m apart): nothing to route.
        await Promise.resolve();
        if (!signal.aborted) setState({ for: traces, segments: NO_SEGMENTS, byTrace: traces.map(() => []), status: "none", done: 0, total: 0 });
        return;
      }
      const byTrace = traces.map(() => []);
      const snapshot = () => byTrace.map((segs) => [...segs]);
      let unrouted = 0;
      for (let i = 0; i < requests.length; i += 1) {
        if (i > 0) await wait(REQUEST_SPACING_MS, signal);
        if (signal.aborted) return;
        try {
          const path = await routeThrough(requests[i].waypoints, signal);
          if (path) byTrace[requests[i].trace].push(path);
          else unrouted += 1;
        } catch (err) {
          if (signal.aborted) return;
          // Router down or rate-limited: stop asking; what's routed so far stays.
          const routed = byTrace.some((segs) => segs.length);
          setState({ for: traces, segments: NO_SEGMENTS, byTrace: snapshot(), status: routed ? "partial" : "failed", done: i, total: requests.length, error: err.message });
          return;
        }
        if (signal.aborted) return;
        setState({ for: traces, segments: NO_SEGMENTS, byTrace: snapshot(), status: "loading", done: i + 1, total: requests.length });
      }
      setState({ for: traces, segments: NO_SEGMENTS, byTrace, status: unrouted || gapped ? "partial" : "ok", done: requests.length, total: requests.length });
    })();

    return () => controller.abort();
  }, [traces, hasTrace]);

  // Results belong to the traces they were computed for; new traces start clean.
  if (!hasTrace) return IDLE;
  if (state.for !== traces) return LOADING;
  return state;
}

/**
 * One trace (single-bus playback).
 * @param {Array<{latitude, longitude, timestamp}>|null} points recorded trace, oldest first
 * @returns {{ segments: Array<Array<[lat, lng]>>, status, done, total }}
 *   segments: road-following pieces; status as for useMatchedRoutes
 *   ("none" = the bus barely moved)
 */
export function useMatchedRoute(points) {
  const traces = useMemo(() => (points ? [points] : null), [points]);
  const result = useMatchedRoutes(traces);
  const segments = result.byTrace[0] ?? NO_SEGMENTS;
  return useMemo(() => ({ ...result, segments }), [result, segments]);
}
