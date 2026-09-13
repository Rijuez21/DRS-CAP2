import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { WifiOff } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import * as api from "../../lib/api";
import { formatDate, formatTime } from "../../lib/format";
import { useDriverLocation } from "../../hooks/useDriverLocation";

const NEXT_STATUS = {
  Scheduled: "Boarding",
  Boarding: "In Transit",
  "In Transit": "Completed",
};

export default function DriverDashboard() {
  const { user } = useAuth();
  const [trips, setTrips] = useState([]);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);

  function reload() {
    if (!user) return;
    api
      .getTrips({ driverId: user.id })
      .then(setTrips)
      .catch((err) => setError(err.message));
  }

  useEffect(reload, [user]);

  // Phase 3.4: only track GPS while a trip is actually underway — the bus
  // this driver is "In Transit" on, if any. useDriverLocation handles the
  // offline-buffer-and-flush itself; this page just needs to tell it which
  // bus (or none) applies right now.
  const activeTrip = trips.find((t) => t.status === "In Transit");
  const { queuedCount } = useDriverLocation(activeTrip?.bus_id ?? null);

  async function advanceStatus(trip) {
    const next = NEXT_STATUS[trip.status];
    if (!next) return;
    setUpdatingId(trip.trip_id);
    try {
      await api.updateTripStatus(trip.trip_id, next);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="text-xl font-bold">Welcome, {user?.name ?? "Driver"}</h1>
        <p className="text-sm text-gray-500">Your assigned trips</p>
      </header>

      {error && <p className="text-sm text-rose-600 font-medium">{error}</p>}

      {activeTrip && queuedCount > 0 && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <WifiOff className="w-3.5 h-3.5" /> {queuedCount} location point{queuedCount === 1 ? "" : "s"} buffered offline — will sync once you're back online.
        </p>
      )}

      {trips.length === 0 ? (
        <p className="text-sm text-gray-500">No trips assigned yet.</p>
      ) : (
        <div className="space-y-3">
          {trips.map((t) => (
            <div key={t.trip_id} className="bg-white rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-semibold">
                  {t.origin} → {t.destination}
                </p>
                <span className="text-xs font-medium px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">
                  {t.status}
                </span>
              </div>
              <p className="text-sm text-gray-600">
                {formatDate(t.departure_time)} · Departs {formatTime(t.departure_time)} · {t.plate_num} ·{" "}
                {t.booked_count}/{t.capacity} seats
              </p>
              <div className="flex items-center gap-3 text-sm pt-1">
                <Link to={`/driver/manifest?tripId=${t.trip_id}`} className="text-emerald-700 underline">
                  Manifest
                </Link>
                <Link
                  to={`/driver/vehicle-checklist?tripId=${t.trip_id}`}
                  className="text-emerald-700 underline"
                >
                  Pre-Trip Checklist
                </Link>
                {NEXT_STATUS[t.status] && (
                  <button
                    type="button"
                    onClick={() => advanceStatus(t)}
                    disabled={updatingId === t.trip_id}
                    className="ml-auto bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-white text-xs font-semibold px-3 py-1.5 rounded"
                  >
                    Mark as {NEXT_STATUS[t.status]}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
