import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import PageLoader from '../components/common/PageLoader'

// Marketing
import LandingPage from "../pages/LandingPage";
import PrivacyPolicy from "../pages/DataPolicy";
import AboutPage from "../pages/AboutPage";

// Auth
import PassengerLogin from "../pages/auth/PassengerLogin";
import StaffLogin from "../pages/auth/StaffLogin";
import AdminLogin from "../pages/auth/AdminLogin";
import OwnerLogin from "../pages/auth/OwnerLogin";
import RequireRole from "../components/auth/RequireRole";

// Layouts
import PassengerLayout from '../components/layout/PassengerLayout'
import DriverLayout from '../components/layout/DriverLayout'
import StaffLayout from '../components/layout/StaffLayout'
import AdminLayout from '../components/layout/AdminLayout'
import OwnerLayout from '../components/layout/OwnerLayout'

// Passenger pages
const PassengerHome = lazy(() => import('../pages/passenger/PassengerHome'))
const TripListings = lazy(() => import('../pages/passenger/TripListings'))
const TripDetail = lazy(() => import('../pages/passenger/TripDetail'))
const BookingConfirmed = lazy(() => import('../pages/passenger/BookingConfirmed'))
const MyBookings = lazy(() => import('../pages/passenger/MyBookings'))
const BookingDetails = lazy(() => import('../pages/passenger/BookingDetails'))
const PaymentReceipt = lazy(() => import('../pages/passenger/PaymentReceipt'))
const PaymentHistory = lazy(() => import('../pages/passenger/PaymentHistory'))   // passenger payment status tracking
const LiveTracking = lazy(() => import('../pages/passenger/LiveTracking'))
const FlagBus = lazy(() => import('../pages/passenger/FlagBus'))          // NEW — Mode 2 "Flag a Bus"; separate from the Book Ahead pages above so that flow never loads GPS/map code of its own
const Profile = lazy(() => import('../pages/passenger/Profile'))

// Driver pages
const DriverDashboard = lazy(() => import('../pages/driver/DriverDashboard'))
const AssignedBus = lazy(() => import('../pages/driver/AssignedBus'))      // NEW
const RouteSchedule = lazy(() => import('../pages/driver/RouteSchedule'))
const Manifest = lazy(() => import('../pages/driver/Manifest'))
const DriverProfile = lazy(() => import('../pages/driver/Profile'))        // NEW — named DriverProfile, not Profile, to avoid colliding with the passenger Profile import already in this file

// Staff pages
const WalkInSales = lazy(() => import('../pages/staff/WalkInSales'))
const ReservationValidation = lazy(() => import('../pages/staff/ReservationValidation'))
const PaymentReview = lazy(() => import('../pages/staff/PaymentReview'))  // Payment Verification — shared by staff and admin

// Admin pages
const AdminDashboard = lazy(() => import('../pages/admin/Dashboard'))
const FleetManagement = lazy(() => import('../pages/admin/FleetManagement'))
const FleetTracking = lazy(() => import('../pages/admin/FleetTracking'))
const GpsTracker = lazy(() => import('../pages/admin/GpsTracker'))
const RouteManagement = lazy(() => import('../pages/admin/RouteManagement'))
const DriverManagement = lazy(() => import('../pages/admin/DriverManagement'))
const TripScheduling = lazy(() => import('../pages/admin/TripScheduling'))
const ReservationsManagement = lazy(() => import('../pages/admin/ReservationsManagement'))
const ReportsAnalytics = lazy(() => import('../pages/admin/ReportsAnalytics'))
const UserManagement = lazy(() => import('../pages/admin/UserManagement'))
const PaymentSettings = lazy(() => import('../pages/admin/PaymentSettings'))
const DiscountReview = lazy(() => import('../pages/staff/DiscountReview'))
const FareDiscount = lazy(() => import('../pages/passenger/FareDiscount'))
const AccountSettings = lazy(() => import('../pages/AccountSettings'))   // "Account & Password" — every role
const Passengers = lazy(() => import('../pages/admin/Passengers'))
const ActivityLog = lazy(() => import('../pages/admin/ActivityLog'))

// Pages load on demand (React.lazy), so a phone downloads only the screens
// it opens. Inside a role's layout the sidebar stays put while a page loads
// (RoleLayout has its own Suspense); this outer one covers the rest.
export default function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
    <Routes>
      {/* Entry point: LandingPage links straight to the passenger login.
          Driver/Terminal Staff, Admin and Bus Owner have their own direct URLs below
          — no public role-picker page. /select-role redirects in case
          anything still links to the old URL. */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/privacy-policy" element={<PrivacyPolicy />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/select-role" element={<Navigate to="/login/passenger" replace />} />
      <Route path="/login/passenger" element={<PassengerLogin />} />
      <Route path="/login/driver" element={<Navigate to="/login/staff" replace />} />
      <Route path="/login/staff" element={<StaffLogin />} />
      <Route path="/login/admin" element={<AdminLogin />} />
      <Route path="/login/owner" element={<OwnerLogin />} />

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
        <Route path="my-bookings/:bookingId/receipt" element={<PaymentReceipt />} />  {/* official receipt, once staff verify the QR Ph payment */}
        <Route path="payments" element={<PaymentHistory />} />
        <Route path="tracking/:tripId" element={<LiveTracking />} />
        {/* Two ways to ride, two separate entry points:
              Book Ahead  = trips -> trips/:tripId (SeatMap) -> booking-confirmed — terminal departure, pick a seat, no map
              Flag a Bus  = flag — already on the roadside, hail an In Transit bus on a live map, no seat picker */}
        <Route path="flag" element={<FlagBus />} />                   {/* NEW */}
        <Route path="profile" element={<Profile />} />
        <Route path="discount" element={<FareDiscount />} />          {/* apply for / renew the student, PWD or senior fare discount */}
        <Route path="account" element={<AccountSettings />} />
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
        <Route path="profile" element={<DriverProfile />} />          {/* NEW */}
        <Route path="account" element={<AccountSettings />} />
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
        <Route path="payments" element={<PaymentReview />} />
        <Route path="trips" element={<TripScheduling />} />            {/* staff can add/edit schedules; cancelling stays admin-only */}
        <Route path="discounts" element={<DiscountReview />} />       {/* student / PWD / senior IDs for the 20% fare discount */}
        <Route path="tracking" element={<FleetTracking />} />          {/* same live fleet map as admin — where every bus is, so staff can tell waiting passengers */}
        <Route path="account" element={<AccountSettings />} />
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
        <Route path="gps" element={<GpsTracker />} />                 {/* SinoTrack ST-906L: connection check, live device data, playback */}
        <Route path="routes" element={<RouteManagement />} />
        <Route path="drivers" element={<DriverManagement />} />
        <Route path="trips" element={<TripScheduling />} />
        <Route path="reservations" element={<ReservationsManagement />} />
        <Route path="reports" element={<ReportsAnalytics />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="payments" element={<PaymentReview />} />
        <Route path="payment-settings" element={<PaymentSettings />} />
        <Route path="discounts" element={<DiscountReview />} />
        <Route path="passengers" element={<Passengers />} />           {/* look up, suspend, confirm email */}
        <Route path="activity" element={<ActivityLog />} />            {/* full audit log */}
        <Route path="account" element={<AccountSettings />} />
      </Route>

      {/* Bus Owner — the same live map as admin/staff, limited to the
          owner's own buses (FleetTracking reads the /owner path). */}
      <Route
        path="/owner"
        element={
          <RequireRole role="owner">
            <OwnerLayout />
          </RequireRole>
        }
      >
        <Route index element={<Navigate to="tracking" replace />} />
        <Route path="tracking" element={<FleetTracking />} />
        <Route path="account" element={<AccountSettings />} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
