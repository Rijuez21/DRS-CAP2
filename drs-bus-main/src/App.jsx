import { createBrowserRouter, RouterProvider, useLocation } from 'react-router-dom'
import AppRoutes from './routes/AppRoutes'
import { AuthProvider } from './context/AuthContext'
import { useReloadOnNewVersion } from './hooks/useReloadOnNewVersion'
import ErrorBoundary from './components/common/ErrorBoundary'
import IdleSignOut from './components/auth/IdleSignOut'

// Picks up a new deploy in tabs that were already open (see the hook).
function VersionWatcher() {
  useReloadOnNewVersion()
  return null
}

// A crash on one page shows a Reload screen instead of a blank app;
// navigating to another page clears it.
function GuardedRoutes() {
  const { pathname } = useLocation()
  return (
    <>
      <VersionWatcher />
      <ErrorBoundary resetKey={pathname}>
        <AppRoutes />
      </ErrorBoundary>
    </>
  )
}

// A data router (instead of <BrowserRouter>) so pages can use useBlocker —
// the Book Ahead payment step asks before the back button abandons unpaid
// seats (BookingConfirmed.jsx). The routes themselves still live in
// AppRoutes' <Routes>, under this one catch-all.
const router = createBrowserRouter([{ path: '*', element: <GuardedRoutes /> }])

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
      <IdleSignOut />
    </AuthProvider>
  )
}
