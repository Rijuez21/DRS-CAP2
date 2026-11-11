// Where a bus was at any moment of a playback, moved along the roads it
// drove (the road-matched path from useMatchedRoutes) instead of jumping in
// straight lines from one recorded fix to the next.
//
// Each recorded point is pinned to its nearest vertex on the road path,
// searching forward only, so a bus that drives the same road twice in a day
// isn't pinned to the wrong pass. Between two fixes the bus travels that
// stretch of road at an even pace. Wherever there's no road path (still
// routing, or the router couldn't place it), it falls back to a straight
// line between the fixes.

const SNAP_M = 300; // a fix farther than this from the road path isn't on it
const GOOD_M = 50; // close enough: stop searching once the path moves away again
const SEARCH_VERTICES = 3000;
const HOLD_GAP_MS = 20 * 60 * 1000; // silent this long: stay put, don't crawl across the gap (matches useMatchedRoute)
const M_PER_DEG = 111320;

// Index of the last time at or before t (-1 = before the first).
export function indexAt(times, t) {
  let lo = 0;
  let hi = times.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

// Squared metres between [lat, lng] and a point; fine at bus-route scale.
function dist2(v, p, cosLat) {
  const dy = (v[0] - p.latitude) * M_PER_DEG;
  const dx = (v[1] - p.longitude) * M_PER_DEG * cosLat;
  return dx * dx + dy * dy;
}

/**
 * @param points recorded fixes, oldest first
 * @param segments road-following pieces for those fixes, in order (may be empty)
 * @returns {{ path, cum, at } | null} path vertices, cumulative metres along
 *   them, and per fix its vertex index (-1 = not on the path); null = no path
 */
export function buildRoadTrack(points, segments) {
  const path = segments.flat();
  if (path.length < 2 || points.length === 0) return null;
  const cosLat = Math.cos((points[0].latitude * Math.PI) / 180);

  const cum = new Float64Array(path.length);
  for (let j = 1; j < path.length; j += 1) {
    cum[j] = cum[j - 1] + Math.sqrt(dist2(path[j], { latitude: path[j - 1][0], longitude: path[j - 1][1] }, cosLat));
  }

  const at = new Int32Array(points.length).fill(-1);
  let from = 0;
  for (let i = 0; i < points.length; i += 1) {
    let best = -1;
    let bestD = Infinity;
    const stop = Math.min(path.length, from + SEARCH_VERTICES);
    for (let j = from; j < stop; j += 1) {
      const d = dist2(path[j], points[i], cosLat);
      if (d < bestD) {
        bestD = d;
        best = j;
      } else if (bestD < GOOD_M * GOOD_M && d > 4 * bestD + GOOD_M * GOOD_M) break; // found it and moved past
    }
    if (bestD <= SNAP_M * SNAP_M) {
      at[i] = best;
      from = best;
    }
  }
  return { path, cum, at };
}

function courseBetween(a, b) {
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
}

/**
 * @returns {{ latLng: [lat, lng], course: number }} the bus at time t
 *   (clamped to its first / last fix)
 */
export function positionAt(points, times, track, t) {
  const n = points.length;
  const i = Math.min(Math.max(indexAt(times, t), 0), n - 1);
  const p = points[i];
  const q = points[Math.min(i + 1, n - 1)];
  const raw = (frac) => [p.latitude + (q.latitude - p.latitude) * frac, p.longitude + (q.longitude - p.longitude) * frac];
  const span = times[Math.min(i + 1, n - 1)] - times[i];
  const frac = t <= times[i] || span <= 0 || span > HOLD_GAP_MS ? 0 : Math.min(1, (t - times[i]) / span);

  const a = track?.at[i] ?? -1;
  const b = track?.at[Math.min(i + 1, n - 1)] ?? -1;
  if (a < 0 || b < a) {
    return { latLng: raw(frac), course: courseBetween([p.latitude, p.longitude], [q.latitude, q.longitude]) };
  }

  // Walk the road from vertex a toward b, frac of the way by distance.
  const { path, cum } = track;
  const target = cum[a] + (cum[b] - cum[a]) * frac;
  let lo = a;
  let hi = b;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= target) lo = mid;
    else hi = mid;
  }
  const v0 = path[lo];
  const v1 = path[Math.min(lo + 1, path.length - 1)];
  const len = cum[Math.min(lo + 1, path.length - 1)] - cum[lo];
  const k = len > 0 ? Math.min(1, (target - cum[lo]) / len) : 0;
  // At the path's last vertex there's no next one: face the way it came in.
  const course = len > 0 ? courseBetween(v0, v1) : courseBetween(path[Math.max(lo - 1, 0)], v0);
  return { latLng: [v0[0] + (v1[0] - v0[0]) * k, v0[1] + (v1[1] - v0[1]) * k], course };
}
