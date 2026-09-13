import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import SeatMap from "../../components/passenger/SeatMap";
import BookingSummaryCard from "../../components/passenger/BookingSummaryCard";
import { useAuth } from "../../context/AuthContext";
import * as api from "../../lib/api";
import { mapTrip } from "../../lib/format";

export default function TripDetail() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [trip, setTrip] = useState(null);
  const [occupiedSeatIds, setOccupiedSeatIds] = useState([]);
  const [loadError, setLoadError] = useState("");

  const [selectedSeatIds, setSelectedSeatIds] = useState([]);
  const [passengerName, setPassengerName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getTrip(tripId), api.getSeats(tripId)])
      .then(([tripRow, seatData]) => {
        if (cancelled) return;
        setTrip(mapTrip(tripRow));
        setOccupiedSeatIds(seatData.bookedSeats);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  useEffect(() => {
    if (user?.name) setPassengerName(user.name);
  }, [user]);

  function toggleSeat(id) {
    setSelectedSeatIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  async function handleConfirm() {
    setSubmitError("");

    if (!user) {
      setSubmitError("Please log in as a passenger to book a seat.");
      return;
    }
    if (selectedSeatIds.length === 0) return;

    setIsSubmitting(true);
    try {
      // One booking row per seat (the schema's seat lock is per trip+seat).
      const bookings = [];
      for (const seatId of selectedSeatIds) {
        bookings.push(
          await api.createBooking({
            tripId: Number(tripId),
            passengerId: user.id,
            passengerName: passengerName || user.name,
            seatNumber: String(seatId),
          })
        );
      }
      navigate("/passenger/booking-confirmed", {
        state: { bookings, trip },
      });
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div className="max-w-md mx-auto px-4 py-6">
        <p role="alert" className="text-sm text-rose-600 font-medium">
          {loadError}
        </p>
      </div>
    );
  }

  const tripView = trip ?? {
    origin: null,
    destination: null,
    distanceKm: null,
    departureTime: null,
    arrivalTime: null,
    duration: null,
    busModel: null,
    plateNumber: null,
    busType: null,
    totalSeats: 52,
    fare: null,
  };

  return (
    <div className="max-w-md mx-auto lg:max-w-5xl px-4 py-6 space-y-5">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm text-ink-600 hover:text-brand-green-600"
      >
        <ChevronLeft className="w-4 h-4" /> Back to trips
      </button>

      <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-6 lg:items-start space-y-5 lg:space-y-0">
        <div className="space-y-5">
          <RouteHeader trip={tripView} tripId={tripId} />
          <BusInfoCard trip={tripView} />
          <SeatMap
            totalSeats={tripView.totalSeats}
            occupiedSeatIds={occupiedSeatIds}
            selectedSeatIds={selectedSeatIds}
            onToggleSeat={toggleSeat}
            maxSeats={6}
          />
        </div>

        <BookingSummaryCard
          selectedSeatIds={selectedSeatIds}
          pricePerSeat={tripView.fare}
          passengerName={passengerName}
          onPassengerNameChange={setPassengerName}
          contactNumber={contactNumber}
          onContactNumberChange={setContactNumber}
          onConfirm={handleConfirm}
          isSubmitting={isSubmitting}
          error={submitError}
        />
      </div>
    </div>
  );
}

function RouteHeader({ trip, tripId }) {
  return (
    <div className="rounded-3xl bg-brand-forest-900 text-white p-5">
      <p className="font-display text-lg font-bold">
        {trip.origin ?? "Origin"} → {trip.destination ?? "Destination"}
      </p>
      <p className="text-xs text-white/60 mb-4">
        {trip.distanceKm != null ? `${trip.distanceKm} km route` : `Trip ${tripId}`}
      </p>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-xs text-white/60">Departs</p>
          <p className="font-display font-bold">{trip.departureTime ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-white/60">Duration</p>
          <p className="font-display font-bold text-brand-sunrise-400">
            {trip.duration ?? "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-white/60">Arrival</p>
          <p className="font-display font-bold">{trip.arrivalTime ?? "—"}</p>
        </div>
      </div>
    </div>
  );
}

function BusInfoCard({ trip }) {
  const fields = [
    { label: "Model", value: trip.busModel },
    { label: "Plate", value: trip.plateNumber },
    { label: "Type", value: trip.busType },
    { label: "Total Seats", value: trip.totalSeats },
  ];

  return (
    <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5">
      <h2 className="font-display font-semibold mb-3 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-brand-green-600" /> Bus Information
      </h2>
      <div className="grid grid-cols-2 gap-y-3 gap-x-4">
        {fields.map((f) => (
          <div key={f.label}>
            <p className="text-xs text-ink-600">{f.label}</p>
            <p className="font-medium">{f.value ?? "—"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
