import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { WifiOff, Satellite, MapPinOff, LocateFixed } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useConfirm } from "../../hooks/useConfirm";
import { useDriverLocation } from "../../hooks/useDriverLocation";
import { useBusTracker } from "../../hooks/useBusTracker";
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

// Same timing as the server (services/tripLifecycle.js): boarding opens 3
// hours before departure. The server has the final say; this only greys the
// button out with a time instead of letting the driver tap into an error.
const BOARDING_OPENS_HOURS_BEFORE = 3;
const boardingOpensAt = (t) => new Date(new Date(t.departure_time).getTime() - BOARDING_OPENS_HOURS_BEFORE * 3600 * 1000);

// Why the button for this trip can't be used yet, or null when it can.
function waitReason(trip, activeTrip, now) {
  if (trip.status !== "Scheduled") return null;
  if (activeTrip && activeTrip.trip_id !== trip.trip_id) return "Finish your current trip first";
  const opens = boardingOpensAt(trip);
  if (now < opens) {
    const sameDay = opens.toDateString() === new Date(now).toDateString();
    return `Boarding opens ${sameDay ? "at" : formatDate(opens.toISOString())?.replace(/, \d{4}$/, "") + ","} ${formatTime(opens.toISOString())}`;
  }
  return null;
}

export default function DriverDashboard() {
  const { user } = useAuth();
  const [trips, setTrips] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [updatingId, setUpdatingId] = useState(null);
  const [confirm, confirmDialog] = useConfirm();

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
  // Missed trips (never departed, past the boarding window) wait for the
  // admin to close them — they're not the driver's to move any more.
  const liveTrips = trips.filter((t) => !t.missed_at);
  const activeTrip = liveTrips.find((t) => t.status === "In Transit") ?? liveTrips.find((t) => t.status === "Boarding");
  // Re-render every minute so "Boarding opens at …" turns into a button on time.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);
  const gps = useDriverLocation(activeTrip?.bus_id ?? null);
  // A bus fitted with a GPS tracker reports by itself; the phone is backup.
  const tracker = useBusTracker(activeTrip?.bus_id ?? null);

  async function advance(trip) {
    const next = NEXT[trip.status];
    if (!next) return;
    // Leaving before the scheduled time: everyone booked must be on board
    // (the server refuses otherwise and names who's missing).
    if (next.to === "In Transit" && new Date() < new Date(trip.departure_time)) {
      const ok = await confirm({
        title: "Leave before the scheduled time?",
        body: `This trip is scheduled for ${formatTime(trip.departure_time)}. You can leave early only if every booked passenger is marked Boarded on the passenger list.`,
        confirmLabel: "Depart now",
        cancelLabel: "Not yet",
        tone: "primary",
      });
      if (!ok) return;
    }
    if (next.to === "Completed") {
      const ok = await confirm({
        title: "Complete this trip?",
        body: "Passengers who haven't been marked Boarded will be recorded as No-Show, and location sharing stops.",
        confirmLabel: "Complete trip",
        cancelLabel: "Not yet",
        tone: "primary",
      });
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

  const now = liveTrips.filter((t) => t.status === "Boarding" || t.status === "In Transit");
  const upcoming = liveTrips.filter((t) => t.status === "Scheduled");
  const missed = trips.filter((t) => t.missed_at && (t.status === "Scheduled" || t.status === "Boarding"));
  const past = trips.filter((t) => t.status === "Completed").slice(-5).reverse();
  const reasonFor = (t) => waitReason(t, activeTrip, clock);

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-3xl">
      <header>
        <h1 className="text-xl font-bold">Welcome, {user?.name ?? "Driver"}</h1>
        <p className="text-sm text-gray-500">Your trips, in order. Tap the green button to move a trip to its next step.</p>
      </header>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {activeTrip &&
        (tracker.online ? (
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <Satellite className="w-4 h-4" /> The bus's GPS tracker is sharing your location with passengers. Your phone is only a backup.
          </p>
        ) : (
          <GpsBanner status={gps.status} queuedCount={gps.queuedCount} onRetry={gps.retry} />
        ))}

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
          <TripGroup title="Upcoming" trips={upcoming} onAdvance={advance} updatingId={updatingId} waitReason={reasonFor} empty="No upcoming trips." />
          {missed.length > 0 && (
            <TripGroup
              title="Waiting for the office"
              note="These never departed and their time has passed. The terminal office will close them — nothing for you to do."
              trips={missed}
              muted
            />
          )}
          {past.length > 0 && <TripGroup title="Recently completed" trips={past} muted />}
        </>
      )}
      {confirmDialog}
    </div>
  );
}

function TripGroup({ title, note, trips, onAdvance, updatingId, waitReason, empty, muted = false }) {
  if (trips.length === 0 && !empty) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      {note && <p className="text-sm text-gray-500">{note}</p>}
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
                {NEXT[t.status] &&
                  (waitReason?.(t) ? (
                    <span className="ml-auto text-sm font-medium text-gray-500 bg-gray-100 px-3 py-2 rounded">{waitReason(t)}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onAdvance(t)}
                      disabled={updatingId === t.trip_id}
                      className="ml-auto bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded"
                    >
                      {updatingId === t.trip_id ? "Saving…" : NEXT[t.status].label}
                    </button>
                  ))}
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
