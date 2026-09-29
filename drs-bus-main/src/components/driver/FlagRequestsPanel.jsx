import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Hand, MapPin } from "lucide-react";
import * as api from "../../lib/api";
import { getSocket } from "../../lib/socket";
import { timeAgo } from "../../lib/geo";

// Driver side of passenger Mode 2 ("Flag a Bus"). Mounted on
// DriverDashboard only while a trip is In Transit — a hail is only ever
// accepted for a bus that's already on the road (the server enforces the
// same rule). Shows two groups: hails waiting for an answer, and riders
// the driver already agreed to stop for but who haven't boarded yet.
//
// Written for a conductor/co-driver to operate as much as the driver:
// big tap targets, one-tap decline reasons, no typing. The driver
// shouldn't be reading a phone while negotiating Halsema Highway.

const DECLINE_REASONS = ["Bus is full", "Already passed you", "Unsafe to stop there"];

// A hail that stays Pending still disappears on its own via the server's
// expiry sweeper ("flag:updated" -> Expired), so this panel never has to
// guess when to drop one.
function isOnPickupList(flag) {
  return flag.status === "Pending" || (flag.status === "Acknowledged" && flag.booking_status === "Confirmed");
}

// The pickup point is always the passenger's own GPS fix (the server
// rejects a flag without a precise one), and it follows them while the
// flag is open — every "flag:updated" carries the latest coordinates, so
// this link always opens where they are *now*. The landmark, if any, is
// only a note for spotting them.
function mapsUrl(flag) {
  if (flag.pickup_latitude == null) return null;
  return `https://www.google.com/maps/search/?api=1&query=${flag.pickup_latitude},${flag.pickup_longitude}`;
}

function PinLink({ flag, className = "" }) {
  const url = mapsUrl(flag);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 font-semibold text-emerald-700 underline ${className}`}>
      <MapPin className="w-4 h-4" /> Exact pickup pin
    </a>
  );
}

export default function FlagRequestsPanel({ tripId, driverId, onBookingsChanged }) {
  const [flags, setFlags] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [decliningId, setDecliningId] = useState(null);
  const [error, setError] = useState("");
  const [, setTick] = useState(0);

  // DriverDashboard's reload() is a plain function recreated every render;
  // holding the latest one in a ref keeps the socket effect below from
  // tearing down and re-registering its listeners on every dashboard render.
  const onBookingsChangedRef = useRef(onBookingsChanged);
  useEffect(() => {
    onBookingsChangedRef.current = onBookingsChanged;
  });

  const load = useCallback(() => {
    if (!tripId) return;
    api
      .getTripFlagRequests(tripId)
      .then(setFlags)
      .catch((err) => setError(err.message));
  }, [tripId]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!driverId) return;
    const socket = getSocket();
    // Same reasoning as FlagBus.jsx: NotificationBell (DriverLayout) owns
    // this room, but a socket that dropped in a dead zone and reconnected
    // has lost it server-side — rejoin (idempotent) and refetch so a hail
    // sent while offline isn't missed. Never leave from here.
    const join = () => socket.emit("subscribe:notifications", { recipientType: "driver", recipientId: driverId });
    join();

    function handleNew(flag) {
      if (flag.trip_id !== Number(tripId)) return;
      setFlags((prev) => (prev.some((f) => f.flag_id === flag.flag_id) ? prev : [...prev, flag]));
      navigator.vibrate?.([200, 100, 200]); // a nudge the conductor can feel; no-op where unsupported
    }
    function handleUpdated(flag) {
      if (flag.trip_id !== Number(tripId)) return;
      setFlags((prev) => {
        const without = prev.filter((f) => f.flag_id !== flag.flag_id);
        return isOnPickupList(flag) ? [...without, flag].sort((a, b) => a.flag_id - b.flag_id) : without;
      });
      if (flag.status === "Acknowledged" || flag.status === "Cancelled") onBookingsChangedRef.current?.();
    }
    function handleReconnect() {
      join();
      load();
    }

    socket.on("flag:new", handleNew);
    socket.on("flag:updated", handleUpdated);
    socket.on("connect", handleReconnect);
    return () => {
      socket.off("flag:new", handleNew);
      socket.off("flag:updated", handleUpdated);
      socket.off("connect", handleReconnect);
    };
  }, [tripId, driverId, load]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, []);

  async function acknowledge(flag) {
    setBusyId(flag.flag_id);
    setError("");
    try {
      await api.acknowledgeFlagRequest(flag.flag_id);
      // The "flag:updated" socket event updates the list; reload anyway in
      // case this socket is mid-reconnect.
      load();
      onBookingsChangedRef.current?.();
    } catch (err) {
      setError(err.message);
      load(); // e.g. auto-declined because the bus filled up — show current state
    } finally {
      setBusyId(null);
    }
  }

  async function decline(flag, reason) {
    setBusyId(flag.flag_id);
    setError("");
    try {
      await api.declineFlagRequest(flag.flag_id, reason);
      setDecliningId(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const pending = flags.filter((f) => f.status === "Pending");
  const stoppingFor = flags.filter((f) => f.status === "Acknowledged");

  return (
    <section className="bg-white rounded-lg border p-4 space-y-3">
      <header className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <Hand className="w-4 h-4 text-emerald-700" /> Flag requests
        </h2>
        {pending.length > 0 && (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">{pending.length} waiting</span>
        )}
      </header>

      {error && <p className="text-sm text-rose-600 font-medium">{error}</p>}

      {flags.length === 0 ? (
        <p className="text-sm text-gray-500">No one has flagged this bus. Requests from passengers along the route will appear here.</p>
      ) : (
        <div className="space-y-2">
          {pending.map((f) => (
            <div key={f.flag_id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{f.passenger_name}</p>
                  {f.pickup_landmark && <p className="text-sm text-gray-700">&ldquo;{f.pickup_landmark}&rdquo;</p>}
                  <p className="text-xs text-gray-500">Flagged {timeAgo(f.requested_at)}</p>
                </div>
                <PinLink flag={f} className="text-sm shrink-0" />
              </div>

              {decliningId === f.flag_id ? (
                <div className="flex flex-wrap gap-2">
                  {DECLINE_REASONS.map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => decline(f, reason)}
                      disabled={busyId === f.flag_id}
                      className="text-xs font-semibold px-3 py-2 rounded border border-rose-300 text-rose-700 bg-white hover:bg-rose-50 disabled:opacity-50"
                    >
                      {reason}
                    </button>
                  ))}
                  <button type="button" onClick={() => setDecliningId(null)} className="text-xs text-gray-500 underline px-2">
                    Back
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => acknowledge(f)}
                    disabled={busyId === f.flag_id}
                    className="flex-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-white text-sm font-semibold px-3 py-2.5 rounded"
                  >
                    Stop for them
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecliningId(f.flag_id)}
                    disabled={busyId === f.flag_id}
                    className="text-sm font-semibold px-3 py-2.5 rounded border border-rose-300 text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                  >
                    Can't stop
                  </button>
                </div>
              )}
            </div>
          ))}

          {stoppingFor.length > 0 && (
            <div className="pt-1 space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Stopping for</p>
              {stoppingFor.map((f) => (
                <div key={f.flag_id} className="flex items-center justify-between text-sm rounded border px-3 py-2">
                  <span>
                    <span className="font-medium">{f.passenger_name}</span> · Seat {f.seat_number}
                    {f.pickup_landmark && <> · &ldquo;{f.pickup_landmark}&rdquo;</>}
                  </span>
                  <PinLink flag={f} className="text-xs" />
                </div>
              ))}
              <p className="text-xs text-gray-500">
                Mark them Boarded (or No-Show) on the{" "}
                <Link to={`/driver/manifest?tripId=${tripId}`} className="text-emerald-700 underline">
                  manifest
                </Link>{" "}
                once you reach them.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
