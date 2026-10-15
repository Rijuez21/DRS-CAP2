import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Wallet,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Download,
  ImagePlus,
  X,
  RefreshCw,
  ReceiptText,
  Copy,
  Check,
  ShieldAlert,
  Landmark,
  Smartphone,
  QrCode,
} from "lucide-react";
import * as api from "../../lib/api";
import { RECEIPT_ACCEPT, formatPeso, readImageFile } from "../../lib/image";
import { formatDateTime, toDateTimeLocal, paymentStatusLabel } from "../../lib/format";
import PaymentStatusBadge from "../payments/PaymentStatusBadge";

const PENDING_POLL_MS = 30000;
const METHOD_ICONS = { gcash: Smartphone, bank_transfer: Landmark, qr_ph: QrCode };
const OPEN = ["Pending", "Escalated"];
const PAID = ["Verified", "Refund Pending", "Refunded"];

// Same rules the server enforces (services/paymentRules.js) — checked here
// first only so mistakes show instantly; the server is the source of truth.
function referenceError(methodType, value) {
  const raw = value.trim();
  if (!raw) return "Enter the reference number from your receipt.";
  if (!/^[A-Za-z0-9 \-/#.]+$/.test(raw)) return "Use only letters, numbers, spaces or dashes.";
  const normalized = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (methodType === "gcash" && !/^\d{8,20}$/.test(normalized)) return "A GCash reference number is 8–20 digits (usually 13).";
  if (methodType !== "gcash" && (normalized.length < 4 || normalized.length > 40)) return "The reference should be 4–40 letters or numbers.";
  return null;
}
function amountError(value) {
  const text = value.trim().replace(/,/g, "");
  if (!text) return "Enter the amount you sent.";
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text) || Number(text) <= 0) return "Enter an amount like 350 or 350.00.";
  return null;
}
const toCentavos = (n) => Math.round(Number(n) * 100);

function minutesLeft(deadline, now) {
  return deadline ? Math.floor((new Date(deadline).getTime() - now) / 60000) : null;
}

// Manual online payment for one or more Reserved online bookings — used
// right after checkout (BookingConfirmed: every seat of the order) and on a
// single booking's page (BookingDetails). There is no payment gateway: the
// passenger pays the operator's account in their own GCash / bank app, then
// submits proof here, and staff verify the money actually arrived.
//
// Every state is re-read from the server, so leaving and coming back always
// lands in the right place:
//   awaiting payment / rejected / needs resubmission -> instructions + form
//   under review (Pending, Escalated)                  -> waiting message
//   verified / refund                                  -> done, receipt link
//   window closed / not payable                        -> why, what to do
//
// onStatus(items) lets the parent refresh the booking status it shows.
export default function PaymentPanel({ bookingIds, onStatus }) {
  const [methods, setMethods] = useState(undefined); // undefined = loading
  const [items, setItems] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [methodId, setMethodId] = useState(null);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [amountClaimed, setAmountClaimed] = useState("");
  const [paidAt, setPaidAt] = useState(() => toDateTimeLocal());
  const [receiptImage, setReceiptImage] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copied, setCopied] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const fileInput = useRef(null);
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  const idsKey = bookingIds.join(",");
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
      .then((rows) => !cancelled && applyStatuses(rows))
      .catch((err) => !cancelled && setLoadError(err.message));
    api
      .getPaymentMethods()
      .then((rows) => {
        if (cancelled) return;
        setMethods(rows);
        if (rows.length === 1) setMethodId(rows[0].method_id);
      })
      .catch(() => !cancelled && setMethods([]));
    return () => {
      cancelled = true;
    };
  }, [fetchStatuses, applyStatuses]);

  // A clock for the deadline countdown.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const underReview = items?.filter((i) => OPEN.includes(i.payment?.status)) ?? [];
  const payable = useMemo(() => items?.filter((i) => i.can_pay) ?? [], [items]);
  const paid = items?.filter((i) => PAID.includes(i.payment?.status)) ?? [];
  const closed = items?.filter((i) => !i.can_pay && !i.payment && i.not_payable_reason && i.booking_status === "Cancelled") ?? [];

  // While staff haven't decided yet, re-check quietly so the page flips to
  // "verified" (or shows a rejection) without a manual refresh.
  const hasOpen = underReview.length > 0;
  useEffect(() => {
    if (!hasOpen) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh().catch(() => {});
    }, PENDING_POLL_MS);
    return () => clearInterval(id);
  }, [hasOpen, refresh]);

  const amountDue = payable.reduce((sum, i) => sum + toCentavos(i.amount_due ?? 0), 0) / 100;
  // Pre-fill the amount with what's due once (the passenger can change it
  // if they actually sent something different — staff then see the mismatch).
  const amountPrefilled = useRef(false);
  useEffect(() => {
    if (!amountPrefilled.current && amountDue > 0) {
      amountPrefilled.current = true;
      setAmountClaimed(amountDue.toFixed(2));
    }
  }, [amountDue]);

  const deadline = payable
    .map((i) => i.payment_deadline)
    .filter(Boolean)
    .sort((a, b) => new Date(a) - new Date(b))[0];
  const left = minutesLeft(deadline, now);
  const method = methods?.find((m) => m.method_id === methodId) ?? null;

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

  async function copy(text, key) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* clipboard blocked — the number is visible anyway */
    }
  }

  async function handleReceiptChange(e) {
    setFieldErrors((f) => ({ ...f, receipt: "" }));
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setReceiptImage(await readImageFile(file, { shrink: true, receipt: true }));
    } catch (err) {
      setFieldErrors((f) => ({ ...f, receipt: err.message }));
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    const errors = {
      method: method ? "" : "Choose how you paid.",
      reference: method ? referenceError(method.method_type, referenceNumber) ?? "" : "",
      amount: amountError(amountClaimed) ?? "",
      paidAt: !paidAt ? "Enter when you paid." : new Date(paidAt).getTime() > Date.now() + 5 * 60000 ? "That time is in the future." : "",
      receipt: receiptImage ? "" : "Attach a screenshot or photo of your receipt.",
    };
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;

    setIsSubmitting(true);
    try {
      const result = await api.submitPayment({
        bookingIds: payable.map((i) => i.booking_id),
        methodId: method.method_id,
        referenceNumber: referenceNumber.trim(),
        amountClaimed: amountClaimed.trim().replace(/,/g, ""),
        paidAt: new Date(paidAt).toISOString(),
        receiptImage,
      });
      setReferenceNumber("");
      setReceiptImage(null);
      setConfirmation(
        result.amount_mismatch
          ? `Proof received. Note: you entered ${formatPeso(result.amount_claimed)} but ${formatPeso(result.amount_due)} is due — staff will check the amount that actually arrived.`
          : "Proof received. Your payment is now under review."
      );
      await refresh();
    } catch (err) {
      setSubmitError(err.message);
      if (err.status === 409) refresh().catch(() => {});
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loadError && !items) {
    return <p className="text-sm text-rose-600 rounded-2xl bg-rose-50 p-4">Couldn't load payment status: {loadError}</p>;
  }
  if (!items || methods === undefined) {
    return <div className="h-32 rounded-3xl bg-white border border-slate-100 animate-pulse" aria-busy="true" aria-label="Loading payment details" />;
  }

  const codes = (list) => list.map((i) => i.booking_reference).join(", ");
  const needsAction = payable.filter((i) => ["Rejected", "Needs Resubmission"].includes(i.payment?.status));

  // Nothing to pay and nothing waiting.
  if (payable.length === 0 && underReview.length === 0) {
    if (paid.length > 0) {
      return (
        <div className="flex gap-2 items-start text-sm rounded-2xl p-4 bg-brand-green-600/10 text-ink-900" role="status">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-brand-green-600" />
          <div className="space-y-2">
            <p>
              {paid.every((i) => i.payment.status === "Verified")
                ? `Payment verified — ${paid.length === 1 ? `booking ${paid[0].booking_reference} is` : "your bookings are"} paid. Nothing left to do.`
                : `Payment ${paymentStatusLabel(paid[0].payment.status).toLowerCase()} for ${codes(paid)}.`}
            </p>
            <div className="flex flex-wrap gap-2">
              {paid
                .filter((i) => i.payment.status === "Verified")
                .map((i) => (
                  <Link
                    key={i.booking_id}
                    to={`/passenger/my-bookings/${i.booking_id}/receipt`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-brand-green-600/20 px-2.5 py-1 text-xs font-semibold text-brand-green-600 hover:bg-brand-green-600 hover:text-white transition-colors"
                  >
                    <ReceiptText className="w-3.5 h-3.5" />
                    {paid.length === 1 ? "View receipt" : `Receipt ${i.booking_reference}`}
                  </Link>
                ))}
            </div>
          </div>
        </div>
      );
    }
    if (closed.length > 0) {
      return (
        <p className="flex gap-2 text-sm rounded-2xl bg-rose-50 text-rose-700 p-4" role="alert">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {closed[0].not_payable_reason}
        </p>
      );
    }
    return null;
  }

  return (
    <section className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5 space-y-4" aria-labelledby="pay-online-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="pay-online-title" className="font-display font-semibold flex items-center gap-2">
          <Wallet className="w-5 h-5 text-brand-green-600" /> Pay online
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

      {confirmation && (
        <p className="flex gap-2 rounded-2xl bg-brand-green-600/10 p-3 text-sm" role="status">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-brand-green-600" /> {confirmation}
        </p>
      )}

      {underReview.length > 0 && (
        <div className="rounded-2xl border border-brand-sunrise-400/50 bg-brand-sunrise-400/15 p-4 text-sm space-y-1.5" role="status">
          <p className="font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4" /> Payment proof received — under review
          </p>
          <p className="text-ink-600">
            {codes(underReview)} · Ref <span className="font-mono">{underReview[0].payment.reference_number}</span>
            {underReview[0].payment.submitted_at ? ` · sent ${formatDateTime(underReview[0].payment.submitted_at)}` : ""}
          </p>
          <p className="text-ink-600">
            Terminal staff will check that the money arrived in our account (usually within {underReview[0].review_sla_minutes ?? 30} minutes during
            office hours). Your seat stays held while they check. You'll be notified when it's verified.
          </p>
        </div>
      )}

      {payable.length > 0 && (
        <>
          {needsAction.map((i) => (
            <div key={i.booking_id} className="flex gap-2 rounded-2xl bg-rose-50 text-rose-700 p-4 text-sm" role="alert">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">
                  {i.payment.status === "Needs Resubmission" ? `Staff need a clearer receipt for ${i.booking_reference}` : `Payment for ${i.booking_reference} couldn't be verified`}
                </p>
                <p>{i.payment.rejection_reason}</p>
                <p className="text-rose-600/80 mt-1">
                  Check your payment app, then send the correct details below ({i.attempts_left} attempt{i.attempts_left === 1 ? "" : "s"} left). Questions? Contact
                  the terminal with your booking reference.
                </p>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between rounded-2xl bg-brand-green-600/10 px-4 py-3">
            <div className="min-w-0">
              <p className="text-xs text-ink-600">Amount due</p>
              <p className="text-xs text-ink-600 truncate">{payable.length === 1 ? payable[0].booking_reference : `${payable.length} seats · ${codes(payable)}`}</p>
            </div>
            <p className="font-display text-xl font-bold text-brand-green-600">{formatPeso(amountDue)}</p>
          </div>

          {deadline && (
            <p
              className={`flex items-center gap-2 text-sm rounded-xl px-3 py-2 ${left != null && left < 15 ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-ink-600"}`}
            >
              <Clock className="w-4 h-4 shrink-0" />
              <span>
                Pay and submit proof by <strong className="font-semibold">{formatDateTime(deadline)}</strong>
                {left != null && left >= 0 ? ` (${left < 60 ? `${left} min` : `${Math.floor(left / 60)} h ${left % 60} min`} left)` : ""}. After that the seat is released.
              </span>
            </p>
          )}

          {methods.length === 0 ? (
            <p className="text-sm rounded-2xl bg-slate-50 p-4 text-ink-600">
              Online payment isn't set up yet. Pay the fare at the terminal — give staff your booking reference {codes(payable)}.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium mb-1">1. Choose how you'll pay</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {methods.map((m) => {
                    const Icon = METHOD_ICONS[m.method_type] ?? Wallet;
                    const active = m.method_id === methodId;
                    return (
                      <label
                        key={m.method_id}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                          active ? "border-brand-green-600 bg-brand-green-600/5 ring-1 ring-brand-green-600" : "border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <input type="radio" name="payment-method" className="sr-only" checked={active} onChange={() => setMethodId(m.method_id)} />
                        <Icon className="w-5 h-5 text-brand-green-600 shrink-0" />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold truncate">{m.display_name}</span>
                          {m.method_label !== m.display_name && <span className="block text-xs text-ink-600">{m.method_label}</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {fieldErrors.method && <p className="text-xs text-rose-600">{fieldErrors.method}</p>}
              </fieldset>

              {method && (
                <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
                  <p className="text-sm font-medium">2. Send exactly {formatPeso(amountDue)} to:</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                    {method.bank_name && (
                      <>
                        <dt className="text-ink-600">Bank</dt>
                        <dd className="font-medium">{method.bank_name}</dd>
                      </>
                    )}
                    {method.account_name && (
                      <>
                        <dt className="text-ink-600">Account name</dt>
                        <dd className="font-medium">{method.account_name}</dd>
                      </>
                    )}
                    {method.account_number && (
                      <>
                        <dt className="text-ink-600">{method.method_type === "gcash" ? "GCash number" : "Account no."}</dt>
                        <dd className="font-mono font-semibold flex items-center gap-2 flex-wrap">
                          {method.account_number}
                          <button
                            type="button"
                            onClick={() => copy(method.account_number, "acct")}
                            className="inline-flex items-center gap-1 text-xs font-sans font-semibold text-brand-green-600 hover:underline"
                          >
                            {copied === "acct" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied === "acct" ? "Copied" : "Copy"}
                          </button>
                        </dd>
                      </>
                    )}
                    <dt className="text-ink-600">Message / note</dt>
                    <dd className="font-mono font-semibold flex items-center gap-2 flex-wrap">
                      {codes(payable)}
                      <button
                        type="button"
                        onClick={() => copy(codes(payable), "ref")}
                        className="inline-flex items-center gap-1 text-xs font-sans font-semibold text-brand-green-600 hover:underline"
                      >
                        {copied === "ref" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied === "ref" ? "Copied" : "Copy"}
                      </button>
                    </dd>
                  </dl>
                  {method.qr_image && (
                    <div className="flex flex-col items-center gap-1.5 pt-1">
                      <img
                        src={method.qr_image}
                        alt={`${method.display_name} payment QR code`}
                        className="w-52 h-52 max-w-full object-contain rounded-2xl border border-slate-200 bg-white p-2"
                      />
                      <a href={method.qr_image} download="drs-bus-payment-qr.png" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-green-600 hover:underline">
                        <Download className="w-3.5 h-3.5" /> Save QR to your phone
                      </a>
                      <p className="text-xs text-ink-600 text-center max-w-xs">Paying from this phone? Save the QR, then use "Upload QR" / "Scan from gallery" in your app.</p>
                    </div>
                  )}
                  {method.instructions && <p className="text-sm text-ink-600 whitespace-pre-line">{method.instructions}</p>}
                  <p className="text-xs text-ink-600">Check the account name before you send. We'll never ask you to pay a personal account not shown here.</p>
                </div>
              )}

              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">3. Tell us about your payment</legend>
                <div className="space-y-1">
                  <label htmlFor="payment-reference" className="text-sm">
                    Reference number
                  </label>
                  <input
                    id="payment-reference"
                    className="input w-full font-mono"
                    inputMode={method?.method_type === "gcash" ? "numeric" : "text"}
                    autoComplete="off"
                    maxLength={100}
                    placeholder={method?.method_type === "gcash" ? "e.g. 1003 456 789 012" : "From your bank / app receipt"}
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    aria-invalid={Boolean(fieldErrors.reference)}
                  />
                  {fieldErrors.reference && <p className="text-xs text-rose-600">{fieldErrors.reference}</p>}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label htmlFor="payment-amount" className="text-sm">
                      Amount you sent (₱)
                    </label>
                    <input
                      id="payment-amount"
                      className="input w-full"
                      inputMode="decimal"
                      autoComplete="off"
                      value={amountClaimed}
                      onChange={(e) => setAmountClaimed(e.target.value)}
                      aria-invalid={Boolean(fieldErrors.amount)}
                    />
                    {fieldErrors.amount ? (
                      <p className="text-xs text-rose-600">{fieldErrors.amount}</p>
                    ) : (
                      !amountError(amountClaimed) &&
                      toCentavos(amountClaimed.replace(/,/g, "")) !== toCentavos(amountDue) && (
                        <p className="text-xs text-amber-700">This doesn&apos;t match the {formatPeso(amountDue)} due. Enter what you actually sent.</p>
                      )
                    )}
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="payment-time" className="text-sm">
                      Date & time paid
                    </label>
                    <input
                      id="payment-time"
                      type="datetime-local"
                      className="input w-full"
                      max={toDateTimeLocal(new Date(Date.now() + 5 * 60000))}
                      value={paidAt}
                      onChange={(e) => setPaidAt(e.target.value)}
                      aria-invalid={Boolean(fieldErrors.paidAt)}
                    />
                    {fieldErrors.paidAt && <p className="text-xs text-rose-600">{fieldErrors.paidAt}</p>}
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-sm">Receipt screenshot or photo</p>
                  {receiptImage ? (
                    <div className="relative inline-block">
                      <img src={receiptImage} alt="Your payment receipt" className="max-h-40 rounded-xl border border-slate-200" />
                      <button
                        type="button"
                        onClick={() => setReceiptImage(null)}
                        aria-label="Remove receipt"
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
                      <ImagePlus className="w-4 h-4" /> Add receipt image
                    </button>
                  )}
                  <input ref={fileInput} type="file" accept={RECEIPT_ACCEPT} className="hidden" onChange={handleReceiptChange} />
                  <p className="text-xs text-ink-600">PNG, JPEG or WebP, up to 5 MB. Only you and DRS staff can see it.</p>
                  {fieldErrors.receipt && <p className="text-xs text-rose-600">{fieldErrors.receipt}</p>}
                </div>
              </fieldset>

              <p className="flex gap-2 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 p-3 text-xs">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-px" />
                Uploading a receipt does not confirm your booking. Staff check that the money actually arrived in our account first — edited or reused
                receipts are rejected.
              </p>

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
                {isSubmitting ? "Submitting…" : "Submit payment proof"}
              </button>
              <p className="text-xs text-ink-600 text-center">Prefer cash? Skip this and pay at the terminal before the deadline.</p>
            </form>
          )}
        </>
      )}

      {items.length > 1 && (
        <ul className="text-xs text-ink-600 space-y-1 border-t border-slate-100 pt-3">
          {items.map((i) => (
            <li key={i.booking_id} className="flex items-center justify-between gap-2">
              <span>{i.booking_reference}</span>
              <PaymentStatusBadge status={i.payment_status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
