import { BrowserRouter, useLocation } from 'react-router-dom'
import AppRoutes from './routes/AppRoutes'
import { AuthProvider } from './context/AuthContext'
import { useReloadOnNewVersion } from './hooks/useReloadOnNewVersion'
import ErrorBoundary from './components/common/ErrorBoundary'

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
    <ErrorBoundary resetKey={pathname}>
      <AppRoutes />
    </ErrorBoundary>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <VersionWatcher />
        <GuardedRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
