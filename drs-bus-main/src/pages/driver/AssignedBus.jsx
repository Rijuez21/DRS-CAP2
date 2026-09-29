import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import * as api from "../../lib/api";
import { formatDate, formatTime } from "../../lib/format";

export default function AssignedBus() {
  const { user } = useAuth();
  const [trips, setTrips] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    api
      .getTrips({ driverId: user.id })
      .then(setTrips)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [user]);

  // "Assigned bus" = whichever bus this driver is on right now (In
  // Transit), or failing that, their next upcoming trip's bus. Detail is
  // intentionally limited to what the trip row already carries
  // (plate_num, capacity) — full Bus-entity fields (type, year_model,
  // the bus's own status) would need a dedicated getBus(busId) endpoint,
  // which doesn't exist yet.
  const activeTrip = trips.find((t) => t.status === "In Transit");
  const upcoming = [...trips]
    .filter((t) => t.status === "Scheduled" || t.status === "Boarding")
    .sort((a, b) => new Date(a.departure_time) - new Date(b.departure_time));
  const assignment = activeTrip ?? upcoming[0] ?? null;

  return (
    <div className="p-6 space-y-4 max-w-lg">
      <header>
        <h1 className="text-xl font-bold">Assigned Bus</h1>
        <p className="text-sm text-gray-500">
          {activeTrip ? "Currently in transit" : "Your next assigned bus"}
        </p>
      </header>

      {error && <p className="text-sm text-rose-600 font-medium">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : !assignment ? (
        <p className="text-sm text-gray-500">No bus currently assigned.</p>
      ) : (
        <div className="bg-white rounded-lg border p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-2xl font-bold tracking-wide">{assignment.plate_num ?? "—"}</p>
            <span className="text-xs font-medium px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">
              {assignment.status}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm pt-2 border-t">
            <Field
              label="Capacity"
              value={assignment.capacity != null ? `${assignment.capacity} seats` : null}
            />
            <Field label="Route" value={`${assignment.origin} → ${assignment.destination}`} />
            <Field label="Departs" value={formatTime(assignment.departure_time)} />
            <Field label="Date" value={formatDate(assignment.departure_time)} />
          </dl>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="font-medium">{value ?? "—"}</dd>
    </div>
  );
}