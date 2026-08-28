// src/components/layout/AdminLayout.jsx
import { NavLink, Outlet } from 'react-router-dom'

const links = [
  { to: 'dashboard', label: 'Dashboard' },
  { to: 'fleet', label: 'Fleet Management' },
  { to: 'routes', label: 'Route Management' },
  { to: 'drivers', label: 'Driver Management' },
  { to: 'trips', label: 'Trip Scheduling' },
  { to: 'reservations', label: 'Reservations' },
  { to: 'maintenance', label: 'Maintenance' },
  { to: 'users', label: 'User Management' },
]

export default function AdminLayout() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 bg-slate-800 text-white p-4 space-y-1 overflow-y-auto">
        <h2 className="font-bold text-lg mb-4">DRS Admin</h2>
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) =>
              `block px-3 py-2 rounded text-sm ${isActive ? 'bg-slate-950' : 'hover:bg-slate-700'}`
            }
          >
            {l.label}
          </NavLink>
        ))}
      </aside>
      <main className="flex-1 bg-gray-50">
        <Outlet />
      </main>
    </div>
  )
}