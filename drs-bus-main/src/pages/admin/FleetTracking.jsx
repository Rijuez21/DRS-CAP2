import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Satellite, WifiOff, RadioTower, MapPin } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../../lib/leafletDefaultIcon"; // makes the default pin marker load (see that file)
import * as api from "../../lib/api";
import { getSocket } from "../../lib/socket";
import EmptyState from "../../components/common/EmptyState";
import { addStopMarker, bindStopLabelZoom, toPinnedStops } from "../../lib/stopMarkers";
import { keepMapSized } from "../../lib/leafletAutoResize";
import { escapeHtml } from "../../lib/escapeHtml";

const STATUS_COLORS = {
  Active: "#16a34a", // brand-green-ish
  Idle: "#64748b", // slate
  Maintenance: "#f59e0b", // amber
};

function busIcon(status, buffered) {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.Idle;
  const badge = buffered
    ? `<span style="position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:9999px;background:#e11d48;border:2px solid white;"></span>`
    : "";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:18px;height:18px;border-radius:9999px;background:${color};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.45);">${badge}</div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

// Recomputed on every render — the component re-renders each time the
// `tick` state below advances, which is what keeps this fresh without
// re-fetching from the API.
function timeAgo(isoString) {
  if (!isoString) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(isoString).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

const DEFAULT_CENTER = [16.4023, 120.596]; // Baguio City — only until a bus has reported

// Shared by admin (/admin/tracking), terminal staff (/staff/tracking) and
// bus owners (/owner/tracking). Admin/staff see every active bus over the
// "fleet" room; an owner sees only their own buses (GET /api/owners/me/fleet,
// even ones that haven't reported yet) and listens to those buses' rooms.
export default function FleetTracking() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isAdmin = pathname.startsWith("/admin");
  const isOwner = pathname.startsWith("/owner");
  const loadLocations = isOwner ? api.getMyFleet : api.getFleetLocations;
  const [buses, setBuses] = useState([]); // keyed array, one entry per bus
  const [selectedBusId, setSelectedBusId] = useState(null);
  const [error, setError] = useState("");
  const [, setTick] = useState(0);

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const stopSizingRef = useRef(null); // keepMapSized cleanup, set when the map is created
  const markersRef = useRef(new Map()); // busId -> L.Marker
  const stopLayerRef = useRef(null); // L.LayerGroup of pinned bus stops
  const [stops, setStops] = useState([]);
  const [showStops, setShowStops] = useState(true);

  // Pinned bus stops (routes rows the admin placed in Route Management), so
  // each bus can be seen against the real stop locations. Unpinned stops
  // have no position and just aren't drawn. Failure is non-fatal: the bus
  // map is the point of this page.
  useEffect(() => {
    let cancelled = false;
    api
      .getRoutes()
      .then((rows) => {
        if (!cancelled) setStops(toPinnedStops(rows));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 1. Seed one marker per bus from the REST snapshot.
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    loadLocations()
      .then((rows) => {
        if (!cancelled) setBuses(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadLocations]);

  // The snapshot only lists buses that had already reported. A bus whose
  // GPS tracker (or driver's phone) reports for the first time while this
  // page is open is fetched in by re-reading the snapshot — at most every
  // 20 s, since the server caches it for 15 s anyway.
  const knownBusIdsRef = useRef(new Set());
  const lastRefetchRef = useRef(0);
  useEffect(() => {
    knownBusIdsRef.current = new Set(buses.map((b) => Number(b.busId)));
  }, [buses]);

  // 2. Admin/staff: the single "fleet" room instead of one room per bus.
  // Owner: one room per own bus — the fleet room would show everyone's.
  const ownerBusIdsKey = isOwner ? buses.map((b) => b.busId).sort((a, b) => a - b).join(",") : "";
  useEffect(() => {
    const socket = getSocket();
    const ownerBusIds = ownerBusIdsKey ? ownerBusIdsKey.split(",").map(Number) : [];
    const join = () => {
      if (isOwner) ownerBusIds.forEach((id) => socket.emit("subscribe:bus", id));
      else socket.emit("subscribe:fleet");
    };
    join();

    function handleUpdate(point) {
      if (!knownBusIdsRef.current.has(Number(point.busId))) {
        if (!isOwner && Date.now() - lastRefetchRef.current > 20000) {
          lastRefetchRef.current = Date.now();
          api.getFleetLocations().then(setBuses).catch(() => {});
        }
        return;
      }
      setBuses((prev) => {
        const idx = prev.findIndex((b) => Number(b.busId) === Number(point.busId));
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          latitude: point.latitude,
          longitude: point.longitude,
          timestamp: point.timestamp,
          syncStatus: point.syncStatus,
          source: point.source,
        };
        return next;
      });
    }
    socket.on("location:update", handleUpdate);
    socket.on("connect", join); // rooms are lost when the connection drops — rejoin

    return () => {
      if (isOwner) ownerBusIds.forEach((id) => socket.emit("unsubscribe:bus", id));
      else socket.emit("unsubscribe:fleet");
      socket.off("location:update", handleUpdate);
      socket.off("connect", join);
    };
  }, [isOwner, ownerBusIdsKey]);

  // 3. Create the map once, then move/create markers as `buses` changes —
  // never recreate the whole map on every update.
  useEffect(() => {
    if (!mapContainerRef.current || buses.length === 0) return;

    if (!mapRef.current) {
      // An owner's list can include buses that haven't reported yet.
      const first = buses.find((b) => b.latitude != null && b.longitude != null);
      mapRef.current = L.map(mapContainerRef.current).setView(first ? [first.latitude, first.longitude] : DEFAULT_CENTER, 11);
      stopSizingRef.current = keepMapSized(mapRef.current);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
      }).addTo(mapRef.current);
    }

    for (const bus of buses) {
      if (bus.latitude == null || bus.longitude == null) continue;
      const icon = busIcon(bus.status, bus.syncStatus === "buffered");
      const existing = markersRef.current.get(bus.busId);
      if (existing) {
        existing.setLatLng([bus.latitude, bus.longitude]);
        existing.setIcon(icon);
      } else {
        const marker = L.marker([bus.latitude, bus.longitude], { icon }).addTo(mapRef.current);
        marker.bindTooltip(escapeHtml(bus.plateNum), { direction: "top", offset: [0, -10] });
        marker.on("click", () => setSelectedBusId(bus.busId));
        markersRef.current.set(bus.busId, marker);
      }
    }
  }, [buses]);

  // Stops layer: drawn once the map exists (it's created with the first
  // bus), under the bus dots, with labels hidden when zoomed far out.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    if (!stopLayerRef.current) stopLayerRef.current = L.layerGroup();
    const layer = stopLayerRef.current;
    layer.clearLayers();
    if (!showStops || stops.length === 0) {
      layer.remove();
      return undefined;
    }
    for (const stop of stops) addStopMarker(layer, stop, { zIndexOffset: -500 });
    layer.addTo(map);
    return bindStopLabelZoom(map);
  }, [stops, showStops, buses.length]);

  useEffect(() => {
    const markers = markersRef.current; // same Map for the component's lifetime
    return () => {
      stopSizingRef.current?.();
      stopSizingRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      stopLayerRef.current = null;
      markers.clear();
    };
  }, []);

  // Pan to a bus when its side-list entry is clicked.
  useEffect(() => {
    if (!selectedBusId || !mapRef.current) return;
    const marker = markersRef.current.get(selectedBusId);
    if (marker) {
      mapRef.current.panTo(marker.getLatLng());
      marker.openTooltip();
    }
  }, [selectedBusId]);

  // Tick every 5s so "last updated Xs ago" stays fresh without re-fetching.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const sortedBuses = useMemo(
    () => [...buses].sort((a, b) => a.plateNum.localeCompare(b.plateNum)),
    [buses]
  );

  return (
    <div className="p-6 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{isOwner ? "My Buses — Live Tracking" : "Live Fleet Tracking"}</h1>
          <p className="text-sm text-gray-500">
            Real-time GPS for {isOwner ? "your buses" : "every active bus"} — click a bus to jump to it on the map.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700" title={stops.length === 0 ? "No stops are pinned yet — pin them in Route Management" : undefined}>
            <input type="checkbox" checked={showStops} onChange={(e) => setShowStops(e.target.checked)} disabled={stops.length === 0} />
            <MapPin className="w-4 h-4 text-blue-600" /> Show stops ({stops.length} pinned)
          </label>
          {isAdmin && (
            <button
              type="button"
              onClick={() => navigate("/admin/fleet")}
              className="text-sm text-emerald-700 underline underline-offset-2"
            >
              Back to Fleet Management
            </button>
          )}
        </div>
      </header>

      {error && <p className="text-sm text-rose-600 font-medium">{error}</p>}

      {isLoading && buses.length === 0 ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : buses.length === 0 && !error ? (
        isOwner ? (
          <EmptyState
            icon={RadioTower}
            title="No buses linked to your account yet"
            description="Ask the terminal administrator to link your buses to your owner account."
          />
        ) : (
          <EmptyState
            icon={RadioTower}
            title="No buses reporting right now"
            description="Active buses will appear here as soon as they report a GPS position."
          />
        )
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          <div
            ref={mapContainerRef}
            className="w-full h-[28rem] lg:h-[36rem] rounded-2xl overflow-hidden border border-slate-200 shadow-sm order-2 lg:order-1"
          />

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y overflow-y-auto max-h-[28rem] lg:max-h-[36rem] order-1 lg:order-2">
            {sortedBuses.map((bus) => (
              <button
                key={bus.busId}
                type="button"
                onClick={() => setSelectedBusId(bus.busId)}
                className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors ${
                  selectedBusId === bus.busId ? "bg-emerald-50" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-sm">{bus.plateNum}</p>
                  <span
                    className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: `${STATUS_COLORS[bus.status] ?? STATUS_COLORS.Idle}22`,
                      color: STATUS_COLORS[bus.status] ?? STATUS_COLORS.Idle,
                    }}
                  >
                    {bus.status}
                  </span>
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  {bus.origin && bus.destination ? `${bus.origin} → ${bus.destination}` : "No trip today"}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{bus.driverName ?? "Unassigned"}</p>
                <div className="flex items-center gap-1.5 mt-1.5 text-xs">
                  <Satellite className={`w-3.5 h-3.5 ${bus.timestamp ? "text-emerald-600" : "text-gray-400"}`} />
                  <span className="text-gray-500">
                    {bus.timestamp
                      ? `${timeAgo(bus.timestamp)} · ${bus.source === "device" ? "GPS tracker" : "Driver's phone"}`
                      : "No GPS position yet"}
                  </span>
                  {bus.syncStatus === "buffered" && (
                    <span className="flex items-center gap-1 text-rose-600 font-medium ml-1">
                      <WifiOff className="w-3.5 h-3.5" /> Buffered
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
