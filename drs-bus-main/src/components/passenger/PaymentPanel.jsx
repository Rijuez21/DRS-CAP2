import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { QrCode, Clock, CheckCircle2, AlertTriangle, Download, ImagePlus, X, RefreshCw, ReceiptText } from "lucide-react";
import * as api from "../../lib/api";
import { IMAGE_ACCEPT, formatPeso, readImageFile } from "../../lib/image";
import { formatTime } from "../../lib/format";

const PENDING_POLL_MS = 30000;

// QR Ph payment for one or more Reserved online bookings — used right after
// checkout (BookingConfirmed, every seat of the order) and on a single
// booking's page (BookingDetails). There is no payment gateway: the
// passenger pays the operator's QR in their own GCash/Maya/bank app, types
// the reference number the app showed them, and staff verify it by hand.
// Once staff verify, the server confirms the booking on its own.
//
// Everything shown is re-read from the server (latest payment per booking),
// so leaving and coming back always lands in the right state:
//   no payment yet / Rejected  -> the form (with the rejection reason)
//   Pending                    -> "awaiting verification"
//   Verified / Confirmed       -> nothing left to do (one line, or nothing)
//
// onStatus(items) lets the parent page refresh the booking status it shows
// (e.g. Reserved -> Confirmed after staff verified).
export default function PaymentPanel({ bookingIds, onStatus }) {
  const [qr, setQr] = useState(undefined); // undefined = loading, null = not set up
  const [items, setItems] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [proofImage, setProofImage] = useState(null);
  const [proofError, setProofError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const fileInput = useRef(null);
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  const idsKey = bookingIds.join(",");

  // Fetching and applying are separate so the initial-load effect below
  // only ever sets state from a promise callback (and can skip it after
  // unmount).
  const fetchStatuses = useCallback(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    return Promise.all(ids.map((id) => api.getBookingPayment(id)));
  }, [idsKey]);

  const applyStatuses = useCallback((rows) => {
    setItems(rows);
    setLoadError("");
    onStatusRef.current?.(rows);
  }, []);

  const refresh = useCallback(() => fetchStatuses().then(applyStatuses), [fetchStatuses, applyStatuses]);

  useEffect(() => {
    let cancelled = false;
    fetchStatuses()
      .then((rows) => {
        if (!cancelled) applyStatuses(rows);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });
    api
      .getPaymentQr()
      .then((row) => {
        if (!cancelled) setQr(row);
      })
      .catch(() => {
        if (!cancelled) setQr(null); // can't load it = can't pay online; fall back to the terminal
      });
    return () => {
      cancelled = true;
    };
  }, [fetchStatuses, applyStatuses]);

  const pending = items?.filter((i) => i.payment?.status === "Pending") ?? [];
  const payable = items?.filter((i) => i.can_pay) ?? [];
  const verified = items?.filter((i) => i.payment?.status === "Verified") ?? [];

  // While staff haven't looked yet, quietly re-check now and then so the
  // page flips to "confirmed" without a manual refresh.
  const hasPending = pending.length > 0;
  useEffect(() => {
    if (!hasPending) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh().catch(() => {});
    }, PENDING_POLL_MS);
    return () => clearInterval(id);
  }, [hasPending, refresh]);

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await refresh();
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleProofChange(e) {
    setProofError("");
    const file = e.target.files?.[0];
    e.target.value = ""; // picking the same file again should still fire onChange
    if (!file) return;
    try {
      setProofImage(await readImageFile(file, { shrink: true }));
    } catch (err) {
      setProofError(err.message);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    const ref = referenceNumber.trim();
    if (!ref) {
      setSubmitError("Enter the reference number from your payment app.");
      return;
    }
    setIsSubmitting(true);
    try {
      await api.submitPayment({
        bookingIds: payable.map((i) => i.booking_id),
        referenceNumber: ref,
        proofImage: proofImage ?? undefined,
      });
      setReferenceNumber("");
      setProofImage(null);
      await refresh();
    } catch (err) {
      setSubmitError(err.message);
      // A 409 means the server's view differs from ours (already pending,
      // confirmed or cancelled meanwhile) — re-read so the right state shows.
      if (err.status === 409) refresh().catch(() => {});
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loadError && !items) {
    return <p className="text-sm text-rose-600 rounded-2xl bg-rose-50 p-4">Couldn't load payment status: {loadError}</p>;
  }
  if (!items || qr === undefined) {
    return <div className="h-32 rounded-3xl bg-white border border-slate-100 animate-pulse" aria-busy="true" />;
  }

  // Nothing to pay and nothing waiting: either it's all verified (say so in
  // one line) or these bookings aren't payable online at all (show nothing).
  if (payable.length === 0 && pending.length === 0) {
    if (verified.length === 0) return null;
    return (
      <div className="flex gap-2 items-start text-sm rounded-2xl p-4 bg-brand-green-600/10 text-ink-900">
        <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-brand-green-600" />
        <div className="space-y-2">
          <p>
            Payment verified — {verified.length === 1 ? `booking #${verified[0].booking_id} is` : "your bookings are"} confirmed. Nothing left to pay.
          </p>
          {/* one receipt per seat: each seat's payment is its own verified row */}
          <div className="flex flex-wrap gap-2">
            {verified.map((i) => (
              <Link
                key={i.booking_id}
                to={`/passenger/my-bookings/${i.booking_id}/receipt`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-brand-green-600/20 px-2.5 py-1 text-xs font-semibold text-brand-green-600 hover:bg-brand-green-600 hover:text-white transition-colors"
              >
                <ReceiptText className="w-3.5 h-3.5" />
                {verified.length === 1 ? "View receipt" : `Receipt #${i.booking_id}`}
              </Link>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const amountDue = payable.reduce((sum, i) => sum + (i.amount_due ?? 0), 0);
  const rejected = payable.filter((i) => i.payment?.status === "Rejected");
  const codes = (list) => list.map((i) => `#${i.booking_id}`).join(", ");

  return (
    <section className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5 space-y-4" aria-labelledby="pay-online-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="pay-online-title" className="font-display font-semibold flex items-center gap-2">
          <QrCode className="w-5 h-5 text-brand-green-600" /> Pay online with QR Ph
        </h2>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="text-xs font-semibold text-ink-600 hover:text-brand-green-600 inline-flex items-center gap-1 disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} /> Check status
        </button>
      </div>

      {pending.length > 0 && (
        <div className="rounded-2xl border border-brand-sunrise-400/50 bg-brand-sunrise-400/15 p-4 text-sm space-y-1" role="status">
          <p className="font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4" /> Payment submitted — awaiting verification
          </p>
          <p className="text-ink-600">
            Booking {codes(pending)} · Ref <span className="font-mono">{pending[0].payment.reference_number}</span>
            {pending[0].payment.submitted_at ? ` · sent ${formatTime(pending[0].payment.submitted_at)}` : ""}
          </p>
          <p className="text-ink-600">
            Your seat stays held while terminal staff check it. You'll get a notification as soon as it's verified — your booking is then confirmed
            automatically.
          </p>
        </div>
      )}

      {payable.length > 0 && (
        <>
          {rejected.map((i) => (
            <div key={i.booking_id} className="flex gap-2 rounded-2xl bg-rose-50 text-rose-700 p-4 text-sm" role="alert">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Payment for booking #{i.booking_id} couldn't be verified</p>
                <p>{i.payment.rejection_reason}</p>
                <p className="text-rose-600/80 mt-1">Your seat is still held. Check your payment app and send the correct reference number below.</p>
              </div>
            </div>
          ))}

          {!qr ? (
            <p className="text-sm rounded-2xl bg-slate-50 p-4 text-ink-600">
              Online payment isn't set up yet. Pay the fare at the terminal — give staff your booking code {codes(payable)}.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex flex-col items-center gap-2">
                <img
                  src={qr.qrImage}
                  alt={qr.label ? `Payment QR code for ${qr.label}` : "Payment QR code"}
                  className="w-56 h-56 max-w-full object-contain rounded-2xl border border-slate-200 bg-white p-2"
                />
                {qr.label && <p className="font-display font-semibold text-center">{qr.label}</p>}
                {qr.instructions && <p className="text-sm text-ink-600 text-center whitespace-pre-line">{qr.instructions}</p>}
                <a
                  href={qr.qrImage}
                  download="drs-bus-payment-qr.png"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-green-600 hover:underline"
                >
                  <Download className="w-3.5 h-3.5" /> Save QR to your phone
                </a>
                <p className="text-xs text-ink-600 text-center max-w-xs">
                  Paying from this phone? Save the QR, then in GCash, Maya or your bank app choose "Upload QR" / "Scan from gallery".
                </p>
              </div>

              <div className="flex items-center justify-between rounded-2xl bg-brand-green-600/10 px-4 py-3">
                <div>
                  <p className="text-xs text-ink-600">Amount to send</p>
                  <p className="text-xs text-ink-600">
                    {payable.length === 1 ? `Booking #${payable[0].booking_id}` : `${payable.length} seats (${codes(payable)})`}
                  </p>
                </div>
                <p className="font-display text-xl font-bold text-brand-green-600">{formatPeso(amountDue)}</p>
              </div>

              <div className="space-y-1">
                <label htmlFor="payment-reference" className="text-sm font-medium">
                  Reference number
                </label>
                <input
                  id="payment-reference"
                  className="input w-full font-mono"
                  inputMode="text"
                  autoComplete="off"
                  maxLength={100}
                  placeholder="e.g. 1003 456 789 012"
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                />
                <p className="text-xs text-ink-600">Shown on your payment app's receipt after you pay (GCash: "Ref No.").</p>
              </div>

              <div className="space-y-1">
                <p className="text-sm font-medium">
                  Screenshot of the receipt <span className="text-ink-600 font-normal">(optional, helps staff verify faster)</span>
                </p>
                {proofImage ? (
                  <div className="relative inline-block">
                    <img src={proofImage} alt="Your payment screenshot" className="max-h-40 rounded-xl border border-slate-200" />
                    <button
                      type="button"
                      onClick={() => setProofImage(null)}
                      aria-label="Remove screenshot"
                      className="absolute -top-2 -right-2 bg-white border border-slate-200 rounded-full p-1 shadow-sm"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="inline-flex items-center gap-2 text-sm border border-dashed border-slate-300 rounded-xl px-4 py-2.5 hover:bg-slate-50"
                  >
                    <ImagePlus className="w-4 h-4" /> Add screenshot
                  </button>
                )}
                <input ref={fileInput} type="file" accept={IMAGE_ACCEPT} className="hidden" onChange={handleProofChange} />
                {proofError && <p className="text-xs text-rose-600">{proofError}</p>}
              </div>

              {submitError && (
                <p role="alert" className="text-sm text-rose-600 font-medium">
                  {submitError}
                </p>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-brand-green-600 hover:bg-brand-green-500 disabled:opacity-60 text-white font-display font-semibold rounded-xl py-3"
              >
                {isSubmitting ? "Sending…" : "I've paid — submit reference number"}
              </button>
              <p className="text-xs text-ink-600 text-center">Prefer cash? Skip this and pay at the terminal instead.</p>
            </form>
          )}
        </>
      )}
    </section>
  );
}
