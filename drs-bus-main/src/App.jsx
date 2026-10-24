import { BrowserRouter } from 'react-router-dom'
import AppRoutes from './routes/AppRoutes'
import { AuthProvider } from './context/AuthContext'
import { useReloadOnNewVersion } from './hooks/useReloadOnNewVersion'

// Picks up a new deploy in tabs that were already open (see the hook).
function VersionWatcher() {
  useReloadOnNewVersion()
  return null
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <VersionWatcher />
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
