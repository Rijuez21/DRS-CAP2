import { Link } from "react-router-dom";
import { Wallet, Info, History } from "lucide-react";
import PaymentStatusBadge from "../payments/PaymentStatusBadge";
import { formatPeso } from "../../lib/image";
import { formatDateTime } from "../../lib/format";

// What each payment status means for the passenger, and what to do next.
const NEXT_STEP = {
  "Awaiting Payment": "Pay using the instructions below and submit your proof before the deadline, or pay at the terminal.",
  Pending: "Staff are checking that your payment arrived in our account. Your seat stays held meanwhile.",
  Escalated: "Your payment needs an extra check by a supervisor. Your seat stays held meanwhile — no action needed unless we contact you.",
  "Needs Resubmission": "Staff need a clearer receipt or more details. Submit again below before the deadline.",
  Rejected: "We couldn't match this payment to our account. Check the details in your app and submit again, or contact the terminal.",
  Verified: "Your payment was verified and your seat is confirmed.",
  "Refund Pending": "A refund is being processed. You'll be notified when it's sent.",
  Refunded: "Your refund was sent.",
};

// Payment tracking for one booking (spec: passenger payment status page).
// Shows only passenger-safe fields from GET /api/payments/booking/:id — never
// staff names or internal notes (the server doesn't send them).
export default function PaymentStatusCard({ info }) {
  if (!info || info.channel !== "online") return null;
  const p = info.payment;
  const status = info.payment_status;
  const expired = info.booking_status === "Cancelled" && info.cancellation_reason === "payment_expired";

  return (
    <section className="card p-5 space-y-3" aria-labelledby="payment-status-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="payment-status-title" className="font-display font-semibold flex items-center gap-2">
          <Wallet className="w-5 h-5 text-brand-green-600" /> Payment
        </h2>
        <PaymentStatusBadge status={status} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Row label="Booking reference" value={info.booking_reference} mono />
        <Row label="Fare due" value={formatPeso(info.amount_due)} />
        {p && <Row label="Method" value={p.method_name ?? p.method_label} />}
        {p && <Row label="Submitted" value={formatDateTime(p.submitted_at)} />}
        {p && <Row label="Reference no." value={p.reference_number} mono />}
        {p?.amount_claimed != null && <Row label="Amount you sent" value={formatPeso(p.amount_claimed)} />}
        {!p && info.payment_deadline && info.booking_status === "Reserved" && <Row label="Pay by" value={formatDateTime(info.payment_deadline)} />}
      </dl>
      {p?.rejection_reason && ["Rejected", "Needs Resubmission"].includes(p.status) && (
        <p className="text-sm rounded-xl bg-rose-50 text-rose-700 p-3">
          <span className="font-semibold">Reason from staff:</span> {p.rejection_reason}
        </p>
      )}
      {p?.refund_reason && ["Refund Pending", "Refunded"].includes(p.status) && (
        <p className="text-sm rounded-xl bg-sky-50 text-sky-800 p-3">
          {p.refund_reason}
          {p.refund_reference ? ` · Refund ref ${p.refund_reference}` : ""}
        </p>
      )}
      <p className="flex gap-2 text-sm text-ink-600">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        {expired ? "The payment window closed without a payment, so the seat was released. Book again if seats are available." : NEXT_STEP[status]}
      </p>
      {info.history?.length > 1 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-600 inline-flex items-center gap-1">
            <History className="w-4 h-4" /> Previous attempts ({info.history.length - 1})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {info.history.slice(1).map((h) => (
              <li key={h.payment_id} className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                <span className="min-w-0">
                  <span className="font-mono">{h.reference_number}</span> · {formatDateTime(h.submitted_at)}
                  {h.rejection_reason && <span className="block text-xs text-ink-600">{h.rejection_reason}</span>}
                </span>
                <PaymentStatusBadge status={h.status} />
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-xs text-ink-600">
        Questions about a payment? Contact the terminal with your booking reference. <Link to="/passenger/payments" className="font-semibold text-brand-green-600 hover:underline">All payments →</Link>
      </p>
    </section>
  );
}

function Row({ label, value, mono }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-600/80">{label}</dt>
      <dd className={`font-medium mt-0.5 break-words ${mono ? "font-mono" : ""}`}>{value ?? "—"}</dd>
    </div>
  );
}
