import { useCallback, useEffect, useState } from "react";
import { Ticket, Printer, CheckCircle2, ArrowLeft, Bus, Armchair } from "lucide-react";
import SeatMap from "../../components/passenger/SeatMap";
import InlineAlert from "../../components/common/InlineAlert";
import ListFrame from "../../components/common/ListFrame";
import { SkeletonList } from "../../components/common/Skeletons";
import { Spinner } from "../../components/common/Buttons";
import PageHeading from "../../components/common/PageHeading";
import StatusBadge from "../../components/common/StatusBadge";
import CashPaymentModal from "../../components/staff/CashPaymentModal";
import * as api from "../../lib/api";
import { compareSeats, customSeatLayout, mapTrip, formatDate, formatPeso, formatTime, stillSelectable } from "../../lib/format";

const tripLabel = (t) => `${t.origin} → ${t.destination}`;
const shortDeparture = (t) => `${formatDate(t.departure_time)?.replace(/, \d{4}$/, "")} ${formatTime(t.departure_time)}`;
const seatsLeft = (t) => (t.capacity != null ? t.capacity - Number(t.booked_count ?? 0) : null);
const TRIP_SORT = [
  { key: "departure_time", label: "Departure", type: "date" },
  { key: "route", label: "Route", accessor: tripLabel },
  { key: "seats_left", label: "Seats left", type: "number", accessor: seatsLeft },
];
const STEPS = ["Choose trip", "Seats & passenger", "Payment"];
const TRIP_FILTERS = [
  {
    key: "availability",
    label: "Availability",
    allLabel: "All trips",
    options: [
      { value: "open", label: "Seats available" },
      { value: "sold_out", label: "Sold out" },
    ],
    match: (t, value) => (value === "open" ? seatsLeft(t) !== 0 : seatsLeft(t) === 0),
  },
];

// Terminal counter sale: trip -> seats -> name -> confirm payment -> sell.
// The payment step asks for the cash received and shows the change; the
// ticket is only issued once that's confirmed (and covers the fare). Only trips a seat
// can still be sold on are offered (the old dropdown listed Completed and
// Cancelled trips too), and a multi-seat sale is all-or-nothing — before,
// seat 3 failing left seats 1–2 sold with only an error on screen.
export default function WalkInSales() {
  const [trips, setTrips] = useState([]);
  const [tripsError, setTripsError] = useState("");
  const [tripId, setTripId] = useState("");
  const [trip, setTrip] = useState(null);
  const [occupiedSeatIds, setOccupiedSeatIds] = useState([]);
  const [seatLayout, setSeatLayout] = useState(null); // null = auto layout from capacity
  const [selectedSeatIds, setSelectedSeatIds] = useState([]);
  const [passengerName, setPassengerName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false); // payment confirmation dialog open
  const [payError, setPayError] = useState("");

  const [tripsLoaded, setTripsLoaded] = useState(false);

  const loadTrips = useCallback(() => {
    api
      .getTrips({ scope: "bookable" })
      .then((rows) => {
        setTrips(rows);
        setTripsError("");
      })
      .catch((err) => setTripsError(err.message))
      .finally(() => setTripsLoaded(true));
  }, []);
  useEffect(loadTrips, [loadTrips]);

  const refreshSeats = useCallback(
    (id) =>
      api.getSeats(id).then((seatData) => {
        setOccupiedSeatIds(seatData.bookedSeats.map(String));
        setSeatLayout(customSeatLayout(seatData));
        setSelectedSeatIds((prev) => stillSelectable(prev, seatData));
      }),
    []
  );

  function chooseTrip(id) {
    setTripId(id);
    setTrip(null);
    setSeatLayout(null);
    setSelectedSeatIds([]);
    setError("");
    setReceipt(null);
    if (!id) return;
    Promise.all([api.getTrip(id), refreshSeats(id)])
      .then(([tripRow]) => setTrip(mapTrip(tripRow)))
      .catch((err) => setError(err.message));
  }

  function toggleSeat(id) {
    setError("");
    setSelectedSeatIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  // Step 4: check the form, then open the payment confirmation.
  function handleSell() {
    setError("");
    if (!passengerName.trim()) {
      setError("Enter the passenger's name.");
      return;
    }
    if (selectedSeatIds.length === 0) return;
    if (trip.fare == null) {
      setError("This route has no fare on file yet, so the payment can't be confirmed. Ask an admin to set it in Route Management.");
      return;
    }
    setPayError("");
    setPaying(true);
  }

  // Payment confirmed in the dialog -> actually sell.
  async function confirmPaymentAndSell(cashReceived) {
    setIsSubmitting(true);
    setPayError("");
    try {
      const result = await api.createWalkInBooking({
        tripId: Number(tripId),
        passengerName: passengerName.trim(),
        seatNumbers: selectedSeatIds.map(String),
        cashReceived,
      });
      const total = result.payment?.total ?? (trip.fare != null ? trip.fare * result.bookings.length : null);
      setReceipt({
        ...result,
        trip,
        total,
        cashReceived: result.payment?.cashReceived ?? cashReceived,
        change: result.payment?.change ?? (total != null ? cashReceived - total : null),
      });
      setPaying(false);
      setPassengerName("");
      setSelectedSeatIds([]);
      refreshSeats(tripId).catch(() => {});
      loadTrips(); // seats-left in the dropdown
    } catch (err) {
      if (err.status === 409) {
        // A seat was just sold elsewhere: close the dialog so staff can re-pick.
        setPaying(false);
        setError(err.message);
        refreshSeats(tripId).catch(() => {});
      } else {
        setPayError(err.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const count = selectedSeatIds.length;
  const pickedTrip = tripId ? trips.find((t) => String(t.trip_id) === String(tripId)) : null;

  // Goal-gradient: always show where in the sale we are.
  const step = receipt ? 4 : paying ? 3 : trip || tripId ? 2 : 1;
  const sortedSeats = [...selectedSeatIds].sort(compareSeats);

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-5xl">
      <PageHeading title="Walk-in Sales" subtitle="Sell a seat to a passenger at the counter. Confirm the cash payment and the ticket is issued immediately." />

      <Stepper step={step} />

      <InlineAlert type="error" message={tripsError} onDismiss={() => setTripsError("")} />

      {/* Peak-End: a clear finish — what was sold, and what to do next */}
      {receipt && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 space-y-3">
          <p className="font-display text-lg font-bold text-emerald-900 flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6" aria-hidden="true" /> Sold {receipt.bookings.length} seat{receipt.bookings.length === 1 ? "" : "s"} to {receipt.passengerName}
          </p>
          <p className="text-sm text-emerald-900">
            {receipt.trip.origin} → {receipt.trip.destination} · {receipt.trip.departureTime} · Bus {receipt.trip.plateNumber}
          </p>
          <p className="text-sm text-emerald-900">{receipt.bookings.map((b) => `Seat ${b.seat_number} (#${b.booking_id})`).join(" · ")}</p>
          {receipt.total != null && (
            <p className="text-sm text-emerald-900 font-medium">
              Paid in cash: {formatPeso(receipt.total)}
              {receipt.cashReceived != null && ` · Received ${formatPeso(receipt.cashReceived)} · Change ${formatPeso(receipt.change ?? 0)}`}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={() => setReceipt(null)} className="min-h-11 px-4 rounded-lg bg-amber-700 hover:bg-amber-600 text-white text-sm font-semibold">
              Sell another on this trip
            </button>
            <button type="button" onClick={() => chooseTrip("")} className="min-h-11 px-4 rounded-lg border border-emerald-300 bg-white text-sm font-semibold text-emerald-900 hover:bg-emerald-100">
              Choose another trip
            </button>
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-lg text-sm font-semibold text-emerald-900 hover:bg-emerald-100">
              <Printer className="w-4 h-4" aria-hidden="true" /> Print receipt
            </button>
          </div>
        </div>
      )}

      {/* Step 1 */}
      {step === 1 && (
        <ListFrame
          rows={trips}
          fields={TRIP_SORT}
          isLoading={!tripsLoaded}
          initialSort={{ key: "departure_time", dir: "asc" }}
          searchKeys={[tripLabel, "plate_num", "bus_number"]}
          searchPlaceholder="Search route or bus…"
          filters={TRIP_FILTERS}
          skeleton={<SkeletonList count={4} />}
          emptyState={{ icon: Ticket, title: "No trips open for sale", description: "Trips appear here once they're scheduled." }}
        >
          {(pageRows) => (
            <ul className="space-y-2" aria-label="Trips open for sale">
              {pageRows.map((t) => {
                const left = seatsLeft(t);
                const soldOut = left === 0;
                return (
                  <li key={t.trip_id}>
                    <button
                      type="button"
                      disabled={soldOut}
                      onClick={() => chooseTrip(String(t.trip_id))}
                      className="w-full flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-1 text-left bg-white rounded-xl border px-4 py-3 min-h-16 hover:border-amber-400 hover:bg-amber-50/50 disabled:opacity-60 disabled:hover:bg-white disabled:hover:border-slate-200 disabled:cursor-not-allowed"
                    >
                      <span className="w-24 shrink-0">
                        <span className="block font-display text-lg font-bold tabular-nums text-ink-900 leading-tight">{formatTime(t.departure_time)}</span>
                        <span className="block text-xs text-gray-500">{formatDate(t.departure_time)?.replace(/, \d{4}$/, "").replace(/^\w+, /, "")}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-ink-900 truncate">{tripLabel(t)}</span>
                        <span className="inline-flex items-center gap-1 text-sm text-gray-600">
                          <Bus className="w-3.5 h-3.5" aria-hidden="true" /> {t.plate_num}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        {soldOut ? (
                          <StatusBadge status="Sold out" />
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-ink-900 tabular-nums">
                            <Armchair className="w-4 h-4 text-gray-400" aria-hidden="true" /> {left ?? "—"} left
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ListFrame>
      )}

      {/* Step 2 (and 3, with the payment dialog over it) */}
      {(step === 2 || step === 3) && (
        <>
          {pickedTrip && (
            <div className="flex flex-wrap items-center justify-between gap-2 bg-white rounded-xl border px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold text-ink-900">{tripLabel(pickedTrip)}</p>
                <p className="text-sm text-gray-600">
                  {shortDeparture(pickedTrip)} · {pickedTrip.plate_num}
                  {seatsLeft(pickedTrip) != null && ` · ${seatsLeft(pickedTrip)} left`}
                </p>
              </div>
              <button type="button" onClick={() => chooseTrip("")} className="inline-flex items-center gap-1 min-h-11 px-3 text-sm font-semibold text-amber-800 rounded-lg hover:bg-amber-50">
                <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Change trip
              </button>
            </div>
          )}

          {!trip && !error && <SkeletonList count={2} />}
          {!trip && error && <InlineAlert type="error" message={error} onDismiss={() => setError("")} />}

          {trip && (
            <div className="lg:grid lg:grid-cols-[1fr_320px] lg:gap-6 lg:items-start space-y-4 lg:space-y-0">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-ink-900">Pick seats <span className="font-normal text-gray-500">(up to 10)</span></p>
                <SeatMap layout={seatLayout} totalSeats={trip.totalSeats} occupiedSeatIds={occupiedSeatIds} selectedSeatIds={selectedSeatIds} onToggleSeat={toggleSeat} maxSeats={10} />
              </div>
              {/* the summary stays in view while picking seats */}
              <div className="bg-white rounded-xl border p-4 space-y-3 lg:sticky lg:top-6">
                <h2 className="font-display font-semibold">Sale summary</h2>
                <label className="block">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Passenger name</span>
                  <input value={passengerName} onChange={(e) => setPassengerName(e.target.value)} maxLength={150} placeholder="Name on ticket" className="input min-h-11" />
                </label>
                <dl className="text-sm space-y-1">
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-600">Seats</dt>
                    <dd className="font-medium text-right">{count === 0 ? "None yet" : sortedSeats.join(", ")}</dd>
                  </div>
                  {trip.fare != null && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-gray-600">Fare</dt>
                      <dd className="tabular-nums">
                        {formatPeso(trip.fare)} × {count}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-2 border-t border-slate-100 pt-2">
                    <dt className="font-semibold">Total</dt>
                    <dd className="font-bold text-emerald-700 tabular-nums">{trip.fare != null ? formatPeso(trip.fare * count) : "—"}</dd>
                  </div>
                </dl>
                <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
                <button
                  type="button"
                  onClick={handleSell}
                  disabled={count === 0 || isSubmitting}
                  className="w-full inline-flex items-center justify-center gap-2 min-h-12 bg-amber-700 hover:bg-amber-600 disabled:bg-gray-200 disabled:text-gray-500 text-white font-semibold rounded-lg"
                >
                  {isSubmitting && <Spinner />}
                  {count === 0 ? "Select a seat" : `Continue to payment · ${count} ticket${count === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {paying && trip && (
        <CashPaymentModal
          title="Step 3 of 3 · Confirm payment"
          summary={
            <>
              <p className="font-medium text-gray-900">{passengerName.trim()}</p>
              <p>
                {trip.origin} → {trip.destination} · {trip.departureTime}
              </p>
              <p>
                {count} seat{count === 1 ? "" : "s"} ({sortedSeats.join(", ")}) × {formatPeso(trip.fare)}
              </p>
            </>
          }
          amountDue={trip.fare * count}
          confirmLabel={`Confirm payment & sell`}
          isSaving={isSubmitting}
          error={payError}
          onConfirm={confirmPaymentAndSell}
          onClose={() => setPaying(false)}
        />
      )}
    </div>
  );
}

// "Step 2 of 3" with a progress bar; step 4 = done.
function Stepper({ step }) {
  const current = Math.min(step, STEPS.length);
  return (
    <nav aria-label="Sale progress" className="space-y-2">
      <p className="text-sm font-semibold text-ink-900">
        {step > STEPS.length ? "Done — ticket issued" : `Step ${current} of ${STEPS.length}: ${STEPS[current - 1]}`}
      </p>
      <ol className="grid grid-cols-3 gap-2">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = step > n;
          const active = step === n;
          return (
            <li key={label} aria-current={active ? "step" : undefined} className="space-y-1">
              <div className={`h-1.5 rounded-full ${done ? "bg-emerald-600" : active ? "bg-amber-600" : "bg-slate-200"}`} />
              <span className={`block text-xs ${active ? "font-semibold text-ink-900" : "text-gray-500"}`}>
                {done && <span className="sr-only">Completed: </span>}
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
