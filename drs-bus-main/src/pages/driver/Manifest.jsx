import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import InlineAlert from "../../components/common/InlineAlert";
import * as api from "../../lib/api";
import { formatDate, formatTime } from "../../lib/format";

const CHANNEL_LABEL = { online: "Booked online", walk_in: "Walk-in", flagged: "Flagged on the road" };

// Passenger list for one trip. Buttons follow the server's driver rules
// (bookingRules.js): Reserved/Confirmed -> Boarded or No-Show, and a
// mis-tap between Boarded and No-Show can be corrected. Cancelled bookings
// are listed but have no actions — they used to keep a live "Boarded"
// button that 500'd when the seat had been resold.
export default function Manifest() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tripId = searchParams.get("tripId");
  const [trips, setTrips] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [isLoading, setIsLoading] = useState(() => Boolean(searchParams.get("tripId")));
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);

  useEffect(() => {
    if (!user) return;
    api.getTrips({ driverId: user.id }).then(setTrips).catch((err) => setError(err.message));
  }, [user]);

  const reload = useCallback(() => {
    if (!tripId) return;
    api
      .getBookings({ tripId })
      .then((rows) => {
        setBookings(rows);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [tripId]);
  useEffect(reload, [reload]);

  async function mark(booking, status) {
    setUpdatingId(booking.booking_id);
    setError("");
    try {
      await api.updateBookingStatus(booking.booking_id, status);
      setBookings((prev) => prev.map((b) => (b.booking_id === booking.booking_id ? { ...b, status } : b)));
    } catch (err) {
      setError(err.message);
      reload();
    } finally {
      setUpdatingId(null);
    }
  }

  const trip = trips.find((t) => String(t.trip_id) === String(tripId));
  const readOnly = trip && (trip.status === "Completed" || trip.status === "Cancelled");
  const bySeat = (a, b) => Number(a.seat_number) - Number(b.seat_number);
  const groups = [
    { title: "To board", rows: bookings.filter((b) => b.status === "Reserved" || b.status === "Confirmed").sort(bySeat) },
    { title: "Boarded", rows: bookings.filter((b) => b.status === "Boarded").sort(bySeat) },
    { title: "No-show", rows: bookings.filter((b) => b.status === "No-Show").sort(bySeat) },
    { title: "Cancelled", rows: bookings.filter((b) => b.status === "Cancelled").sort(bySeat), muted: true },
  ];

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-3xl">
      <header>
        <h1 className="text-xl font-bold">Passenger List</h1>
        <p className="text-sm text-gray-500">As each passenger gets on, tap Boarded. Tap No-show for anyone who didn't come.</p>
      </header>

      <select value={tripId ?? ""} onChange={(e) => {
          setBookings([]);
          setIsLoading(Boolean(e.target.value));
          setSearchParams(e.target.value ? { tripId: e.target.value } : {});
        }} className="input bg-white">
        <option value="">Select a trip…</option>
        {trips.map((t) => (
          <option key={t.trip_id} value={t.trip_id}>
            {formatDate(t.departure_time)?.replace(/, \d{4}$/, "")} {formatTime(t.departure_time)} · {t.origin} → {t.destination} · {t.status}
          </option>
        ))}
      </select>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />

      {tripId && (
        <>
          {readOnly && <p className="text-sm text-gray-600 bg-white border rounded-lg px-3 py-2">This trip is {trip.status.toLowerCase()} — the list is read-only.</p>}
          <p className="text-sm text-gray-600">
            {groups[1].rows.length} boarded · {groups[0].rows.length} still to board · {groups[2].rows.length} no-show
          </p>
          {isLoading && bookings.length === 0 ? (
            <p className="text-sm text-gray-500">Loading passengers…</p>
          ) : bookings.length === 0 ? (
            <p className="text-sm text-gray-500 bg-white rounded-lg border p-4">No passengers booked on this trip yet.</p>
          ) : (
            groups.map(
              (g) =>
                g.rows.length > 0 && (
                  <section key={g.title} className="space-y-1.5">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {g.title} ({g.rows.length})
                    </h2>
                    <div className={`bg-white rounded-lg border divide-y ${g.muted ? "opacity-60" : ""}`}>
                      {g.rows.map((b) => (
                        <div key={b.booking_id} className="p-3 flex items-center gap-3">
                          <span className="w-10 h-10 shrink-0 rounded-lg bg-slate-100 flex items-center justify-center font-bold">{b.seat_number}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{b.passenger_name}</p>
                            <p className="text-xs text-gray-500">
                              #{b.booking_id} · {CHANNEL_LABEL[b.channel] ?? b.channel}
                              {b.status === "Reserved" && " · not yet confirmed at terminal"}
                            </p>
                          </div>
                          {!readOnly && <RowActions booking={b} busy={updatingId === b.booking_id} onMark={mark} />}
                        </div>
                      ))}
                    </div>
                  </section>
                )
            )
          )}
        </>
      )}
    </div>
  );
}

function RowActions({ booking, busy, onMark }) {
  const btn = "text-xs font-semibold px-3 py-2 rounded disabled:opacity-50";
  if (booking.status === "Reserved" || booking.status === "Confirmed") {
    return (
      <div className="flex gap-2 shrink-0">
        <button type="button" onClick={() => onMark(booking, "Boarded")} disabled={busy} className={`${btn} bg-emerald-700 hover:bg-emerald-600 text-white`}>
          Boarded
        </button>
        <button type="button" onClick={() => onMark(booking, "No-Show")} disabled={busy} className={`${btn} border border-rose-300 text-rose-600 hover:bg-rose-50`}>
          No-show
        </button>
      </div>
    );
  }
  if (booking.status === "Boarded") {
    return (
      <button type="button" onClick={() => onMark(booking, "No-Show")} disabled={busy} className={`${btn} text-gray-500 underline shrink-0`}>
        Undo — mark no-show
      </button>
    );
  }
  if (booking.status === "No-Show") {
    return (
      <button type="button" onClick={() => onMark(booking, "Boarded")} disabled={busy} className={`${btn} border border-emerald-300 text-emerald-700 shrink-0`}>
        Arrived — mark boarded
      </button>
    );
  }
  return null;
}
