// src/components/layout/StaffLayout.jsx
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

const links = [
  { to: 'walk-in', label: 'Walk-in Sales' },
  { to: 'validate', label: 'Validate Reservation' },
]

export default function StaffLayout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 bg-amber-700 text-white p-4 space-y-2 flex flex-col">
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
        <div className="flex-1" />
        {user && <p className="text-xs text-amber-100 px-3">{user.name}</p>}
        <button
          type="button"
          onClick={() => { signOut(); navigate('/') }}
          className="text-left px-3 py-2 rounded hover:bg-amber-600 text-sm"
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