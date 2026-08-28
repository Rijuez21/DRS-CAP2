// src/components/layout/StaffLayout.jsx
import { NavLink, Outlet } from 'react-router-dom'

const links = [
  { to: 'walk-in', label: 'Walk-in Sales' },
  { to: 'validate', label: 'Validate Reservation' },
]

export default function StaffLayout() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 bg-amber-700 text-white p-4 space-y-2">
        <h2 className="font-bold text-lg mb-4">DRS Terminal Staff</h2>
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) =>
              `block px-3 py-2 rounded ${isActive ? 'bg-amber-900' : 'hover:bg-amber-600'}`
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