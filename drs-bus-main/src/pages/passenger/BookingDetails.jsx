import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ChevronLeft, MapPin } from "lucide-react";
import StatusBadge from "../../components/common/StatusBadge";
import * as api from "../../lib/api";
import { formatDate, formatTime } from "../../lib/format";

export default function BookingDetails() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getBooking(bookingId)
      .then((row) => {
        if (!cancelled) setBooking(row);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  async function handleCancel() {
    if (!window.confirm("Cancel this booking? This can't be undone.")) return;
    setIsCancelling(true);
    try {
      await api.updateBookingStatus(bookingId, "Cancelled");
      setBooking((prev) => ({ ...prev, status: "Cancelled" }));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsCancelling(false);
    }
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto px-4 py-6">
        <p role="alert" className="text-sm text-rose-600 font-medium">
          {error}
        </p>
      </div>
    );
  }

  if (!booking) {
    return <div className="max-w-md mx-auto px-4 py-6 text-sm text-ink-600">Loading…</div>;
  }

  const canCancel = booking.status === "Reserved" || booking.status === "Confirmed";
  // Tracking a bus that's already Cancelled/No-Show makes no sense; anything
  // else (Reserved/Confirmed/Boarded) has a real trip_id to look up on the map.
  const canTrack = booking.status !== "Cancelled" && booking.status !== "No-Show";

  return (
    <div className="max-w-md mx-auto px-4 py-6 space-y-5">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm text-ink-600 hover:text-brand-green-600"
      >
        <ChevronLeft className="w-4 h-4" /> Back
      </button>

      <div className="rounded-3xl bg-brand-forest-900 text-white p-5">
        <div className="flex items-center justify-between mb-2">
          <p className="font-display text-lg font-bold">Booking #{booking.booking_id}</p>
          <StatusBadge status={booking.status} />
        </div>
        <p className="text-sm text-white/70">
          {booking.origin} → {booking.destination}
        </p>
      </div>

      <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5 grid grid-cols-2 gap-y-4 gap-x-4">
        <Field label="Passenger" value={booking.passenger_name} />
        <Field label="Seat" value={booking.seat_number} />
        <Field label="Departure Date" value={formatDate(booking.departure_time)} />
        <Field label="Departure Time" value={formatTime(booking.departure_time)} />
        <Field label="Fare" value={booking.base_fare != null ? `₱${booking.base_fare}` : "—"} />
        <Field label="Booked At" value={formatDate(booking.booked_at)} />
      </div>

      {canTrack && (
        <Link
          to={`/passenger/tracking/${booking.trip_id}`}
          className="w-full flex items-center justify-center gap-2 bg-brand-green-600 hover:bg-brand-green-500 transition-colors text-white font-display font-semibold rounded-xl py-3"
        >
          <MapPin className="w-4 h-4" />
          Track This Bus
        </Link>
      )}

      {canCancel && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={isCancelling}
          className="w-full border border-rose-300 text-rose-600 hover:bg-rose-50 disabled:opacity-60 transition-colors font-display font-semibold rounded-xl py-3"
        >
          {isCancelling ? "Cancelling…" : "Cancel Booking"}
        </button>
      )}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-xs text-ink-600">{label}</p>
      <p className="font-medium">{value ?? "—"}</p>
    </div>
  );
}
