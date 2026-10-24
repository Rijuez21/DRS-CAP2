import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Satellite, RadioTower, CircleCheck, CircleX, CircleAlert, RefreshCw, Gauge, Compass, Battery, Signal,
  KeyRound, MapPin, Clock, Play, Pause, History, ScrollText, Map as MapIcon, ShieldCheck,
} from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as api from "../../lib/api";
import { getSocket } from "../../lib/socket";
import { keepMapSized } from "../../lib/leafletAutoResize";
import InlineAlert from "../../components/common/InlineAlert";
import EmptyState from "../../components/common/EmptyState";
import LocationPermissionCard from "../../components/common/LocationPermissionCard";
import { useGeolocation } from "../../hooks/useGeolocation";
import { useRoadRoute } from "../../hooks/useRoadRoute";
import { formatDistance } from "../../lib/geo";

// The SinoTrack-style device page: is the ST-906L connected, what did it
// last report, where is it now, and where has the bus been. The tracker
// talks to the backend directly (server/src/services/gpsGateway.js); this
// page reads that state and follows it live over Socket.io ("gps:admin").

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg) => COMPASS[Math.round(((Number(deg) % 360) + 360) % 360 / 45) % 8];

function timeAgo(iso, now) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleString();
}

function deviceStatus(d) {
  if (d.online && d.connected) return { label: "Online", className: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" };
  if (d.connected) return { label: "Connected, waiting for data", className: "bg-amber-100 text-amber-800", dot: "bg-amber-500" };
  if (d.online) return { label: "Reconnecting", className: "bg-amber-100 text-amber-800", dot: "bg-amber-500" };
  return { label: "Offline", className: "bg-slate-200 text-slate-700", dot: "bg-slate-400" };
}

function arrowIcon(course, color = "#047857") {
  return L.divIcon({
    className: "",
    html: `<div style="width:30px;height:30px;transform:rotate(${Number(course) || 0}deg)"><svg viewBox="0 0 24 24" width="30" height="30"><circle cx="12" cy="12" r="11" fill="white" stroke="${color}" stroke-width="2"/><path d="M12 4 L17 17 L12 14 L7 17 Z" fill="${color}"/></svg></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function useNow(ms = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export default function GpsTracker() {
  const now = useNow();
  const [status, setStatus] = useState(null); // { listener, publicAddress, devices }
  const [buses, setBuses] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [verify, setVerify] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [tab, setTab] = useState("live");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [lookupId, setLookupId] = useState("");

  const loadStatus = useCallback(
    () =>
      api
        .getGpsStatus()
        .then((s) => {
          setStatus(s);
          // Default to the tracker that's online / assigned — there's one today.
          setSelectedId((cur) => {
            if (cur && s.devices.some((d) => d.deviceId === cur)) return cur;
            const best = [...s.devices].sort((a, b) => Number(b.online) - Number(a.online) || Number(Boolean(b.bus)) - Number(Boolean(a.bus)))[0];
            return best?.deviceId ?? cur;
          });
        })
        .catch((err) => setError(err.message)),
    []
  );

  useEffect(() => {
    loadStatus();
    api.getBuses().then(setBuses).catch(() => {});
  }, [loadStatus]);

  const loadDetail = useCallback((id) => {
    if (!id) return Promise.resolve();
    return api
      .getGpsDevice(id)
      .then(setDetail)
      .catch((err) => {
        setDetail(null);
        setError(err.message);
      });
  }, []);

  const fetchVerify = useCallback(
    (id) =>
      api
        .verifyGpsDevice(id)
        .then(setVerify)
        .catch((err) => setError(err.message)),
    []
  );
  // The "Verify connection" button: same check, with a spinner.
  const runVerify = useCallback(
    (id) => {
      if (!id) return;
      setVerifying(true);
      fetchVerify(id).finally(() => setVerifying(false));
    },
    [fetchVerify]
  );

  useEffect(() => {
    if (!selectedId) return;
    loadDetail(selectedId);
    fetchVerify(selectedId);
  }, [selectedId, loadDetail, fetchVerify]);

  // Live: every tracker message. The list updates from the event itself;
  // the open device's log/trail are re-read at most every 3 s.
  const selectedRef = useRef(selectedId);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);
  const lastDetailFetch = useRef(0);
  useEffect(() => {
    const socket = getSocket();
    const join = () => socket.emit("subscribe:gps");
    join();
    function onDevice(d) {
      setStatus((prev) => {
        if (!prev) return prev;
        const idx = prev.devices.findIndex((x) => x.deviceId === d.deviceId);
        const devices = [...prev.devices];
        if (idx === -1) devices.push({ ...d, bus: null });
        else devices[idx] = { ...devices[idx], ...d };
        return { ...prev, devices };
      });
      if (d.deviceId === selectedRef.current) {
        setDetail((prev) => (prev ? { ...prev, ...d } : prev));
        if (Date.now() - lastDetailFetch.current > 3000) {
          lastDetailFetch.current = Date.now();
          api.getGpsDevice(d.deviceId).then(setDetail).catch(() => {});
        }
      } else if (!selectedRef.current) {
        setSelectedId(d.deviceId);
      }
    }
    socket.on("gps:device", onDevice);
    socket.on("connect", join);
    return () => {
      socket.emit("unsubscribe:gps");
      socket.off("gps:device", onDevice);
      socket.off("connect", join);
    };
  }, []);

  async function assign(busId) {
    setError("");
    setSuccess("");
    try {
      await api.assignGpsDevice(selectedId, busId || null);
      setSuccess(busId ? "Tracker assigned. Its positions now appear on every live map." : "Tracker unassigned from its bus.");
      await Promise.all([loadStatus(), loadDetail(selectedId), api.getBuses().then(setBuses)]);
      runVerify(selectedId);
    } catch (err) {
      setError(err.message);
    }
  }

  function lookup(e) {
    e.preventDefault();
    const id = lookupId.trim();
    if (!/^[0-9A-Za-z]{1,32}$/.test(id)) {
      setError("Enter the device ID printed on the tracker's label (digits only, usually 10).");
      return;
    }
    setError("");
    setDetail(null);
    setVerify(null);
    // A tracker that has never connected has no detail yet; the verify
    // checklist still says exactly what's missing.
    setSelectedId(id);
    if (selectedId === id) runVerify(id);
  }

  const devices = status?.devices ?? [];
  const selected = devices.find((d) => d.deviceId === selectedId) ?? (detail && { ...detail });
  const listener = status?.listener;

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Satellite className="w-5 h-5 text-emerald-700" /> GPS Tracker
          </h1>
          <p className="text-sm text-gray-500">SinoTrack ST-906L: connection check, live position and route playback.</p>
        </div>
        <form onSubmit={lookup} className="flex items-center gap-2">
          <input
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            placeholder="Device ID on the tracker label"
            className="input w-56"
            maxLength={32}
          />
          <button type="submit" className="text-sm font-semibold px-3 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50">
            Check
          </button>
        </form>
      </header>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {listener && <ListenerCard listener={listener} />}

      {devices.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {devices.map((d) => {
            const st = deviceStatus(d);
            return (
              <button
                key={d.deviceId}
                type="button"
                onClick={() => setSelectedId(d.deviceId)}
                className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-full border ${d.deviceId === selectedId ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white"}`}
              >
                <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                <span className="font-mono">{d.deviceId}</span>
                {d.bus && <span className="text-gray-500">· {d.bus.plateNum}</span>}
              </button>
            );
          })}
        </div>
      )}

      {!selectedId ? (
        status && (
          <EmptyState
            icon={RadioTower}
            title="No tracker has connected yet"
            description="It appears here automatically once it connects."
          />
        )
      ) : (
        <>
          <DeviceCard
            device={selected ?? { deviceId: selectedId }}
            detail={detail}
            buses={buses}
            now={now}
            onAssign={assign}
          />

          <VerifyCard verify={verify} verifying={verifying} onVerify={() => runVerify(selectedId)} now={now} />

          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="flex border-b text-sm">
              {[
                ["live", "Live map", MapIcon],
                ["playback", "Playback", History],
                ["log", "Raw messages", ScrollText],
              ].map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 font-medium border-b-2 -mb-px ${tab === key ? "border-emerald-600 text-emerald-800" : "border-transparent text-gray-500 hover:text-gray-800"}`}
                >
                  <Icon className="w-4 h-4" /> {label}
                </button>
              ))}
            </div>
            <div className="p-3">
              {tab === "live" && <LiveMap detail={detail} />}
              {tab === "playback" && <Playback bus={detail?.bus ?? selected?.bus ?? null} />}
              {tab === "log" && <RawLog log={detail?.log ?? []} now={now} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const TROUBLESHOOT = [
  ["Power", "The tracker's lights are on and it's wired to the bus battery."],
  ["SIM data", "The SIM inside the tracker has load or an active data plan."],
  ["Mobile signal", "The bus is in an area with Globe/Smart signal."],
  ["GPS signal", "The tracker isn't covered by metal and the bus is outdoors with a clear view of the sky."],
];

function ListenerCard({ listener }) {
  return (
    <section className="bg-white rounded-xl border p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {listener.running ? (
          <span className="flex items-center gap-1.5 font-medium text-emerald-800">
            <CircleCheck className="w-4 h-4" /> Server is listening for trackers on TCP port {listener.port}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 font-medium text-rose-700">
            <CircleX className="w-4 h-4" /> Tracker listener is not running{listener.error ? `: ${listener.error}` : ""}
          </span>
        )}
      </div>
      <div className="text-sm">
        <p className="font-medium text-gray-700">Tracker offline? Check these</p>
        <ul className="mt-2 space-y-1.5 text-gray-600">
          {TROUBLESHOOT.map(([title, text]) => (
            <li key={title} className="flex gap-2">
              <CircleCheck className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" />
              <span>
                <span className="font-medium text-gray-800">{title}:</span> {text}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Stat({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="flex items-center gap-1.5 text-xs text-gray-500">
        <Icon className="w-3.5 h-3.5" /> {label}
      </p>
      <p className="font-semibold text-sm mt-0.5 break-words">{value}</p>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

function DeviceCard({ device, detail, buses, now, onAssign }) {
  const d = { ...device, ...(detail ?? {}) };
  const st = deviceStatus(d);
  const fix = d.fix;
  const valid = d.lastValidFix;
  const currentBusId = d.bus?.busId ?? "";

  return (
    <section className="bg-white rounded-xl border p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${st.className}`}>
            <span className={`w-2 h-2 rounded-full ${st.dot}`} /> {st.label}
          </span>
          <div>
            <p className="font-mono font-semibold">{d.deviceId}</p>
            <p className="text-xs text-gray-500">
              {d.bus ? `Bus ${d.bus.busNumber ? `#${d.bus.busNumber} · ` : ""}${d.bus.plateNum}` : "Not assigned to a bus"}
            </p>
          </div>
        </div>
        {/* keyed so the picker resets whenever the saved assignment changes */}
        <AssignBus key={`${d.deviceId}:${currentBusId}`} deviceId={d.deviceId} currentBusId={currentBusId} buses={buses} onAssign={onAssign} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Stat icon={Clock} label="Last update" value={timeAgo(d.lastMessageAt, now)} hint={d.messageCount ? `${d.messageCount} messages` : null} />
        <Stat
          icon={Satellite}
          label="GPS"
          value={!fix ? "No position yet" : fix.valid ? "Satellite fix" : "No satellite fix"}
          hint={valid ? `fix ${timeAgo(valid.time, now)}` : null}
        />
        <Stat icon={Gauge} label="Speed" value={valid ? `${valid.speedKmh} km/h` : "—"} />
        <Stat icon={Compass} label="Heading" value={valid ? `${compass(valid.course)} (${valid.course}°)` : "—"} />
        <Stat icon={KeyRound} label="ACC (ignition)" value={fix?.ignition == null ? "—" : fix.ignition ? "On" : "Off"} />
        <Stat
          icon={Battery}
          label="Battery"
          value={d.link?.battery != null && Number.isFinite(d.link.battery) ? `${d.link.battery}%` : fix?.battery != null ? `${fix.battery}%` : "—"}
        />
        <Stat
          icon={MapPin}
          label="Coordinates"
          value={valid ? `${valid.latitude.toFixed(5)}, ${valid.longitude.toFixed(5)}` : "—"}
        />
        <Stat
          icon={Signal}
          label="Signal / satellites"
          value={d.link && Number.isFinite(d.link.gsm) ? `GSM ${d.link.gsm} · ${d.link.satellites} sats` : "—"}
        />
        <Stat icon={RadioTower} label="Connected from" value={d.connected ? d.remoteAddress ?? "—" : "Not connected"} hint={d.connectedAt ? `since ${timeAgo(d.connectedAt, now)}` : null} />
        <Stat
          icon={CircleAlert}
          label="Alarms"
          value={fix?.alarms?.length ? fix.alarms.join(", ") : "None"}
        />
        <Stat
          icon={MapIcon}
          label="Sent to live maps"
          value={d.lastIngest ? (d.lastIngest.error ? d.lastIngest.error : timeAgo(d.lastIngest.at, now)) : "—"}
        />
      </div>
    </section>
  );
}

function AssignBus({ deviceId, currentBusId, buses, onAssign }) {
  const [busChoice, setBusChoice] = useState(String(currentBusId));
  return (
    <div className="flex items-center gap-2">
      <select value={busChoice} onChange={(e) => setBusChoice(e.target.value)} className="input w-56" aria-label="Bus this tracker is fitted to">
        <option value="">Not assigned</option>
        {buses.map((b) => (
          <option key={b.bus_id} value={b.bus_id}>
            {b.bus_number ? `#${b.bus_number} · ` : ""}
            {b.plate_num}
            {b.gps_device_id && b.gps_device_id !== deviceId ? ` (has ${b.gps_device_id})` : ""}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={busChoice === String(currentBusId)}
        onClick={() => onAssign(busChoice ? Number(busChoice) : null)}
        className="text-sm font-semibold px-3 py-2 rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-40"
      >
        Save
      </button>
    </div>
  );
}

const CHECK_ICONS = {
  pass: <CircleCheck className="w-5 h-5 text-emerald-600 shrink-0" />,
  warn: <CircleAlert className="w-5 h-5 text-amber-500 shrink-0" />,
  fail: <CircleX className="w-5 h-5 text-rose-600 shrink-0" />,
};

function VerifyCard({ verify, verifying, onVerify, now }) {
  const overall = verify?.overall;
  return (
    <section className="bg-white rounded-xl border p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-700" /> Connection check
          </h2>
          {verify && (
            <p className={`text-sm ${overall === "pass" ? "text-emerald-700" : overall === "warn" ? "text-amber-700" : "text-rose-700"}`}>
              {overall === "pass"
                ? "Everything works: the tracker is connected and its position reaches every module."
                : overall === "warn"
                  ? "Connected, but something needs attention."
                  : "Not working yet. Fix the first failed step below."}
              <span className="text-gray-400"> · checked {timeAgo(verify.checkedAt, now)}</span>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onVerify}
          disabled={verifying}
          className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded border border-emerald-700 text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${verifying ? "animate-spin" : ""}`} /> {verifying ? "Checking…" : "Verify connection"}
        </button>
      </div>
      {verify && (
        <ol className="space-y-2">
          {verify.checks.map((c) => (
            <li key={c.key} className="flex items-start gap-2 text-sm">
              {CHECK_ICONS[c.status]}
              <div>
                <p className="font-medium">{c.label}</p>
                <p className="text-gray-500">{c.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// Returns [ref for the map's <div>, the Leaflet map once created]. A ref
// callback (with React 19 cleanup) creates/destroys the map with the div.
function useLeafletMap() {
  const [map, setMap] = useState(null);
  const containerRef = useCallback((node) => {
    if (!node) return undefined;
    const m = L.map(node).setView([16.4023, 120.596], 13); // Baguio until the tracker reports
    const stopSizing = keepMapSized(m);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors" }).addTo(m);
    setMap(m);
    return () => {
      stopSizing();
      m.remove();
      setMap(null);
    };
  }, []);
  return [containerRef, map];
}

const meIcon = L.divIcon({
  className: "",
  html: `<div style="width:18px;height:18px;border-radius:9999px;background:#2563eb;border:3px solid white;box-shadow:0 0 0 2px rgba(37,99,235,.35),0 1px 3px rgba(0,0,0,.4)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

// The bus (tracker) and, once the admin shares their location, where they
// are plus the road route from them to the bus — like "find my vehicle".
// No trail: past positions are what the Playback tab is for.
function LiveMap({ detail }) {
  const [containerRef, map] = useLeafletMap();
  const busMarkerRef = useRef(null);
  const meMarkerRef = useRef(null);
  const routeLineRef = useRef(null);
  const centredRef = useRef(false);
  const framedBothRef = useRef(false);
  const [follow, setFollow] = useState(true);
  const fix = detail?.lastValidFix;
  // Asked only via the button below (or silently if already allowed).
  const { status: meStatus, position: me, request: requestMe } = useGeolocation();
  const { route, status: routeStatus } = useRoadRoute(me, fix, detail?.deviceId ?? null);

  // The bus.
  useEffect(() => {
    if (!map || !fix) return;
    const latLng = [fix.latitude, fix.longitude];
    if (!busMarkerRef.current) busMarkerRef.current = L.marker(latLng, { icon: arrowIcon(fix.course) }).addTo(map);
    else {
      busMarkerRef.current.setLatLng(latLng);
      busMarkerRef.current.setIcon(arrowIcon(fix.course));
    }
    busMarkerRef.current.bindTooltip(`Bus · ${fix.speedKmh} km/h · ${new Date(fix.time).toLocaleTimeString()}`);
    if (!centredRef.current) {
      map.setView(latLng, 16);
      centredRef.current = true;
    } else if (follow && !me) map.panTo(latLng);
  }, [map, fix, follow, me]);

  // You.
  useEffect(() => {
    if (!map || !me) return;
    const latLng = [me.latitude, me.longitude];
    if (!meMarkerRef.current) meMarkerRef.current = L.marker(latLng, { icon: meIcon, zIndexOffset: 500 }).bindTooltip("You").addTo(map);
    else meMarkerRef.current.setLatLng(latLng);
  }, [map, me]);

  // Road route from you to the bus (dashed straight line if the router is unreachable).
  useEffect(() => {
    if (!map) return;
    if (!route) {
      routeLineRef.current?.remove();
      routeLineRef.current = null;
      return;
    }
    const style = { color: "#2563eb", weight: 5, opacity: 0.75, dashArray: route.isFallback ? "8 8" : null };
    if (!routeLineRef.current) routeLineRef.current = L.polyline(route.path, style).addTo(map);
    else {
      routeLineRef.current.setLatLngs(route.path);
      routeLineRef.current.setStyle(style);
    }
    // Show both ends once; after that the admin controls the map.
    if (!framedBothRef.current) {
      map.fitBounds(routeLineRef.current.getBounds(), { padding: [40, 40], maxZoom: 17 });
      framedBothRef.current = true;
    }
  }, [map, route]);

  useEffect(
    () => () => {
      busMarkerRef.current = null;
      meMarkerRef.current = null;
      routeLineRef.current = null;
    },
    []
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-gray-500">{fix ? `Bus last fix ${new Date(fix.time).toLocaleString()}` : "Waiting for the tracker's first satellite fix…"}</p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow bus
        </label>
      </div>

      {meStatus === "ok" ? (
        route && (
          <p className="text-sm font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            You are {formatDistance(route.distanceKm)} from the bus{" "}
            {route.isFallback
              ? "in a straight line (road route unavailable)"
              : `by road · about ${Math.max(1, Math.round(route.durationMin))} min by car`}
            {routeStatus === "loading" ? " · updating…" : ""}
          </p>
        )
      ) : (
        <LocationPermissionCard
          compact
          status={meStatus}
          reason="Show where you are on the map, with the road route from you to the bus."
          onRequest={requestMe}
        />
      )}

      <div ref={containerRef} className="w-full h-[26rem] rounded-lg overflow-hidden border" />
    </div>
  );
}

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

function Playback({ bus }) {
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
  const markerRef = useRef(null);

  async function load(e) {
    e?.preventDefault();
    if (!bus) return;
    setError("");
    setLoading(true);
    setPlaying(false);
    try {
      const res = await api.getGpsHistory({ busId: bus.busId, from: new Date(from).toISOString(), to: new Date(to).toISOString() });
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
    const line = L.polyline(latLngs, { color: "#2563eb", weight: 4, opacity: 0.75 });
    lineRef.current = L.layerGroup([
      line,
      L.circleMarker(latLngs[0], { radius: 6, color: "#16a34a", fillOpacity: 1 }).bindTooltip("Start"),
      L.circleMarker(latLngs[latLngs.length - 1], { radius: 6, color: "#dc2626", fillOpacity: 1 }).bindTooltip("End"),
    ]).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [30, 30] });
  }, [map, points]);

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
    return <p className="text-sm text-gray-500 p-3">Assign this tracker to a bus first. Playback shows the positions saved for that bus.</p>;
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

function RawLog({ log, now }) {
  if (!log.length) return <p className="text-sm text-gray-500 p-3">No messages received from this tracker since the server started.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-gray-500">
          <tr>
            <th className="py-1 pr-3">Received</th>
            <th className="py-1 pr-3">Type</th>
            <th className="py-1">Message</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {log.map((m, i) => (
            <tr key={`${m.at}-${i}`}>
              <td className="py-1 pr-3 whitespace-nowrap text-gray-500">{timeAgo(m.at, now)}</td>
              <td className="py-1 pr-3 font-medium">{m.type}</td>
              <td className="py-1 font-mono break-all">{m.raw}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
