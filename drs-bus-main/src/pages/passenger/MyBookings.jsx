import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, CalendarClock, Hand, ArrowRight, Route, Bus, Ticket, Sunrise, Sun, Moon } from "lucide-react";
import TripSearchPanel from "../../components/passenger/TripSearchPanel";
import StatsRow from "../../components/passenger/StatsRow";
import TerminalDirectionsCard from "../../components/passenger/TerminalDirectionsCard";
import EmptyState from "../../components/common/EmptyState";
import { useAuth } from "../../context/AuthContext";
import * as api from "../../lib/api";
import { mapTrip, isSameDay } from "../../lib/format";

function greetingFor(hour) {
  if (hour < 12) return { text: "Good morning", icon: Sunrise };
  if (hour < 18) return { text: "Good afternoon", icon: Sun };
  return { text: "Good evening", icon: Moon };
}

export default function PassengerHome() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [routes, setRoutes] = useState([]);
  const [trips, setTrips] = useState([]);
  const [bookingCount, setBookingCount] = useState(null);

  useEffect(() => {
    api.getRoutes().then(setRoutes).catch(() => setRoutes([]));
    // Bookable trips only — the old count included cancelled and finished runs.
    api.getTrips({ scope: "bookable" }).then((rows) => setTrips(rows.map(mapTrip))).catch(() => setTrips([]));
  }, []);

  useEffect(() => {
    if (!user) return;
    api
      .getBookings()
      .then((rows) => setBookingCount(rows.filter((b) => ["Reserved", "Confirmed", "Boarded"].includes(b.status) && !["Completed", "Cancelled"].includes(b.trip_status)).length))
      .catch(() => {});
  }, [user]);

  const today = new Date();
  const todayLabel = today.toLocaleDateString("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const greeting = greetingFor(today.getHours());
  const GreetingIcon = greeting.icon;
  const firstName = user?.name?.trim().split(/\s+/)[0] ?? "Passenger";

  const stats = [
    { label: "Routes", value: routes.length || null, icon: Route },
    { label: "Departures Today", value: trips.filter((t) => isSameDay(t.departureIso, todayIso)).length, icon: Bus },
    { label: "Upcoming Trips", value: bookingCount, icon: Ticket },
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
    <div className="page-enter px-4 py-6 lg:px-8 lg:py-10 max-w-md mx-auto lg:max-w-5xl space-y-6">
      <header className="hero-forest rounded-3xl p-6 pb-10 lg:p-8 lg:pb-14 shadow-xl shadow-brand-forest-900/20">
        <p className="flex items-center gap-2 text-sm font-medium text-brand-sunrise-400">
          <GreetingIcon className="w-4 h-4" /> {greeting.text}
        </p>
        <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight mt-1">{firstName}, where to today?</h1>
        <p className="text-sm text-white/60 mt-1.5">{todayLabel}</p>
      </header>

      <RideModeChooser onChoose={(path) => navigate(path)} />

      <div className="space-y-6 lg:grid lg:grid-cols-[340px_1fr] lg:gap-8 lg:space-y-0 lg:items-start">
        <TripSearchPanel onSearch={handleSearch} />

        <div className="space-y-6">
          <StatsRow stats={stats} />

          <TerminalDirectionsCard />

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-semibold text-lg">
                Popular Routes
              </h2>
              <button
                type="button"
                onClick={() => navigate("/passenger/trips")}
                className="inline-flex items-center gap-1 text-sm font-medium text-brand-green-600 hover:gap-1.5 transition-all"
              >
                See all <ArrowRight className="w-3.5 h-3.5" />
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
                    className="group card card-interactive rounded-2xl text-left p-4 space-y-3"
                  >
                    <div className="flex items-stretch gap-3">
                      <RouteLine />
                      <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
                        <p className="font-medium text-sm truncate">{r.origin}</p>
                        <p className="font-medium text-sm truncate">{r.destination}</p>
                      </div>
                      {r.base_fare != null && (
                        <div className="text-right shrink-0">
                          <p className="text-[11px] text-ink-600">from</p>
                          <p className="font-display font-bold text-brand-green-600">₱{Number(r.base_fare).toLocaleString("en-PH")}</p>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs text-ink-600">
                      <span>{r.distance != null ? `${r.distance} km` : "Scheduled route"}</span>
                      <span className="inline-flex items-center gap-1 font-medium text-brand-green-600 opacity-80 group-hover:opacity-100">
                        View trips <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </div>
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

// Origin dot, dotted road, destination pin — sits beside the two stop names.
function RouteLine() {
  return (
    <span className="flex flex-col items-center py-1" aria-hidden="true">
      <span className="w-2.5 h-2.5 rounded-full border-2 border-brand-green-600 bg-white" />
      <span className="flex-1 min-h-3 border-l-2 border-dotted border-slate-300 my-1" />
      <MapPin className="w-3.5 h-3.5 text-brand-sunrise-500" />
    </span>
  );
}

// The fork between the two ride modes, shown first on Home so the
// passenger picks based on where they are right now, before seeing any
// search form. The search panel below this is the Book Ahead search —
// it isn't reused for Flag a Bus, which filters by live position instead.
const RIDE_MODES = [
  {
    path: "/passenger/trips",
    icon: CalendarClock,
    title: "Book Ahead",
    description: "Leaving from the terminal? Reserve a seat on a scheduled trip.",
    badge: "bg-brand-forest-900 text-brand-sunrise-400",
  },
  {
    path: "/passenger/flag",
    icon: Hand,
    title: "Flag a Bus Nearby",
    description: "Already on the roadside? Hail a bus that's on its way to you.",
    badge: "bg-brand-sunrise-400 text-brand-forest-950",
  },
];

function RideModeChooser({ onChoose }) {
  return (
    <section aria-label="How are you riding today?" className="grid gap-3 sm:grid-cols-2 -mt-12 lg:-mt-14 px-3 relative">
      {RIDE_MODES.map(({ path, icon: Icon, title, description, badge }) => (
        <button
          key={path}
          type="button"
          onClick={() => onChoose(path)}
          className="group card card-interactive flex items-center gap-4 text-left rounded-2xl p-4"
        >
          <span className={`w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center shadow-sm ${badge}`}>
            <Icon className="w-5 h-5" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-display font-semibold">{title}</span>
            <span className="block text-xs text-ink-600 mt-0.5">{description}</span>
          </span>
          <span className="w-8 h-8 shrink-0 rounded-full bg-slate-100 group-hover:bg-brand-green-600 group-hover:text-white text-ink-600 flex items-center justify-center transition-colors">
            <ArrowRight className="w-4 h-4" />
          </span>
        </button>
      ))}
    </section>
  );
}
