import { useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ChevronLeft, RouteOff } from "lucide-react";
import TripCard from "../../components/passenger/TripCard";
import EmptyState from "../../components/common/EmptyState";

// TODO: replace with GET /api/trips?origin=&destination=&date=
const trips = [];

export default function TripListings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const date = searchParams.get("date");

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
          {trips.length} Trips Available
        </p>
      </header>

      {trips.length === 0 ? (
        <EmptyState
          icon={RouteOff}
          title="No trips loaded yet"
          description="This list will populate once trip search connects to the backend API."
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
