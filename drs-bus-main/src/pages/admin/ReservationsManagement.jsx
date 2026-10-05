import { useEffect, useState } from "react";
import { Ticket } from "lucide-react";
import * as api from "../../lib/api";
import EmptyState from "../../components/common/EmptyState";
import InlineAlert from "../../components/common/InlineAlert";
import { formatDate, formatTime } from "../../lib/format";

const STATUS_OPTIONS = ["", "Reserved", "Confirmed", "Boarded", "Cancelled", "No-Show"];
const CHANNEL_OPTIONS = ["", "online", "walk_in", "flagged"]; // "flagged" = roadside hail a driver acknowledged (Flag a Bus mode)
const CHANNEL_LABELS = { "": "All channels", online: "Online", walk_in: "Walk-in", flagged: "Flagged (roadside)" };

// Table 4's Reservations Oversight: filterable, read-only except cancel.
export default function AdminReservationsManagement() {
  const [bookings, setBookings] = useState([]);
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function load() {
    // No filters = every booking (newest 500). The old default silently
    // swapped "All statuses" for Reserved-only because the API used to
    // reject an unfiltered request.
    const params = { status: status || undefined, channel: channel || undefined };
    api
      .getBookings(params)
      .then((rows) => {
        setBookings(rows);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }

  useEffect(load, [status, channel]);

  async function handleCancel(booking) {
    if (!window.confirm(`Cancel booking #${booking.booking_id} (${booking.passenger_name})?`)) return;
    try {
      await api.updateBookingStatus(booking.booking_id, "Cancelled");
      setSuccess("Booking cancelled.");
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="text-xl font-bold">Reservations Oversight</h1>
        <p className="text-sm text-gray-500">Every booking across all channels, filterable by status.</p>
      </header>

      <div className="flex gap-3">
        <select value={status} onChange={(e) => { setIsLoading(true); setStatus(e.target.value); }} className="input max-w-[10rem]">
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s || "All statuses"}</option>)}
        </select>
        <select value={channel} onChange={(e) => { setIsLoading(true); setChannel(e.target.value); }} className="input max-w-[10rem]">
          {CHANNEL_OPTIONS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
        </select>
      </div>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : bookings.length === 0 ? (
        <EmptyState icon={Ticket} title="No bookings match these filters" />
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">Passenger</th>
                <th className="px-4 py-3">Trip</th>
                <th className="px-4 py-3">Seat</th>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {bookings.map((b) => (
                <tr key={b.booking_id}>
                  <td className="px-4 py-3 font-medium">{b.passenger_name}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {b.origin} → {b.destination}
                    <div className="text-xs text-gray-400">{formatDate(b.departure_time)} · {formatTime(b.departure_time)}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{b.seat_number}</td>
                  <td className="px-4 py-3 text-gray-600">{CHANNEL_LABELS[b.channel] ?? b.channel}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">{b.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {b.status !== "Cancelled" && b.status !== "Boarded" && b.status !== "No-Show" && (
                      <button type="button" onClick={() => handleCancel(b)} className="text-xs font-semibold text-rose-600 hover:underline">Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
