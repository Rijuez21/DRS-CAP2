import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Info, Bus } from "lucide-react";
import SeatMap from "../../components/passenger/SeatMap";
import BookingSummaryCard from "../../components/passenger/BookingSummaryCard";
import BookingSteps from "../../components/passenger/BookingSteps";
import InlineAlert from "../../components/common/InlineAlert";
import { useAuth } from "../../context/AuthContext";
import * as api from "../../lib/api";
import { mapTrip, formatDate } from "../../lib/format";
import { LAST_BOOKING_KEY } from "../../lib/storageKeys";

const SEAT_REFRESH_MS = 30000; // pick up seats other people just bought while this page is open

// Mirrors the server's whyTripNotBookable (bookingRules.js) so the page can
// explain up front instead of letting the passenger pick seats for nothing.
function notBookableReason(trip) {
  if (!trip) return null;
  if (trip.status === "Cancelled") return "This trip has been cancelled.";
  if (trip.status === "Completed") return "This trip has already finished.";
  if (trip.status === "In Transit") return "This bus has already left the terminal.";
  if (trip.status === "Scheduled" && new Date(trip.departureIso) <= new Date()) return "This trip's departure time has passed.";
  if (trip.totalSeats == null) return "Seats for this bus can't be booked online yet.";
  return null;
}

// Book Ahead, step 2: pick seats and reserve.
export default function TripDetail() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [trip, setTrip] = useState(null);
  const [occupiedSeatIds, setOccupiedSeatIds] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [selectedSeatIds, setSelectedSeatIds] = useState([]);
  const [passengerName, setPassengerName] = useState(user?.name ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const refreshSeats = useCallback(
    () =>
      api.getSeats(tripId).then((seatData) => {
        const taken = seatData.bookedSeats.map(String);
        setOccupiedSeatIds(taken);
        // Drop any selected seat someone else just bought.
        setSelectedSeatIds((prev) => prev.filter((s) => !taken.includes(String(s))));
        return taken;
      }),
    [tripId]
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getTrip(tripId), refreshSeats()])
      .then(([tripRow]) => {
        if (!cancelled) setTrip(mapTrip(tripRow));
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });
    const id = setInterval(() => refreshSeats().catch(() => {}), SEAT_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tripId, refreshSeats]);

  function toggleSeat(id) {
    setSubmitError("");
    setSelectedSeatIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function handleConfirm() {
    setSubmitError("");
    if (selectedSeatIds.length === 0) return;
    setIsSubmitting(true);
    try {
      // One request for all seats: either every seat is reserved or none is.
      const result = await api.createBooking({
        tripId: Number(tripId),
        seatNumbers: selectedSeatIds.map(String),
        passengerName: passengerName.trim() || undefined,
      });
      const confirmation = { bookings: result.bookings, trip, passengerName: result.passengerName };
      sessionStorage.setItem(LAST_BOOKING_KEY, JSON.stringify(confirmation));
      navigate("/passenger/booking-confirmed", { replace: true, state: confirmation });
    } catch (err) {
      setSubmitError(err.message);
      // Someone took a seat first: nothing was booked. Refresh the map so
      // the taken seat greys out and is removed from the selection.
      if (err.status === 409) refreshSeats().catch(() => {});
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div className="max-w-md mx-auto px-4 py-6 space-y-4">
        <InlineAlert type="error" message={loadError} />
        <Link to="/passenger/trips" className="text-sm font-medium text-brand-green-600 hover:underline">
          Back to trips
        </Link>
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="max-w-md mx-auto lg:max-w-5xl px-4 py-6 space-y-4" aria-busy="true">
        <div className="h-32 rounded-3xl bg-brand-forest-900/80 animate-pulse" />
        <div className="h-96 rounded-3xl bg-white border border-slate-100 animate-pulse" />
      </div>
    );
  }

  const blocked = notBookableReason(trip);

  return (
    <div className="page-enter max-w-md mx-auto lg:max-w-5xl px-4 py-6 lg:py-10 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link to="/passenger/trips" className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-brand-green-600 transition-colors">
          <ChevronLeft className="w-4 h-4" /> All trips
        </Link>
        <BookingSteps current={1} />
      </div>

      <RouteHeader trip={trip} />

      {blocked ? (
        <div role="alert" className="card p-5 space-y-3">
          <p className="font-display font-semibold flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-brand-sunrise-400/20 flex items-center justify-center shrink-0">
              <Info className="w-5 h-5 text-amber-700" />
            </span>
            {blocked}
          </p>
          <p className="text-sm text-ink-600">
            {trip.status === "In Transit"
              ? "You can still catch it on the road if you're along the route."
              : "Choose another departure to reserve a seat."}
          </p>
          <Link
            to={trip.status === "In Transit" ? "/passenger/flag" : "/passenger/trips"}
            className="inline-block bg-brand-green-600 hover:bg-brand-green-500 text-white font-display font-semibold rounded-xl px-4 py-2.5 shadow-md shadow-brand-green-600/25 transition-colors"
          >
            {trip.status === "In Transit" ? "Flag this bus instead" : "See other trips"}
          </Link>
        </div>
      ) : (
        <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-6 lg:items-start space-y-5 lg:space-y-0">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-display font-semibold text-lg">Choose your seats</h2>
              {trip.seatsAvailable != null && (
                <span className="rounded-full bg-brand-green-500/12 text-brand-green-600 px-3 py-1 text-xs font-semibold">
                  {trip.seatsAvailable} of {trip.totalSeats} free
                </span>
              )}
            </div>
            <p className="text-sm text-ink-600 -mt-1">Tap the seats you want, up to 6.</p>
            <SeatMap
              totalSeats={trip.totalSeats}
              occupiedSeatIds={occupiedSeatIds}
              selectedSeatIds={selectedSeatIds}
              onToggleSeat={toggleSeat}
              maxSeats={6}
            />
          </div>
          <BookingSummaryCard
            selectedSeatIds={selectedSeatIds}
            pricePerSeat={trip.fare}
            passengerName={passengerName}
            onPassengerNameChange={setPassengerName}
            onConfirm={handleConfirm}
            isSubmitting={isSubmitting}
            error={submitError}
          />
        </div>
      )}
    </div>
  );
}

function RouteHeader({ trip }) {
  const facts = [trip.busModel, trip.plateNumber, trip.distanceKm != null ? `${trip.distanceKm} km` : null].filter(Boolean);
  return (
    <div className="hero-forest rounded-3xl p-5 lg:p-6 pb-8 space-y-5 shadow-xl shadow-brand-forest-900/20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-brand-sunrise-400">{formatDate(trip.departureIso)}</p>
          <p className="font-display text-xl lg:text-2xl font-bold mt-0.5">
            {trip.origin} → {trip.destination}
          </p>
        </div>
        {trip.fare != null && (
          <div className="text-right shrink-0">
            <p className="text-[11px] text-white/60">per seat</p>
            <p className="font-display text-xl font-bold text-brand-sunrise-400">₱{trip.fare}</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-white/50">Departs</p>
          <p className="font-display text-lg font-bold">{trip.departureTime ?? "—"}</p>
        </div>
        <div className="flex-1 flex flex-col items-center gap-1" aria-hidden="true">
          <span className="text-xs font-semibold text-brand-sunrise-400">{trip.duration ?? " "}</span>
          <span className="w-full flex items-center">
            <span className="w-2 h-2 rounded-full bg-white shrink-0" />
            <span className="flex-1 border-t-2 border-dashed border-white/25" />
            <Bus className="w-4 h-4 text-brand-sunrise-400 mx-1.5 shrink-0" />
            <span className="flex-1 border-t-2 border-dashed border-white/25" />
            <span className="w-2 h-2 rounded-full bg-brand-sunrise-400 shrink-0" />
          </span>
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wider text-white/50">Arrives</p>
          <p className="font-display text-lg font-bold">{trip.arrivalTime ?? "—"}</p>
        </div>
      </div>

      {facts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {facts.map((f) => (
            <span key={f} className="rounded-full bg-white/10 border border-white/10 px-2.5 py-1 text-xs text-white/80">
              {f}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
