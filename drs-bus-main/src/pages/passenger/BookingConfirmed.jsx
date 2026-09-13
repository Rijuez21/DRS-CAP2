import { useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import StatusBadge from "../../components/common/StatusBadge";

export default function BookingConfirmed() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const bookings = state?.bookings ?? [];
  const trip = state?.trip;

  if (bookings.length === 0) {
    return (
      <div className="max-w-md mx-auto px-4 py-10 text-center space-y-4">
        <p className="text-ink-600">No booking to show. Start from Trips instead.</p>
        <button
          type="button"
          onClick={() => navigate("/passenger/trips")}
          className="text-brand-green-600 font-medium underline underline-offset-2"
        >
          Browse trips
        </button>
      </div>
    );
  }

  const total = trip?.fare != null ? trip.fare * bookings.length : null;

  return (
    <div className="max-w-md mx-auto px-4 py-8 space-y-5">
      <div className="flex flex-col items-center text-center gap-2">
        <span className="w-14 h-14 rounded-full bg-brand-green-600/10 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-brand-green-600" />
        </span>
        <h1 className="font-display text-xl font-bold">Booking Confirmed</h1>
        <p className="text-sm text-ink-600">
          Show your booking code at the terminal. Fare is paid upon boarding.
        </p>
      </div>

      <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5 space-y-4">
        {trip && (
          <div>
            <p className="font-display font-semibold">
              {trip.origin} → {trip.destination}
            </p>
            <p className="text-sm text-ink-600">
              {trip.departureTime} · {trip.busModel}
            </p>
          </div>
        )}

        <div className="space-y-2">
          {bookings.map((b) => (
            <div
              key={b.booking_id}
              className="flex items-center justify-between rounded-2xl bg-brand-green-600/5 px-4 py-3"
            >
              <div>
                <p className="text-xs text-ink-600">Booking Code</p>
                <p className="font-display font-bold">#{b.booking_id}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-ink-600">Seat</p>
                <p className="font-medium">{b.seatNumber}</p>
              </div>
              <StatusBadge status={b.status} />
            </div>
          ))}
        </div>

        {total != null && (
          <div className="flex items-center justify-between rounded-2xl bg-brand-green-600/10 px-4 py-3">
            <p className="text-xs text-ink-600">Total Due at Boarding</p>
            <p className="font-display text-lg font-bold text-brand-green-600">₱{total}</p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => navigate("/passenger/my-bookings")}
          className="w-full bg-brand-green-600 hover:bg-brand-green-500 transition-colors text-white font-display font-semibold rounded-xl py-3"
        >
          View My Bookings
        </button>
        <button
          type="button"
          onClick={() => navigate("/passenger/home")}
          className="w-full text-sm text-ink-600 hover:text-brand-green-600 py-2"
        >
          Back to Home
        </button>
      </div>
    </div>
  );
}
