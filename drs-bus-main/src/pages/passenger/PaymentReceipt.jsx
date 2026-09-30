import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, Printer, ReceiptText, BadgeCheck, Clock } from "lucide-react";
import InlineAlert from "../../components/common/InlineAlert";
import * as api from "../../lib/api";
import { formatPeso } from "../../lib/image";
import { formatDate, formatTime, receiptNumber } from "../../lib/format";
import sunLogo from "../../assets/logo-sun.svg";

// The official receipt for a verified QR Ph payment. There's no separate
// receipts table: a receipt IS the Verified payment row (amount, reference,
// verified_at), read through the same GET /api/payments/booking/:id the
// payment panel uses. Staff verifying the payment is what "issues" it —
// the passenger gets a bell notification linking here.
//
// "Print / Save as PDF" uses the browser's print dialog; the .print-area
// rule in index.css hides the app around the receipt.
export default function PaymentReceipt() {
  const { bookingId } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .getBookingPayment(bookingId)
      .then((row) => {
        if (!cancelled) setInfo(row);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  const back = (
    <Link
      to={`/passenger/my-bookings/${bookingId}`}
      className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-brand-green-600 transition-colors"
    >
      <ChevronLeft className="w-4 h-4" /> Booking #{bookingId}
    </Link>
  );

  if (error) {
    return (
      <div className="max-w-md mx-auto px-4 py-6 space-y-4">
        {back}
        <InlineAlert type="error" message={error} />
      </div>
    );
  }
  if (!info) {
    return (
      <div className="max-w-md mx-auto px-4 py-6 space-y-4" aria-busy="true">
        <div className="h-[32rem] rounded-3xl bg-white border border-slate-100 animate-pulse" />
      </div>
    );
  }

  const payment = info.payment;
  if (payment?.status !== "Verified") {
    return (
      <div className="page-enter max-w-md mx-auto px-4 py-6 space-y-5">
        {back}
        <div className="card p-6 text-center space-y-2">
          <span className="mx-auto w-12 h-12 rounded-2xl bg-brand-sunrise-400/20 text-amber-700 flex items-center justify-center">
            <Clock className="w-6 h-6" />
          </span>
          <p className="font-display font-semibold">No receipt yet</p>
          <p className="text-sm text-ink-600">
            {payment?.status === "Pending"
              ? "Your payment is waiting for terminal staff to verify it. Your receipt is issued automatically once they do."
              : "Receipts are issued for online payments once terminal staff verify them."}
          </p>
        </div>
      </div>
    );
  }

  const rows = [
    ["Booking code", `#${payment.booking_id}`],
    ["Route", `${payment.origin} → ${payment.destination}`],
    ["Departure", `${formatDate(payment.departure_time) ?? "—"}, ${formatTime(payment.departure_time) ?? ""}`],
    ["Seat", payment.seat_number],
    ["Bus", [payment.bus_number && `Bus ${payment.bus_number}`, payment.plate_num].filter(Boolean).join(" · ") || "—"],
  ];

  return (
    <div className="page-enter max-w-md mx-auto px-4 py-6 lg:py-10 space-y-5">
      <div className="flex items-center justify-between gap-3 print:hidden">
        {back}
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 bg-brand-green-600 hover:bg-brand-green-500 text-white text-sm font-display font-semibold rounded-xl px-4 py-2.5 shadow-md shadow-brand-green-600/25 transition-colors"
        >
          <Printer className="w-4 h-4" /> Print / Save as PDF
        </button>
      </div>

      <article className="print-area card overflow-hidden" aria-labelledby="receipt-title">
        <header className="hero-forest px-6 py-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src={sunLogo} alt="" className="w-10 h-10" />
            <div>
              <p className="font-display font-bold leading-tight">D&apos; Rising Sun Transport</p>
              <p className="text-xs text-white/60">Passenger e-receipt</p>
            </div>
          </div>
          <ReceiptText className="w-6 h-6 text-brand-sunrise-400 shrink-0" />
        </header>

        <div className="px-6 pt-6 pb-5 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 id="receipt-title" className="font-display text-xl font-bold tracking-tight">
                Official Receipt
              </h1>
              <p className="text-sm text-ink-600 font-mono">{receiptNumber(payment.payment_id)}</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border-2 border-brand-green-600 text-brand-green-600 px-3 py-1 text-xs font-bold uppercase tracking-widest -rotate-3">
              <BadgeCheck className="w-3.5 h-3.5" /> Paid
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-600/80">Issued to</dt>
              <dd className="font-medium mt-0.5">{payment.passenger_name ?? "—"}</dd>
            </div>
            <div className="text-right">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-600/80">Date paid</dt>
              <dd className="font-medium mt-0.5">
                {formatDate(payment.verified_at)?.replace(/^\w+, /, "")}
                <span className="block text-xs text-ink-600">{formatTime(payment.verified_at)}</span>
              </dd>
            </div>
          </dl>

          <div className="rounded-2xl bg-slate-50 border border-slate-100 divide-y divide-slate-100">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm">
                <span className="text-ink-600 shrink-0">{label}</span>
                <span className="font-medium text-right">{value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="ticket-perforation" aria-hidden="true" />

        <div className="px-6 py-5 space-y-3 bg-slate-50/60">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-600">Bus fare · 1 seat</span>
            <span className="font-medium">{formatPeso(payment.amount)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-dashed border-slate-300 pt-3">
            <span className="font-display font-semibold">Total paid</span>
            <span className="font-display text-2xl font-bold text-brand-green-600">{formatPeso(payment.amount)}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1 text-sm">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-600/80">Payment method</p>
              <p className="font-medium mt-0.5">QR Ph</p>
            </div>
            <div className="text-right min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-600/80">Reference no.</p>
              <p className="font-mono font-medium mt-0.5 break-all">{payment.reference_number}</p>
            </div>
          </div>
        </div>

        <footer className="px-6 py-4 border-t border-slate-100 text-center text-xs text-ink-600 space-y-0.5">
          <p>Payment verified by D&apos; Rising Sun terminal staff.</p>
          <p>Show booking code #{payment.booking_id} at the terminal to check in. Thank you for riding with us!</p>
        </footer>
      </article>
    </div>
  );
}
