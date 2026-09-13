import { useEffect, useState } from "react";
import SeatMap from "../../components/passenger/SeatMap";
import * as api from "../../lib/api";
import { mapTrip } from "../../lib/format";

export default function WalkInSales() {
  const [trips, setTrips] = useState([]);
  const [tripId, setTripId] = useState("");
  const [trip, setTrip] = useState(null);
  const [occupiedSeatIds, setOccupiedSeatIds] = useState([]);
  const [selectedSeatIds, setSelectedSeatIds] = useState([]);
  const [passengerName, setPassengerName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.getTrips().then(setTrips).catch(() => {});
  }, []);

  useEffect(() => {
    if (!tripId) {
      setTrip(null);
      return;
    }
    setSelectedSeatIds([]);
    setMessage("");
    Promise.all([api.getTrip(tripId), api.getSeats(tripId)]).then(([tripRow, seatData]) => {
      setTrip(mapTrip(tripRow));
      setOccupiedSeatIds(seatData.bookedSeats);
    });
  }, [tripId]);

  function toggleSeat(id) {
    setSelectedSeatIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function handleSell() {
    setError("");
    if (!passengerName) {
      setError("Enter the passenger's name.");
      return;
    }
    if (selectedSeatIds.length === 0) return;

    setIsSubmitting(true);
    try {
      for (const seatId of selectedSeatIds) {
        await api.createWalkInBooking({ tripId: Number(tripId), passengerName, seatNumber: String(seatId) });
      }
      setMessage(`Sold ${selectedSeatIds.length} seat(s) to ${passengerName}.`);
      setPassengerName("");
      setSelectedSeatIds([]);
      const seatData = await api.getSeats(tripId);
      setOccupiedSeatIds(seatData.bookedSeats);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="p-6 space-y-4 max-w-2xl">
      <header>
        <h1 className="text-xl font-bold">Walk-in Ticket Sales</h1>
        <p className="text-sm text-gray-500">Process over-the-counter bookings. Paid on the spot.</p>
      </header>

      <select
        value={tripId}
        onChange={(e) => setTripId(e.target.value)}
        className="border rounded px-3 py-2 text-sm bg-white w-full"
      >
        <option value="">Select a trip…</option>
        {trips.map((t) => (
          <option key={t.trip_id} value={t.trip_id}>
            {t.origin} → {t.destination} · {new Date(t.departure_time).toLocaleString("en-PH")}
          </option>
        ))}
      </select>

      {trip && (
        <>
          <SeatMap
            totalSeats={trip.totalSeats}
            occupiedSeatIds={occupiedSeatIds}
            selectedSeatIds={selectedSeatIds}
            onToggleSeat={toggleSeat}
            maxSeats={10}
          />

          <div className="bg-white rounded-lg border p-4 space-y-3">
            <input
              value={passengerName}
              onChange={(e) => setPassengerName(e.target.value)}
              placeholder="Passenger name"
              className="w-full border rounded px-3 py-2 text-sm"
            />
            <p className="text-sm text-gray-600">
              {selectedSeatIds.length} seat(s) selected
              {trip.fare != null && selectedSeatIds.length > 0 && (
                <> · Total ₱{trip.fare * selectedSeatIds.length}</>
              )}
            </p>
            {error && <p className="text-sm text-rose-600 font-medium">{error}</p>}
            {message && <p className="text-sm text-emerald-700 font-medium">{message}</p>}
            <button
              type="button"
              onClick={handleSell}
              disabled={selectedSeatIds.length === 0 || isSubmitting}
              className="bg-amber-700 hover:bg-amber-600 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded"
            >
              {isSubmitting ? "Processing…" : "Sell Ticket"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
