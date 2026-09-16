import { Routes, Route, Navigate } from 'react-router-dom'

// Marketing
import LandingPage from "../pages/LandingPage";

// Auth
import PassengerLogin from "../pages/auth/PassengerLogin";
import StaffLogin from "../pages/auth/StaffLogin";
import AdminLogin from "../pages/auth/AdminLogin";
import RequireRole from "../components/auth/RequireRole";

// Layouts
import PassengerLayout from '../components/layout/PassengerLayout'
import DriverLayout from '../components/layout/DriverLayout'
import StaffLayout from '../components/layout/StaffLayout'
import AdminLayout from '../components/layout/AdminLayout'

// Passenger pages
import PassengerHome from '../pages/passenger/PassengerHome'
import TripListings from '../pages/passenger/TripListings'
import TripDetail from '../pages/passenger/TripDetail'
import BookingConfirmed from '../pages/passenger/BookingConfirmed'
import MyBookings from '../pages/passenger/MyBookings'
import BookingDetails from '../pages/passenger/BookingDetails'
import LiveTracking from '../pages/passenger/LiveTracking'
import Profile from '../pages/passenger/Profile'

// Driver pages
import DriverDashboard from '../pages/driver/DriverDashboard'
import AssignedBus from '../pages/driver/AssignedBus'      // NEW
import RouteSchedule from '../pages/driver/RouteSchedule'
import Manifest from '../pages/driver/Manifest'
import VehicleChecklist from '../pages/driver/VehicleChecklist'
import IssueReports from '../pages/driver/IssueReports'
import DriverProfile from '../pages/driver/Profile'        // NEW — named DriverProfile, not Profile, to avoid colliding with the passenger Profile import already in this file

// Staff pages
import WalkInSales from '../pages/staff/WalkInSales'
import ReservationValidation from '../pages/staff/ReservationValidation'

// Admin pages
import AdminDashboard from '../pages/admin/Dashboard'
import FleetManagement from '../pages/admin/FleetManagement'
import FleetTracking from '../pages/admin/FleetTracking'
import RouteManagement from '../pages/admin/RouteManagement'
import DriverManagement from '../pages/admin/DriverManagement'
import TripScheduling from '../pages/admin/TripScheduling'
import ReservationsManagement from '../pages/admin/ReservationsManagement'
import MaintenanceTracking from '../pages/admin/MaintenanceTracking'
import ReportsAnalytics from '../pages/admin/ReportsAnalytics'
import UserManagement from '../pages/admin/UserManagement'

export default function AppRoutes() {
  return (
    <Routes>
      {/* Entry point: LandingPage links straight to the passenger login.
          Driver/Terminal Staff and Admin have their own direct URLs below
          — no public role-picker page. /select-role redirects in case
          anything still links to the old URL. */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/select-role" element={<Navigate to="/login/passenger" replace />} />
      <Route path="/login/passenger" element={<PassengerLogin />} />
      <Route path="/login/driver" element={<Navigate to="/login/staff" replace />} />
      <Route path="/login/staff" element={<StaffLogin />} />
      <Route path="/login/admin" element={<AdminLogin />} />

      {/* Passenger */}
      <Route
        path="/passenger"
        element={
          <RequireRole role="passenger">
            <PassengerLayout />
          </RequireRole>
        }
      >
        <Route index element={<Navigate to="home" replace />} />
        <Route path="home" element={<PassengerHome />} />
        <Route path="trips" element={<TripListings />} />
        <Route path="trips/:tripId" element={<TripDetail />} />
        <Route path="booking-confirmed" element={<BookingConfirmed />} />
        <Route path="my-bookings" element={<MyBookings />} />
        <Route path="my-bookings/:bookingId" element={<BookingDetails />} />
        <Route path="tracking/:tripId" element={<LiveTracking />} />
        <Route path="profile" element={<Profile />} />
      </Route>

      {/* Driver */}
      <Route
        path="/driver"
        element={
          <RequireRole role="driver">
            <DriverLayout />
          </RequireRole>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DriverDashboard />} />
        <Route path="assigned-bus" element={<AssignedBus />} />       {/* NEW */}
        <Route path="route-schedule" element={<RouteSchedule />} />
        <Route path="manifest" element={<Manifest />} />
        <Route path="vehicle-checklist" element={<VehicleChecklist />} />
        <Route path="issue-reports" element={<IssueReports />} />
        <Route path="profile" element={<DriverProfile />} />          {/* NEW */}
      </Route>

      {/* Terminal Staff */}
      <Route
        path="/staff"
        element={
          <RequireRole role="staff">
            <StaffLayout />
          </RequireRole>
        }
      >
        <Route index element={<Navigate to="walk-in" replace />} />
        <Route path="walk-in" element={<WalkInSales />} />
        <Route path="validate" element={<ReservationValidation />} />
      </Route>

      {/* Admin */}
      <Route
        path="/admin"
        element={
          <RequireRole role="admin">
            <AdminLayout />
          </RequireRole>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="fleet" element={<FleetManagement />} />
        <Route path="tracking" element={<FleetTracking />} />
        <Route path="routes" element={<RouteManagement />} />
        <Route path="drivers" element={<DriverManagement />} />
        <Route path="trips" element={<TripScheduling />} />
        <Route path="reservations" element={<ReservationsManagement />} />
        <Route path="maintenance" element={<MaintenanceTracking />} />
        <Route path="reports" element={<ReportsAnalytics />} />
        <Route path="users" element={<UserManagement />} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}