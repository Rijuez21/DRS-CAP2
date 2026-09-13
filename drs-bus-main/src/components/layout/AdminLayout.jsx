// src/components/layout/AdminLayout.jsx
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

const links = [
  { to: 'dashboard', label: 'Dashboard' },
  { to: 'fleet', label: 'Fleet Management' },
  { to: 'tracking', label: 'Live Tracking' },
  { to: 'routes', label: 'Route Management' },
  { to: 'drivers', label: 'Driver Management' },
  { to: 'trips', label: 'Trip Scheduling' },
  { to: 'reservations', label: 'Reservations' },
  { to: 'maintenance', label: 'Maintenance' },
  { to: 'reports', label: 'Reports & Analytics' },
  { to: 'users', label: 'User Management' },
]

export default function AdminLayout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 bg-slate-800 text-white p-4 space-y-1 overflow-y-auto flex flex-col">
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
        <div className="flex-1" />
        {user && <p className="text-xs text-slate-400 px-3">{user.name}</p>}
        <button
          type="button"
          onClick={() => { signOut(); navigate('/') }}
          className="text-left px-3 py-2 rounded hover:bg-slate-700 text-sm"
        >
          Log Out
        </button>
      </aside>
      <main className="flex-1 bg-gray-50">
        <Outlet />
      </main>
    </div>
  )
}