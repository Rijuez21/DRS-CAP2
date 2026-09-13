import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronLeft, Satellite, WifiOff } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import * as api from "../../lib/api";
import { getSocket } from "../../lib/socket";
import { mapTrip, formatTime } from "../../lib/format";

// Bundlers rewrite the default Leaflet marker image URLs, which otherwise
// 404 — this is the standard fix.
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

export default function LiveTracking() {
  const { tripId } = useParams();
  const navigate = useNavigate();

  const [trip, setTrip] = useState(null);
  const [position, setPosition] = useState(null); // { latitude, longitude, timestamp, sync_status }
  const [error, setError] = useState("");

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);

  // 1. Resolve the trip -> bus_id, then get the last known point.
  useEffect(() => {
    let cancelled = false;
    api
      .getTrip(tripId)
      .then((row) => {
        if (cancelled) return;
        const mapped = mapTrip(row);
        setTrip(mapped);
        return api.getLatestLocation(mapped.busId).catch(() => null);
      })
      .then((point) => {
        if (!cancelled && point) {
          setPosition({
            latitude: point.latitude,
            longitude: point.longitude,
            timestamp: point.timestamp,
            sync_status: point.sync_status ?? point.syncStatus,
          });
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  // 2. Subscribe to live updates over Socket.io for this bus.
  useEffect(() => {
    if (!trip?.busId) return;
    const socket = getSocket();
    socket.emit("subscribe:bus", trip.busId);

    function handleUpdate(point) {
      setPosition({
        latitude: point.latitude,
        longitude: point.longitude,
        timestamp: point.timestamp,
        sync_status: point.syncStatus,
      });
    }
    socket.on("location:update", handleUpdate);

    return () => {
      socket.emit("unsubscribe:bus", trip.busId);
      socket.off("location:update", handleUpdate);
    };
  }, [trip?.busId]);

  // 3. Render/update the Leaflet map whenever position changes.
  useEffect(() => {
    if (!position || !mapContainerRef.current) return;
    const { latitude, longitude } = position;

    if (!mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current).setView([latitude, longitude], 13);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
      }).addTo(mapRef.current);
      markerRef.current = L.marker([latitude, longitude]).addTo(mapRef.current);
    } else {
      markerRef.current.setLatLng([latitude, longitude]);
      mapRef.current.panTo([latitude, longitude]);
    }

    return () => {
      // Leaflet map itself persists across position updates; only torn
      // down when the component unmounts (next effect's cleanup below).
    };
  }, [position]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="max-w-md mx-auto lg:max-w-3xl px-4 py-6 space-y-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm text-ink-600 hover:text-brand-green-600"
      >
        <ChevronLeft className="w-4 h-4" /> Back
      </button>

      <header>
        <h1 className="font-display text-xl font-bold">Live Bus Tracking</h1>
        {trip && (
          <p className="text-sm text-ink-600">
            {trip.origin} → {trip.destination} · {trip.plateNumber ?? `Trip ${tripId}`}
          </p>
        )}
      </header>

      {error && (
        <p role="alert" className="text-sm text-rose-600 font-medium">
          {error}
        </p>
      )}

      {!position ? (
        <div className="flex flex-col items-center text-center gap-2 py-16 rounded-2xl border border-dashed border-slate-200 bg-white/60">
          <WifiOff className="w-8 h-8 text-ink-600/50" strokeWidth={1.5} />
          <p className="font-display font-semibold">No location yet</p>
          <p className="text-sm text-ink-600 max-w-xs">
            This bus hasn't reported its GPS position yet, or is currently in a
            connectivity dead zone. It will appear as soon as a signal is received.
          </p>
        </div>
      ) : (
        <>
          <div
            ref={mapContainerRef}
            className="w-full h-80 rounded-3xl overflow-hidden border border-slate-100 shadow-sm"
          />
          <div className="flex items-center justify-between rounded-2xl bg-white border border-slate-100 shadow-sm px-4 py-3 text-sm">
            <span className="flex items-center gap-1.5 text-ink-600">
              <Satellite className="w-4 h-4 text-brand-green-600" />
              Last update: {formatTime(position.timestamp)}
            </span>
            {position.sync_status === "buffered" && (
              <span className="text-xs font-medium text-brand-sunrise-600">
                Buffered — syncing after reconnect
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
