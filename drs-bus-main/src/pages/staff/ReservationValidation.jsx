import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import StatusBadge from "../../components/common/StatusBadge";
import InlineAlert from "../../components/common/InlineAlert";
import CashPaymentModal from "../../components/staff/CashPaymentModal";
import * as api from "../../lib/api";
import { formatDate, formatTime } from "../../lib/format";
import { formatPeso } from "../../lib/image";

const CHANNEL_LABEL = { online: "Online", walk_in: "Walk-in", flagged: "Flagged on the road" };

// What staff can do from each booking status — mirrors the server's
// whyStatusChangeNotAllowed for staff (bookingRules.js), so every button
// shown will actually work.
const ACTIONS = {
  // "Confirmed" from Reserved goes through the payment confirmation dialog
  // (cash collected at the counter) instead of a bare status change.
  Reserved: [
    { to: "Confirmed", label: "Collect fare & confirm", tone: "primary", payment: true },
    { to: "Boarded", label: "Check in (boarded)", tone: "primary" },
    { to: "Cancelled", label: "Cancel booking", tone: "danger" },
  ],
  Confirmed: [
    { to: "Boarded", label: "Check in (boarded)", tone: "primary" },
    { to: "Cancelled", label: "Cancel booking", tone: "danger" },
  ],
  "No-Show": [{ to: "Boarded", label: "Arrived late — check in", tone: "primary" }],
};
const DONE_MESSAGE = { Confirmed: "Seat confirmed.", Boarded: "Passenger checked in.", Cancelled: "Booking cancelled — the seat is free again." };

// Passengers are told to show their booking code at the terminal, so the
// code is the first thing this search accepts (names still work).
export default function ReservationValidation() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [busyTo, setBusyTo] = useState(null);
  // Online payment status, tagged with the booking/status it was loaded for
  // so a stale answer is never shown for a different booking.
  const [paymentState, setPaymentState] = useState({ key: null, info: undefined });
  const [collecting, setCollecting] = useState(false); // cash payment dialog open
  const [collectError, setCollectError] = useState("");
  const [isCollecting, setIsCollecting] = useState(false);

  // Online bookings may already have a QR payment on file — load it so the
  // counter knows whether to collect the fare (and so "Collect fare" is
  // hidden while a QR payment is still waiting for review).
  const selectedId = selected?.booking_id;
  const selectedChannel = selected?.channel;
  const selectedStatus = selected?.status;
  const paymentKey = selectedId && selectedChannel === "online" ? `${selectedId}-${selectedStatus}` : null;
  const paymentInfo = paymentKey && paymentState.key === paymentKey ? paymentState.info : undefined; // undefined = loading / not applicable
  useEffect(() => {
    if (!paymentKey) return undefined;
    let cancelled = false;
    api
      .getBookingPayment(selectedId)
      .then((row) => !cancelled && setPaymentState({ key: paymentKey, info: row }))
      .catch(() => !cancelled && setPaymentState({ key: paymentKey, info: null }));
    return () => {
      cancelled = true;
    };
  }, [paymentKey, selectedId]);

  async function handleSearch(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSelected(null);
    const q = query.trim();
    if (!q) return;
    setIsSearching(true);
    try {
      const rows = await api.searchBookings(q);
      setResults(rows);
      // An exact code match is almost always what staff want — open it.
      const code = q.replace(/^#/, "");
      const exact = rows.find((r) => String(r.booking_id) === code);
      if (exact) setSelected(exact);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSearching(false);
    }
  }

  async function setStatus(to) {
    setError("");
    setSuccess("");
    setBusyTo(to);
    try {
      await api.updateBookingStatus(selected.booking_id, to);
      const updated = { ...selected, status: to };
      setSelected(updated);
      setResults((prev) => prev?.map((r) => (r.booking_id === updated.booking_id ? updated : r)) ?? prev);
      setSuccess(DONE_MESSAGE[to] ?? `Marked ${to}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyTo(null);
    }
  }

  async function confirmCashPayment(cashReceived) {
    setIsCollecting(true);
    setCollectError("");
    try {
      const result = await api.confirmCounterPayment(selected.booking_id, cashReceived);
      const updated = { ...selected, status: "Confirmed" };
      setSelected(updated);
      setResults((prev) => prev?.map((r) => (r.booking_id === updated.booking_id ? updated : r)) ?? prev);
      const p = result.payment;
      setSuccess(`Payment received — ${formatPeso(p.cashReceived)} cash, change ${formatPeso(p.change)}. Booking #${result.booking_id} is confirmed.`);
      setCollecting(false);
    } catch (err) {
      setCollectError(err.message);
    } finally {
      setIsCollecting(false);
    }
  }

  const tripOver = selected && ["Completed", "Cancelled"].includes(selected.trip_status);
  const qrPending = paymentInfo?.payment?.status === "Pending";
  const fare = selected?.base_fare != null ? Number(selected.base_fare) : null;
  // Hide "Collect fare" while a QR payment waits for review (verify that
  // instead), while that status is still loading, or when the route has no
  // fare to collect.
  const actions = (selected && !tripOver ? (ACTIONS[selected.status] ?? []) : []).filter(
    (a) => !a.payment || (fare != null && !qrPending && (selected.channel !== "online" || paymentInfo !== undefined))
  );

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-2xl">
      <header>
        <h1 className="text-xl font-bold">Validate Reservation</h1>
        <p className="text-sm text-gray-500">Ask for the passenger's booking code (e.g. #12), or search by name.</p>
      </header>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Booking code or passenger name"
          autoFocus
          className="input flex-1"
        />
        <button
          type="submit"
          disabled={isSearching}
          className="flex items-center gap-1.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded"
        >
          <Search className="w-4 h-4" /> {isSearching ? "Searching…" : "Search"}
        </button>
      </form>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {results && results.length === 0 && <p className="text-sm text-gray-600">No booking matches “{query}”. Check the code with the passenger.</p>}

      {results && results.length > 0 && !selected && (
        <div className="bg-white rounded-lg border divide-y">
          {results.map((r) => (
            <button key={r.booking_id} type="button" onClick={() => setSelected(r)} className="w-full text-left p-3 hover:bg-amber-50 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  #{r.booking_id} · {r.passenger_name}
                </span>
                <StatusBadge status={r.status} />
              </div>
              <p className="text-xs text-gray-500">
                {r.origin} → {r.destination} · {formatDate(r.departure_time)} {formatTime(r.departure_time)} · Seat {r.seat_number}
              </p>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="bg-white rounded-lg border p-4 space-y-3">
          {results?.length > 1 && (
            <button type="button" onClick={() => setSelected(null)} className="text-xs text-gray-500 hover:underline">
              ← Back to {results.length} results
            </button>
          )}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-gray-500">Booking #{selected.booking_id}</p>
              <p className="text-lg font-bold">{selected.passenger_name}</p>
            </div>
            <StatusBadge status={selected.status} />
          </div>
          <dl className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
            <div><dt className="text-xs text-gray-500">Trip</dt><dd className="font-medium">{selected.origin} → {selected.destination}</dd></div>
            <div><dt className="text-xs text-gray-500">Departs</dt><dd className="font-medium">{formatDate(selected.departure_time)?.replace(/, \d{4}$/, "")} {formatTime(selected.departure_time)}</dd></div>
            <div><dt className="text-xs text-gray-500">Seat</dt><dd className="font-medium text-lg">{selected.seat_number}</dd></div>
            <div><dt className="text-xs text-gray-500">Bus</dt><dd className="font-medium">{selected.plate_num ?? "—"}</dd></div>
            <div><dt className="text-xs text-gray-500">Channel</dt><dd className="font-medium">{CHANNEL_LABEL[selected.channel] ?? selected.channel}</dd></div>
            <div><dt className="text-xs text-gray-500">Trip status</dt><dd className="font-medium">{selected.trip_status}</dd></div>
          </dl>
          {selected.channel === "online" && <OnlinePaymentStatus info={paymentInfo} />}
          {selected.status === "Reserved" && !tripOver && fare == null && (
            <p className="text-sm text-gray-600">This route has no fare on file, so the payment can't be recorded here.</p>
          )}
          {tripOver && <p className="text-sm text-rose-600 font-medium">This trip is {selected.trip_status.toLowerCase()} — the booking can't be changed.</p>}
          {!tripOver && actions.length === 0 && <p className="text-sm text-gray-600">Nothing to do — this booking is {selected.status.toLowerCase()}.</p>}
          {actions.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {actions.map((a) => (
                <button
                  key={a.to}
                  type="button"
                  onClick={() => {
                    if (a.payment) {
                      setCollectError("");
                      setCollecting(true);
                      return;
                    }
                    if (a.to === "Cancelled" && !window.confirm(`Cancel booking #${selected.booking_id}? The seat will be released.`)) return;
                    setStatus(a.to);
                  }}
                  disabled={busyTo !== null || isCollecting}
                  className={
                    a.tone === "danger"
                      ? "border border-rose-300 text-rose-600 hover:bg-rose-50 disabled:opacity-60 text-sm font-semibold px-4 py-2 rounded"
                      : "bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded"
                  }
                >
                  {busyTo === a.to ? "Saving…" : a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {collecting && selected && fare != null && (
        <CashPaymentModal
          title={`Collect fare · #${selected.booking_id}`}
          summary={
            <>
              <p className="font-medium text-gray-900">{selected.passenger_name}</p>
              <p>
                {selected.origin} → {selected.destination} · Seat {selected.seat_number}
              </p>
              <p className="text-xs text-gray-500">Confirming the payment also confirms the seat, and the passenger is notified.</p>
            </>
          }
          amountDue={fare}
          note={paymentInfo?.payment?.status === "Rejected" ? "Their online payment was rejected — collect the full fare in cash." : undefined}
          confirmLabel="Confirm payment"
          isSaving={isCollecting}
          error={collectError}
          onConfirm={confirmCashPayment}
          onClose={() => setCollecting(false)}
        />
      )}
    </div>
  );
}

// Did this online passenger already pay by QR Ph? Tells the counter whether
// to collect the fare, and points at the review queue when a payment is
// still waiting (verifying it there confirms the booking automatically).
function OnlinePaymentStatus({ info }) {
  if (info === undefined) return <p className="text-sm text-gray-400">Checking online payment…</p>;
  if (info === null) return null;
  const p = info.payment;
  const box = "text-sm rounded-lg px-3 py-2";
  if (!p) {
    return (
      <p className={`${box} bg-slate-50 text-gray-700`}>
        {info.booking_status === "Reserved" ? "No online payment submitted — collect the fare at the counter." : "No online payment on file."}
      </p>
    );
  }
  const ref = (
    <>
      {formatPeso(p.amount)}, ref <span className="font-mono">{p.reference_number}</span>
    </>
  );
  if (p.status === "Verified") return <p className={`${box} bg-emerald-50 text-emerald-800`}>Paid online ({ref}) — verified. No fare to collect.</p>;
  if (p.status === "Pending") {
    return (
      <p className={`${box} bg-amber-50 text-amber-800`}>
        Online payment waiting for review ({ref}).{" "}
        <Link to="/staff/payments" className="font-semibold underline">
          Verify it in Online Payments
        </Link>{" "}
        — that confirms the seat automatically.
      </p>
    );
  }
  return (
    <p className={`${box} bg-rose-50 text-rose-700`}>
      Online payment rejected ({ref}): {p.rejection_reason}. Collect the fare at the counter, or the passenger can resubmit.
    </p>
  );
}
