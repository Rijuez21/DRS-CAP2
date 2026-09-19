import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronLeft, Satellite, WifiOff, MapPin } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import * as api from "../../lib/api";
import { getSocket } from "../../lib/socket";
import { mapTrip } from "../../lib/format";
import EmptyState from "../../components/common/EmptyState";

// Same bundler marker-image-URL fix FleetTracking.jsx applies — kept here
// for parity even though the marker below uses a colored divIcon rather
// than the default pin.
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function busIcon(buffered) {
  const badge = buffered
    ? `<span style="position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:9999px;background:#e11d48;border:2px solid white;"></span>`
    : "";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:22px;height:22px;border-radius:9999px;background:#2f9e5c;border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);">${badge}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

// Recomputed on every render — the component re-renders each time the
// `tick` state below advances, same approach as FleetTracking.jsx.
function timeAgo(isoString) {
  if (!isoString) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(isoString).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

export default function LiveTracking() {
  const { tripId } = useParams();
  const navigate = useNavigate();

  const [trip, setTrip] = useState(null);
  const [location, setLocation] = useState(null); // { latitude, longitude, timestamp, syncStatus }
  const [error, setError] = useState("");
  const [, setTick] = useState(0);

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);

  // 1. Load the trip so we know which bus to track, and can show route
  //    context. mapTrip() gives us the camelCase shape (busId, origin,
  //    destination, departureTime) — same convention TripDetail.jsx uses.
  useEffect(() => {
    let cancelled = false;
    api
      .getTrip(tripId)
      .then((row) => {
        if (!cancelled) setTrip(mapTrip(row));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  // 2. Seed the initial position from the REST snapshot once we know the busId.
  useEffect(() => {
    if (!trip?.busId) return;
    let cancelled = false;
    api
      .getLatestLocation(trip.busId)
      .then((row) => {
        if (!cancelled && row) setLocation(row);
      })
      .catch(() => {
        // No location reported yet is a normal state here (trip hasn't
        // departed), not something to surface as an error.
      });
    return () => {
      cancelled = true;
    };
  }, [trip?.busId]);

  // 3. Subscribe to this one bus for live updates.
  //    NOTE — assumed symmetric with FleetTracking's "fleet" room
  //    convention (subscribe:fleet/unsubscribe:fleet -> location:update).
  //    This hasn't been confirmed against the actual backend socket
  //    handlers yet. The busId check inside handleUpdate is a safety net
  //    either way: if the backend instead just broadcasts every point to
  //    everyone, this still only reacts to the right bus.
  useEffect(() => {
    if (!trip?.busId) return;
    const socket = getSocket();
    socket.emit("subscribe:bus", { busId: trip.busId });

    function handleUpdate(point) {
      if (point.busId !== trip.busId) return;
      setLocation({
        latitude: point.latitude,
        longitude: point.longitude,
        timestamp: point.timestamp,
        syncStatus: point.syncStatus,
      });
    }
    socket.on("location:update", handleUpdate);

    return () => {
      socket.emit("unsubscribe:bus", { busId: trip.busId });
      socket.off("location:update", handleUpdate);
    };
  }, [trip?.busId]);

  // 4. Create the map once we have a first position, then just move the
  //    marker on every later update — never recreate the map itself.
  useEffect(() => {
    if (!mapContainerRef.current || !location) return;

    const icon = busIcon(location.syncStatus === "buffered");

    if (!mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current).setView(
        [location.latitude, location.longitude],
        13
      );
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
      }).addTo(mapRef.current);
      markerRef.current = L.marker([location.latitude, location.longitude], { icon }).addTo(
        mapRef.current
      );
    } else {
      markerRef.current.setLatLng([location.latitude, location.longitude]);
      markerRef.current.setIcon(icon);
      mapRef.current.panTo([location.latitude, location.longitude]);
    }
  }, [location]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // Tick every 5s so "last updated Xs ago" stays fresh without re-fetching.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="max-w-md mx-auto lg:max-w-3xl px-4 py-6 space-y-5">
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
            {trip.origin} → {trip.destination} · Departs {trip.departureTime}
          </p>
        )}
      </header>

      {error && <p className="text-sm text-rose-600 font-medium">{error}</p>}

      {!location && !error ? (
        <EmptyState
          icon={Satellite}
          title="Not tracking yet"
          description="The map will appear as soon as this bus starts reporting its GPS position — usually once the trip departs."
        />
      ) : location ? (
        <div className="space-y-3">
          <div
            ref={mapContainerRef}
            className="w-full h-[24rem] lg:h-[30rem] rounded-3xl overflow-hidden border border-slate-200 shadow-sm"
          />
          <div className="flex items-center gap-2 text-xs text-ink-600 px-1">
            <MapPin className="w-3.5 h-3.5 text-brand-green-600" />
            Last updated {timeAgo(location.timestamp)}
            {location.syncStatus === "buffered" && (
              <span className="flex items-center gap-1 text-rose-600 font-medium ml-1">
                <WifiOff className="w-3.5 h-3.5" /> Buffered — reconnecting
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}