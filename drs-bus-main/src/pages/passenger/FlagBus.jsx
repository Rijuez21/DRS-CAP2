import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Hand,
  LocateFixed,
  Bus,
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  CheckCircle2,
  XCircle,
  CalendarClock,
  WifiOff,
} from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import EmptyState from "../../components/common/EmptyState";
import InlineAlert from "../../components/common/InlineAlert";
import { useAuth } from "../../context/AuthContext";
import * as api from "../../lib/api";
import { getSocket } from "../../lib/socket";
import { useGeolocation } from "../../hooks/useGeolocation";
import LocationPermissionCard from "../../components/common/LocationPermissionCard";
import { distanceKm, formatDistance, timeAgo } from "../../lib/geo";

// Passenger Mode 2 — "Flag a Bus". For someone standing along the route
// (not at the terminal) who wants to catch a bus that's already on the
// road ("umaandar na"). Deliberately a separate page from the Book Ahead
// flow (TripListings -> TripDetail -> SeatMap): that flow reserves a
// specific seat in advance and has no map; this one is GPS-first, has no
// seat picker, and sends a hail the driver answers in real time.
//
// Data sources, all existing infrastructure:
//   - GET /api/tracking/in-transit     first paint: every In Transit trip + its bus's last GPS point
//   - "subscribe:bus" / "location:update"  live movement, same per-bus rooms LiveTracking.jsx uses
//   - POST /api/bookings/flags         the hail itself (see buildFlagRequestsRouter in bookings.js)
//   - "flag:updated" on passenger:<id>  driver's answer, pushed to the room NotificationBell already joins

const DEFAULT_CENTER = [16.4023, 120.596]; // Baguio City — only used until the passenger's own GPS fix arrives
const BUS_LIST_REFRESH_MS = 30000; // picks up buses that just went In Transit + fresh seat counts; movement itself is live over the socket
const STALE_LOCATION_MS = 5 * 60 * 1000; // older than this, the bus is probably in a dead zone — say so instead of implying it's parked there
const FLAG_TTL_MINUTES = 15; // mirrors FLAG_TTL_MINUTES in server/src/routes/bookings.js — display only, the server sweeper is authoritative
const RECENT_FLAG_WINDOW_MS = 30 * 60 * 1000; // after a refresh, still show a flag's outcome if it's this recent
const TREND_THRESHOLD_KM = 0.05; // ignore GPS jitter smaller than ~50 m when deciding approaching vs moving away
// The driver stops exactly where the passenger is, so a flag needs a real
// GPS fix, never a typed description alone. Mirrors MAX_PICKUP_ACCURACY_M
// in server/src/routes/bookings.js (the server enforces it; this only
// keeps the button honest). Worse than this is a Wi-Fi/cell-tower guess.
const MAX_PICKUP_ACCURACY_M = 100;
// While a flag is open the pickup pin follows the passenger: resend only
// after real movement (not GPS jitter) and not more often than this, so a
// passenger pacing at the roadside doesn't flood the driver with updates.
const PIN_MOVE_THRESHOLD_KM = 0.02; // 20 m
const PIN_UPDATE_MIN_INTERVAL_MS = 15000;

function isPreciseFix(me) {
  return Boolean(me) && me.accuracy != null && me.accuracy <= MAX_PICKUP_ACCURACY_M;
}

const DECLINE_OR_CLOSED = ["Declined", "Expired", "Cancelled"];

function isOpenFlag(flag) {
  return Boolean(flag) && (flag.status === "Pending" || (flag.status === "Acknowledged" && flag.booking_status === "Confirmed"));
}

function seatsLeft(bus) {
  return bus.capacity == null ? null : Math.max(0, bus.capacity - Number(bus.booked_count ?? 0));
}

// DECIMAL columns come back from mysql2 as strings ("16.4100000"); a live
// socket point is whatever the driver's device posted. Normalize once on
// the way in so every distance/marker calculation downstream sees numbers.
function toPoint(lat, lng) {
  if (lat == null || lng == null) return { latitude: null, longitude: null };
  return { latitude: Number(lat), longitude: Number(lng) };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Pill-shaped divIcon labelled with the terminal-facing bus number (108,
// 208…) — that's what's painted on the bus and what a passenger on the
// roadside can actually read, not the plate.
function busIcon(bus, { selected }) {
  const left = seatsLeft(bus);
  const bg = left == null || left === 0 ? "#64748b" : "#2f9e5c";
  const ring = selected ? "box-shadow:0 0 0 3px #f0a63a,0 1px 4px rgba(0,0,0,.45);" : "box-shadow:0 1px 4px rgba(0,0,0,.45);";
  const label = escapeHtml(bus.bus_number ?? bus.plate_num);
  return L.divIcon({
    className: "",
    html: `<div style="transform:translate(-50%,-50%);display:inline-flex;align-items:center;gap:4px;white-space:nowrap;padding:3px 8px;border-radius:9999px;background:${bg};color:#fff;font:600 12px/1.2 Inter,sans-serif;border:2px solid #fff;${ring}">🚌 ${label}</div>`,
    iconSize: [0, 0],
  });
}

export default function FlagBus() {
  const { user } = useAuth();

  const [routes, setRoutes] = useState([]);
  const [origin, setOrigin] = useState("");
  const [destinationRouteId, setDestinationRouteId] = useState("");

  const [buses, setBuses] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  // Passenger's own GPS via the shared hook: asks through the browser
  // prompt only after they tap "Share my location" (or silently if they
  // allowed it on an earlier visit). See hooks/useGeolocation.js.
  const { status: geoStatus, position: me, request: requestLocation } = useGeolocation();

  const [selectedTripId, setSelectedTripId] = useState(null);
  const [landmark, setLandmark] = useState("");
  const [flag, setFlag] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // A clock held in state (ticked below) rather than Date.now() read during
  // render, so "last seen 2m ago" / "expires in N min" stay pure renders
  // that still refresh on their own.
  const [now, setNow] = useState(() => Date.now());

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const busMarkersRef = useRef(new Map()); // trip_id -> L.Marker
  const meMarkerRef = useRef(null);
  const hasFitRef = useRef(false);
  const meRef = useRef(null); // latest `me` for the socket handler, which is bound once per bus set
  const lastPinRef = useRef({ flagId: null, point: null, at: 0 }); // last pickup pin sent to the server

  // ---- Direction / "my route" filter -----------------------------------
  // routes is one row per km post ("Baguio -> <stop>"), so picking your
  // own stop gives a distance, and only buses travelling at least that far
  // are useful to you (server: ?minDistance=).
  useEffect(() => {
    api.getRoutes().then(setRoutes).catch(() => setRoutes([]));
  }, []);

  const origins = useMemo(() => [...new Set(routes.map((r) => r.origin))].sort(), [routes]);
  const destinations = useMemo(
    () =>
      routes
        .filter((r) => !origin || r.origin === origin)
        .sort((a, b) => Number(a.distance ?? 0) - Number(b.distance ?? 0)),
    [routes, origin]
  );
  const minDistance = routes.find((r) => String(r.route_id) === destinationRouteId)?.distance ?? undefined;

  // ---- In-transit buses (REST snapshot, refreshed) ----------------------
  const loadBuses = useCallback(() => {
    return api
      .getInTransitBuses({ origin: origin || undefined, minDistance })
      .then((rows) => {
        setBuses((prev) => {
          const prevByTrip = new Map(prev.map((b) => [b.trip_id, b]));
          return rows.map((row) => {
            const fresh = { ...row, ...toPoint(row.latitude, row.longitude) };
            const old = prevByTrip.get(row.trip_id);
            if (!old) return fresh;
            // A socket update may already be newer than what this REST
            // snapshot read from MySQL — never move a marker backwards.
            const oldIsNewer = old.timestamp && (!fresh.timestamp || new Date(old.timestamp) > new Date(fresh.timestamp));
            return oldIsNewer
              ? { ...fresh, latitude: old.latitude, longitude: old.longitude, timestamp: old.timestamp, sync_status: old.sync_status, trend: old.trend }
              : { ...fresh, trend: old.trend };
          });
        });
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [origin, minDistance]);

  useEffect(() => {
    loadBuses();
    const id = setInterval(loadBuses, BUS_LIST_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadBuses]);

  // ---- Passenger's own GPS --------------------------------------------
  // The pickup point is always the phone's real, precise fix (your "exact
  // location" rule) — there is no typed-landmark substitute. Without it the
  // form shows LocationPermissionCard: why it's needed, and how to allow it.
  useEffect(() => {
    meRef.current = me;
  }, [me]);

  // ---- My flag request (restore + live updates) ------------------------
  const refreshMyFlag = useCallback(() => {
    api
      .getMyFlagRequests()
      .then((rows) => {
        const latest = rows[0];
        const isRecent = latest && Date.now() - new Date(latest.requested_at).getTime() < RECENT_FLAG_WINDOW_MS;
        setFlag(latest && (isOpenFlag(latest) || isRecent) ? latest : null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    refreshMyFlag();

    const socket = getSocket();
    // Joining is idempotent, and NotificationBell (PassengerLayout) already
    // joined this room — re-emitting here covers the case that matters on
    // Cordillera roads: the socket dropped and reconnected, which silently
    // empties its server-side rooms. We never *leave* the room from here,
    // since that would also cut off the bell; the bell owns leaving.
    const join = () => socket.emit("subscribe:notifications", { recipientType: "passenger", recipientId: user.id });
    join();

    function handleFlagUpdated(updated) {
      setFlag((prev) => (!prev || prev.flag_id === updated.flag_id ? updated : prev));
    }
    function handleReconnect() {
      join();
      refreshMyFlag(); // catch an answer that arrived while we were offline
    }
    socket.on("flag:updated", handleFlagUpdated);
    socket.on("connect", handleReconnect);
    return () => {
      socket.off("flag:updated", handleFlagUpdated);
      socket.off("connect", handleReconnect);
    };
  }, [user, refreshMyFlag]);

  // Seat counts change when a flag is acknowledged/cancelled — refresh.
  const flagStatusKey = flag ? `${flag.flag_id}:${flag.status}:${flag.booking_status ?? ""}` : "";
  useEffect(() => {
    if (flagStatusKey) loadBuses();
  }, [flagStatusKey, loadBuses]);

  // Keep the pickup pin on the passenger while the flag is open. If they
  // walk after flagging, the driver's pin moves with them — the stop is
  // where they are now. Imprecise fixes are skipped rather than sent, so a
  // momentary bad reading never replaces a good pin with a worse one.
  const openFlagId = isOpenFlag(flag) ? flag.flag_id : null;
  useEffect(() => {
    if (!openFlagId || !isPreciseFix(me)) return;
    const last = lastPinRef.current;
    if (last.flagId !== openFlagId) {
      // First look at this flag (just sent, or restored after a refresh):
      // the server already holds the pin it was created with.
      lastPinRef.current = { flagId: openFlagId, point: { latitude: flag.pickup_latitude, longitude: flag.pickup_longitude }, at: Date.now() };
      return;
    }
    const moved = distanceKm(last.point, me);
    if (moved == null || moved < PIN_MOVE_THRESHOLD_KM || Date.now() - last.at < PIN_UPDATE_MIN_INTERVAL_MS) return;

    lastPinRef.current = { flagId: openFlagId, point: { latitude: me.latitude, longitude: me.longitude }, at: Date.now() };
    api
      .updateFlagLocation(openFlagId, { pickupLatitude: me.latitude, pickupLongitude: me.longitude, pickupAccuracy: me.accuracy })
      .then((updated) => setFlag((prev) => (prev?.flag_id === updated.flag_id ? updated : prev)))
      .catch(() => {}); // flag closed meanwhile, or offline — the next movement retries
    // flag.pickup_* are read only to seed the ref for a newly seen flag, keyed by openFlagId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFlagId, me]);

  // ---- Live bus movement over the existing per-bus rooms ---------------
  const busIdsKey = useMemo(
    () => [...new Set(buses.map((b) => b.bus_id))].sort((a, b) => a - b).join(","),
    [buses]
  );

  useEffect(() => {
    if (!busIdsKey) return;
    const ids = busIdsKey.split(",").map(Number);
    const socket = getSocket();
    const joinAll = () => ids.forEach((id) => socket.emit("subscribe:bus", id));
    joinAll();

    function handleUpdate(point) {
      const next = toPoint(point.latitude, point.longitude);
      setBuses((prev) =>
        prev.map((b) => {
          if (b.bus_id !== Number(point.busId)) return b;
          // Approaching vs moving away is inferred from successive
          // distances to the passenger — there's no route polyline in the
          // schema to say "already passed your stop", so this is the
          // honest signal available.
          const before = distanceKm(meRef.current, b);
          const after = distanceKm(meRef.current, next);
          let trend = b.trend;
          if (before != null && after != null && Math.abs(after - before) > TREND_THRESHOLD_KM) {
            trend = after < before ? "approaching" : "away";
          }
          return { ...b, ...next, timestamp: point.timestamp, sync_status: point.syncStatus, trend };
        })
      );
    }
    socket.on("location:update", handleUpdate);
    socket.on("connect", joinAll); // rooms are lost on reconnect

    return () => {
      ids.forEach((id) => socket.emit("unsubscribe:bus", id));
      socket.off("location:update", handleUpdate);
      socket.off("connect", joinAll);
    };
  }, [busIdsKey]);

  // Keep "12s ago" labels fresh without refetching.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  // ---- Map ----------------------------------------------------------------
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    mapRef.current = L.map(mapContainerRef.current).setView(DEFAULT_CENTER, 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(mapRef.current);

    const markers = busMarkersRef.current;
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      meMarkerRef.current = null;
      hasFitRef.current = false;
      markers.clear();
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !me) return;
    const latLng = [me.latitude, me.longitude];
    if (!meMarkerRef.current) {
      meMarkerRef.current = L.circleMarker(latLng, {
        radius: 8,
        color: "#ffffff",
        weight: 3,
        fillColor: "#2563eb",
        fillOpacity: 1,
      })
        .bindTooltip("You — the bus stops here", { direction: "top", offset: [0, -8] })
        .addTo(mapRef.current);
    } else {
      meMarkerRef.current.setLatLng(latLng);
    }
  }, [me]);

  const highlightTripId = isOpenFlag(flag) ? flag.trip_id : selectedTripId;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = busMarkersRef.current;
    const liveTripIds = new Set();

    for (const bus of buses) {
      if (bus.latitude == null || bus.longitude == null) continue;
      liveTripIds.add(bus.trip_id);
      const icon = busIcon(bus, { selected: bus.trip_id === highlightTripId });
      const existing = markers.get(bus.trip_id);
      if (existing) {
        existing.setLatLng([bus.latitude, bus.longitude]);
        existing.setIcon(icon);
      } else {
        const marker = L.marker([bus.latitude, bus.longitude], { icon }).addTo(map);
        marker.on("click", () => setSelectedTripId(bus.trip_id));
        markers.set(bus.trip_id, marker);
      }
    }
    for (const [tripId, marker] of markers) {
      if (!liveTripIds.has(tripId)) {
        marker.remove();
        markers.delete(tripId);
      }
    }

    // Frame the passenger + every bus once, the first time both are known;
    // after that the passenger controls the map.
    if (!hasFitRef.current && liveTripIds.size > 0) {
      const points = buses.filter((b) => b.latitude != null).map((b) => [b.latitude, b.longitude]);
      if (me) points.push([me.latitude, me.longitude]);
      // animate: false on both framing moves — if the passenger's GPS fix
      // lands first, the animated setView below is still mid-flight when
      // the buses arrive, and its finishing zoom would override this fit,
      // leaving buses off-screen.
      map.fitBounds(points, { padding: [40, 40], maxZoom: 14, animate: false });
      hasFitRef.current = true;
    } else if (!hasFitRef.current && me) {
      map.setView([me.latitude, me.longitude], 13, { animate: false });
    }
  }, [buses, highlightTripId, me]);

  useEffect(() => {
    if (!selectedTripId || !mapRef.current) return;
    const marker = busMarkersRef.current.get(selectedTripId);
    if (marker) mapRef.current.panTo(marker.getLatLng());
  }, [selectedTripId]);

  // ---- Derived list ---------------------------------------------------------
  const sortedBuses = useMemo(() => {
    const withDistance = buses.map((b) => ({ ...b, distance: distanceKm(me, b) }));
    return withDistance.sort((a, b) => {
      if (a.distance == null && b.distance == null) return 0;
      if (a.distance == null) return 1;
      if (b.distance == null) return -1;
      return a.distance - b.distance;
    });
  }, [buses, me]);

  const selectedBus = sortedBuses.find((b) => b.trip_id === selectedTripId) ?? null;

  // ---- Actions ------------------------------------------------------------
  async function handleFlag() {
    if (!selectedBus) return;
    setError("");
    setIsSubmitting(true);
    try {
      const created = await api.createFlagRequest({
        tripId: selectedBus.trip_id,
        pickupLatitude: me?.latitude,
        pickupLongitude: me?.longitude,
        pickupAccuracy: me?.accuracy,
        pickupLandmark: landmark.trim() || undefined,
      });
      setFlag(created);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancelFlag() {
    if (!flag) return;
    if (!window.confirm("Cancel your flag request? The driver will be told not to stop.")) return;
    try {
      setFlag(await api.cancelFlagRequest(flag.flag_id));
    } catch (err) {
      setError(err.message);
    }
  }

  function handleDismissFlag() {
    setFlag(null);
    setSelectedTripId(null);
  }

  const hasOpenFlag = isOpenFlag(flag);

  return (
    <div className="max-w-md mx-auto lg:max-w-5xl px-4 py-6 space-y-5">
      <header className="space-y-1">
        <h1 className="font-display text-xl font-bold flex items-center gap-2">
          <Hand className="w-5 h-5 text-brand-green-600" /> Flag a Bus
        </h1>
        <p className="text-sm text-ink-600">
          Waiting along the road? Pick a bus that's already on its way and let the driver know to stop for you.
        </p>
        <p className="text-xs text-ink-600">
          At the terminal instead?{" "}
          <Link to="/passenger/trips" className="font-medium text-brand-green-600 hover:underline">
            Book ahead and choose your seat
          </Link>
        </p>
      </header>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />

      {!hasOpenFlag && (
        <LocationPermissionCard
          status={geoStatus}
          onRequest={requestLocation}
          reason="The bus stops exactly where you're standing, so we need your phone's location. It's shared only with the driver of the bus you flag."
        />
      )}

      <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-6 lg:items-start space-y-5 lg:space-y-0">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-semibold uppercase tracking-wide text-ink-600 mb-1.5">Leaving from</span>
              <select
                value={origin}
                onChange={(e) => {
                  setOrigin(e.target.value);
                  setDestinationRouteId("");
                }}
                className="input bg-white"
              >
                <option value="">Any direction</option>
                {origins.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-semibold uppercase tracking-wide text-ink-600 mb-1.5">Your stop</span>
              <select value={destinationRouteId} onChange={(e) => setDestinationRouteId(e.target.value)} className="input bg-white">
                <option value="">Any stop</option>
                {destinations.map((r) => (
                  <option key={r.route_id} value={r.route_id}>
                    {r.destination}{r.distance != null ? ` (${r.distance} km)` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* isolate: Leaflet's panes/controls and the badge use z-index 400+;
              a local stacking context keeps them from painting over the
              sticky mobile header (z-20) when the page scrolls. */}
          <div className="relative isolate">
            <div
              ref={mapContainerRef}
              className="w-full h-80 lg:h-[26rem] rounded-3xl overflow-hidden border border-slate-100 shadow-sm z-0"
            />
            <LocationBadge status={geoStatus} me={me} />
          </div>

          <section className="space-y-3">
            <h2 className="font-display font-semibold text-lg">Buses on the road</h2>
            {isLoading ? (
              <p className="text-sm text-ink-600">Loading…</p>
            ) : sortedBuses.length === 0 ? (
              <EmptyState
                icon={Bus}
                title="No buses in transit right now"
                description="Buses show up here once their driver starts the trip. You can also reserve a seat on a scheduled departure."
                action={
                  <Link to="/passenger/trips" className="text-sm font-medium text-brand-green-600 hover:underline">
                    Book ahead instead
                  </Link>
                }
              />
            ) : (
              <div className="space-y-2.5">
                {sortedBuses.map((bus) => (
                  <BusRow
                    key={bus.trip_id}
                    bus={bus}
                    now={now}
                    isSelected={bus.trip_id === highlightTripId}
                    disabled={hasOpenFlag}
                    onSelect={() => setSelectedTripId(bus.trip_id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="lg:sticky lg:top-6">
          {flag ? (
            <FlagStatusCard flag={flag} now={now} onCancel={handleCancelFlag} onDismiss={handleDismissFlag} />
          ) : (
            <FlagForm
              bus={selectedBus}
              me={me}
              geoStatus={geoStatus}
              landmark={landmark}
              onLandmarkChange={setLandmark}
              onSubmit={handleFlag}
              isSubmitting={isSubmitting}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function LocationBadge({ status, me }) {
  const precise = status === "ok" && isPreciseFix(me);
  const text =
    status === "ok"
      ? precise
        ? `Exact location · ±${Math.round(me.accuracy)} m`
        : `Getting a precise fix… ±${Math.round(me?.accuracy ?? 0)} m`
      : status === "locating"
        ? "Finding your location…"
        : status === "idle"
          ? "Location not shared yet"
          : status === "denied"
            ? "Location blocked — needed to flag a bus"
            : "Location unavailable — needed to flag a bus";
  const tone = precise ? "text-brand-green-600" : ["locating", "ok", "idle"].includes(status) ? "text-ink-600" : "text-rose-600";
  return (
    <div className="absolute top-3 left-3 z-[400] flex items-center gap-1.5 rounded-full bg-white/95 shadow px-3 py-1.5 text-xs font-medium">
      <LocateFixed className={`w-3.5 h-3.5 ${tone}`} />
      <span className={tone}>{text}</span>
    </div>
  );
}

function BusRow({ bus, now, isSelected, disabled, onSelect }) {
  const left = seatsLeft(bus);
  const isStale = bus.timestamp && now - new Date(bus.timestamp).getTime() > STALE_LOCATION_MS;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled && !isSelected}
      className={`w-full text-left rounded-2xl bg-white border p-4 shadow-sm transition space-y-1.5 disabled:opacity-50 ${
        isSelected ? "border-brand-sunrise-500 ring-2 ring-brand-sunrise-400/40" : "border-slate-100 hover:border-brand-green-500/50 hover:shadow-md"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-display font-semibold">
          Bus {bus.bus_number ?? "—"} <span className="text-ink-600 font-normal text-sm">· {bus.plate_num}</span>
        </p>
        <span
          className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
            left == null ? "bg-slate-400/15 text-slate-500" : left === 0 ? "bg-rose-500/15 text-rose-600" : "bg-brand-green-500/15 text-brand-green-600"
          }`}
        >
          {left == null ? "Capacity n/a" : left === 0 ? "Full" : `${left} seat${left === 1 ? "" : "s"} left`}
        </span>
      </div>
      <p className="text-sm text-ink-600">
        {bus.origin} → {bus.destination}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-600">
        {bus.distance != null && <span className="font-medium text-ink-900">{formatDistance(bus.distance)} away</span>}
        {bus.trend === "approaching" && (
          <span className="flex items-center gap-0.5 text-brand-green-600 font-medium">
            <ArrowDownRight className="w-3.5 h-3.5" /> getting closer
          </span>
        )}
        {bus.trend === "away" && (
          <span className="flex items-center gap-0.5 text-brand-sunrise-500 font-medium">
            <ArrowUpRight className="w-3.5 h-3.5" /> moving away
          </span>
        )}
        {bus.latitude == null ? (
          <span className="flex items-center gap-1"><WifiOff className="w-3.5 h-3.5" /> No GPS yet</span>
        ) : isStale ? (
          <span className="flex items-center gap-1 text-brand-sunrise-500"><WifiOff className="w-3.5 h-3.5" /> Last seen {timeAgo(bus.timestamp)} — may be in a dead zone</span>
        ) : (
          <span>GPS {timeAgo(bus.timestamp)}</span>
        )}
      </div>
    </button>
  );
}

function FlagForm({ bus, me, geoStatus, landmark, onLandmarkChange, onSubmit, isSubmitting }) {
  if (!bus) {
    return (
      <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5 text-sm text-ink-600 space-y-2">
        <p className="font-display font-semibold text-ink-900">Choose a bus</p>
        <p>Tap a bus on the map or in the list to flag it. Buses closest to you are listed first.</p>
      </div>
    );
  }

  const left = seatsLeft(bus);
  const hasLocation = geoStatus === "ok" && Boolean(me);
  const precise = hasLocation && isPreciseFix(me);

  // Order matters: tell the passenger the one thing they can act on.
  let blockReason = "";
  if (left == null) blockReason = "This bus's seating capacity isn't on file, so it can't take flag requests.";
  else if (left === 0) blockReason = "This bus is full. Try another bus.";
  else if (!hasLocation) blockReason = "location"; // rendered as LocationPermissionCard below
  else if (!precise) blockReason = `Getting a precise fix (±${Math.round(me.accuracy)} m, need ±${MAX_PICKUP_ACCURACY_M} m). Stand in the open for a few seconds.`;

  return (
    <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5 space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-600">Flagging</p>
        <p className="font-display text-lg font-bold">
          Bus {bus.bus_number ?? "—"} · {bus.plate_num}
        </p>
        <p className="text-sm text-ink-600">
          {bus.origin} → {bus.destination}
          {bus.distance != null && ` · ${formatDistance(bus.distance)} from you`}
        </p>
      </div>

      <p className="text-sm text-ink-600">
        The bus stops at <strong className="text-ink-900">your exact GPS location</strong> (the blue dot). Stay where you are
        — if you do move, your pickup point updates for the driver automatically.
      </p>

      <label className="block">
        <span className="block text-xs font-semibold uppercase tracking-wide text-ink-600 mb-1.5">
          Help the driver spot you (optional)
        </span>
        <input
          type="text"
          value={landmark}
          onChange={(e) => onLandmarkChange(e.target.value)}
          maxLength={150}
          placeholder="e.g. yellow umbrella, by the waiting shed"
          className="input"
        />
      </label>

      <p className="text-xs text-ink-600">
        No seat selection — the conductor will seat you once you board. Fare is paid on the bus.
      </p>

      {blockReason === "location" ? (
        <p className="text-sm text-rose-600 font-medium">
          {geoStatus === "locating" ? "Finding your exact location…" : "Share your location (at the top of the page) to flag this bus."}
        </p>
      ) : (
        blockReason && <p className="text-sm text-rose-600 font-medium">{blockReason}</p>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={Boolean(blockReason) || isSubmitting}
        className="w-full flex items-center justify-center gap-2 bg-brand-green-600 hover:bg-brand-green-500 disabled:opacity-50 transition-colors text-white font-display font-semibold rounded-xl py-3"
      >
        <Hand className="w-4 h-4" />
        {isSubmitting ? "Sending…" : "Flag this bus"}
      </button>
    </div>
  );
}

function FlagStatusCard({ flag, now, onCancel, onDismiss }) {
  const busLabel = flag.bus_number ? `Bus ${flag.bus_number} (${flag.plate_num})` : `Bus ${flag.plate_num}`;
  const expiresAt = new Date(flag.requested_at).getTime() + FLAG_TTL_MINUTES * 60 * 1000;
  // Clamped: DB timestamps have 1-second precision, so right after sending,
  // rounding up could otherwise show "16 min" on a 15-minute window.
  const minutesLeft = Math.min(FLAG_TTL_MINUTES, Math.max(0, Math.ceil((expiresAt - now) / 60000)));

  if (flag.status === "Pending") {
    return (
      <StatusShell tone="amber" icon={Clock} title="Waiting for the driver…">
        <p>
          {busLabel} has been notified and can see your exact location. Wave the bus down when you see it.
        </p>
        <p className="text-xs">Keep this page open with location on — if you move, your pickup point moves with you.</p>
        <p className="text-xs">If the driver doesn't respond in about {minutesLeft} min, this request expires on its own.</p>
        <CancelButton onClick={onCancel} />
      </StatusShell>
    );
  }

  if (flag.status === "Acknowledged") {
    if (flag.booking_status === "Boarded") {
      return (
        <StatusShell tone="green" icon={CheckCircle2} title="You're on board">
          <p>Safe trip! Your ride is in My Bookings.</p>
          <BookingLink flag={flag} />
          <DismissButton onClick={onDismiss} label="Done" />
        </StatusShell>
      );
    }
    if (flag.booking_status !== "Confirmed") {
      return (
        <StatusShell tone="slate" icon={XCircle} title="This ride was closed">
          <p>The booking for this flag is now {String(flag.booking_status ?? "closed").toLowerCase()}.</p>
          <DismissButton onClick={onDismiss} label="Flag another bus" />
        </StatusShell>
      );
    }
    return (
      <StatusShell tone="green" icon={CheckCircle2} title="The bus is stopping for you">
        <p>
          {busLabel} will pick you up at your current location. Seat <strong>{flag.seat_number}</strong> is being held — pay the conductor on board.
        </p>
        <p className="text-xs">Stay where you are and keep this page open so the driver's pin stays on you.</p>
        <BookingLink flag={flag} />
        <CancelButton onClick={onCancel} label="I no longer need this ride" />
      </StatusShell>
    );
  }

  const closed = {
    Declined: { title: "The driver can't stop", body: flag.decline_reason ? `${busLabel}: ${flag.decline_reason}.` : `${busLabel} can't pick you up.` },
    Expired: { title: "No response in time", body: `${busLabel} didn't answer. It may be out of signal — try again or flag another bus.` },
    Cancelled: { title: "Flag cancelled", body: "The driver has been told not to stop." },
  }[flag.status];

  return (
    <StatusShell tone={flag.status === "Declined" ? "rose" : "slate"} icon={XCircle} title={closed?.title ?? flag.status}>
      <p>{closed?.body}</p>
      {DECLINE_OR_CLOSED.includes(flag.status) && <DismissButton onClick={onDismiss} label="Flag another bus" />}
    </StatusShell>
  );
}

const TONES = {
  amber: "bg-amber-50 border-amber-200 text-amber-900",
  green: "bg-emerald-50 border-emerald-200 text-emerald-900",
  rose: "bg-rose-50 border-rose-200 text-rose-900",
  slate: "bg-slate-50 border-slate-200 text-slate-800",
};

function StatusShell({ tone, icon: Icon, title, children }) {
  return (
    <div role="status" className={`rounded-3xl border p-5 space-y-3 text-sm ${TONES[tone]}`}>
      <p className="font-display text-lg font-bold flex items-center gap-2">
        <Icon className="w-5 h-5" /> {title}
      </p>
      {children}
    </div>
  );
}

function BookingLink({ flag }) {
  if (!flag.booking_id) return null;
  return (
    <Link to={`/passenger/my-bookings/${flag.booking_id}`} className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
      <CalendarClock className="w-4 h-4" /> View booking #{flag.booking_id}
    </Link>
  );
}

function CancelButton({ onClick, label = "Cancel flag request" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full border border-rose-300 text-rose-600 bg-white hover:bg-rose-50 transition-colors font-display font-semibold rounded-xl py-2.5"
    >
      {label}
    </button>
  );
}

function DismissButton({ onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full bg-brand-green-600 hover:bg-brand-green-500 transition-colors text-white font-display font-semibold rounded-xl py-2.5"
    >
      {label}
    </button>
  );
}
