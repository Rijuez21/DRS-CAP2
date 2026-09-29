import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, RouteOff } from "lucide-react";
import TripCard from "../../components/passenger/TripCard";
import EmptyState from "../../components/common/EmptyState";
import InlineAlert from "../../components/common/InlineAlert";
import * as api from "../../lib/api";
import { mapTrip, isSameDay } from "../../lib/format";

// Book Ahead, step 1: pick a departure. Only trips a seat can still be
// bought on are listed (?scope=bookable — Scheduled before departure, or
// Boarding). This page used to list every trip ever run, Completed and
// Cancelled included, each claiming the bus's full capacity in "seats left".
export default function TripListings() {
  const [searchParams] = useSearchParams();
  const origin = searchParams.get("origin");
  const destination = searchParams.get("destination");
  const date = searchParams.get("date");
  const [allTrips, setAllTrips] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .getTrips({ scope: "bookable" })
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

  const trips = useMemo(
    () =>
      allTrips.filter((t) => {
        if (origin && t.origin !== origin) return false;
        if (destination && t.destination !== destination) return false;
        if (date && !isSameDay(t.departureIso, date)) return false;
        return true;
      }),
    [allTrips, origin, destination, date]
  );

  // Say what's actually being shown, instead of always printing today's date.
  const filterSummary = [
    origin && `from ${origin}`,
    destination && `to ${destination}`,
    date && `on ${new Date(`${date}T00:00:00`).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" })}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const hasFilters = Boolean(origin || destination || date);

  return (
    <div className="max-w-md mx-auto lg:max-w-4xl px-4 py-6 space-y-5">
      <Link to="/passenger/home" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-brand-green-600">
        <ChevronLeft className="w-4 h-4" /> Home
      </Link>

      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">Book a seat</h1>
          <p className="text-sm text-ink-600">{filterSummary || "All upcoming departures"}</p>
        </div>
        <p className="text-sm font-medium text-ink-600 shrink-0">
          {isLoading ? "Loading…" : `${trips.length} trip${trips.length === 1 ? "" : "s"}`}
        </p>
      </header>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />

      {isLoading ? (
        <div className="space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-36 rounded-2xl bg-white border border-slate-100 animate-pulse" />
          ))}
        </div>
      ) : trips.length === 0 && !error ? (
        <EmptyState
          icon={RouteOff}
          title={hasFilters ? "No trips match your search" : "No upcoming trips"}
          description={hasFilters ? "Try another date or destination." : "New departures appear here once they're scheduled."}
          action={
            hasFilters ? (
              <Link to="/passenger/trips" className="text-sm font-medium text-brand-green-600 hover:underline">
                Show all upcoming trips
              </Link>
            ) : null
          }
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
