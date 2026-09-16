// src/components/layout/DriverLayout.jsx
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import NotificationBell from '../common/NotificationBell'

const links = [
  { to: 'dashboard', label: 'Trip Dashboard' },
  { to: 'assigned-bus', label: 'Assigned Bus' },   // NEW
  { to: 'route-schedule', label: 'Route Schedule' },
  { to: 'manifest', label: 'Manifest' },
  { to: 'vehicle-checklist', label: 'Pre-Trip Checklist' },
  { to: 'issue-reports', label: 'Issue Reports' },
  { to: 'profile', label: 'Profile' },              // NEW
]

export default function DriverLayout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 bg-emerald-700 text-white p-4 space-y-2 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg">DRS Driver</h2>
          <NotificationBell recipientType="driver" recipientId={user?.id} />
        </div>
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
        <div className="flex-1" />
        {user && <p className="text-xs text-emerald-200 px-3">{user.name}</p>}
        <button
          type="button"
          onClick={() => { signOut(); navigate('/') }}
          className="text-left px-3 py-2 rounded hover:bg-emerald-600 text-sm"
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