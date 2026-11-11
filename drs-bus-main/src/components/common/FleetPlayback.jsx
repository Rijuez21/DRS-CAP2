import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import L from "leaflet";
import { useLeafletMap } from "../../hooks/useLeafletMap";
import { useMatchedRoutes } from "../../hooks/useMatchedRoute";
import { arrowIcon } from "../../lib/arrowIcon";
import { distanceKm } from "../../lib/geo";
import { indexAt, buildRoadTrack, positionAt } from "../../lib/roadTrack";

// Plays several buses back together on one clock: each bus moves to where
// it was at the same moment, so an owner sees the whole fleet's day at
// once. Like RoutePlayback, each route is snapped to the roads (all buses
// share one queue to the rate-limited router, so it fills in over a few
// seconds), and the arrows drive along those roads between fixes.
// loadHistory({ from, to }) resolves to { buses: [{ busId, busNumber,
// plateNum, points, truncated }] } (api.getMyFleetHistory).

const COLORS = ["#1d4ed8", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#db2777", "#65a30d", "#ca8a04", "#475569"];
// Playback rate: simulated seconds per real second.
const SPEEDS = [
  [60, "1 min/s"],
  [300, "5 min/s"],
  [900, "15 min/s"],
  [3600, "1 h/s"],
];
const TICK_MS = 200;

const toLocalInput = (date) => {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

const busLabel = (b) => (b.busNumber ? `${b.busNumber} · ${b.plateNum}` : b.plateNum);

export default function FleetPlayback({ loadHistory }) {
  const [containerRef, map] = useLeafletMap();
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return toLocalInput(d);
  });
  const [to, setTo] = useState(() => toLocalInput(new Date()));
  const [buses, setBuses] = useState(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(300);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const linesRef = useRef(null);
  const matchedRef = useRef(null);
  const markersRef = useRef(new Map());

  // Per bus: colour, timestamps as ms (for the clock), distance covered.
  const tracks = useMemo(
    () =>
      (buses ?? []).map((b, i) => {
        let km = 0;
        for (let j = 1; j < b.points.length; j += 1) km += distanceKm(b.points[j - 1], b.points[j]) ?? 0;
        return { ...b, color: COLORS[i % COLORS.length], times: b.points.map((p) => new Date(p.timestamp).getTime()), km };
      }),
    [buses]
  );
  // The clock runs from the earliest first point to the latest last one.
  const { withData, start, end } = useMemo(() => {
    const has = tracks.filter((t) => t.points.length > 0);
    return {
      withData: has,
      start: has.length ? Math.min(...has.map((t) => t.times[0])) : 0,
      end: has.length ? Math.max(...has.map((t) => t.times[t.times.length - 1])) : 0,
    };
  }, [tracks]);

  const traces = useMemo(() => (withData.length ? withData.map((t) => t.points) : null), [withData]);
  const matched = useMatchedRoutes(traces);
  const roadTracks = useMemo(
    () => withData.map((t, i) => buildRoadTrack(t.points, matched.byTrace[i] ?? [])),
    [withData, matched.byTrace]
  );

  async function load(e) {
    e?.preventDefault();
    setError("");
    setLoading(true);
    setPlaying(false);
    try {
      const res = await loadHistory({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
      const firsts = res.buses.filter((b) => b.points.length).map((b) => new Date(b.points[0].timestamp).getTime());
      setBuses(res.buses);
      setTime(firsts.length ? Math.min(...firsts) : 0);
      if (res.buses.some((b) => b.truncated)) setError("Some buses have more positions than can be shown at once — pick a shorter range to see all of them.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Draw every bus's route once per load.
  useEffect(() => {
    if (!map) return;
    linesRef.current?.remove();
    linesRef.current = null;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = new Map();
    if (!withData.length) return;
    // The raw recorded trace: faint and dashed, under the road-matched
    // routes drawn below, so any stretch that couldn't be matched still shows.
    const lines = withData.map((t) =>
      L.polyline(t.points.map((p) => [p.latitude, p.longitude]), { color: t.color, weight: 2, opacity: 0.4, dashArray: "6 6" })
    );
    linesRef.current = L.featureGroup(lines).addTo(map);
    map.fitBounds(linesRef.current.getBounds(), { padding: [30, 30] });
  }, [map, withData]);

  // Each bus's route snapped to the roads, filled in as pieces come back.
  useEffect(() => {
    if (!map) return;
    matchedRef.current?.remove();
    matchedRef.current = null;
    const lines = withData.flatMap((t, i) =>
      (matched.byTrace[i] ?? []).map((path) => L.polyline(path, { color: t.color, weight: 5, opacity: 0.75 }))
    );
    if (!lines.length) return;
    matchedRef.current = L.layerGroup(lines).addTo(map);
    // Arrows stay on top of the route lines.
    markersRef.current.forEach((m) => m.setZIndexOffset(1000));
  }, [map, withData, matched.byTrace]);

  // Move each bus's arrow to where it was at `time`, along the road. Before
  // its first point or after its last, it waits faded at that end.
  useEffect(() => {
    if (!map) return;
    withData.forEach((t, n) => {
      const i = indexAt(t.times, time);
      const { latLng, course } = positionAt(t.points, t.times, roadTracks[n], time);
      const active = i >= 0 && i < t.points.length - 1;
      let marker = markersRef.current.get(t.busId);
      if (!marker) {
        marker = L.marker(latLng, { icon: arrowIcon(course, t.color), zIndexOffset: 1000 })
          .bindTooltip(busLabel(t), { permanent: true, direction: "top", offset: [0, -14] })
          .addTo(map);
        markersRef.current.set(t.busId, marker);
      } else {
        marker.setLatLng(latLng);
        marker.setIcon(arrowIcon(course, t.color));
      }
      marker.setOpacity(active ? 1 : 0.45);
    });
  }, [map, withData, roadTracks, time]);

  useEffect(() => {
    if (!playing || end === 0) return undefined;
    const id = setInterval(() => {
      setTime((t) => {
        if (t >= end) {
          setPlaying(false);
          return end;
        }
        return Math.min(end, t + speed * TICK_MS);
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, speed, end]);

  function status(t) {
    if (!t.points.length) return "No positions";
    const i = indexAt(t.times, time);
    if (i < 0) return "Not started yet";
    if (i >= t.points.length - 1) return "Finished";
    return "Moving";
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
          {loading ? "Loading…" : "Load routes"}
        </button>
      </form>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {withData.length > 0 && matched.status !== "idle" && (
        <p className={`text-xs ${matched.status === "failed" || matched.status === "partial" ? "text-amber-700" : "text-gray-500"}`}>
          {matched.status === "loading"
            ? `Snapping the routes to the roads… ${matched.total ? `${matched.done}/${matched.total}` : ""}`
            : matched.status === "none"
              ? "None of the buses moved much in this time range, so there are no road routes to draw."
              : matched.status === "ok"
                ? "Solid lines follow the roads. Dashed lines = the raw recorded positions."
                : matched.status === "partial"
                  ? "Some stretches couldn't be matched to a road (e.g. long signal gaps); they show only as dashed lines."
                  : "The road-matching service couldn't be reached, so only the raw recorded positions (dashed) are shown."}
        </p>
      )}
      {buses && withData.length === 0 && <p className="text-sm text-gray-500">None of your buses saved any positions in this time range.</p>}
      {withData.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => {
              if (time >= end) setTime(start);
              setPlaying((p) => !p);
            }}
            className="flex items-center gap-1 px-3 py-1.5 rounded border font-semibold"
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />} {playing ? "Pause" : "Play"}
          </button>
          <input
            type="range"
            min={start}
            max={end}
            step={1000}
            value={time}
            onChange={(e) => setTime(Number(e.target.value))}
            className="flex-1 min-w-40"
          />
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="input w-28">
            {SPEEDS.map(([s, label]) => (
              <option key={s} value={s}>
                {label}
              </option>
            ))}
          </select>
          <span className="text-gray-600 tabular-nums">{new Date(time).toLocaleString()}</span>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-3">
        <div ref={containerRef} className="w-full h-[26rem] rounded-lg overflow-hidden border" />
        {tracks.length > 0 && (
          <ul className="border rounded-lg divide-y text-sm max-h-[26rem] overflow-y-auto">
            {tracks.map((t) => (
              <li key={t.busId}>
                <button
                  type="button"
                  disabled={!t.points.length}
                  onClick={() => {
                    const m = markersRef.current.get(t.busId);
                    if (m && map) map.panTo(m.getLatLng());
                  }}
                  className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-slate-50 disabled:hover:bg-transparent disabled:opacity-60"
                >
                  <span className="mt-1 w-3 h-3 rounded-full shrink-0" style={{ background: t.color }} />
                  <span className="min-w-0">
                    <span className="block font-medium truncate">{busLabel(t)}</span>
                    <span className="block text-xs text-gray-500">
                      {status(t)}
                      {t.points.length > 0 && ` · ${t.km.toFixed(1)} km`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
