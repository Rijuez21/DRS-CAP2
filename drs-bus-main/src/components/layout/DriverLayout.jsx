// src/components/layout/DriverLayout.jsx
import { NavLink, Outlet } from 'react-router-dom'

const links = [
  { to: 'dashboard', label: 'Trip Dashboard' },
  { to: 'route-schedule', label: 'Route Schedule' },
  { to: 'manifest', label: 'Manifest' },
  { to: 'vehicle-checklist', label: 'Pre-Trip Checklist' },
  { to: 'issue-reports', label: 'Issue Reports' },
]

export default function DriverLayout() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 bg-emerald-700 text-white p-4 space-y-2">
        <h2 className="font-bold text-lg mb-4">DRS Driver</h2>
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) =>
              `block px-3 py-2 rounded ${isActive ? 'bg-emerald-900' : 'hover:bg-emerald-600'}`
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