import { useNavigate } from "react-router-dom";
import { MapPin } from "lucide-react";
import TripSearchPanel from "../../components/passenger/TripSearchPanel";
import StatsRow from "../../components/passenger/StatsRow";
import EmptyState from "../../components/common/EmptyState";

// TODO: replace with the logged-in user's name from auth/session
const passengerName = "Passenger";

// TODO: replace with real counts from GET /api/dashboard/summary
const stats = [
  { label: "Routes", value: null },
  { label: "Trips Today", value: null },
  { label: "My Bookings", value: null },
];

// TODO: replace with GET /api/routes/popular
const popularRoutes = [];

export default function PassengerHome() {
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  function handleSearch(criteria) {
    const cleaned = Object.fromEntries(
      Object.entries(criteria).filter(([, v]) => v)
    );
    const params = new URLSearchParams(cleaned).toString();
    navigate(`/passenger/trips${params ? `?${params}` : ""}`);
  }

  return (
    <div className="px-4 py-6 lg:px-8 lg:py-10 max-w-md mx-auto lg:max-w-5xl">
      <header className="mb-5">
        <p className="text-sm text-ink-600">{today}</p>
        <h1 className="font-display text-2xl font-bold">
          Welcome, {passengerName}
        </h1>
      </header>

      <div className="space-y-6 lg:grid lg:grid-cols-[340px_1fr] lg:gap-8 lg:space-y-0 lg:items-start">
        <TripSearchPanel onSearch={handleSearch} />

        <div className="space-y-6">
          <StatsRow stats={stats} />

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-semibold text-lg">
                Popular Routes
              </h2>
              <button
                type="button"
                onClick={() => navigate("/passenger/trips")}
                className="text-sm font-medium text-brand-green-600 hover:underline"
              >
                See all
              </button>
            </div>

            {popularRoutes.length === 0 ? (
              <EmptyState
                icon={MapPin}
                title="No popular routes yet"
                description="Your most-traveled routes will show up here once trip data is connected."
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {popularRoutes.map((r) => (
                  <div key={r.id}>{/* route card, wire up once data exists */}</div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
