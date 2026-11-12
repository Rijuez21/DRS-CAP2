import { useRef, useState } from "react";
import { useBlocker, useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2, Ticket } from "lucide-react";
import StatusBadge from "../../components/common/StatusBadge";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import InlineAlert from "../../components/common/InlineAlert";
import BookingSteps from "../../components/passenger/BookingSteps";
import PaymentPanel from "../../components/passenger/PaymentPanel";
import * as api from "../../lib/api";
import { useKeepAlive } from "../../hooks/useKeepAlive";
import { LAST_BOOKING_KEY } from "../../lib/storageKeys";
import { bookingReference } from "../../lib/format";
import { discountedFare, CATEGORY_LABELS, DISCOUNT_PERCENT } from "../../lib/discounts";

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
  // The panel's per-seat rows (null until loaded): `payment` is set once
  // any proof was sent or cash taken.
  const [paymentItems, setPaymentItems] = useState(null);

  // Going BACK from here (browser/phone back, or the Trips link) used to
  // leave the seats Reserved without a payment — on the admin Reservations
  // page and blocking other passengers — until the payment hold ran out.
  // While the seats are still an unpaid hold, ask first; going ahead puts
  // them back on sale. "View My Bookings" / "Back to Home" keep the
  // reservation (the passenger can still pay from My Bookings or at the
  // terminal before the deadline).
  const unpaidHold =
    bookings.length > 0 &&
    (paymentItems
      ? paymentItems.every((i) => i.booking_status === "Reserved" && !i.payment)
      : bookings.every((b) => b.status === "Reserved"));
  const leavingRef = useRef(false);
  // Paying isn't "inactive" (no idle sign-out while this step is on screen).
  useKeepAlive(unpaidHold);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation, historyAction }) =>
      unpaidHold &&
      !leavingRef.current &&
      currentLocation.pathname !== nextLocation.pathname &&
      (historyAction === "POP" || nextLocation.pathname.startsWith("/passenger/trips"))
  );
  const [releasing, setReleasing] = useState(false);
  const [leaveError, setLeaveError] = useState("");

  async function releaseAndLeave() {
    if (releasing) return;
    setReleasing(true);
    setLeaveError("");
    try {
      await api.abandonBookings(bookings.map((b) => b.booking_id));
    } catch (err) {
      // 409 = a payment exists after all (sent from another tab, or cash at
      // the counter), 404 = already gone: either way nothing to release.
      if (err.status !== 409 && err.status !== 404) {
        setReleasing(false);
        setLeaveError(`Your seats weren't released: ${err.message}`);
        blocker.reset?.();
        return;
      }
    }
    sessionStorage.removeItem(LAST_BOOKING_KEY);
    leavingRef.current = true;
    blocker.proceed?.();
  }

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

  // One seat may be at the student / PWD / senior fare (bookings[].discount_category).
  const total = trip?.fare != null ? bookings.reduce((sum, b) => sum + (b.discount_category ? discountedFare(trip.fare) : Number(trip.fare)), 0) : null;
  const anyDiscount = bookings.some((b) => b.discount_category); // then label every seat: discounted or Regular
  const codes = bookings.map((b) => b.booking_reference ?? bookingReference(b.booking_id)).join(", ");
  const statusOf = (b) => liveStatus[b.booking_id] ?? b.status;
  const allConfirmed = bookings.every((b) => statusOf(b) === "Confirmed");

  function handlePaymentStatus(items) {
    setLiveStatus(Object.fromEntries(items.map((i) => [i.booking_id, i.booking_status])));
    setPaymentItems(items);
  }

  const seatList = bookings.map((b) => b.seat_number).join(", ");

  return (
    <div className="page-enter max-w-md mx-auto px-4 py-8 space-y-5">
      <div className="flex justify-center">
        <BookingSteps current={2} />
      </div>

      <InlineAlert type="error" message={leaveError} onDismiss={() => setLeaveError("")} />

      {blocker.state === "blocked" && (
        <ConfirmDialog
          title="Leave without paying?"
          confirmLabel={bookings.length === 1 ? "Release seat & go back" : "Release seats & go back"}
          cancelLabel="Stay and pay"
          busyLabel="Releasing…"
          busy={releasing}
          onConfirm={releaseAndLeave}
          onCancel={() => blocker.reset()}
        >
          <p>
            {bookings.length === 1 ? `Seat ${seatList} is` : `Seats ${seatList} are`} only held while you pay. If you go back now, the
            reservation is cancelled and {bookings.length === 1 ? "the seat goes" : "the seats go"} back on sale.
          </p>
          <p className="mt-2">To keep it and pay at the terminal instead, stay and tap “View My Bookings”.</p>
        </ConfirmDialog>
      )}

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
          {allConfirmed ? "Your payment was verified." : "Your seat is held for a limited time. Pay online below and submit your proof, or pay at the terminal."}
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
                <p className="text-[11px] font-mono text-ink-600">{b.booking_reference ?? bookingReference(b.booking_id)}</p>
              </div>
              <div className="text-center">
                <p className="text-[11px] uppercase tracking-wider text-ink-600">Seat</p>
                <p className="font-display text-lg font-bold">{b.seat_number}</p>
                {anyDiscount && (
                  <p className={`text-[11px] font-semibold ${b.discount_category ? "text-brand-green-600" : "text-ink-600"}`}>
                    {b.discount_category ? `${CATEGORY_LABELS[b.discount_category]} ${DISCOUNT_PERCENT}% off` : "Regular"}
                  </p>
                )}
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
              : `Paid online? Your seat is confirmed once staff verify the money arrived. Otherwise, pay at the terminal with your booking reference ${codes} before the deadline. Either way, show your reference when you check in.`}
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
