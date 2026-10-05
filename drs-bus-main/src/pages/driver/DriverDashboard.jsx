import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { WifiOff, Satellite, MapPinOff, LocateFixed } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useDriverLocation } from "../../hooks/useDriverLocation";
import FlagRequestsPanel from "../../components/driver/FlagRequestsPanel";
import StatusBadge from "../../components/common/StatusBadge";
import InlineAlert from "../../components/common/InlineAlert";
import * as api from "../../lib/api";
import { formatDate, formatTime } from "../../lib/format";

// One step forward at a time — the same machine the server enforces
// (trips.js DRIVER_NEXT). Labels say what the tap does, in driver terms.
const NEXT = {
  Scheduled: { to: "Boarding", label: "Start boarding" },
  Boarding: { to: "In Transit", label: "Depart — start trip" },
  "In Transit": { to: "Completed", label: "Arrived — complete trip" },
};

export default function DriverDashboard() {
  const { user } = useAuth();
  const [trips, setTrips] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [updatingId, setUpdatingId] = useState(null);

  const reload = useCallback(() => {
    if (!user) return;
    api
      .getTrips({ driverId: user.id })
      .then(setTrips)
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [user]);
  useEffect(reload, [reload]);

  // GPS is shared from Boarding onward — that's when passengers can open
  // live tracking. Starting it right after the driver taps "Start boarding"
  // means the browser's permission prompt appears in context.
  const activeTrip = trips.find((t) => t.status === "In Transit") ?? trips.find((t) => t.status === "Boarding");
  const gps = useDriverLocation(activeTrip?.bus_id ?? null);

  async function advance(trip) {
    const next = NEXT[trip.status];
    if (!next) return;
    if (next.to === "Completed") {
      const ok = window.confirm(
        "Complete this trip? Passengers who haven't been marked Boarded will be recorded as No-Show, and location sharing stops."
      );
      if (!ok) return;
    }
    setError("");
    setSuccess("");
    setUpdatingId(trip.trip_id);
    try {
      await api.updateTripStatus(trip.trip_id, next.to);
      setSuccess(
        next.to === "Boarding"
          ? "Boarding started. Your location is now shared with passengers."
          : next.to === "In Transit"
            ? "Trip started. Watch this page for passengers flagging you on the road."
            : "Trip completed. Location sharing stopped."
      );
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setUpdatingId(null);
    }
  }

  const now = trips.filter((t) => t.status === "Boarding" || t.status === "In Transit");
  const upcoming = trips.filter((t) => t.status === "Scheduled");
  const past = trips.filter((t) => t.status === "Completed").slice(-5).reverse();

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-3xl">
      <header>
        <h1 className="text-xl font-bold">Welcome, {user?.name ?? "Driver"}</h1>
        <p className="text-sm text-gray-500">Your trips, in order. Tap the green button to move a trip to its next step.</p>
      </header>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {activeTrip && <GpsBanner status={gps.status} queuedCount={gps.queuedCount} onRetry={gps.retry} />}

      {activeTrip?.status === "In Transit" && (
        <FlagRequestsPanel tripId={activeTrip.trip_id} driverId={user?.id} onBookingsChanged={reload} />
      )}

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading your trips…</p>
      ) : trips.length === 0 ? (
        <p className="text-sm text-gray-500 bg-white rounded-lg border p-4">No trips assigned yet. Your administrator will schedule them.</p>
      ) : (
        <>
          <TripGroup title="Now" trips={now} onAdvance={advance} updatingId={updatingId} empty={null} />
          <TripGroup title="Upcoming" trips={upcoming} onAdvance={advance} updatingId={updatingId} empty="No upcoming trips." />
          {past.length > 0 && <TripGroup title="Recently completed" trips={past} muted />}
        </>
      )}
    </div>
  );
}

function TripGroup({ title, trips, onAdvance, updatingId, empty, muted = false }) {
  if (trips.length === 0 && !empty) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      {trips.length === 0 ? (
        <p className="text-sm text-gray-500">{empty}</p>
      ) : (
        trips.map((t) => (
          <div key={t.trip_id} className={`bg-white rounded-lg border p-4 space-y-2 ${muted ? "opacity-70" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">
                {t.origin} → {t.destination}
              </p>
              <StatusBadge status={t.status} />
            </div>
            <p className="text-sm text-gray-600">
              {formatDate(t.departure_time)?.replace(/, \d{4}$/, "")} · Departs {formatTime(t.departure_time)} · {t.plate_num} · {t.booked_count}/{t.capacity ?? "?"} seats booked
            </p>
            {!muted && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm pt-1">
                <Link to={`/driver/manifest?tripId=${t.trip_id}`} className="text-emerald-700 font-medium underline">
                  Passenger list
                </Link>
                {NEXT[t.status] && (
                  <button
                    type="button"
                    onClick={() => onAdvance(t)}
                    disabled={updatingId === t.trip_id}
                    className="ml-auto bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded"
                  >
                    {updatingId === t.trip_id ? "Saving…" : NEXT[t.status].label}
                  </button>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </section>
  );
}

// Location sharing status for the active trip. A blocked permission used to
// fail silently — now the driver is told, and told how to fix it.
function GpsBanner({ status, queuedCount, onRetry }) {
  if (status === "sharing") {
    return (
      <p className="flex items-center gap-2 text-sm font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
        <Satellite className="w-4 h-4" /> Sharing your location with passengers
        {queuedCount > 0 && (
          <span className="ml-auto flex items-center gap-1 text-xs text-amber-700">
            <WifiOff className="w-3.5 h-3.5" /> {queuedCount} saved offline, will send when signal returns
          </span>
        )}
      </p>
    );
  }
  if (status === "locating") {
    return (
      <p className="flex items-center gap-2 text-sm text-gray-700 bg-white border rounded-lg px-3 py-2">
        <LocateFixed className="w-4 h-4 text-emerald-700" /> Getting your location… if the browser asks, choose Allow.
      </p>
    );
  }
  const text =
    status === "denied"
      ? "Location is blocked, so passengers can't see your bus. Tap the lock icon next to the address bar, set Location to Allow, then tap Try again."
      : status === "unsupported"
        ? "This browser can't share location. Use Chrome or Safari on your phone."
        : "Can't get a GPS fix. Check that your phone's Location is on.";
  return (
    <div role="alert" className="flex items-start gap-2 text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
      <MapPinOff className="w-4 h-4 mt-0.5 shrink-0" />
      <span className="flex-1">{text}</span>
      {status !== "unsupported" && (
        <button type="button" onClick={onRetry} className="shrink-0 font-semibold underline">
          Try again
        </button>
      )}
    </div>
  );
}
