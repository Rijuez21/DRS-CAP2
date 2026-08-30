import { Routes, Route, Navigate } from 'react-router-dom'

// Auth
import RoleSelect from "../pages/auth/RoleSelect";
import PassengerLogin from "../pages/auth/PassengerLogin";
import DriverLogin from "../pages/auth/DriverLogin";
import AdminLogin from "../pages/auth/AdminLogin";

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
import RouteSchedule from '../pages/driver/RouteSchedule'
import Manifest from '../pages/driver/Manifest'
import VehicleChecklist from '../pages/driver/VehicleChecklist'
import IssueReports from '../pages/driver/IssueReports'

// Staff pages
import WalkInSales from '../pages/staff/WalkInSales'
import ReservationValidation from '../pages/staff/ReservationValidation'

// Admin pages
import AdminDashboard from '../pages/admin/Dashboard'
import FleetManagement from '../pages/admin/FleetManagement'
import RouteManagement from '../pages/admin/RouteManagement'
import DriverManagement from '../pages/admin/DriverManagement'
import TripScheduling from '../pages/admin/TripScheduling'
import ReservationsManagement from '../pages/admin/ReservationsManagement'
import MaintenanceTracking from '../pages/admin/MaintenanceTracking'
import UserManagement from '../pages/admin/UserManagement'

export default function AppRoutes() {
  return (
    <Routes>
      {/* Entry point: choose a role, then log in as that role */}
      <Route path="/" element={<RoleSelect />} />
      <Route path="/login/passenger" element={<PassengerLogin />} />
      <Route path="/login/driver" element={<DriverLogin />} />
      <Route path="/login/admin" element={<AdminLogin />} />

      {/* Passenger */}
      <Route path="/passenger" element={<PassengerLayout />}>
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
      <Route path="/driver" element={<DriverLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DriverDashboard />} />
        <Route path="route-schedule" element={<RouteSchedule />} />
        <Route path="manifest" element={<Manifest />} />
        <Route path="vehicle-checklist" element={<VehicleChecklist />} />
        <Route path="issue-reports" element={<IssueReports />} />
      </Route>

      {/* Terminal Staff */}
      <Route path="/staff" element={<StaffLayout />}>
        <Route index element={<Navigate to="walk-in" replace />} />
        <Route path="walk-in" element={<WalkInSales />} />
        <Route path="validate" element={<ReservationValidation />} />
      </Route>

      {/* Admin */}
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="fleet" element={<FleetManagement />} />
        <Route path="routes" element={<RouteManagement />} />
        <Route path="drivers" element={<DriverManagement />} />
        <Route path="trips" element={<TripScheduling />} />
        <Route path="reservations" element={<ReservationsManagement />} />
        <Route path="maintenance" element={<MaintenanceTracking />} />
        <Route path="users" element={<UserManagement />} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}