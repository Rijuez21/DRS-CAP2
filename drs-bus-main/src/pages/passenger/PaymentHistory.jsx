import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Wallet, ChevronRight } from "lucide-react";
import PageHeader from "../../components/passenger/PageHeader";
import EmptyState from "../../components/common/EmptyState";
import InlineAlert from "../../components/common/InlineAlert";
import PaymentStatusBadge from "../../components/payments/PaymentStatusBadge";
import * as api from "../../lib/api";
import { formatPeso } from "../../lib/image";
import { formatDateTime } from "../../lib/format";

// Every online payment the passenger has submitted, newest first — status,
// trip, seat, fare, method and any reason staff gave. Their own data only
// (GET /api/payments/mine reads the passenger from the login token).
export default function PaymentHistory() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .getMyPayments()
      .then((data) => !cancelled && setRows(data))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page-enter max-w-md mx-auto lg:max-w-2xl px-4 py-6 lg:py-10 space-y-6">
      <PageHeader icon={Wallet} title="Payments" subtitle="Online payments you've submitted and their status" />
      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      {!rows && !error ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-white border border-slate-100 animate-pulse" />
          ))}
        </div>
      ) : rows?.length === 0 ? (
        <EmptyState icon={Wallet} title="No online payments yet" description="When you pay for a booking online, its status shows up here." />
      ) : (
        <ul className="space-y-3">
          {rows?.map((p) => (
            <li key={p.payment_id}>
              <Link to={`/passenger/my-bookings/${p.booking_id}`} className="card card-interactive group flex items-center gap-3 p-4">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-semibold">{p.booking_reference}</span>
                    <PaymentStatusBadge status={p.status} />
                  </div>
                  <p className="text-sm font-medium truncate">
                    {p.origin} → {p.destination} · Seat {p.seat_number}
                  </p>
                  <p className="text-xs text-ink-600">
                    {formatDateTime(p.departure_time)} · {formatPeso(p.amount)} · {p.method_name ?? p.method_label} · sent {formatDateTime(p.submitted_at)}
                  </p>
                  {p.rejection_reason && ["Rejected", "Needs Resubmission"].includes(p.status) && (
                    <p className="text-xs text-rose-600">Staff: {p.rejection_reason}</p>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-ink-600 shrink-0 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
