import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin } from "lucide-react";
import TripSearchPanel from "../../components/passenger/TripSearchPanel";
import StatsRow from "../../components/passenger/StatsRow";
import EmptyState from "../../components/common/EmptyState";
import { useAuth } from "../../context/AuthContext";
import * as api from "../../lib/api";
import { mapTrip, isSameDay } from "../../lib/format";

export default function PassengerHome() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [routes, setRoutes] = useState([]);
  const [trips, setTrips] = useState([]);
  const [bookingCount, setBookingCount] = useState(null);

  useEffect(() => {
    api.getRoutes().then(setRoutes).catch(() => setRoutes([]));
    api.getTrips().then((rows) => setTrips(rows.map(mapTrip))).catch(() => setTrips([]));
  }, []);

  useEffect(() => {
    if (!user) return;
    api.getBookings({ passengerId: user.id }).then((rows) => setBookingCount(rows.length)).catch(() => {});
  }, [user]);

  const today = new Date();
  const todayLabel = today.toLocaleDateString("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const stats = [
    { label: "Routes", value: routes.length || null },
    { label: "Trips Today", value: trips.filter((t) => isSameDay(t.departureIso, todayIso)).length || null },
    { label: "My Bookings", value: bookingCount },
  ];

  // "Popular" here just means the first few distinct routes on record —
  // there's no booking-volume ranking endpoint yet.
  const popularRoutes = useMemo(() => routes.slice(0, 4), [routes]);

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
        <p className="text-sm text-ink-600">{todayLabel}</p>
        <h1 className="font-display text-2xl font-bold">
          Welcome, {user?.name ?? "Passenger"}
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
                title="No routes yet"
                description="Routes will show up here once they're added by an administrator."
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {popularRoutes.map((r) => (
                  <button
                    key={r.route_id}
                    type="button"
                    onClick={() =>
                      navigate(
                        `/passenger/trips?${new URLSearchParams({ origin: r.origin, destination: r.destination })}`
                      )
                    }
                    className="text-left rounded-2xl bg-white border border-slate-100 p-4 shadow-sm hover:border-brand-green-500/50 hover:shadow-md transition"
                  >
                    <p className="font-medium text-sm">
                      {r.origin} → {r.destination}
                    </p>
                    <p className="text-xs text-ink-600 mt-1">
                      {r.distance != null ? `${r.distance} km` : ""}
                      {r.base_fare != null ? ` · ₱${r.base_fare}` : ""}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
