// Straight-line ("as the crow flies") distance between two GPS points, in
// km — the haversine formula. Used by the Flag a Bus page to show how far
// each in-transit bus is from the passenger. Mountain roads in the
// Cordillera wind far more than this, so it's shown as a rough "how close
// is it" signal, never as a road distance or an ETA.
const EARTH_RADIUS_KM = 6371;

export function distanceKm(a, b) {
  if (!a || !b || a.latitude == null || b.latitude == null) return null;
  const toRad = (deg) => (Number(deg) * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function formatDistance(km) {
  if (km == null) return null;
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

// Same idea as FleetTracking.jsx's local timeAgo(), shared here so the
// passenger and driver Flag views don't each carry a copy.
export function timeAgo(isoString) {
  if (!isoString) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(isoString).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}
