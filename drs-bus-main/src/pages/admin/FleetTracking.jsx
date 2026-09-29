import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Satellite, WifiOff, RadioTower } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import * as api from "../../lib/api";
import { getSocket } from "../../lib/socket";
import EmptyState from "../../components/common/EmptyState";

// Same bundler marker-image-URL fix LiveTracking.jsx applies — kept here
// for parity even though the fleet markers below use colored divIcons
// rather than the default pin.
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

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

export default function FleetTracking() {
  const navigate = useNavigate();
  const [buses, setBuses] = useState([]); // keyed array, one entry per bus
  const [selectedBusId, setSelectedBusId] = useState(null);
  const [error, setError] = useState("");
  const [, setTick] = useState(0);

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map()); // busId -> L.Marker

  // 1. Seed one marker per bus from the REST snapshot.
  useEffect(() => {
    let cancelled = false;
    api
      .getFleetLocations()
      .then((rows) => {
        if (!cancelled) setBuses(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Subscribe to the single "fleet" room instead of one room per bus.
  useEffect(() => {
    const socket = getSocket();
    const join = () => socket.emit("subscribe:fleet");
    join();

    function handleUpdate(point) {
      setBuses((prev) => {
        const idx = prev.findIndex((b) => Number(b.busId) === Number(point.busId));
        if (idx === -1) return prev; // point for a bus not in the active-fleet snapshot (e.g. now Idle) — ignore
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          latitude: point.latitude,
          longitude: point.longitude,
          timestamp: point.timestamp,
          syncStatus: point.syncStatus,
        };
        return next;
      });
    }
    socket.on("location:update", handleUpdate);
    socket.on("connect", join); // rooms are lost when the connection drops — rejoin

    return () => {
      socket.emit("unsubscribe:fleet");
      socket.off("location:update", handleUpdate);
      socket.off("connect", join);
    };
  }, []);

  // 3. Create the map once, then move/create markers as `buses` changes —
  // never recreate the whole map on every update.
  useEffect(() => {
    if (!mapContainerRef.current || buses.length === 0) return;

    if (!mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current).setView(
        [buses[0].latitude, buses[0].longitude],
        11
      );
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
        marker.bindTooltip(bus.plateNum, { direction: "top", offset: [0, -10] });
        marker.on("click", () => setSelectedBusId(bus.busId));
        markersRef.current.set(bus.busId, marker);
      }
    }
  }, [buses]);

  useEffect(() => {
    const markers = markersRef.current; // same Map for the component's lifetime
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
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
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Live Fleet Tracking</h1>
          <p className="text-sm text-gray-500">
            Real-time GPS for every active bus — click a bus to jump to it on the map.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/admin/fleet")}
          className="text-sm text-emerald-700 underline underline-offset-2"
        >
          Back to Fleet Management
        </button>
      </header>

      {error && <p className="text-sm text-rose-600 font-medium">{error}</p>}

      {buses.length === 0 && !error ? (
        <EmptyState
          icon={RadioTower}
          title="No buses reporting right now"
          description="Active buses will appear here as soon as they report a GPS position."
        />
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
                  <Satellite className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-gray-500">{timeAgo(bus.timestamp)}</span>
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
