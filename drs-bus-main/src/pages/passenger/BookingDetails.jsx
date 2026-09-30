import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, MapPin, Info, Bus, ReceiptText } from "lucide-react";
import StatusBadge from "../../components/common/StatusBadge";
import InlineAlert from "../../components/common/InlineAlert";
import PaymentPanel from "../../components/passenger/PaymentPanel";
import * as api from "../../lib/api";
import { formatDate, formatTime, receiptNumber } from "../../lib/format";

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
    <Link to="/passenger/my-bookings" className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-brand-green-600 transition-colors">
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
    <div className="page-enter max-w-md mx-auto px-4 py-6 lg:py-10 space-y-5">
      {back}

      {/* the ticket: code + route on the stub, details below the perforation */}
      <div className="card overflow-hidden">
        <div className="hero-forest p-5 pb-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-white/50">Booking code</p>
              <p className="font-display text-3xl font-bold tracking-wide">#{booking.booking_id}</p>
            </div>
            {/* white backing keeps the badge colours readable on the dark stub */}
            <span className="rounded-full bg-white p-0.5 shadow-sm">
              <StatusBadge status={booking.status} />
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-white/50">From</p>
              <p className="font-display font-semibold truncate">{booking.origin}</p>
            </div>
            <span className="flex-1 min-w-8 flex items-center" aria-hidden="true">
              <span className="flex-1 border-t-2 border-dashed border-white/25" />
              <Bus className="w-4 h-4 text-brand-sunrise-400 mx-1.5 shrink-0" />
              <span className="flex-1 border-t-2 border-dashed border-white/25" />
            </span>
            <div className="min-w-0 text-right">
              <p className="text-[11px] uppercase tracking-wider text-white/50">To</p>
              <p className="font-display font-semibold truncate">{booking.destination}</p>
            </div>
          </div>
        </div>

        <div className="ticket-perforation" aria-hidden="true" />

        <div className="p-5 grid grid-cols-2 gap-y-4 gap-x-4">
          <Field label="Passenger" value={booking.passenger_name} />
          <Field label="Seat" value={booking.seat_number} />
          <Field label="Date" value={formatDate(booking.departure_time)} />
          <Field label="Departs" value={formatTime(booking.departure_time)} />
          <Field label="Bus" value={booking.plate_num} />
          <Field label="Fare" value={booking.base_fare != null ? `₱${Number(booking.base_fare).toLocaleString("en-PH")}` : null} />
          <Field label="Trip status" value={booking.trip_status} />
          <Field label="Booked" value={`${formatDate(booking.booked_at)?.replace(/^\w+, /, "")} ${formatTime(booking.booked_at) ?? ""}`} />
        </div>
      </div>

      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />
      <InlineAlert type="error" message={actionError} onDismiss={() => setActionError("")} />

      {notice && (
        <p
          className={`flex gap-3 text-sm rounded-2xl p-4 border ${
            booking.trip_status === "Cancelled" ? "bg-rose-50 text-rose-700 border-rose-200" : "bg-brand-sunrise-400/15 text-ink-900 border-brand-sunrise-400/40"
          }`}
        >
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          {notice}
        </p>
      )}

      {booking.status === "Reserved" && booking.channel === "online" && busNotLeft && (
        <PaymentPanel bookingIds={[booking.booking_id]} onStatus={handlePaymentStatus} />
      )}

      {paymentInfo?.payment?.status === "Verified" && (
        <Link
          to={`/passenger/my-bookings/${booking.booking_id}/receipt`}
          className="card card-interactive group flex items-center gap-3 rounded-2xl p-4"
        >
          <span className="w-10 h-10 shrink-0 rounded-xl bg-brand-green-600 text-white flex items-center justify-center">
            <ReceiptText className="w-5 h-5" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-display font-semibold">Official receipt</span>
            <span className="block text-xs text-ink-600">
              {receiptNumber(paymentInfo.payment.payment_id)} · Payment verified · view, print or save as PDF
            </span>
          </span>
          <ChevronRight className="w-4 h-4 text-ink-600 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}

      {canTrack && (
        <Link
          to={`/passenger/tracking/${booking.trip_id}`}
          className="w-full flex items-center justify-center gap-2 bg-brand-green-600 hover:bg-brand-green-500 text-white font-display font-semibold rounded-xl py-3 shadow-lg shadow-brand-green-600/25 transition-colors"
        >
          <MapPin className="w-4 h-4" /> Track this bus live
        </Link>
      )}
      {canCancel && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={isCancelling}
          className="w-full border border-rose-200 text-rose-600 bg-white hover:bg-rose-50 hover:border-rose-300 disabled:opacity-60 font-display font-semibold rounded-xl py-3 transition-colors"
        >
          {isCancelling ? "Cancelling…" : booking.channel === "flagged" ? "Cancel this ride" : "Cancel booking"}
        </button>
      )}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-600/80">{label}</p>
      <p className="font-medium mt-0.5">{value ?? "—"}</p>
    </div>
  );
}
