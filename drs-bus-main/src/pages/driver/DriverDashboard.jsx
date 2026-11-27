import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { WifiOff, Satellite, MapPinOff, LocateFixed, UserPlus, Users, BusFront } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useConfirm } from "../../hooks/useConfirm";
import { useDriverLocation } from "../../hooks/useDriverLocation";
import { useBusTracker } from "../../hooks/useBusTracker";
import { useKeepAlive } from "../../hooks/useKeepAlive";
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
  // My job on the trip that's running: "driver" or "conductor" (the server
  // works it out per trip, so one person can conduct today, drive tomorrow).
  const myRole = activeTrip?.my_role ?? null;
  const hasConductor = activeTrip?.conductor_id != null;
  // GPS is the driver's job: only the driver's phone shares the bus's
  // position (backup to the bus's tracker). The server refuses a conductor's.
  // A bus fitted with a GPS tracker reports by itself; the phone is backup.
  const tracker = useBusTracker(activeTrip?.bus_id ?? null);
  // While the tracker is reporting, the phone doesn't send at all (the
  // server would ignore it anyway); it takes over only when the tracker
  // goes quiet, is moved to another bus, or isn't fitted.
  const sharesGps = Boolean(activeTrip) && myRole === "driver";
  const gps = useDriverLocation(sharesGps && !tracker.online ? activeTrip.bus_id : null);
  // Drive mode: the driver of a trip on the road with a conductor aboard.
  // Nothing to tap — just where to stop next, in big text.
  const driveMode = activeTrip?.status === "In Transit" && myRole === "driver" && hasConductor;
  // Never signed out for inactivity during a trip — even with the phone in a
  // pocket (the server exempts a driver on a trip too).
  useKeepAlive(Boolean(activeTrip), { evenWhenHidden: true });

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
        <h1 className="text-xl font-bold">Welcome, {user?.name ?? (user?.crewRole === "Conductor" ? "Conductor" : "Driver")}</h1>
        <p className="text-sm text-gray-500">
          {user?.crewRole === "Conductor"
            ? "Your trips, in order. You handle the passengers and fares; the driver drives."
            : "Your trips, in order. Tap the green button to move a trip to its next step."}
        </p>
      </header>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {activeTrip &&
        (tracker.online ? (
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <Satellite className="w-4 h-4" /> The bus's GPS tracker is sharing the bus's location with passengers. {sharesGps ? "Your phone is only a backup." : ""}
          </p>
        ) : sharesGps ? (
          <GpsBanner status={gps.status} queuedCount={gps.queuedCount} onRetry={gps.retry} />
        ) : (
          <p className="flex items-center gap-2 text-sm text-gray-700 bg-white border rounded-lg px-3 py-2">
            <Satellite className="w-4 h-4 text-emerald-700" /> {activeTrip.driver_name}&apos;s phone shares the bus&apos;s location. You handle the passengers and fares.
          </p>
        ))}

      {activeTrip && <CrewCard trip={activeTrip} myRole={myRole} />}

      {driveMode && (
        <>
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
            <BusFront className="w-4 h-4" /> Drive mode — {activeTrip.conductor_name} is handling passengers and fares.
          </p>
          <FlagRequestsPanel tripId={activeTrip.trip_id} driverId={user?.id} onBookingsChanged={reload} readOnly conductorName={activeTrip.conductor_name} />
        </>
      )}

      {/* Whoever handles passengers (the conductor, or a driver working alone)
          gets the quick actions and answers the hails. */}
      {activeTrip && !driveMode && (myRole === "conductor" || !hasConductor) && (
        <ConductorActions trip={activeTrip} />
      )}

      {activeTrip?.status === "In Transit" && !driveMode && (
        <FlagRequestsPanel tripId={activeTrip.trip_id} driverId={user?.id} busId={activeTrip.bus_id} onBookingsChanged={reload} />
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

// Free seats right now: booked seats and walk-on riders still aboard both
// take one. Same count the server uses for Flag a Bus (services/crew.js).
function seatsLeft(t) {
  if (t.capacity == null) return null;
  return Math.max(0, Number(t.capacity) - Number(t.booked_count ?? 0) - Number(t.walk_ons_aboard ?? 0));
}

const ROLE_LABEL = { driver: "Driver", conductor: "Conductor" };

// Who's on this bus with you.
function CrewCard({ trip, myRole }) {
  const partner =
    myRole === "conductor"
      ? { role: "Driver", name: trip.driver_name }
      : trip.conductor_id != null
        ? { role: "Conductor", name: trip.conductor_name }
        : null;
  return (
    <section className="bg-white rounded-lg border px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <p className="text-sm">
        You&apos;re the <strong>{ROLE_LABEL[myRole] ?? "crew"}</strong> on {trip.bus_number ? `Bus ${trip.bus_number}` : trip.plate_num}
      </p>
      {partner ? (
        <p className="text-sm text-gray-600 flex items-center gap-2">
          {partner.role}: <strong className="text-ink-900">{partner.name}</strong>
        </p>
      ) : (
        <p className="text-sm text-gray-500">No conductor on this trip — you handle passengers and fares too.</p>
      )}
      {seatsLeft(trip) != null && (
        <p className="ml-auto text-right">
          <span className="block text-2xl font-bold tabular-nums text-emerald-800 leading-none">{seatsLeft(trip)}</span>
          <span className="text-xs text-gray-500">seats left</span>
        </p>
      )}
    </section>
  );
}

// The conductor's everyday buttons, big enough to hit on a moving bus.
// "Walk-on" is for the rider who waved the bus down without the app.
function ConductorActions({ trip }) {
  const onRoad = trip.status === "In Transit";
  return (
    <section className="grid grid-cols-2 gap-2">
      {onRoad && (
        <Link
          to={`/driver/fares?tripId=${trip.trip_id}&add=walkon`}
          className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-lg font-bold py-4"
        >
          <UserPlus className="w-6 h-6" /> Walk-on passenger
        </Link>
      )}
      <Link to={`/driver/manifest?tripId=${trip.trip_id}`} className="flex items-center justify-center gap-2 rounded-xl border-2 border-emerald-700 text-emerald-800 font-semibold py-3">
        <Users className="w-5 h-5" /> Passenger list
      </Link>
      <Link to={`/driver/fares?tripId=${trip.trip_id}`} className="flex items-center justify-center gap-2 rounded-xl border-2 border-emerald-700 text-emerald-800 font-semibold py-3">
        Fares {Number(trip.walk_ons_aboard) > 0 && <span className="text-xs bg-emerald-100 rounded-full px-2">{trip.walk_ons_aboard} aboard</span>}
      </Link>
    </section>
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
              <span className="flex items-center gap-1.5">
                {t.my_role && (
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${t.my_role === "conductor" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                    {ROLE_LABEL[t.my_role]}
                  </span>
                )}
                <StatusBadge status={t.status} />
              </span>
            </div>
            <p className="text-sm text-gray-600">
              {formatDate(t.departure_time)?.replace(/, \d{4}$/, "")} · Departs {formatTime(t.departure_time)} · {t.plate_num} · {t.booked_count}/{t.capacity ?? "?"} seats booked
              {Number(t.walk_ons_aboard) > 0 && ` · ${t.walk_ons_aboard} walk-on aboard`}
            </p>
            <p className="text-xs text-gray-500">
              {t.my_role === "conductor" ? `Driver: ${t.driver_name}` : t.conductor_name ? `Conductor: ${t.conductor_name}` : "No conductor assigned"}
            </p>
            {!muted && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm pt-1">
                <Link to={`/driver/manifest?tripId=${t.trip_id}`} className="text-emerald-700 font-medium underline">
                  Passenger list
                </Link>
                {/* Moving the trip on is the driver's job; the conductor just sees where it's at. */}
                {NEXT[t.status] && t.my_role === "conductor" ? (
                  <span className="ml-auto text-xs text-gray-500">The driver starts boarding, departs and completes the trip</span>
                ) : NEXT[t.status] &&
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
