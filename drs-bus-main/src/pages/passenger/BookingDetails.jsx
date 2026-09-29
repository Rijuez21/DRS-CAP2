import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, MapPin, Info } from "lucide-react";
import StatusBadge from "../../components/common/StatusBadge";
import InlineAlert from "../../components/common/InlineAlert";
import PaymentPanel from "../../components/passenger/PaymentPanel";
import * as api from "../../lib/api";
import { formatDate, formatTime } from "../../lib/format";

export default function BookingDetails() {
  const { bookingId } = useParams();
  const [booking, setBooking] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  // Latest payment state from PaymentPanel (null until it loads).
  const [paymentInfo, setPaymentInfo] = useState(null);

  // The panel re-reads the booking's status with its payment, so a booking
  // staff confirmed by verifying the payment updates here without a reload.
  function handlePaymentStatus([info]) {
    if (!info) return;
    setPaymentInfo(info);
    setBooking((prev) => (prev && prev.status !== info.booking_status ? { ...prev, status: info.booking_status } : prev));
  }

  useEffect(() => {
    let cancelled = false;
    api
      .getBooking(bookingId)
      .then((row) => {
        if (!cancelled) setBooking(row);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });
    // Also needed once the booking is Confirmed (the payment panel is gone
    // by then): cancelling a seat that was paid online must warn about the
    // refund. Failure here only loses that warning, so it's not an error.
    api
      .getBookingPayment(bookingId)
      .then((info) => {
        if (!cancelled) setPaymentInfo(info);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  async function handleCancel() {
    const flagged = booking.channel === "flagged";
    // A payment staff haven't verified yet isn't refunded automatically —
    // say so before the passenger gives the seat up.
    const paymentStatus = paymentInfo?.payment?.status;
    const question = flagged
      ? "Cancel this ride? The driver will be told not to stop for you."
      : paymentStatus === "Pending" || paymentStatus === "Verified"
        ? "Cancel this booking? You've already sent an online payment for it — cancelling releases your seat but does NOT refund that payment automatically. Contact the terminal about a refund. This can't be undone."
        : "Cancel this booking? Your seat will be released and this can't be undone.";
    if (!window.confirm(question)) return;
    setActionError("");
    setIsCancelling(true);
    try {
      await api.updateBookingStatus(bookingId, "Cancelled");
      setBooking((prev) => ({ ...prev, status: "Cancelled" }));
      setSuccess(flagged ? "Ride cancelled. The driver has been told." : "Booking cancelled. Your seat has been released.");
    } catch (err) {
      setActionError(err.message);
      // 409 = it changed underneath us (e.g. staff just verified the payment
      // and confirmed it). Show the real status rather than a stale one.
      if (err.status === 409) api.getBooking(bookingId).then(setBooking).catch(() => {});
    } finally {
      setIsCancelling(false);
    }
  }

  const back = (
    <Link to="/passenger/my-bookings" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-brand-green-600">
      <ChevronLeft className="w-4 h-4" /> My Bookings
    </Link>
  );

  if (loadError) {
    return (
      <div className="max-w-md mx-auto px-4 py-6 space-y-4">
        {back}
        <InlineAlert type="error" message={loadError} />
      </div>
    );
  }
  if (!booking) {
    return (
      <div className="max-w-md mx-auto px-4 py-6 space-y-4" aria-busy="true">
        <div className="h-28 rounded-3xl bg-brand-forest-900/80 animate-pulse" />
        <div className="h-40 rounded-3xl bg-white border border-slate-100 animate-pulse" />
      </div>
    );
  }

  const holdsSeat = ["Reserved", "Confirmed", "Boarded"].includes(booking.status);
  const busNotLeft = ["Scheduled", "Boarding"].includes(booking.trip_status);
  // Same rule the server enforces (bookingRules.whyStatusChangeNotAllowed).
  const canCancel = ["Reserved", "Confirmed"].includes(booking.status) && busNotLeft;
  // A position only exists once the driver is sharing GPS (Boarding onward).
  const canTrack = holdsSeat && ["Boarding", "In Transit"].includes(booking.trip_status);

  const notice =
    booking.trip_status === "Cancelled"
      ? "This trip was cancelled by the operator. Please book another trip."
      : booking.status === "Reserved" && busNotLeft
        ? paymentInfo?.payment?.status === "Pending"
          ? "Your seat is held while staff verify your payment. It's confirmed automatically once they do."
          : `Pay online below, or pay at the terminal with booking code #${booking.booking_id}. Either confirms your seat.`
        : booking.status === "Confirmed" && booking.trip_status === "Scheduled"
          ? "Your seat is confirmed. Live bus tracking starts when boarding opens."
          : null;

  return (
    <div className="max-w-md mx-auto px-4 py-6 space-y-5">
      {back}

      <div className="rounded-3xl bg-brand-forest-900 text-white p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-white/60">Booking code</p>
            <p className="font-display text-3xl font-bold">#{booking.booking_id}</p>
          </div>
          <StatusBadge status={booking.status} />
        </div>
        <p className="text-sm text-white/80">
          {booking.origin} → {booking.destination}
        </p>
      </div>

      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />
      <InlineAlert type="error" message={actionError} onDismiss={() => setActionError("")} />

      {notice && (
        <p className={`flex gap-2 text-sm rounded-2xl p-4 ${booking.trip_status === "Cancelled" ? "bg-rose-50 text-rose-700" : "bg-brand-sunrise-400/15 text-ink-900"}`}>
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          {notice}
        </p>
      )}

      <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5 grid grid-cols-2 gap-y-4 gap-x-4">
        <Field label="Passenger" value={booking.passenger_name} />
        <Field label="Seat" value={booking.seat_number} />
        <Field label="Date" value={formatDate(booking.departure_time)} />
        <Field label="Departs" value={formatTime(booking.departure_time)} />
        <Field label="Bus" value={booking.plate_num} />
        <Field label="Fare" value={booking.base_fare != null ? `₱${booking.base_fare}` : null} />
        <Field label="Trip status" value={booking.trip_status} />
        <Field label="Booked" value={`${formatDate(booking.booked_at)?.replace(/^\w+, /, "")} ${formatTime(booking.booked_at) ?? ""}`} />
      </div>

      {booking.status === "Reserved" && booking.channel === "online" && busNotLeft && (
        <PaymentPanel bookingIds={[booking.booking_id]} onStatus={handlePaymentStatus} />
      )}

      {canTrack && (
        <Link
          to={`/passenger/tracking/${booking.trip_id}`}
          className="w-full flex items-center justify-center gap-2 bg-brand-green-600 hover:bg-brand-green-500 text-white font-display font-semibold rounded-xl py-3"
        >
          <MapPin className="w-4 h-4" /> Track this bus live
        </Link>
      )}
      {canCancel && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={isCancelling}
          className="w-full border border-rose-300 text-rose-600 bg-white hover:bg-rose-50 disabled:opacity-60 font-display font-semibold rounded-xl py-3"
        >
          {isCancelling ? "Cancelling…" : booking.channel === "flagged" ? "Cancel this ride" : "Cancel booking"}
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
