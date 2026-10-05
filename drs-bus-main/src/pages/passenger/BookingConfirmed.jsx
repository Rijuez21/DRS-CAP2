import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2, Ticket } from "lucide-react";
import StatusBadge from "../../components/common/StatusBadge";
import BookingSteps from "../../components/passenger/BookingSteps";
import PaymentPanel from "../../components/passenger/PaymentPanel";
import { LAST_BOOKING_KEY } from "../../lib/storageKeys";

function readLastBooking() {
  try {
    return JSON.parse(sessionStorage.getItem(LAST_BOOKING_KEY) ?? "null");
  } catch {
    return null;
  }
}

// Book Ahead, step 3. Router state is lost on refresh, so the last
// reservation is also kept in sessionStorage (written by TripDetail) —
// before, a refresh showed "No booking to show" and the codes were gone.
// Titled "Reserved", not "Confirmed": the booking IS Reserved until it's
// paid — online via the QR Ph panel below (confirmed automatically once
// staff verify the payment) or at the terminal.
export default function BookingConfirmed() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const data = state?.bookings ? state : readLastBooking();
  const bookings = data?.bookings ?? [];
  const trip = data?.trip;
  // Fresh statuses from the payment panel (the sessionStorage copy still
  // says Reserved after staff verify the payment and confirm the seats).
  const [liveStatus, setLiveStatus] = useState({});

  if (bookings.length === 0) {
    return (
      <div className="max-w-md mx-auto px-4 py-10 text-center space-y-4">
        <p className="text-ink-600">Your reservations are saved in My Bookings.</p>
        <button
          type="button"
          onClick={() => navigate("/passenger/my-bookings")}
          className="bg-brand-green-600 hover:bg-brand-green-500 text-white font-display font-semibold rounded-xl px-5 py-3"
        >
          Go to My Bookings
        </button>
      </div>
    );
  }

  const total = trip?.fare != null ? trip.fare * bookings.length : null;
  const codes = bookings.map((b) => `#${b.booking_id}`).join(", ");
  const statusOf = (b) => liveStatus[b.booking_id] ?? b.status;
  const allConfirmed = bookings.every((b) => statusOf(b) === "Confirmed");

  function handlePaymentStatus(items) {
    setLiveStatus(Object.fromEntries(items.map((i) => [i.booking_id, i.booking_status])));
  }

  return (
    <div className="page-enter max-w-md mx-auto px-4 py-8 space-y-5">
      <div className="flex justify-center">
        <BookingSteps current={2} />
      </div>

      <div className="flex flex-col items-center text-center gap-2 pt-2">
        <span className="w-16 h-16 rounded-full bg-brand-green-600 text-white flex items-center justify-center ring-8 ring-brand-green-500/15 shadow-lg shadow-brand-green-600/30 mb-2">
          <CheckCircle2 className="w-8 h-8" />
        </span>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          {allConfirmed
            ? bookings.length === 1 ? "Seat confirmed" : `${bookings.length} seats confirmed`
            : bookings.length === 1 ? "Seat reserved" : `${bookings.length} seats reserved`}
        </h1>
        <p className="text-sm text-ink-600">
          {allConfirmed ? "Your payment was verified." : "Your seat is held for you. Pay online below, or at the terminal."}
        </p>
      </div>

      {/* the ticket */}
      <div className="card overflow-hidden">
        {trip && (
          <div className="hero-forest px-5 py-4">
            <p className="text-[11px] uppercase tracking-wider text-white/50">Your trip</p>
            <p className="font-display text-lg font-bold">
              {trip.origin} → {trip.destination}
            </p>
            <p className="text-sm text-white/70">
              {trip.departureTime}
              {trip.plateNumber ? ` · Bus ${trip.plateNumber}` : ""}
            </p>
          </div>
        )}
        <div className="p-5 space-y-2">
          {bookings.map((b) => (
            <div key={b.booking_id} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-ink-600">Booking code</p>
                <p className="font-display text-xl font-bold tracking-wide">#{b.booking_id}</p>
              </div>
              <div className="text-center">
                <p className="text-[11px] uppercase tracking-wider text-ink-600">Seat</p>
                <p className="font-display text-lg font-bold">{b.seat_number}</p>
              </div>
              <StatusBadge status={statusOf(b)} />
            </div>
          ))}
        </div>
        {total != null && (
          <>
            <div className="ticket-perforation" aria-hidden="true" />
            <div className="flex items-center justify-between px-5 py-4 bg-slate-50/60">
              <p className="text-sm font-medium text-ink-600">Total fare</p>
              <p className="font-display text-2xl font-bold text-brand-green-600">₱{total}</p>
            </div>
          </>
        )}
      </div>

      <PaymentPanel bookingIds={bookings.map((b) => b.booking_id)} onStatus={handlePaymentStatus} />

      <div className="flex gap-3 rounded-2xl border border-brand-sunrise-400/50 bg-brand-sunrise-400/15 p-4 text-sm">
        <span className="w-9 h-9 shrink-0 rounded-xl bg-brand-sunrise-400 text-brand-forest-950 flex items-center justify-center">
          <Ticket className="w-4 h-4" />
        </span>
        <div className="space-y-1">
          <p className="font-semibold">What to do next</p>
          <p className="text-ink-600">
            {allConfirmed
              ? `At the terminal, show your booking code ${codes} to check in and board.`
              : `Paid online? Your seat is confirmed automatically once staff verify it. Otherwise, pay at the terminal with your booking code ${codes}. Either way, show your code when you check in.`}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => navigate("/passenger/my-bookings")}
          className="w-full bg-brand-green-600 hover:bg-brand-green-500 text-white font-display font-semibold rounded-xl py-3 shadow-lg shadow-brand-green-600/25 transition-colors"
        >
          View My Bookings
        </button>
        <button
          type="button"
          onClick={() => navigate("/passenger/home")}
          className="w-full bg-white border border-slate-200 text-ink-900 font-display font-semibold rounded-xl py-3 hover:bg-slate-50 transition-colors"
        >
          Back to Home
        </button>
      </div>
    </div>
  );
}
