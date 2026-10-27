import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Search, ChevronRight, ArrowLeft, RotateCcw } from "lucide-react";
import StatusBadge from "../../components/common/StatusBadge";
import InlineAlert from "../../components/common/InlineAlert";
import ListFrame from "../../components/common/ListFrame";
import { SkeletonList } from "../../components/common/Skeletons";
import { Spinner } from "../../components/common/Buttons";
import PageHeading from "../../components/common/PageHeading";
import CashPaymentModal from "../../components/staff/CashPaymentModal";
import { useListState } from "../../hooks/useListState";
import * as api from "../../lib/api";
import { formatDate, formatPeso, formatTime } from "../../lib/format";
import { CATEGORY_LABELS, DISCOUNT_PERCENT } from "../../lib/discounts";

const CHANNEL_LABEL = { online: "Online", walk_in: "Walk-in", flagged: "Flagged on the road" };
const tripLabel = (r) => `${r.origin} → ${r.destination}`;

// Search results (up to 25 from the server): narrowed, sorted and filtered
// client-side; tapping one opens it.
const RESULT_SORT = [
  { key: "departure_time", label: "Departure", type: "date" },
  { key: "passenger_name", label: "Passenger" },
  { key: "seat_number", label: "Seat" },
  { key: "status", label: "Status", type: "status" },
];
const RESULT_FILTERS = [
  {
    key: "status",
    label: "Status",
    allLabel: "All statuses",
    options: ["Reserved", "Confirmed", "Boarded", "No-Show", "Cancelled"].map((s) => ({ value: s, label: s })),
  },
  { key: "channel", label: "Channel", allLabel: "All channels", options: Object.entries(CHANNEL_LABEL).map(([value, label]) => ({ value, label })) },
];

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
  // Lives here (not in the table) so it survives opening a booking and
  // coming back to the list.
  const resultsTable = useListState({ initialSort: { key: "departure_time", dir: "asc" }, filters: RESULT_FILTERS });
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
  const searchRef = useRef(null);

  // Peak-End: after finishing with one passenger, one tap starts the next.
  function startNext() {
    setQuery("");
    setResults(null);
    setSelected(null);
    setError("");
    setSuccess("");
    resultsTable.clearAll();
    searchRef.current?.focus();
  }

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
    resultsTable.clearAll();
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
  // fare_due = the route fare less any student / PWD / senior discount on this seat.
  const fare = selected?.fare_due != null ? Number(selected.fare_due) : null;
  // Hide "Collect fare" while a QR payment waits for review (verify that
  // instead), while that status is still loading, or when the route has no
  // fare to collect.
  const actions = (selected && !tripOver ? (ACTIONS[selected.status] ?? []) : []).filter(
    (a) => !a.payment || (fare != null && !qrPending && (selected.channel !== "online" || paymentInfo !== undefined))
  );

  const primary = actions.filter((a) => a.tone !== "danger");
  const danger = actions.filter((a) => a.tone === "danger");
  function runAction(a) {
    if (a.payment) {
      setCollectError("");
      setCollecting(true);
      return;
    }
    if (a.to === "Cancelled" && !window.confirm(`Cancel booking #${selected.booking_id}? The seat will be released.`)) return;
    setStatus(a.to);
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl">
      <PageHeading title="Validate Reservation" subtitle="Ask for the passenger's booking code (e.g. #12), or search by name." />

      {/* the one thing this page is for: a big field, focused on arrival */}
      <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2" role="search">
        <div className="relative flex-1">
          <Search className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Booking code (#12) or passenger name"
            aria-label="Booking code or passenger name"
            autoFocus
            autoComplete="off"
            className="input min-h-14 pl-12 text-lg bg-white"
          />
        </div>
        <button
          type="submit"
          disabled={isSearching}
          className="inline-flex items-center justify-center gap-2 min-h-14 px-6 rounded-lg bg-amber-700 hover:bg-amber-600 disabled:opacity-60 text-white text-base font-semibold shadow-sm"
        >
          {isSearching ? <Spinner className="w-5 h-5" /> : <Search className="w-5 h-5" aria-hidden="true" />}
          {isSearching ? "Searching…" : "Find booking"}
        </button>
      </form>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      {success && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2" role="status">
          <span className="text-sm font-medium text-emerald-800">{success}</span>
          <button type="button" onClick={startNext} className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg bg-white border border-emerald-300 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
            <RotateCcw className="w-4 h-4" aria-hidden="true" /> Next passenger
          </button>
        </div>
      )}

      {isSearching && !results && <SkeletonList count={3} />}

      {results && results.length === 0 && (
        <p className="text-sm text-gray-600 rounded-lg border border-dashed bg-white/60 px-4 py-6 text-center">
          No booking matches “{query}”. Check the code with the passenger.
        </p>
      )}

      {results && results.length > 0 && !selected && (
        <ListFrame
          state={resultsTable}
          rows={results}
          fields={RESULT_SORT}
          searchKeys={["booking_id", "passenger_name", tripLabel, "seat_number"]}
          searchPlaceholder="Filter these results…"
          filters={RESULT_FILTERS}
        >
          {(pageRows) => (
            <ul className="space-y-2" aria-label="Matching bookings">
              {pageRows.map((r) => (
                <li key={r.booking_id}>
                  <button
                    type="button"
                    onClick={() => setSelected(r)}
                    className="w-full flex items-center gap-3 text-left bg-white rounded-xl border px-4 py-3 min-h-16 hover:border-amber-400 hover:bg-amber-50/50"
                  >
                    <span className="w-12 h-12 shrink-0 rounded-lg bg-slate-100 flex flex-col items-center justify-center">
                      <span className="text-[10px] uppercase text-gray-500 leading-none">Seat</span>
                      <span className="font-bold text-ink-900 leading-tight">{r.seat_number}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink-900">{r.passenger_name}</span>
                        <span className="font-mono text-xs text-gray-500">#{r.booking_id}</span>
                      </span>
                      <span className="block text-sm text-gray-600 truncate">
                        {tripLabel(r)} · {formatDate(r.departure_time)?.replace(/, \d{4}$/, "")} {formatTime(r.departure_time)}
                      </span>
                    </span>
                    <StatusBadge status={r.status} />
                    <ChevronRight className="w-5 h-5 text-gray-400 shrink-0" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ListFrame>
      )}

      {selected && (
        <div className="bg-white rounded-xl border p-4 sm:p-5 space-y-4">
          {results?.length > 1 && (
            <button type="button" onClick={() => setSelected(null)} className="inline-flex items-center gap-1 min-h-11 -mt-1 text-sm font-medium text-gray-600 hover:text-gray-900">
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to {results.length} results
            </button>
          )}
          <div className="flex items-start gap-4">
            {/* the seat is what the passenger needs to hear — make it the biggest thing */}
            <div className="w-20 h-20 shrink-0 rounded-xl bg-brand-forest-900 text-white flex flex-col items-center justify-center">
              <span className="text-[10px] uppercase tracking-wide opacity-80">Seat</span>
              <span className="font-display text-3xl font-bold leading-none">{selected.seat_number}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-500 font-mono">Booking #{selected.booking_id}</p>
              <p className="text-xl font-bold text-ink-900 break-words">{selected.passenger_name}</p>
              <div className="mt-1">
                <StatusBadge status={selected.status} />
              </div>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm border-t border-slate-100 pt-3">
            <div className="col-span-2 sm:col-span-1"><dt className="text-xs text-gray-500">Trip</dt><dd className="font-medium">{selected.origin} → {selected.destination}</dd></div>
            <div><dt className="text-xs text-gray-500">Departs</dt><dd className="font-medium">{formatDate(selected.departure_time)?.replace(/, \d{4}$/, "")} {formatTime(selected.departure_time)}</dd></div>
            <div><dt className="text-xs text-gray-500">Bus</dt><dd className="font-medium">{selected.plate_num ?? "—"}</dd></div>
            <div><dt className="text-xs text-gray-500">Channel</dt><dd className="font-medium">{CHANNEL_LABEL[selected.channel] ?? selected.channel}</dd></div>
            <div><dt className="text-xs text-gray-500">Trip status</dt><dd className="font-medium">{selected.trip_status}</dd></div>
            {fare != null && <div><dt className="text-xs text-gray-500">Fare</dt><dd className="font-medium">{formatPeso(fare)}</dd></div>}
            <div><dt className="text-xs text-gray-500">Fare type</dt><dd className="font-medium">{selected.discount_category ? `${CATEGORY_LABELS[selected.discount_category]} (${DISCOUNT_PERCENT}% off)` : "Regular"}</dd></div>
          </dl>
          {selected.discount_category && (
            <p className="text-sm rounded-xl px-3 py-2 bg-amber-50 text-amber-800">
              {CATEGORY_LABELS[selected.discount_category]} fare ({DISCOUNT_PERCENT}% off) — ask to see their {CATEGORY_LABELS[selected.discount_category]} ID at boarding.
            </p>
          )}
          {selected.channel === "online" && <OnlinePaymentStatus info={paymentInfo} />}
          {selected.status === "Reserved" && !tripOver && fare == null && (
            <p className="text-sm text-gray-600">This route has no fare on file, so the payment can't be recorded here.</p>
          )}
          {tripOver && <p className="text-sm text-rose-700 font-medium">This trip is {selected.trip_status.toLowerCase()} — the booking can't be changed.</p>}
          {!tripOver && actions.length === 0 && <p className="text-sm text-gray-600">Nothing to do — this booking is {selected.status.toLowerCase()}.</p>}
          {primary.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {primary.map((a, i) => (
                <button
                  key={a.to}
                  type="button"
                  onClick={() => runAction(a)}
                  disabled={busyTo !== null || isCollecting}
                  className={`inline-flex items-center justify-center gap-2 min-h-14 px-4 rounded-xl text-base font-semibold disabled:opacity-60 ${
                    i === 0 ? "bg-emerald-700 hover:bg-emerald-600 text-white shadow-sm" : "border-2 border-emerald-700 text-emerald-800 hover:bg-emerald-50"
                  }`}
                >
                  {busyTo === a.to && <Spinner className="w-5 h-5" />}
                  {busyTo === a.to ? "Saving…" : a.label}
                </button>
              ))}
            </div>
          )}
          {/* destructive: smaller, set apart, and confirmed */}
          {danger.length > 0 && (
            <div className="flex justify-end border-t border-slate-100 pt-3">
              {danger.map((a) => (
                <button
                  key={a.to}
                  type="button"
                  onClick={() => runAction(a)}
                  disabled={busyTo !== null || isCollecting}
                  className="inline-flex items-center gap-2 min-h-11 px-4 rounded-lg text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                >
                  {busyTo === a.to && <Spinner />}
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
