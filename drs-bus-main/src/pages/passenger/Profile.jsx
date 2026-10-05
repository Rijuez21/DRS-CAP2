import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogOut, Mail, Ticket, TicketCheck, CircleX, CalendarClock, Hand, ChevronRight } from "lucide-react";
import StatsRow from "../../components/passenger/StatsRow";
import { useAuth } from "../../context/AuthContext";
import * as api from "../../lib/api";
import { initials } from "../../lib/format";

const SHORTCUTS = [
  { to: "/passenger/my-bookings", icon: Ticket, label: "My Bookings", hint: "Reserved seats and flagged rides" },
  { to: "/passenger/trips", icon: CalendarClock, label: "Book Ahead", hint: "Reserve a seat on a scheduled trip" },
  { to: "/passenger/flag", icon: Hand, label: "Flag a Bus", hint: "Hail a bus that's on its way to you" },
];

export default function Profile() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState([]);
  const [loaded, setLoaded] = useState(false); // show real zeros once loaded, "—" only while loading

  useEffect(() => {
    if (!user) return;
    api
      .getBookings()
      .then((rows) => {
        setBookings(rows);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [user]);

  const stats = [
    { label: "Trips booked", value: loaded ? bookings.length : null, icon: Ticket },
    { label: "Travelled", value: loaded ? bookings.filter((b) => b.status === "Boarded").length : null, icon: TicketCheck },
    { label: "Cancelled", value: loaded ? bookings.filter((b) => b.status === "Cancelled").length : null, icon: CircleX },
  ];

  function handleLogout() {
    signOut();
    navigate("/");
  }

  return (
    <div className="page-enter max-w-md mx-auto px-4 py-6 lg:py-10 space-y-5">
      <div className="card overflow-hidden">
        <div className="hero-forest h-24" aria-hidden="true" />
        {/* relative: lifts the avatar above the banner (.hero-forest is its own stacking context) */}
        <div className="relative flex flex-col items-center text-center gap-1.5 px-5 pb-6 -mt-10">
          <span className="w-20 h-20 rounded-full bg-brand-sunrise-400 text-brand-forest-950 ring-4 ring-white shadow-lg flex items-center justify-center font-display text-2xl font-bold">
            {initials(user?.name ?? "Passenger")}
          </span>
          <h1 className="font-display text-xl font-bold mt-1.5">{user?.name ?? "Passenger"}</h1>
          {user?.email && (
            <p className="flex items-center gap-1.5 text-sm text-ink-600">
              <Mail className="w-3.5 h-3.5" /> {user.email}
            </p>
          )}
          <span className="mt-1 rounded-full bg-brand-green-500/12 text-brand-green-600 px-3 py-0.5 text-xs font-semibold">Passenger</span>
        </div>
      </div>

      <StatsRow stats={stats} />

      <nav className="card divide-y divide-slate-100 overflow-hidden" aria-label="Shortcuts">
        {SHORTCUTS.map(({ to, icon: Icon, label, hint }) => (
          <Link key={to} to={to} className="group flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 transition-colors">
            <span className="w-9 h-9 shrink-0 rounded-xl bg-brand-forest-900 text-brand-sunrise-400 flex items-center justify-center">
              <Icon className="w-4 h-4" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold">{label}</span>
              <span className="block text-xs text-ink-600 truncate">{hint}</span>
            </span>
            <ChevronRight className="w-4 h-4 text-ink-600 transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </nav>

      <button
        type="button"
        onClick={handleLogout}
        className="w-full flex items-center justify-center gap-2 bg-white border border-slate-200 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 transition-colors font-display font-semibold rounded-xl py-3"
      >
        <LogOut className="w-4 h-4" /> Log Out
      </button>
    </div>
  );
}
