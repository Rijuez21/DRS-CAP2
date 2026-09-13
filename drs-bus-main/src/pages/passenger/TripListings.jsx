import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ChevronLeft, RouteOff } from "lucide-react";
import TripCard from "../../components/passenger/TripCard";
import EmptyState from "../../components/common/EmptyState";
import * as api from "../../lib/api";
import { mapTrip, isSameDay } from "../../lib/format";

export default function TripListings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const origin = searchParams.get("origin");
  const destination = searchParams.get("destination");
  const date = searchParams.get("date");

  const [allTrips, setAllTrips] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    api
      .getTrips()
      .then((rows) => {
        if (!cancelled) setAllTrips(rows.map(mapTrip));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trips = useMemo(() => {
    return allTrips.filter((t) => {
      if (origin && t.origin !== origin) return false;
      if (destination && t.destination !== destination) return false;
      if (date && !isSameDay(t.departureIso, date)) return false;
      return true;
    });
  }, [allTrips, origin, destination, date]);

  const formattedDate = useMemo(() => {
    const d = date ? new Date(date) : new Date();
    return d.toLocaleDateString("en-PH", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, [date]);

  return (
    <div className="max-w-md mx-auto lg:max-w-4xl px-4 py-6 space-y-5">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm text-ink-600 hover:text-brand-green-600"
      >
        <ChevronLeft className="w-4 h-4" /> Back to home
      </button>

      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-xl font-bold">All Routes</h1>
          <p className="text-sm text-ink-600">{formattedDate}</p>
        </div>
        <p className="text-sm font-medium text-ink-600">
          {isLoading ? "Loading…" : `${trips.length} Trips Available`}
        </p>
      </header>

      {error && (
        <p role="alert" className="text-sm text-rose-600 font-medium">
          {error}
        </p>
      )}

      {!isLoading && trips.length === 0 ? (
        <EmptyState
          icon={RouteOff}
          title="No trips found"
          description="Try a different route or date."
        />
      ) : (
        <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
          {trips.map((t) => (
            <TripCard key={t.id} trip={t} />
          ))}
        </div>
      )}
    </div>
  );
}
