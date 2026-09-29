import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Menu, X, LogOut } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import NotificationBell from "../common/NotificationBell";

// One responsive shell for every role (passenger, driver, staff, admin).
// Before, only the passenger layout adapted to phones: the driver, staff and
// admin layouts kept a permanent 180–224 px sidebar, leaving 166–210 px for
// the actual page on a 390 px phone (admin even scrolled sideways) — and the
// passenger's mobile "Open menu" button had no action at all.
//
//   desktop (lg+): the sidebar each role already had, in its own colours
//   phone:         top bar (title, bell, working menu drawer with every
//                  link + name + Log Out) and a bottom tab bar with the
//                  role's everyday pages (links marked `tab: true`)
//
// theme keeps each role's existing colour scheme rather than restyling it.
export default function RoleLayout({ title, links, theme, bell }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuFor, setMenuFor] = useState(null); // pathname the drawer was opened on
  // Navigating anywhere closes the drawer: it's only "open" for the page
  // it was opened on (no effect needed to reset it).
  const menuOpen = menuFor === location.pathname;
  const tabs = links.filter((l) => l.tab);

  function handleLogout() {
    signOut();
    navigate("/");
  }

  const bellEl = bell && user ? <NotificationBell recipientType={bell} recipientId={user.id} /> : null;
  const sideLink = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${isActive ? theme.activeLink : theme.idleLink}`;

  const linkList = (
    <>
      {links.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} className={sideLink}>
          {Icon && <Icon className="w-4 h-4 shrink-0" />}
          {label}
        </NavLink>
      ))}
    </>
  );
  const footer = (
    <div className="pt-4 mt-auto space-y-1">
      {user && <p className={`text-xs px-3 truncate ${theme.muted}`}>{user.name}</p>}
      <button type="button" onClick={handleLogout} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium ${theme.idleLink}`}>
        <LogOut className="w-4 h-4" /> Log Out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-surface lg:flex">
      {/* Desktop sidebar */}
      <aside className={`hidden lg:flex lg:flex-col lg:w-60 lg:shrink-0 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto ${theme.sidebar} text-white p-5 space-y-1`}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display font-bold text-lg">{title}</h2>
          {bellEl}
        </div>
        {linkList}
        {footer}
      </aside>

      <div className="flex-1 min-w-0">
        {/* Phone top bar */}
        <header className={`lg:hidden sticky top-0 z-30 flex items-center justify-between ${theme.sidebar} text-white px-4 py-3.5`}>
          <h1 className="font-display font-bold">{title}</h1>
          <div className="flex items-center gap-2">
            {bellEl}
            <button type="button" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuFor(location.pathname)} className="p-1">
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Phone menu drawer — every page, plus Log Out */}
        {menuOpen && (
          <div className="lg:hidden fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Menu">
            <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setMenuFor(null)} />
            <nav className={`absolute right-0 top-0 h-full w-72 max-w-[85%] ${theme.sidebar} text-white p-5 flex flex-col space-y-1 overflow-y-auto`}>
              <div className="flex items-center justify-between mb-4">
                <span className="font-display font-bold">{title}</span>
                <button type="button" aria-label="Close menu" onClick={() => setMenuFor(null)} className="p-1">
                  <X className="w-5 h-5" />
                </button>
              </div>
              {linkList}
              {footer}
            </nav>
          </div>
        )}

        <main className={tabs.length ? "pb-20 lg:pb-0" : ""}>
          <Outlet />
        </main>

        {/* Phone bottom tabs — the pages this role uses every day */}
        {tabs.length > 0 && (
          <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-slate-100 flex" aria-label="Main">
            {tabs.map(({ to, label, short, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex-1 min-w-0 flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${isActive ? theme.tabActive : "text-ink-600"}`
                }
              >
                {Icon && <Icon className="w-5 h-5" />}
                <span className="truncate max-w-full px-1">{short ?? label}</span>
              </NavLink>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
