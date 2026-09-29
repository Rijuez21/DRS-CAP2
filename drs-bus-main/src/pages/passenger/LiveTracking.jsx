import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, Satellite, WifiOff, LocateFixed, Clock } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import InlineAlert from "../../components/common/InlineAlert";
import LocationPermissionCard from "../../components/common/LocationPermissionCard";
import { useGeolocation } from "../../hooks/useGeolocation";
import * as api from "../../lib/api";
import { getSocket } from "../../lib/socket";
import { mapTrip, formatTime } from "../../lib/format";
import { distanceKm, formatDistance, timeAgo } from "../../lib/geo";

// Bundlers rewrite the default Leaflet marker image URLs, which otherwise
// 404 — this is the standard fix.
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const STALE_MS = 5 * 60 * 1000; // no fix for 5 min: likely a Cordillera dead zone — say so

// Follow one trip's bus live. The passenger's own position is optional
// here ("Show me on the map"): it's only requested when they tap the
// button, through the normal browser prompt, and a refusal just hides the
// "you" dot — the bus map keeps working.
export default function LiveTracking() {
  const { tripId } = useParams();
  const [trip, setTrip] = useState(null);
  const [position, setPosition] = useState(null); // bus: { latitude, longitude, timestamp, sync_status }
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [wantsMe, setWantsMe] = useState(false);
  const { status: myStatus, position: me, request: requestMe, stop: stopMe } = useGeolocation();

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const busMarkerRef = useRef(null);
  const meMarkerRef = useRef(null);

  // 1. Resolve the trip -> bus_id, then get the last known point.
  useEffect(() => {
    let cancelled = false;
    api
      .getTrip(tripId)
      .then((row) => {
        if (cancelled) return null;
        const mapped = mapTrip(row);
        setTrip(mapped);
        return api.getLatestLocation(mapped.busId).catch(() => null);
      })
      .then((point) => {
        if (!cancelled && point) {
          setPosition({
            latitude: Number(point.latitude),
            longitude: Number(point.longitude),
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

  // 2. Live updates over Socket.io. Rejoin on reconnect — the server drops
  // room membership when a connection blips, which used to freeze this map
  // until a manual refresh.
  useEffect(() => {
    if (!trip?.busId) return undefined;
    const socket = getSocket();
    const join = () => socket.emit("subscribe:bus", trip.busId);
    join();
    function handleUpdate(point) {
      if (Number(point.busId) !== trip.busId) return;
      setPosition({
        latitude: Number(point.latitude),
        longitude: Number(point.longitude),
        timestamp: point.timestamp,
        sync_status: point.syncStatus,
      });
    }
    socket.on("location:update", handleUpdate);
    socket.on("connect", join);
    return () => {
      socket.emit("unsubscribe:bus", trip.busId);
      socket.off("location:update", handleUpdate);
      socket.off("connect", join);
    };
  }, [trip?.busId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  // 3. Map: created once the bus has a position; bus + optional "you" dot.
  useEffect(() => {
    if (!position || !mapContainerRef.current) return;
    const latLng = [position.latitude, position.longitude];
    if (!mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current).setView(latLng, 13);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
      }).addTo(mapRef.current);
      busMarkerRef.current = L.marker(latLng).bindTooltip("Bus").addTo(mapRef.current);
    } else {
      busMarkerRef.current.setLatLng(latLng);
      if (!meMarkerRef.current) mapRef.current.panTo(latLng);
    }
  }, [position]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!wantsMe || !me) {
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
      return;
    }
    const latLng = [me.latitude, me.longitude];
    if (!meMarkerRef.current) {
      meMarkerRef.current = L.circleMarker(latLng, { radius: 8, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 })
        .bindTooltip("You")
        .addTo(map);
      if (position) map.fitBounds([latLng, [position.latitude, position.longitude]], { padding: [40, 40], maxZoom: 15, animate: false });
    } else {
      meMarkerRef.current.setLatLng(latLng);
    }
  }, [me, wantsMe, position]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
    },
    []
  );

  function handleShowMe() {
    setWantsMe(true);
    requestMe();
  }
  function handleHideMe() {
    setWantsMe(false);
    stopMe();
  }

  const isStale = position && now - new Date(position.timestamp).getTime() > STALE_MS;
  const distance = wantsMe && me && position ? distanceKm(me, position) : null;

  // What the trip's own status means for tracking, in plain words.
  const tripNotice = !trip
    ? null
    : trip.status === "Scheduled"
      ? `This bus departs at ${trip.departureTime}. Live tracking starts when boarding opens.`
      : trip.status === "Completed"
        ? "This trip has finished."
        : trip.status === "Cancelled"
          ? "This trip was cancelled."
          : null;

  return (
    <div className="max-w-md mx-auto lg:max-w-3xl px-4 py-6 space-y-4">
      <Link to="/passenger/my-bookings" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-brand-green-600">
        <ChevronLeft className="w-4 h-4" /> My Bookings
      </Link>

      <header>
        <h1 className="font-display text-xl font-bold">Track your bus</h1>
        {trip && (
          <p className="text-sm text-ink-600">
            {trip.origin} → {trip.destination} · {trip.plateNumber ?? `Trip ${tripId}`}
            {trip.status && ` · ${trip.status}`}
          </p>
        )}
      </header>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />

      {tripNotice && (
        <p className="flex gap-2 text-sm rounded-2xl p-4 bg-brand-sunrise-400/15">
          <Clock className="w-4 h-4 mt-0.5 shrink-0" />
          {tripNotice}
        </p>
      )}

      {!position ? (
        !tripNotice && (
          <div className="flex flex-col items-center text-center gap-2 py-16 rounded-2xl border border-dashed border-slate-200 bg-white/60">
            <WifiOff className="w-8 h-8 text-ink-600/50" strokeWidth={1.5} />
            <p className="font-display font-semibold">Waiting for the bus's location</p>
            <p className="text-sm text-ink-600 max-w-xs">
              The driver's phone hasn't sent a position yet, or the bus is in a no-signal area. It'll appear here automatically.
            </p>
          </div>
        )
      ) : (
        <>
          <div ref={mapContainerRef} className="relative isolate w-full h-80 lg:h-[26rem] rounded-3xl overflow-hidden border border-slate-100 shadow-sm" />
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white border border-slate-100 shadow-sm px-4 py-3 text-sm">
            <span className={`flex items-center gap-1.5 ${isStale ? "text-brand-sunrise-500 font-medium" : "text-ink-600"}`}>
              {isStale ? <WifiOff className="w-4 h-4" /> : <Satellite className="w-4 h-4 text-brand-green-600" />}
              {isStale ? `Last seen ${timeAgo(position.timestamp)} — may be out of signal` : `Updated ${formatTime(position.timestamp)}`}
            </span>
            {distance != null && <span className="font-semibold">{formatDistance(distance)} from you</span>}
            {position.sync_status === "buffered" && <span className="text-xs font-medium text-brand-sunrise-500">Catching up after a signal drop</span>}
          </div>

          {!wantsMe ? (
            <button
              type="button"
              onClick={handleShowMe}
              className="w-full flex items-center justify-center gap-2 border border-slate-200 bg-white hover:bg-slate-50 font-display font-semibold rounded-xl py-2.5"
            >
              <LocateFixed className="w-4 h-4 text-brand-green-600" /> Show me on the map
            </button>
          ) : myStatus === "ok" ? (
            <button type="button" onClick={handleHideMe} className="text-sm text-ink-600 underline">
              Stop showing my location
            </button>
          ) : (
            <LocationPermissionCard status={myStatus} onRequest={requestMe} compact reason="See how far the bus is from you." />
          )}
        </>
      )}
    </div>
  );
}
