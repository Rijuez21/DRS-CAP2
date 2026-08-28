// src/components/layout/PassengerLayout.jsx
import { NavLink, Outlet } from 'react-router-dom'

const links = [
  { to: 'home', label: 'Home' },
  { to: 'trips', label: 'Browse Trips' },
  { to: 'my-bookings', label: 'My Bookings' },
  { to: 'profile', label: 'Profile' },
]

export default function PassengerLayout() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 bg-blue-700 text-white p-4 space-y-2">
        <h2 className="font-bold text-lg mb-4">DRS Passenger</h2>
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) =>
              `block px-3 py-2 rounded ${isActive ? 'bg-blue-900' : 'hover:bg-blue-600'}`
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