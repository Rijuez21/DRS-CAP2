import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { RouteOff, CalendarClock, CircleDot, MapPin, CalendarDays, X } from "lucide-react";
import TripCard from "../../components/passenger/TripCard";
import PageHeader from "../../components/passenger/PageHeader";
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
  const filters = [
    origin && { icon: CircleDot, text: `From ${origin}` },
    destination && { icon: MapPin, text: `To ${destination}` },
    date && { icon: CalendarDays, text: new Date(`${date}T00:00:00`).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" }) },
  ].filter(Boolean);
  const hasFilters = filters.length > 0;

  return (
    <div className="page-enter max-w-md mx-auto lg:max-w-4xl px-4 py-6 lg:py-10 space-y-5">
      <PageHeader
        back={{ to: "/passenger/home", label: "Home" }}
        icon={CalendarClock}
        title="Book a seat"
        subtitle={hasFilters ? "Departures matching your search" : "All upcoming departures"}
        aside={
          <span className="inline-block rounded-full bg-white border border-slate-200 px-3 py-1 text-xs font-semibold text-ink-600">
            {isLoading ? "Loading…" : `${trips.length} trip${trips.length === 1 ? "" : "s"}`}
          </span>
        }
      >
        {hasFilters && (
          <div className="flex flex-wrap items-center gap-2">
            {filters.map(({ icon: Icon, text }) => (
              <span key={text} className="inline-flex items-center gap-1.5 rounded-full bg-brand-forest-900/5 border border-brand-forest-900/10 px-3 py-1 text-xs font-medium text-brand-forest-800">
                <Icon className="w-3.5 h-3.5 text-brand-green-600" /> {text}
              </span>
            ))}
            <Link to="/passenger/trips" className="inline-flex items-center gap-1 text-xs font-medium text-ink-600 hover:text-rose-600 px-1">
              <X className="w-3.5 h-3.5" /> Clear
            </Link>
          </div>
        )}
      </PageHeader>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />

      {isLoading ? (
        <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-40 rounded-2xl bg-white border border-slate-100 animate-pulse" />
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
        <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">
          {trips.map((t) => (
            <TripCard key={t.id} trip={t} />
          ))}
        </div>
      )}
    </div>
  );
}
