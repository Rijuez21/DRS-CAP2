import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import * as api from "../../lib/api";

export default function Manifest() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tripId = searchParams.get("tripId");

  const [trips, setTrips] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);

  useEffect(() => {
    if (!user) return;
    api.getTrips({ driverId: user.id }).then(setTrips).catch(() => {});
  }, [user]);

  function reload() {
    if (!tripId) return;
    api
      .getBookings({ tripId })
      .then(setBookings)
      .catch((err) => setError(err.message));
  }

  useEffect(reload, [tripId]);

  async function mark(bookingId, status) {
    setUpdatingId(bookingId);
    try {
      await api.updateBookingStatus(bookingId, status);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setUpdatingId(null);
    }
  }

  const counts = bookings.reduce((acc, b) => {
    acc[b.status] = (acc[b.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="text-xl font-bold">Passenger Manifest</h1>
        <p className="text-sm text-gray-500">Mark passengers as boarded or no-show.</p>
      </header>

      <select
        value={tripId ?? ""}
        onChange={(e) => setSearchParams(e.target.value ? { tripId: e.target.value } : {})}
        className="border rounded px-3 py-2 text-sm bg-white"
      >
        <option value="">Select a trip…</option>
        {trips.map((t) => (
          <option key={t.trip_id} value={t.trip_id}>
            {t.origin} → {t.destination} · {new Date(t.departure_time).toLocaleString("en-PH")}
          </option>
        ))}
      </select>

      {error && <p className="text-sm text-rose-600 font-medium">{error}</p>}

      {tripId && (
        <>
          <p className="text-sm text-gray-600">
            {bookings.length} passengers ·{" "}
            {Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(", ")}
          </p>
          <div className="bg-white rounded-lg border divide-y">
            {bookings.map((b) => (
              <div key={b.booking_id} className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium">{b.passenger_name}</p>
                  <p className="text-xs text-gray-500">
                    Seat {b.seat_number} · {b.channel} · {b.status}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => mark(b.booking_id, "Boarded")}
                    disabled={updatingId === b.booking_id || b.status === "Boarded"}
                    className="text-xs font-semibold px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white"
                  >
                    Boarded
                  </button>
                  <button
                    type="button"
                    onClick={() => mark(b.booking_id, "No-Show")}
                    disabled={updatingId === b.booking_id || b.status === "No-Show"}
                    className="text-xs font-semibold px-3 py-1.5 rounded border border-rose-300 text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                  >
                    No-Show
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
