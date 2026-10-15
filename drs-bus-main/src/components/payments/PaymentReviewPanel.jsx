import { useCallback, useEffect, useState } from "react";
import {
  X,
  AlertTriangle,
  Copy,
  Check,
  UserCheck,
  ShieldCheck,
  Undo2,
  Flag,
  RotateCcw,
  Ban,
  Clock,
  History,
  StickyNote,
  Maximize2,
} from "lucide-react";
import * as api from "../../lib/api";
import Modal from "../admin/Modal";
import ReceiptImage from "./ReceiptImage";
import PaymentStatusBadge from "./PaymentStatusBadge";
import StatusBadge from "../common/StatusBadge";
import { formatPeso } from "../../lib/image";
import { formatDateTime, paymentStatusLabel } from "../../lib/format";

const OPEN = ["Pending", "Escalated"];

const REJECT_REASONS = [
  "We couldn't find this reference number in our account",
  "The amount received doesn't match the fare",
  "The receipt doesn't match the reference number",
  "This receipt was already used for another booking",
];
const RESUBMIT_REASONS = [
  "The screenshot is blurry — please upload a clearer one",
  "The reference number isn't visible on the receipt",
  "Please upload the full receipt showing the amount and date",
];

const ACTION_LABELS = {
  submitted: "Proof submitted",
  resubmitted: "Proof resubmitted",
  verified: "Verified — funds confirmed",
  rejected: "Rejected",
  resubmission_requested: "Asked for resubmission",
  escalated: "Escalated",
  assigned: "Started reviewing",
  unassigned: "Stopped reviewing",
  note: "Internal note",
  refund_requested: "Refund requested",
  refund_confirmed: "Refund confirmed sent",
  refund_cancelled: "Refund cancelled",
  seat_released: "Seat released (deadline passed)",
  legacy_backfill: "Imported from the old payment system",
};

// The review screen for one transfer. Everything needed to decide is on
// this one screen: the receipt next to the booking(s), the official account
// it should have reached, duplicate warnings, earlier attempts and the full
// history. The receipt is never treated as proof — Verify asks staff to
// confirm they found the money in the real account records first.
export default function PaymentReviewPanel({ submissionId, user, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [modal, setModal] = useState(null); // { type, seat? }
  const [busy, setBusy] = useState(false);
  const [fullImage, setFullImage] = useState(null);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const isAdmin = user?.role === "admin";

  const load = useCallback(
    () =>
      api
        .getPaymentSubmission(submissionId)
        .then((d) => {
          setDetail(d);
          setError("");
        })
        .catch((err) => setError(err.message)),
    [submissionId]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when switching payments
    setDetail(null);
    load();
  }, [load]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && !modal && !fullImage) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, modal, fullImage]);

  async function run(fn, message) {
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      setSuccess(typeof message === "function" ? message(result) : message);
      setModal(null);
      await load();
      onChanged?.();
      return result;
    } catch (err) {
      // 409s mean the payment changed under us — show the fresh state.
      if (err.status === 409 && err.data?.code !== "DUPLICATE_ACK_REQUIRED") load();
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function handleAssign(assign) {
    try {
      await run(() => api.assignSubmission(submissionId, assign), assign ? "You're now reviewing this payment." : "Released for another reviewer.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleNote(e) {
    e.preventDefault();
    if (!note.trim()) return;
    try {
      await run(() => api.addSubmissionNote(submissionId, note.trim()), "Note saved (staff only).");
      setNote("");
    } catch (err) {
      setError(err.message);
    }
  }

  const statuses = detail?.statuses ?? [];
  const isOpen = statuses.some((s) => OPEN.includes(s));
  const escalated = statuses.includes("Escalated");
  const canDecide = isOpen && (!escalated || isAdmin);
  const suspicious = detail?.duplicates?.filter((d) => !d.same_passenger || d.same_receipt) ?? [];
  const seatsCancelled = detail?.seats?.filter((s) => s.booking_status === "Cancelled") ?? [];

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={`Payment submission ${submissionId}`}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative h-full w-full max-w-5xl bg-surface shadow-2xl flex flex-col">
        <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 bg-white border-b">
          <div className="min-w-0">
            <h2 className="font-display font-bold text-lg truncate">Payment #{submissionId}</h2>
            {detail && (
              <p className="text-xs text-gray-500 truncate">
                {detail.passenger_name} · submitted {formatDateTime(detail.submitted_at)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {statuses.map((s) => (
              <PaymentStatusBadge key={s} status={s} />
            ))}
            <button type="button" onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100" aria-label="Close review">
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          {error && (
            <p role="alert" className="text-sm rounded-lg bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2">
              {error}
            </p>
          )}
          {success && (
            <p role="status" className="text-sm rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2">
              {success}
            </p>
          )}
          {!detail ? (
            !error && <div className="h-64 rounded-xl bg-white animate-pulse" aria-busy="true" />
          ) : (
            <>
              {/* Warnings first — they change how much to trust everything below. */}
              <div className="space-y-2">
                {detail.reference_already_verified_elsewhere && (
                  <Warning tone="rose" title="Reference already verified for another payment">
                    Submission #{detail.reference_claim.submission_id} already used this reference
                    {detail.reference_claim.claimed_by_name ? ` (verified by ${detail.reference_claim.claimed_by_name})` : ""}. The same money can't pay twice — reject this one.
                  </Warning>
                )}
                {suspicious.length > 0 && (
                  <Warning tone="amber" title="Possible duplicate">
                    <ul className="list-disc pl-4 space-y-0.5">
                      {suspicious.map((d) => (
                        <li key={d.submission_id}>
                          #{d.submission_id} · {d.passenger_name} · {d.same_reference ? "same reference" : ""}
                          {d.same_reference && d.same_receipt ? " and " : ""}
                          {d.same_receipt ? "identical receipt image" : ""} · {d.statuses ?? "—"} · {formatDateTime(d.submitted_at)}
                        </li>
                      ))}
                    </ul>
                  </Warning>
                )}
                {detail.amount_mismatch && (
                  <Warning tone="amber" title="Amount doesn't match">
                    Passenger says they sent {formatPeso(detail.amount_claimed)}, but {formatPeso(detail.amount_due)} is due. Verify only the amount you actually see received.
                  </Warning>
                )}
                {seatsCancelled.length > 0 && isOpen && (
                  <Warning tone="slate" title="Booking cancelled meanwhile">
                    {seatsCancelled.map((s) => s.booking_reference).join(", ")} {seatsCancelled.length === 1 ? "was" : "were"} cancelled. If the money arrived, verifying records
                    it and opens a refund automatically.
                  </Warning>
                )}
                {escalated && !isAdmin && (
                  <Warning tone="violet" title="Escalated">
                    An administrator needs to decide on this payment.
                  </Warning>
                )}
                {detail.is_legacy && (
                  <Warning tone="slate" title="From the old payment system">
                    Submitted before payment methods existed: method, claimed amount and payment time weren't collected.
                  </Warning>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                {/* Receipt */}
                <section className="bg-white rounded-xl border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Passenger&apos;s receipt</h3>
                    {detail.has_receipt && (
                      <span className="text-xs text-gray-400">
                        {detail.receipt_mime?.replace("image/", "").toUpperCase()} {detail.receipt_bytes ? `· ${Math.round(detail.receipt_bytes / 1024)} KB` : ""}
                      </span>
                    )}
                  </div>
                  {detail.has_receipt ? (
                    <>
                      <ReceiptImage submissionId={submissionId} className="w-full max-h-[60vh]" onClick={setFullImage} />
                      <p className="text-xs text-gray-500 flex items-center gap-1">
                        <Maximize2 className="w-3 h-3" /> Tap to enlarge. A screenshot can be edited — it is not proof the money arrived.
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-500 py-8 text-center">No receipt image on file.</p>
                  )}
                </section>

                <div className="space-y-4">
                  {/* What to look for in the official records */}
                  <section className="bg-white rounded-xl border p-4 space-y-3">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-brand-green-600" /> Check in the official account
                    </h3>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <Field label="Account">
                        {[detail.method_name ?? detail.method_label, detail.method_bank_name].filter(Boolean).join(" · ")}
                        {detail.method_account_number && <span className="block font-mono text-xs text-gray-500">{detail.method_account_number}</span>}
                      </Field>
                      <Field label="Reference no.">
                        <span className="font-mono font-semibold break-all">{detail.reference_number}</span>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(detail.reference_number);
                              setCopied(true);
                              setTimeout(() => setCopied(false), 1500);
                            } catch {
                              /* ignore */
                            }
                          }}
                          className="ml-1.5 inline-flex items-center text-xs text-sky-700"
                          aria-label="Copy reference number"
                        >
                          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </Field>
                      <Field label="Amount due">
                        <span className="font-semibold">{formatPeso(detail.amount_due)}</span>
                      </Field>
                      <Field label="Passenger says they sent">
                        <span className={detail.amount_mismatch ? "font-semibold text-amber-700" : "font-semibold"}>{formatPeso(detail.amount_claimed)}</span>
                      </Field>
                      <Field label="Paid at (per passenger)">{formatDateTime(detail.paid_at) ?? "—"}</Field>
                      <Field label="Submitted">{formatDateTime(detail.submitted_at)}</Field>
                      {detail.amount_received != null && (
                        <Field label="Received (confirmed)">
                          <span className="font-semibold text-brand-green-600">{formatPeso(detail.amount_received)}</span>
                          {detail.ledger_reference && <span className="block text-xs text-gray-500">Ledger ref {detail.ledger_reference}</span>}
                        </Field>
                      )}
                      <Field label="Passenger">
                        {detail.passenger_name}
                        <span className="block text-xs text-gray-500">{detail.passenger_phone || detail.passenger_email}</span>
                      </Field>
                    </dl>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      {detail.assigned_to_name ? (
                        <span className="inline-flex items-center gap-1">
                          <UserCheck className="w-3.5 h-3.5" /> Being reviewed by {detail.assigned_to === user?.id ? "you" : detail.assigned_to_name}
                        </span>
                      ) : (
                        isOpen && <span>No one is reviewing this yet.</span>
                      )}
                      {isOpen && !detail.assigned_to && (
                        <button type="button" disabled={busy} onClick={() => handleAssign(true)} className="font-semibold text-sky-700 hover:underline">
                          I&apos;m checking it
                        </button>
                      )}
                      {isOpen && detail.assigned_to === user?.id && (
                        <button type="button" disabled={busy} onClick={() => handleAssign(false)} className="font-semibold text-sky-700 hover:underline">
                          Release
                        </button>
                      )}
                    </div>
                  </section>

                  {/* Seats on this transfer */}
                  <section className="bg-white rounded-xl border overflow-hidden">
                    <h3 className="text-sm font-semibold px-4 pt-3 pb-2">Booking{detail.seats.length > 1 ? `s (${detail.seats.length} seats)` : ""}</h3>
                    <ul className="divide-y">
                      {detail.seats.map((s) => (
                        <li key={s.payment_id} className="px-4 py-3 text-sm space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-mono font-semibold">{s.booking_reference}</span>
                            <span className="flex items-center gap-1.5">
                              <StatusBadge status={s.booking_status} />
                              <PaymentStatusBadge status={s.status} />
                            </span>
                          </div>
                          <p className="text-gray-600">
                            {s.origin} → {s.destination} · Seat {s.seat_number} · {formatPeso(s.amount)}
                          </p>
                          <p className="text-xs text-gray-500">
                            Departs {formatDateTime(s.departure_time)} ({s.trip_status}){s.bus_number ? ` · Bus ${s.bus_number}` : s.plate_num ? ` · ${s.plate_num}` : ""}
                            {s.payment_deadline && s.booking_status === "Reserved" ? ` · pay-by ${formatDateTime(s.payment_deadline)}` : ""}
                          </p>
                          {s.rejection_reason && !OPEN.includes(s.status) && s.status !== "Verified" && <p className="text-xs text-rose-600">Told passenger: {s.rejection_reason}</p>}
                          {s.refund_reason && <p className="text-xs text-sky-700">Refund: {s.refund_reason}{s.refund_reference ? ` · ref ${s.refund_reference}` : ""}</p>}
                          <div className="flex flex-wrap gap-3 pt-0.5">
                            {s.status === "Verified" && (
                              <button type="button" onClick={() => setModal({ type: "refund", seat: s })} className="text-xs font-semibold text-sky-700 hover:underline inline-flex items-center gap-1">
                                <Undo2 className="w-3.5 h-3.5" /> Start refund
                              </button>
                            )}
                            {s.status === "Refund Pending" && isAdmin && (
                              <>
                                <button type="button" onClick={() => setModal({ type: "refundConfirm", seat: s })} className="text-xs font-semibold text-brand-green-600 hover:underline">
                                  Confirm refund sent
                                </button>
                                <button type="button" onClick={() => setModal({ type: "refundCancel", seat: s })} className="text-xs font-semibold text-gray-500 hover:underline">
                                  Cancel refund
                                </button>
                              </>
                            )}
                            {s.status === "Refund Pending" && !isAdmin && <span className="text-xs text-gray-500">An administrator confirms the refund once it's sent.</span>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              </div>

              {detail.previous_attempts.length > 0 && (
                <section className="bg-white rounded-xl border p-4">
                  <h3 className="text-sm font-semibold mb-2">Earlier attempts for these bookings</h3>
                  <ul className="text-sm divide-y">
                    {detail.previous_attempts.map((a) => (
                      <li key={a.payment_id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                        <span>
                          {a.booking_reference} · <span className="font-mono">{a.reference_number}</span> · {formatDateTime(a.submitted_at)}
                          {a.amount_claimed != null && ` · ${formatPeso(a.amount_claimed)}`}
                          {a.rejection_reason && <span className="block text-xs text-gray-500">{a.rejection_reason}</span>}
                        </span>
                        <PaymentStatusBadge status={a.status} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="bg-white rounded-xl border p-4 space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <History className="w-4 h-4" /> History
                </h3>
                <ol className="space-y-2 text-sm">
                  {detail.history.map((h) => (
                    <li key={h.audit_log_id} className="flex gap-3">
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-slate-300 shrink-0" />
                      <div className="min-w-0">
                        <p>
                          <span className="font-medium">{ACTION_LABELS[h.action] ?? h.action}</span>
                          {h.previous_status || h.new_status ? (
                            <span className="text-gray-500">
                              {" "}
                              ({h.previous_status ? `${paymentStatusLabel(h.previous_status)} → ` : ""}
                              {paymentStatusLabel(h.new_status ?? "—")})
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-gray-500">
                          {h.actor_name ?? h.actor_role} · {h.actor_role} · {formatDateTime(h.created_at)}
                        </p>
                        {h.reason && <p className="text-xs text-gray-700">Reason: {h.reason}</p>}
                        {h.internal_note && (
                          <p className="text-xs text-violet-800 bg-violet-50 rounded px-2 py-1 mt-1 inline-flex gap-1">
                            <StickyNote className="w-3 h-3 mt-0.5 shrink-0" /> {h.internal_note}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
                <form onSubmit={handleNote} className="flex gap-2">
                  <input
                    className="input flex-1"
                    placeholder="Add an internal note (staff only)…"
                    maxLength={1000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    aria-label="Internal note"
                  />
                  <button type="submit" disabled={busy || !note.trim()} className="px-3 py-2 text-sm rounded-lg border bg-white font-semibold disabled:opacity-50">
                    Save
                  </button>
                </form>
              </section>
            </>
          )}
        </div>

        {detail && isOpen && (
          <footer className="border-t bg-white px-4 sm:px-6 py-3 flex flex-wrap items-center gap-2">
            {canDecide ? (
              <>
                <button
                  type="button"
                  onClick={() => setModal({ type: "verify" })}
                  className="bg-brand-green-600 hover:bg-brand-green-500 text-white text-sm font-semibold rounded-lg px-4 py-2 inline-flex items-center gap-1.5"
                >
                  <ShieldCheck className="w-4 h-4" /> Verify payment
                </button>
                <button type="button" onClick={() => setModal({ type: "resubmit" })} className="text-sm font-semibold rounded-lg px-3 py-2 border bg-white inline-flex items-center gap-1.5">
                  <RotateCcw className="w-4 h-4" /> Ask for new receipt
                </button>
                <button type="button" onClick={() => setModal({ type: "reject" })} className="text-sm font-semibold rounded-lg px-3 py-2 border border-rose-200 text-rose-600 bg-white inline-flex items-center gap-1.5">
                  <Ban className="w-4 h-4" /> Reject
                </button>
                {!escalated && (
                  <button type="button" onClick={() => setModal({ type: "escalate" })} className="text-sm font-semibold rounded-lg px-3 py-2 text-violet-700 inline-flex items-center gap-1.5 sm:ml-auto">
                    <Flag className="w-4 h-4" /> Escalate
                  </button>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-500 flex items-center gap-2">
                <Clock className="w-4 h-4" /> Waiting for an administrator&apos;s decision.
              </p>
            )}
          </footer>
        )}
      </div>

      {modal?.type === "verify" && (
        <VerifyModal
          detail={detail}
          suspicious={suspicious}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={(body) =>
            run(
              () => api.verifySubmission(submissionId, body),
              (r) => {
                const refunds = r.seats.filter((s) => s.refund).length;
                const confirmed = r.seats.filter((s) => s.booking_confirmed).length;
                return `Verified. ${confirmed} seat${confirmed === 1 ? "" : "s"} confirmed${refunds ? `, ${refunds} sent to refund (booking cancelled or already paid)` : ""}${r.overpaid ? `. Overpaid by ${formatPeso(r.overpaid)} — refund the difference.` : "."}`;
              }
            )
          }
        />
      )}
      {(modal?.type === "reject" || modal?.type === "resubmit") && (
        <ReasonModal
          kind={modal.type}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={(body) =>
            run(
              () => (modal.type === "reject" ? api.rejectSubmission(submissionId, body) : api.requestResubmission(submissionId, body)),
              modal.type === "reject" ? "Rejected. The passenger has been told why and can resubmit." : "Sent back. The passenger has been asked for a clearer receipt."
            )
          }
        />
      )}
      {modal?.type === "escalate" && (
        <NoteModal
          title="Escalate to an administrator"
          description="Use this when the transaction is unclear or disputed. Admins are notified; the seat stays held. The note is internal."
          confirmLabel="Escalate"
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={(text) => run(() => api.escalateSubmission(submissionId, text), "Escalated to administrators.")}
        />
      )}
      {modal?.type === "refund" && (
        <RefundModal
          seat={modal.seat}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={(body) => run(() => api.requestRefund(modal.seat.payment_id, body), "Refund requested. An administrator confirms it once the money is sent back.")}
        />
      )}
      {modal?.type === "refundConfirm" && (
        <RefundConfirmModal
          seat={modal.seat}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={(body) => run(() => api.confirmRefund(modal.seat.payment_id, body), "Refund recorded as sent. The passenger has been notified.")}
        />
      )}
      {modal?.type === "refundCancel" && (
        <NoteModal
          title="Cancel this refund?"
          description="The payment goes back to Verified. The booking is NOT reopened."
          confirmLabel="Cancel refund"
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={(text) => run(() => api.cancelRefund(modal.seat.payment_id, text), "Refund cancelled.")}
        />
      )}

      {fullImage && (
        <div className="fixed inset-0 z-[60] bg-black/85 flex flex-col" role="dialog" aria-modal="true" aria-label="Receipt full size" onClick={() => setFullImage(null)}>
          <div className="flex justify-end p-3">
            <button type="button" onClick={() => setFullImage(null)} className="text-white p-1 hover:bg-white/10 rounded" aria-label="Close">
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4 flex justify-center items-start">
            <img src={fullImage} alt="Payment receipt full size" className="max-w-none bg-white rounded-lg" onClick={(e) => e.stopPropagation()} />
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className="mt-0.5">{children ?? "—"}</dd>
    </div>
  );
}

const TONES = {
  rose: "bg-rose-50 border-rose-200 text-rose-800",
  amber: "bg-amber-50 border-amber-200 text-amber-900",
  violet: "bg-violet-50 border-violet-200 text-violet-900",
  slate: "bg-slate-50 border-slate-200 text-slate-700",
};
function Warning({ tone, title, children }) {
  return (
    <div className={`flex gap-2 rounded-lg border px-3 py-2 text-sm ${TONES[tone]}`} role={tone === "rose" ? "alert" : undefined}>
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        <div className="text-xs mt-0.5">{children}</div>
      </div>
    </div>
  );
}

function ErrorLine({ message }) {
  return message ? (
    <p role="alert" className="text-sm text-rose-600">
      {message}
    </p>
  ) : null;
}

function VerifyModal({ detail, suspicious, busy, onClose, onSubmit }) {
  const [found, setFound] = useState(false);
  const [refMatches, setRefMatches] = useState(false);
  const [amount, setAmount] = useState("");
  const [ledger, setLedger] = useState("");
  const [note, setNote] = useState("");
  const [ackDuplicate, setAckDuplicate] = useState(false);
  const [error, setError] = useState("");
  const amountOk = /^\d{1,7}(\.\d{1,2})?$/.test(amount.trim().replace(/,/g, "")) && Number(amount.replace(/,/g, "")) > 0;
  const under = amountOk && Math.round(Number(amount.replace(/,/g, "")) * 100) < Math.round(detail.amount_due * 100);
  const needsAck = suspicious.length > 0;
  const ready = found && refMatches && amountOk && !under && (!needsAck || ackDuplicate) && !detail.reference_already_verified_elsewhere;

  async function submit() {
    setError("");
    try {
      await onSubmit({ amountReceived: amount.trim().replace(/,/g, ""), ledgerReference: ledger.trim() || undefined, acknowledgeDuplicate: ackDuplicate, note: note.trim() || undefined });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal
      title="Verify this payment?"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border bg-white">
            Not yet
          </button>
          <button type="button" onClick={submit} disabled={!ready || busy} className="px-4 py-2 text-sm rounded-lg bg-brand-green-600 text-white font-semibold disabled:opacity-50">
            {busy ? "Verifying…" : "Mark as verified"}
          </button>
        </>
      }
    >
      <p className="text-sm text-gray-600">
        Open the official {detail.method_name ?? detail.method_label} account and find reference <span className="font-mono font-semibold">{detail.reference_number}</span>.
        Verifying confirms {detail.seats.length === 1 ? "the seat" : `${detail.seats.length} seats`} and notifies the passenger. It can&apos;t be undone (only refunded).
      </p>
      <label className="flex gap-2 text-sm">
        <input type="checkbox" checked={found} onChange={(e) => setFound(e.target.checked)} className="mt-0.5" />
        I found this exact transaction in the official account or merchant records, and the money has arrived.
      </label>
      <label className="flex gap-2 text-sm">
        <input type="checkbox" checked={refMatches} onChange={(e) => setRefMatches(e.target.checked)} className="mt-0.5" />
        The reference number and date in our records match this submission.
      </label>
      <div className="space-y-1">
        <label htmlFor="verify-amount" className="text-sm font-medium">
          Amount received in the account (₱)
        </label>
        <input id="verify-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`Due: ${detail.amount_due}`} />
        {under && <p className="text-xs text-rose-600">Less than the {formatPeso(detail.amount_due)} due — an underpayment can&apos;t be verified. Reject it or ask for the rest.</p>}
      </div>
      <div className="space-y-1">
        <label htmlFor="verify-ledger" className="text-sm font-medium">
          Ledger / statement reference <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input id="verify-ledger" className="input" maxLength={100} value={ledger} onChange={(e) => setLedger(e.target.value)} />
      </div>
      {needsAck && (
        <label className="flex gap-2 text-sm text-amber-900 bg-amber-50 rounded-lg p-2">
          <input type="checkbox" checked={ackDuplicate} onChange={(e) => setAckDuplicate(e.target.checked)} className="mt-0.5" />
          I reviewed the {suspicious.length} possible duplicate(s) and this is a separate, genuine payment.
        </label>
      )}
      <div className="space-y-1">
        <label htmlFor="verify-note" className="text-sm font-medium">
          Internal note <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <textarea id="verify-note" className="input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <ErrorLine message={error} />
    </Modal>
  );
}

function ReasonModal({ kind, busy, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const reject = kind === "reject";
  const picks = reject ? REJECT_REASONS : RESUBMIT_REASONS;

  async function submit() {
    setError("");
    if (!reason.trim()) {
      setError("Type a reason — the passenger will see it.");
      return;
    }
    try {
      await onSubmit({ reason: reason.trim(), note: note.trim() || undefined });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal
      title={reject ? "Reject this payment?" : "Ask for a new receipt?"}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border bg-white">
            Keep it under review
          </button>
          <button type="button" onClick={submit} disabled={busy} className={`px-4 py-2 text-sm rounded-lg text-white font-semibold disabled:opacity-60 ${reject ? "bg-rose-600" : "bg-slate-900"}`}>
            {busy ? "Saving…" : reject ? "Reject payment" : "Send back"}
          </button>
        </>
      }
    >
      <p className="text-sm text-gray-600">
        {reject
          ? "Use this when the payment can't be found or doesn't match. The seat stays held for a short window so the passenger can resubmit."
          : "Use this when the money may be real but the proof is unclear. The passenger gets a fresh window to upload again."}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {picks.map((text) => (
          <button key={text} type="button" onClick={() => setReason(text)} className="text-xs rounded-full border px-2.5 py-1 hover:bg-slate-50 text-left">
            {text}
          </button>
        ))}
      </div>
      <div className="space-y-1">
        <label htmlFor="reason" className="text-sm font-medium">
          Reason (shown to the passenger)
        </label>
        <textarea id="reason" className="input" rows={3} maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </div>
      <div className="space-y-1">
        <label htmlFor="reason-note" className="text-sm font-medium">
          Internal note <span className="text-gray-400 font-normal">(optional, staff only)</span>
        </label>
        <input id="reason-note" className="input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <ErrorLine message={error} />
    </Modal>
  );
}

function NoteModal({ title, description, confirmLabel, busy, onClose, onSubmit }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  async function submit() {
    setError("");
    if (!text.trim()) {
      setError("Add a note.");
      return;
    }
    try {
      await onSubmit(text.trim());
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border bg-white">
            Back
          </button>
          <button type="button" onClick={submit} disabled={busy} className="px-4 py-2 text-sm rounded-lg bg-slate-900 text-white font-semibold disabled:opacity-60">
            {busy ? "Saving…" : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-gray-600">{description}</p>
      <textarea className="input" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} aria-label="Note" autoFocus />
      <ErrorLine message={error} />
    </Modal>
  );
}

function RefundModal({ seat, busy, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const [cancel, setCancel] = useState(false);
  const [error, setError] = useState("");
  const holdsSeat = ["Reserved", "Confirmed"].includes(seat.booking_status);
  async function submit() {
    setError("");
    if (!reason.trim()) {
      setError("Give a reason for the refund.");
      return;
    }
    try {
      await onSubmit({ reason: reason.trim(), cancelBooking: holdsSeat ? cancel : undefined });
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <Modal
      title={`Refund ${seat.booking_reference}?`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border bg-white">
            Back
          </button>
          <button type="button" onClick={submit} disabled={busy || (holdsSeat && !cancel)} className="px-4 py-2 text-sm rounded-lg bg-sky-700 text-white font-semibold disabled:opacity-50">
            {busy ? "Saving…" : "Request refund"}
          </button>
        </>
      }
    >
      <p className="text-sm text-gray-600">
        Marks {formatPeso(seat.amount)} as owed back (Refund pending). Nothing is sent automatically — send the money from the official account, then an administrator records it.
      </p>
      <textarea className="input" rows={2} maxLength={255} placeholder="Reason (the passenger sees it)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Refund reason" />
      {holdsSeat && (
        <label className="flex gap-2 text-sm text-rose-700 bg-rose-50 rounded-lg p-2">
          <input type="checkbox" checked={cancel} onChange={(e) => setCancel(e.target.checked)} className="mt-0.5" />
          Also cancel this {seat.booking_status.toLowerCase()} booking and release seat {seat.seat_number}.
        </label>
      )}
      <ErrorLine message={error} />
    </Modal>
  );
}

function RefundConfirmModal({ seat, busy, onClose, onSubmit }) {
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setError("");
    try {
      await onSubmit({ refundReference: ref.trim(), note: note.trim() || undefined });
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <Modal
      title={`Confirm refund for ${seat.booking_reference}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border bg-white">
            Back
          </button>
          <button type="button" onClick={submit} disabled={busy || !sent || !ref.trim()} className="px-4 py-2 text-sm rounded-lg bg-brand-green-600 text-white font-semibold disabled:opacity-50">
            {busy ? "Saving…" : "Mark as refunded"}
          </button>
        </>
      }
    >
      <label className="flex gap-2 text-sm">
        <input type="checkbox" checked={sent} onChange={(e) => setSent(e.target.checked)} className="mt-0.5" />
        I sent {formatPeso(seat.amount)} back to the passenger and the transfer went through.
      </label>
      <input className="input" maxLength={100} placeholder="Refund transfer reference number" value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Refund reference" />
      <input className="input" maxLength={1000} placeholder="Internal note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Internal note" />
      <ErrorLine message={error} />
    </Modal>
  );
}
