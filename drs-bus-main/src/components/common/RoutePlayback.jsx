import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import L from "leaflet";
import { useLeafletMap } from "../../hooks/useLeafletMap";
import { useMatchedRoute } from "../../hooks/useMatchedRoute";
import { arrowIcon } from "../../lib/arrowIcon";

const toLocalInput = (date) => {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

function distanceKm(points) {
  let km = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [a, b] = [points[i - 1], points[i]];
    const rad = Math.PI / 180;
    const dLat = (b.latitude - a.latitude) * rad;
    const dLon = (b.longitude - a.longitude) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
    km += 2 * 6371 * Math.asin(Math.sqrt(h));
  }
  return km;
}

// Route playback: load the positions saved for one bus over a time range,
// draw the path (snapped to the roads) and replay it with a moving arrow.
// loadHistory({ busId, from, to }) resolves to { points, truncated } —
// api.getGpsHistory for admin, api.getMyBusHistory for a bus owner.
export default function RoutePlayback({ bus, loadHistory, noBusMessage = "Pick a bus first." }) {
  const [containerRef, map] = useLeafletMap();
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return toLocalInput(d);
  });
  const [to, setTo] = useState(() => toLocalInput(new Date()));
  const [points, setPoints] = useState(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const lineRef = useRef(null);
  const matchedRef = useRef(null);
  const markerRef = useRef(null);
  const matched = useMatchedRoute(points);

  async function load(e) {
    e?.preventDefault();
    if (!bus) return;
    setError("");
    setLoading(true);
    setPlaying(false);
    try {
      const res = await loadHistory({ busId: bus.busId, from: new Date(from).toISOString(), to: new Date(to).toISOString() });
      setPoints(res.points);
      setIndex(0);
      if (res.truncated) setError("Showing the first 20,000 points — pick a shorter range for the rest.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Draw the whole route once per load.
  useEffect(() => {
    if (!map) return;
    lineRef.current?.remove(); // layer group: route line + start/end dots
    markerRef.current?.remove();
    lineRef.current = null;
    markerRef.current = null;
    if (!points?.length) return;
    const latLngs = points.map((p) => [p.latitude, p.longitude]);
    // The raw recorded trace: faint and dashed, under the road-matched route
    // drawn below, so any stretch that couldn't be matched still shows.
    const line = L.polyline(latLngs, { color: "#64748b", weight: 2, opacity: 0.6, dashArray: "6 6" });
    lineRef.current = L.layerGroup([
      line,
      L.circleMarker(latLngs[0], { radius: 6, color: "#16a34a", fillOpacity: 1 }).bindTooltip("Start"),
      L.circleMarker(latLngs[latLngs.length - 1], { radius: 6, color: "#dc2626", fillOpacity: 1 }).bindTooltip("End"),
    ]).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [30, 30] });
  }, [map, points]);

  // The route snapped to the roads, filled in as each piece comes back.
  useEffect(() => {
    if (!map) return;
    matchedRef.current?.remove();
    matchedRef.current = null;
    if (!matched.segments.length) return;
    matchedRef.current = L.layerGroup(
      matched.segments.map((path) => L.polyline(path, { color: "#2563eb", weight: 5, opacity: 0.8 }))
    ).addTo(map);
  }, [map, matched.segments]);

  // Move the playback marker.
  useEffect(() => {
    if (!map || !points?.length) return;
    const p = points[Math.min(index, points.length - 1)];
    const next = points[Math.min(index + 1, points.length - 1)];
    const course = (Math.atan2(next.longitude - p.longitude, next.latitude - p.latitude) * 180) / Math.PI;
    if (!markerRef.current) markerRef.current = L.marker([p.latitude, p.longitude], { icon: arrowIcon(course, "#1d4ed8") }).addTo(map);
    else {
      markerRef.current.setLatLng([p.latitude, p.longitude]);
      markerRef.current.setIcon(arrowIcon(course, "#1d4ed8"));
    }
  }, [map, points, index]);

  useEffect(() => {
    if (!playing || !points?.length) return undefined;
    const id = setInterval(() => {
      setIndex((i) => {
        if (i >= points.length - 1) {
          setPlaying(false);
          return i;
        }
        return Math.min(points.length - 1, i + speed);
      });
    }, 200);
    return () => clearInterval(id);
  }, [playing, points, speed]);

  const summary = useMemo(() => (points?.length ? { km: distanceKm(points) } : null), [points]);
  const current = points?.[index];

  if (!bus) {
    return <p className="text-sm text-gray-500 p-3">{noBusMessage}</p>;
  }

  return (
    <div className="space-y-3">
      <form onSubmit={load} className="flex flex-wrap items-end gap-2 text-sm">
        <label className="space-y-1">
          <span className="block text-xs text-gray-500">From</span>
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="input" />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-gray-500">To</span>
          <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="input" />
        </label>
        <button type="submit" disabled={loading} className="px-3 py-2 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-semibold disabled:opacity-50">
          {loading ? "Loading…" : "Load route"}
        </button>
        {summary && (
          <p className="text-gray-600 ml-auto">
            {points.length} points · {summary.km.toFixed(1)} km
          </p>
        )}
      </form>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {points?.length > 1 && matched.status !== "idle" && (
        <p className={`text-xs ${matched.status === "failed" || matched.status === "partial" ? "text-amber-700" : "text-gray-500"}`}>
          {matched.status === "loading"
            ? `Snapping the route to the roads… ${matched.total ? `${matched.done}/${matched.total}` : ""}`
            : matched.status === "none"
              ? "The bus barely moved in this time range, so there's no road route to draw."
              : matched.status === "ok"
              ? "Blue line follows the roads. Dashed line = the raw recorded positions."
              : matched.status === "partial"
                ? "Some stretches couldn't be matched to a road (e.g. long signal gaps); they show only as the dashed line."
                : "The road-matching service couldn't be reached, so only the raw recorded positions (dashed) are shown."}
        </p>
      )}
      {points && points.length === 0 && <p className="text-sm text-gray-500">No positions saved for {bus.plateNum} in this time range.</p>}
      {points?.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => {
              if (index >= points.length - 1) setIndex(0);
              setPlaying((p) => !p);
            }}
            className="flex items-center gap-1 px-3 py-1.5 rounded border font-semibold"
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />} {playing ? "Pause" : "Play"}
          </button>
          <input
            type="range"
            min={0}
            max={points.length - 1}
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
            className="flex-1 min-w-40"
          />
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="input w-24">
            {[1, 4, 16, 64].map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
          {current && <span className="text-gray-600 tabular-nums">{new Date(current.timestamp).toLocaleString()}</span>}
        </div>
      )}
      <div ref={containerRef} className="w-full h-[26rem] rounded-lg overflow-hidden border" />
    </div>
  );
}
