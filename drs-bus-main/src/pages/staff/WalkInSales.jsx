import { useCallback, useEffect, useState } from "react";
import { Ticket, Printer } from "lucide-react";
import SeatMap from "../../components/passenger/SeatMap";
import InlineAlert from "../../components/common/InlineAlert";
import * as api from "../../lib/api";
import { mapTrip, formatDate, formatTime } from "../../lib/format";

// Terminal counter sale: trip -> seats -> name -> sell. Only trips a seat
// can still be sold on are offered (the old dropdown listed Completed and
// Cancelled trips too), and a multi-seat sale is all-or-nothing — before,
// seat 3 failing left seats 1–2 sold with only an error on screen.
export default function WalkInSales() {
  const [trips, setTrips] = useState([]);
  const [tripsError, setTripsError] = useState("");
  const [tripId, setTripId] = useState("");
  const [trip, setTrip] = useState(null);
  const [occupiedSeatIds, setOccupiedSeatIds] = useState([]);
  const [selectedSeatIds, setSelectedSeatIds] = useState([]);
  const [passengerName, setPassengerName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState("");

  const loadTrips = useCallback(() => {
    api
      .getTrips({ scope: "bookable" })
      .then((rows) => {
        setTrips(rows);
        setTripsError("");
      })
      .catch((err) => setTripsError(err.message));
  }, []);
  useEffect(loadTrips, [loadTrips]);

  const refreshSeats = useCallback(
    (id) =>
      api.getSeats(id).then((seatData) => {
        const taken = seatData.bookedSeats.map(String);
        setOccupiedSeatIds(taken);
        setSelectedSeatIds((prev) => prev.filter((s) => !taken.includes(String(s))));
      }),
    []
  );

  function chooseTrip(id) {
    setTripId(id);
    setTrip(null);
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

  async function handleSell() {
    setError("");
    if (!passengerName.trim()) {
      setError("Enter the passenger's name.");
      return;
    }
    if (selectedSeatIds.length === 0) return;
    setIsSubmitting(true);
    try {
      const result = await api.createWalkInBooking({
        tripId: Number(tripId),
        passengerName: passengerName.trim(),
        seatNumbers: selectedSeatIds.map(String),
      });
      setReceipt({ ...result, trip, total: trip.fare != null ? trip.fare * result.bookings.length : null });
      setPassengerName("");
      setSelectedSeatIds([]);
      refreshSeats(tripId).catch(() => {});
      loadTrips(); // seats-left in the dropdown
    } catch (err) {
      setError(err.message);
      if (err.status === 409) refreshSeats(tripId).catch(() => {});
    } finally {
      setIsSubmitting(false);
    }
  }

  const count = selectedSeatIds.length;

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-5xl">
      <header>
        <h1 className="text-xl font-bold">Walk-in Sales</h1>
        <p className="text-sm text-gray-500">Sell a seat to a passenger at the counter. Walk-in tickets are confirmed immediately.</p>
      </header>

      <InlineAlert type="error" message={tripsError} onDismiss={() => setTripsError("")} />

      <label className="block">
        <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">1. Trip</span>
        <select value={tripId} onChange={(e) => chooseTrip(e.target.value)} className="input bg-white">
          <option value="">{trips.length === 0 ? "No trips open for sale" : "Select a trip…"}</option>
          {trips.map((t) => {
            const left = t.capacity != null ? t.capacity - Number(t.booked_count ?? 0) : null;
            return (
              <option key={t.trip_id} value={t.trip_id} disabled={left === 0}>
                {formatDate(t.departure_time)?.replace(/, \d{4}$/, "")} {formatTime(t.departure_time)} · {t.origin} → {t.destination} · {t.plate_num}
                {left != null ? ` · ${left === 0 ? "SOLD OUT" : `${left} left`}` : ""}
              </option>
            );
          })}
        </select>
      </label>

      {receipt && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-2">
          <p className="font-semibold text-emerald-800 flex items-center gap-2">
            <Ticket className="w-4 h-4" /> Sold {receipt.bookings.length} seat{receipt.bookings.length === 1 ? "" : "s"} to {receipt.passengerName}
          </p>
          <p className="text-sm text-emerald-900">
            {receipt.trip.origin} → {receipt.trip.destination} · {receipt.trip.departureTime} · Bus {receipt.trip.plateNumber}
          </p>
          <p className="text-sm text-emerald-900">
            {receipt.bookings.map((b) => `Seat ${b.seat_number} (#${b.booking_id})`).join(" · ")}
            {receipt.total != null && ` · Collect ₱${receipt.total}`}
          </p>
          <button type="button" onClick={() => window.print()} className="text-xs font-semibold text-emerald-800 underline inline-flex items-center gap-1">
            <Printer className="w-3.5 h-3.5" /> Print receipt
          </button>
        </div>
      )}

      {tripId && !trip && !error && <p className="text-sm text-gray-500">Loading seats…</p>}

      {trip && (
        <div className="lg:grid lg:grid-cols-[1fr_320px] lg:gap-6 lg:items-start space-y-4 lg:space-y-0">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">2. Seats (up to 10)</p>
            <SeatMap totalSeats={trip.totalSeats} occupiedSeatIds={occupiedSeatIds} selectedSeatIds={selectedSeatIds} onToggleSeat={toggleSeat} maxSeats={10} />
          </div>
          <div className="bg-white rounded-lg border p-4 space-y-3 lg:sticky lg:top-6">
            <label className="block">
              <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">3. Passenger name</span>
              <input value={passengerName} onChange={(e) => setPassengerName(e.target.value)} maxLength={150} placeholder="Name on ticket" className="input" />
            </label>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">{count === 0 ? "No seats selected" : `Seats ${[...selectedSeatIds].sort((a, b) => a - b).join(", ")}`}</span>
              {trip.fare != null && count > 0 && <span className="font-bold text-emerald-700">₱{trip.fare * count}</span>}
            </div>
            <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
            <button
              type="button"
              onClick={handleSell}
              disabled={count === 0 || isSubmitting}
              className="w-full bg-amber-700 hover:bg-amber-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold rounded-lg py-2.5"
            >
              {isSubmitting ? "Selling…" : count === 0 ? "Select a seat" : `Sell ${count} ticket${count === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
