import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Wallet, Image as ImageIcon, AlertTriangle, X, RefreshCw } from "lucide-react";
import * as api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import EmptyState from "../../components/common/EmptyState";
import InlineAlert from "../../components/common/InlineAlert";
import StatusBadge from "../../components/common/StatusBadge";
import Modal from "../../components/admin/Modal";
import { formatDate, formatTime } from "../../lib/format";
import { formatPeso } from "../../lib/image";

const FILTERS = [
  { value: "Pending", label: "To review" },
  { value: "Verified", label: "Verified" },
  { value: "Rejected", label: "Rejected" },
  { value: "", label: "All" },
];
const QUEUE_POLL_MS = 30000;

// Quick picks for the reject dialog — the passenger reads this reason, so
// it should tell them what to fix. Staff can still type their own.
const REJECT_REASONS = [
  "We couldn't find this reference number in our account",
  "The amount received doesn't match the fare",
  "The screenshot doesn't match the reference number",
];

function shortDateTime(iso) {
  if (!iso) return "—";
  return `${formatDate(iso)?.replace(/^\w+, /, "").replace(/, \d{4}$/, "")} ${formatTime(iso)}`;
}

// QR Ph review queue, shared by terminal staff (/staff/payments) and admin
// (/admin/payments). Staff compare each reference number (and screenshot)
// against the real receiving GCash/Maya/bank account, then:
//   Verify -> payment Verified and, if the booking is still Reserved, it is
//             confirmed automatically + the passenger is notified (one tap)
//   Reject -> reason required; the booking stays Reserved and the passenger
//             is told why so they can resubmit
// Each seat is its own row and is verified individually, even when several
// share one reference number (one transfer for a multi-seat order).
export default function PaymentReview() {
  const { user } = useAuth();
  const [status, setStatus] = useState("Pending");
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null); // row being rejected
  const [reason, setReason] = useState("");
  const [rejectError, setRejectError] = useState("");
  const [proof, setProof] = useState(null); // { row, image } | { row, loading } | { row, error }

  const load = useCallback(() => {
    return api
      .getPayments(status || undefined)
      .then((data) => {
        setRows(data);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [status]);

  useEffect(() => {
    load();
    if (status !== "Pending") return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, QUEUE_POLL_MS);
    return () => clearInterval(id);
  }, [load, status]);

  // Rows from one passenger with the same reference number are one transfer
  // (a multi-seat order). Showing the combined amount lets staff match it to
  // the single incoming payment they see in the receiving account.
  const groups = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const key = `${r.passenger_id}|${r.reference_number}|${r.status}`;
      const g = map.get(key) ?? { count: 0, total: 0 };
      g.count += 1;
      g.total += r.amount;
      map.set(key, g);
    }
    return map;
  }, [rows]);
  const groupOf = (r) => groups.get(`${r.passenger_id}|${r.reference_number}|${r.status}`);

  async function handleVerify(row) {
    const effect =
      row.booking_status === "Reserved"
        ? `This confirms booking #${row.booking_id} (seat ${row.seat_number}) and notifies ${row.passenger_name}.`
        : `Booking #${row.booking_id} is ${row.booking_status}, so it won't be changed — the payment is just recorded as received.`;
    if (!window.confirm(`Verify ${formatPeso(row.amount)} with reference ${row.reference_number}?\n\n${effect}`)) return;
    setError("");
    setSuccess("");
    setBusyId(row.payment_id);
    try {
      const result = await api.verifyPayment(row.payment_id);
      setSuccess(
        result.booking_confirmed
          ? `Payment verified — booking #${result.booking_id} is now confirmed.`
          : `Payment verified. Booking #${result.booking_id} was ${result.booking_status}, so it was left unchanged.`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
      load();
    }
  }

  function openReject(row) {
    setRejecting(row);
    setReason("");
    setRejectError("");
  }

  async function handleReject() {
    const text = reason.trim();
    if (!text) {
      setRejectError("Type a reason — the passenger will see it.");
      return;
    }
    setBusyId(rejecting.payment_id);
    setRejectError("");
    try {
      await api.rejectPayment(rejecting.payment_id, text);
      setSuccess(`Payment for booking #${rejecting.booking_id} rejected. The passenger has been told why; their seat is still held.`);
      setRejecting(null);
    } catch (err) {
      setRejectError(err.message);
    } finally {
      setBusyId(null);
      load();
    }
  }

  async function openProof(row) {
    setProof({ row, loading: true });
    try {
      const { proofImage } = await api.getPaymentProof(row.payment_id);
      setProof({ row, image: proofImage });
    } catch (err) {
      setProof({ row, error: err.message });
    }
  }

  const settingsLink = user?.role === "admin" ? "/admin/payment-settings" : null;

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Online Payments</h1>
          <p className="text-sm text-gray-500 max-w-2xl">
            Check each reference number against the receiving account before verifying. Verifying confirms the booking automatically.
          </p>
        </div>
        {settingsLink && (
          <Link to={settingsLink} className="text-sm font-semibold text-brand-green-600 hover:underline">
            Payment QR settings →
          </Link>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value || "all"}
            type="button"
            onClick={() => {
              setIsLoading(true);
              setStatus(f.value);
            }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border ${
              status === f.value ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {f.label}
          </button>
        ))}
        <button type="button" onClick={() => load()} className="ml-auto inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title={status === "Pending" ? "No payments waiting for review" : "No payments here"}
          description={status === "Pending" ? "New submissions appear here automatically." : undefined}
        />
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">Passenger</th>
                <th className="px-4 py-3">Booking / trip</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const group = groupOf(r);
                const busy = busyId === r.payment_id;
                return (
                  <tr key={r.payment_id} className="align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.passenger_name}</div>
                      <div className="text-xs text-gray-400">{r.passenger_phone || r.passenger_email}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      <div>
                        <span className="font-semibold text-gray-900">#{r.booking_id}</span> · Seat {r.seat_number}{" "}
                        <span className="text-xs text-gray-400">({r.booking_status})</span>
                      </div>
                      <div>
                        {r.origin} → {r.destination}
                      </div>
                      <div className="text-xs text-gray-400">
                        {shortDateTime(r.departure_time)}
                        {r.bus_number ? ` · Bus ${r.bus_number}` : r.plate_num ? ` · ${r.plate_num}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-semibold">{formatPeso(r.amount)}</div>
                      {group?.count > 1 && (
                        <div className="text-xs text-gray-500">
                          {group.count} seats · {formatPeso(group.total)} total
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono">{r.reference_number}</div>
                      {r.reference_used_by_other_passenger && (
                        <div className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">
                          <AlertTriangle className="w-3 h-3" /> Also used by another passenger
                        </div>
                      )}
                      {r.has_proof && (
                        <button type="button" onClick={() => openProof(r)} className="mt-1 flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline">
                          <ImageIcon className="w-3.5 h-3.5" /> View screenshot
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{shortDateTime(r.submitted_at)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                      {r.status === "Rejected" && r.rejection_reason && <div className="text-xs text-gray-500 mt-1 max-w-[14rem]">{r.rejection_reason}</div>}
                      {r.status !== "Pending" && r.verified_by_name && (
                        <div className="text-xs text-gray-400 mt-1">
                          by {r.verified_by_name}, {shortDateTime(r.verified_at)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {r.status === "Pending" && (
                        <div className="flex flex-col items-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleVerify(r)}
                            disabled={busy}
                            className="bg-brand-green-600 hover:bg-brand-green-500 disabled:opacity-60 text-white text-xs font-semibold rounded-lg px-3 py-1.5"
                          >
                            {busy ? "Working…" : "Verify"}
                          </button>
                          <button
                            type="button"
                            onClick={() => openReject(r)}
                            disabled={busy}
                            className="text-xs font-semibold text-rose-600 hover:underline disabled:opacity-60"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rejecting && (
        <Modal
          title={`Reject payment for #${rejecting.booking_id}`}
          onClose={() => setRejecting(null)}
          footer={
            <>
              <button type="button" onClick={() => setRejecting(null)} className="px-4 py-2 text-sm rounded-lg border bg-white">
                Keep it pending
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={busyId === rejecting.payment_id}
                className="px-4 py-2 text-sm rounded-lg bg-rose-600 text-white font-semibold disabled:opacity-60"
              >
                {busyId === rejecting.payment_id ? "Rejecting…" : "Reject payment"}
              </button>
            </>
          }
        >
          <p className="text-sm text-gray-600">
            {rejecting.passenger_name} · {formatPeso(rejecting.amount)} · ref <span className="font-mono">{rejecting.reference_number}</span>. The booking stays
            Reserved and the passenger can resubmit.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {REJECT_REASONS.map((text) => (
              <button key={text} type="button" onClick={() => setReason(text)} className="text-xs rounded-full border px-2.5 py-1 hover:bg-slate-50 text-left">
                {text}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            <label htmlFor="reject-reason" className="text-sm font-medium">
              Reason (shown to the passenger)
            </label>
            <textarea
              id="reject-reason"
              className="input w-full"
              rows={3}
              maxLength={255}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
          </div>
          {rejectError && <p className="text-sm text-rose-600">{rejectError}</p>}
        </Modal>
      )}

      {proof && <ProofViewer proof={proof} onClose={() => setProof(null)} />}
    </div>
  );
}

// Full-size screenshot. Not the shared Modal: that caps at max-w-md, and a
// receipt needs to be readable at its real size (scrolls if it's larger
// than the screen).
function ProofViewer({ proof, onClose }) {
  const [actualSize, setActualSize] = useState(false);
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { row } = proof;
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col" role="dialog" aria-modal="true" aria-label="Payment screenshot" onClick={onClose}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm">
          #{row.booking_id} · {row.passenger_name} · {formatPeso(row.amount)} · ref <span className="font-mono">{row.reference_number}</span>
        </p>
        <button type="button" onClick={onClose} aria-label="Close" className="p-1 hover:bg-white/10 rounded">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4 flex justify-center items-start">
        {proof.loading && <p className="text-white/80 text-sm">Loading screenshot…</p>}
        {proof.error && <p className="text-rose-200 text-sm">{proof.error}</p>}
        {proof.image && (
          // Fits the screen by default; tap to see it at full resolution.
          <img
            src={proof.image}
            alt="Payment screenshot"
            title={actualSize ? "Tap to fit the screen" : "Tap for full size"}
            className={`rounded-lg bg-white ${actualSize ? "max-w-none cursor-zoom-out" : "max-w-full max-h-full object-contain cursor-zoom-in"}`}
            onClick={(e) => {
              e.stopPropagation();
              setActualSize((v) => !v);
            }}
          />
        )}
        {proof.image === null && <p className="text-white/80 text-sm">No screenshot was uploaded.</p>}
      </div>
    </div>
  );
}
