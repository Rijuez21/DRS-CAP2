import { NavLink, Outlet } from "react-router-dom";
import { Home, Bus, Ticket, User, Menu } from "lucide-react";

const links = [
  { to: "home", label: "Home", icon: Home },
  { to: "trips", label: "Trips", icon: Bus },
  { to: "my-bookings", label: "Bookings", icon: Ticket },
  { to: "profile", label: "Profile", icon: User },
];

export default function PassengerLayout() {
  return (
    <div className="min-h-screen bg-surface lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:shrink-0 bg-brand-forest-900 text-white p-5 space-y-1">
        <h2 className="font-display font-bold text-lg mb-6">D&apos; Rising Sun</h2>
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive
                  ? "bg-white/10 text-white"
                  : "text-white/70 hover:bg-white/5 hover:text-white"
              }`
            }
          >
            <Icon className="w-4 h-4" />
            {label}
          </NavLink>
        ))}
      </aside>

      <div className="flex-1 min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-20 flex items-center justify-between bg-brand-forest-900 text-white px-4 py-3.5">
          <h1 className="font-display font-bold">D&apos; Rising Sun</h1>
          <button type="button" aria-label="Open menu">
            <Menu className="w-5 h-5" />
          </button>
        </header>

        <main className="pb-20 lg:pb-0">
          <Outlet />
        </main>

        {/* Mobile bottom tab bar */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-slate-100 flex">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium ${
                  isActive ? "text-brand-green-600" : "text-ink-600"
                }`
              }
            >
              <Icon className="w-5 h-5" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}