import { useState } from "react";
import StatusBadge from "../../components/common/StatusBadge";
import * as api from "../../lib/api";
import { formatDate, formatTime } from "../../lib/format";

// Phase 4.2: there's no separate booking "code" in the schema, so lookup
// is by passenger name (search) — pick the right result, then confirm/
// check-in/cancel it, same as before.
export default function ReservationValidation() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function handleSearch(e) {
    e.preventDefault();
    setError("");
    setSelected(null);
    if (!query) return;
    try {
      const rows = await api.searchBookings(query);
      setResults(rows);
      if (rows.length === 0) setError("No bookings found for that name.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function setStatus(status) {
    setIsBusy(true);
    try {
      await api.updateBookingStatus(selected.booking_id, status);
      setSelected((prev) => ({ ...prev, status }));
      setResults((prev) => prev.map((r) => (r.booking_id === selected.booking_id ? { ...r, status } : r)));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="p-6 space-y-4 max-w-md">
      <header>
        <h1 className="text-xl font-bold">Validate Reservation</h1>
        <p className="text-sm text-gray-500">Search by passenger name to check them in.</p>
      </header>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Passenger name"
          className="flex-1 border rounded px-3 py-2 text-sm"
        />
        <button type="submit" className="bg-amber-700 hover:bg-amber-600 text-white text-sm font-semibold px-4 py-2 rounded">
          Search
        </button>
      </form>

      {error && <p className="text-sm text-rose-600 font-medium">{error}</p>}

      {results.length > 0 && !selected && (
        <div className="bg-white rounded-lg border divide-y">
          {results.map((r) => (
            <button
              key={r.booking_id}
              type="button"
              onClick={() => setSelected(r)}
              className="w-full text-left px-4 py-3 hover:bg-slate-50"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{r.passenger_name}</p>
                <StatusBadge status={r.status} />
              </div>
              <p className="text-xs text-gray-500">
                {r.origin} → {r.destination} · {formatDate(r.departure_time)} {formatTime(r.departure_time)} · Seat {r.seat_number}
              </p>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <button type="button" onClick={() => setSelected(null)} className="text-xs text-gray-500 hover:underline">← Back to results</button>
          <div className="flex items-center justify-between">
            <p className="font-semibold">Booking #{selected.booking_id}</p>
            <StatusBadge status={selected.status} />
          </div>
          <p className="text-sm text-gray-600">
            {selected.passenger_name} · Seat {selected.seat_number} · {selected.channel}
          </p>
          <p className="text-sm text-gray-600">{selected.origin} → {selected.destination}</p>
          <p className="text-sm text-gray-600">{formatDate(selected.departure_time)} · {formatTime(selected.departure_time)}</p>

          <div className="flex gap-2 pt-2">
            {selected.status === "Reserved" && (
              <button type="button" onClick={() => setStatus("Confirmed")} disabled={isBusy} className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-white text-xs font-semibold px-3 py-2 rounded">
                Confirm
              </button>
            )}
            {(selected.status === "Confirmed" || selected.status === "Reserved") && (
              <button type="button" onClick={() => setStatus("Boarded")} disabled={isBusy} className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-white text-xs font-semibold px-3 py-2 rounded">
                Check In (Boarded)
              </button>
            )}
            {selected.status !== "Cancelled" && selected.status !== "Boarded" && (
              <button type="button" onClick={() => setStatus("Cancelled")} disabled={isBusy} className="border border-rose-300 text-rose-600 hover:bg-rose-50 disabled:opacity-60 text-xs font-semibold px-3 py-2 rounded">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
