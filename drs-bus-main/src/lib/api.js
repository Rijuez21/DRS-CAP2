// Where the backend is. Deployed builds set VITE_API_URL (e.g. the Railway
// server URL). In local development it's usually left unset: the app then
// calls its own address and the Vite dev server forwards /api and
// /socket.io to the backend (vite.config.js), so the same setup works on
// the PC, on a phone over Wi-Fi, or through a single HTTPS tunnel.
const BASE_URL = import.meta.env.VITE_API_URL || window.location.origin;

// Set by AuthContext on sign-in/sign-out/rehydrate so this plain module
// (not a React component) can still attach the Bearer token to requests
// that now require it (admin/staff writes, the fleet tracking endpoint).
let authToken = null;
export function setAuthToken(token) {
  authToken = token ?? null;
}

// Called when the server rejects our login token (expired after 12h, or
// the secret changed). AuthContext registers a handler that signs the user
// out and sends them to their login page with an explanation — before, the
// app kept looking logged in and every screen just said "Invalid or
// expired token".
let unauthorizedHandler = null;
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

/**
 * Thin fetch wrapper: builds the URL, sends JSON, and throws an Error whose
 * .message is the backend's { error } string so callers can show it
 * directly (e.g. `setError(err.message)`) without re-parsing anything.
 */
async function request(path, { method = "GET", body, params } = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    });
  }

  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    if (response.status === 401 && authToken) {
      unauthorizedHandler?.();
      throw Object.assign(new Error("Your session has expired. Please log in again."), { status: 401 });
    }
    // .status and .data let a page react to specifics (e.g. conflictSeat)
    // while err.message stays the human-readable text to show.
    throw Object.assign(new Error(data?.error || `Request failed (${response.status})`), { status: response.status, data });
  }
  return data;
}

// ---- Auth -------------------------------------------------------------
export const login = ({ email, password, role }) =>
  request("/api/auth/login", { method: "POST", body: { email, password, role } });

export const register = ({ name, email, phoneno, password }) =>
  request("/api/auth/register", { method: "POST", body: { name, email, phoneno, password } });

// ---- Routes -------------------------------------------------------------
export const getRoutes = () => request("/api/routes");

// ---- Trips -------------------------------------------------------------
export const getTrips = (params) => request("/api/trips", { params });
export const getTrip = (tripId) => request(`/api/trips/${tripId}`);
export const getSeats = (tripId) => request(`/api/trips/${tripId}/seats`);
export const updateTripStatus = (tripId, status) =>
  request(`/api/trips/${tripId}/status`, { method: "PATCH", body: { status } });

// ---- Bookings -------------------------------------------------------------
// All seats in one request, booked together or not at all (the server
// rolls back and returns 409 + data.conflictSeat if any seat was taken).
// The passenger is taken from the login token, not sent from here.
export const createBooking = ({ tripId, seatNumbers, passengerName }) =>
  request("/api/bookings", { method: "POST", body: { tripId, seatNumbers, passengerName } });

// cashReceived = the counter's payment confirmation; the server refuses a
// sale when it doesn't cover the fare.
export const createWalkInBooking = ({ tripId, passengerName, seatNumbers, cashReceived }) =>
  request("/api/bookings/walk-in", { method: "POST", body: { tripId, passengerName, seatNumbers, cashReceived } });

// Terminal staff collect the fare in cash for a Reserved online booking:
// confirms the payment and the seat (Reserved -> Confirmed) in one step.
export const confirmCounterPayment = (bookingId, cashReceived) =>
  request(`/api/bookings/${bookingId}/counter-payment`, { method: "POST", body: { cashReceived } });

export const getBookings = (params) => request("/api/bookings", { params });
export const getBooking = (bookingId) => request(`/api/bookings/${bookingId}`);
export const updateBookingStatus = (bookingId, status) =>
  request(`/api/bookings/${bookingId}/status`, { method: "PATCH", body: { status } });

// ---- Manual online payments (server/src/routes/payments.js) ----------------
// No payment gateway: passengers pay the operator's GCash / bank / QR Ph
// account in their own app, then submit proof here. A payment is only
// Verified when staff confirm the money arrived in the official account —
// never because a receipt was uploaded. Images travel as base64 data: URLs.
//
// Payment methods (instructions + account details, configured by admins)
export const getPaymentMethods = ({ all } = {}) => request("/api/payments/methods", { params: { all: all ? 1 : undefined } });
export const createPaymentMethod = (payload) => request("/api/payments/methods", { method: "POST", body: payload });
export const updatePaymentMethod = (methodId, payload) => request(`/api/payments/methods/${methodId}`, { method: "PATCH", body: payload });

// Passenger. One submission = one transfer (may cover several seats). The
// amount DUE is computed by the server; amountClaimed is what they say they sent.
export const submitPayment = ({ bookingIds, methodId, referenceNumber, amountClaimed, paidAt, receiptImage }) =>
  request("/api/payments", { method: "POST", body: { bookingIds, methodId, referenceNumber, amountClaimed, paidAt, receiptImage } });
// { booking_reference, booking_status, amount_due, payment_deadline, payment_status, can_pay, payment, history[] }
export const getBookingPayment = (bookingId) => request(`/api/payments/booking/${bookingId}`);
export const getMyPayments = () => request("/api/payments/mine");

// Receipt images are private: fetched with the login header (never a public
// URL) and shown through a short-lived object URL. Call URL.revokeObjectURL
// when done.
export async function fetchReceiptObjectUrl(submissionId) {
  let response;
  try {
    response = await fetch(`${BASE_URL}/api/payments/submissions/${submissionId}/receipt`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  if (!response.ok) {
    if (response.status === 401 && authToken) unauthorizedHandler?.();
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `Couldn't load the receipt (${response.status})`);
  }
  return URL.createObjectURL(await response.blob());
}

// Staff / admin review
export const getPaymentSummary = () => request("/api/payments/summary");
export const getPaymentQueue = (params) => request("/api/payments/queue", { params });
export const getPaymentSubmission = (submissionId) => request(`/api/payments/submissions/${submissionId}`);
export const verifySubmission = (submissionId, { amountReceived, ledgerReference, acknowledgeDuplicate, note }) =>
  request(`/api/payments/submissions/${submissionId}/verify`, {
    method: "PATCH",
    body: { fundsConfirmed: true, amountReceived, ledgerReference, acknowledgeDuplicate, note },
  });
export const rejectSubmission = (submissionId, { reason, note }) =>
  request(`/api/payments/submissions/${submissionId}/reject`, { method: "PATCH", body: { reason, note } });
export const requestResubmission = (submissionId, { reason, note }) =>
  request(`/api/payments/submissions/${submissionId}/request-resubmission`, { method: "PATCH", body: { reason, note } });
export const escalateSubmission = (submissionId, note) =>
  request(`/api/payments/submissions/${submissionId}/escalate`, { method: "PATCH", body: { note } });
export const assignSubmission = (submissionId, assign = true) =>
  request(`/api/payments/submissions/${submissionId}/assign`, { method: "PATCH", body: { assign } });
export const addSubmissionNote = (submissionId, note) =>
  request(`/api/payments/submissions/${submissionId}/notes`, { method: "POST", body: { note } });
export const requestRefund = (paymentId, { reason, cancelBooking }) =>
  request(`/api/payments/${paymentId}/refund-request`, { method: "PATCH", body: { reason, cancelBooking } });
export const confirmRefund = (paymentId, { refundReference, note }) =>
  request(`/api/payments/${paymentId}/refund-confirm`, { method: "PATCH", body: { refundReference, note } });
export const cancelRefund = (paymentId, note) => request(`/api/payments/${paymentId}/refund-cancel`, { method: "PATCH", body: { note } });

// ---- Tracking -------------------------------------------------------------
export const getLatestLocation = (busId) => request(`/api/tracking/${busId}/latest`);
export const getFleetLocations = () => request("/api/tracking/fleet/latest");
export const postLocation = (payload) => request("/api/tracking", { method: "POST", body: payload });
export const postLocationBatch = (points) => request("/api/tracking/batch", { method: "POST", body: { points } });

// ---- GPS tracker hardware (admin GpsTracker.jsx) --------------------------
export const getGpsStatus = () => request("/api/gps/status");
export const getGpsDevice = (deviceId) => request(`/api/gps/devices/${encodeURIComponent(deviceId)}`);
export const verifyGpsDevice = (deviceId) => request(`/api/gps/devices/${encodeURIComponent(deviceId)}/verify`);
export const assignGpsDevice = (deviceId, busId) =>
  request(`/api/gps/devices/${encodeURIComponent(deviceId)}/assign`, { method: "POST", body: { busId } });
export const getGpsHistory = ({ busId, from, to }) => request("/api/gps/history", { params: { busId, from, to } });

// ---- Flag a Bus (passenger Mode 2 + driver response) -------------------------------------------------------------
// Kept separate from the Bookings section above on purpose: the Book Ahead
// flow (TripDetail -> createBooking) never calls any of these.
export const getInTransitBuses = (params) => request("/api/tracking/in-transit", { params });
// Pickup = the GPS fix itself, or (pinnedManually) a spot the passenger
// tapped on the map plus the device fix it must stay close to.
export const createFlagRequest = ({ tripId, pickupLatitude, pickupLongitude, pickupAccuracy, pickupLandmark, pinnedManually, deviceLatitude, deviceLongitude, deviceAccuracy }) =>
  request("/api/bookings/flags", {
    method: "POST",
    body: { tripId, pickupLatitude, pickupLongitude, pickupAccuracy, pickupLandmark, pinnedManually, deviceLatitude, deviceLongitude, deviceAccuracy },
  });
export const updateFlagLocation = (flagId, { pickupLatitude, pickupLongitude, pickupAccuracy }) =>
  request(`/api/bookings/flags/${flagId}/location`, { method: "PATCH", body: { pickupLatitude, pickupLongitude, pickupAccuracy } });
export const getMyFlagRequests = () => request("/api/bookings/flags/mine");
export const cancelFlagRequest = (flagId) => request(`/api/bookings/flags/${flagId}/cancel`, { method: "PATCH" });
export const getTripFlagRequests = (tripId) => request("/api/bookings/flags", { params: { tripId } });
export const acknowledgeFlagRequest = (flagId) => request(`/api/bookings/flags/${flagId}/acknowledge`, { method: "PATCH" });
export const declineFlagRequest = (flagId, reason) =>
  request(`/api/bookings/flags/${flagId}/decline`, { method: "PATCH", body: { reason } });

// ---- Fleet (buses) -------------------------------------------------------------
export const getBuses = () => request("/api/buses");
export const createBus = (payload) => request("/api/buses", { method: "POST", body: payload });
export const updateBus = (busId, payload) => request(`/api/buses/${busId}`, { method: "PATCH", body: payload });
export const deleteBus = (busId) => request(`/api/buses/${busId}`, { method: "DELETE" });
export const updateBusStatus = (busId, status) =>
  request(`/api/buses/${busId}/status`, { method: "PATCH", body: { status } });

// ---- Routes (admin edits) -------------------------------------------------------------
export const getAdminRoutes = () => request("/api/routes", { params: { includeInactive: 1 } });

export const createRoute = (payload) => request("/api/routes", { method: "POST", body: payload });
export const updateRoute = (routeId, payload) => request(`/api/routes/${routeId}`, { method: "PATCH", body: payload });
export const setRouteActive = (routeId, isActive) =>
  request(`/api/routes/${routeId}/deactivate`, { method: "PATCH", body: { isActive } });

// Admin pins where a stop (a routes row) is on the map; both null clears it.
export const pinRoute = (routeId, { latitude, longitude }) =>
  request(`/api/routes/${routeId}/pin`, { method: "PATCH", body: { latitude, longitude } });

// ---- Drivers (admin) -------------------------------------------------------------
export const getDrivers = () => request("/api/drivers");
export const getDriver = (driverId) => request(`/api/drivers/${driverId}`); // NEW — also used by a driver viewing their own profile; backend should authorize when :id matches the requesting driver's own id, not just admin
export const createDriver = (payload) => request("/api/drivers", { method: "POST", body: payload });
export const updateDriver = (driverId, payload) =>
  request(`/api/drivers/${driverId}`, { method: "PATCH", body: payload });
export const deleteDriver = (driverId) => request(`/api/drivers/${driverId}`, { method: "DELETE" });

// ---- Staff / admin accounts (admin) -------------------------------------------------------------
export const getStaff = (role) => request("/api/staff", { params: { role } });
export const createStaff = (payload) => request("/api/staff", { method: "POST", body: payload });
export const updateStaff = (staffId, payload) =>
  request(`/api/staff/${staffId}`, { method: "PATCH", body: payload });
export const deleteStaff = (staffId) => request(`/api/staff/${staffId}`, { method: "DELETE" });

// ---- Trip scheduling (admin + terminal staff) -------------------------------------------------------------
export const createTrip = (payload) => request("/api/trips", { method: "POST", body: payload });
export const updateTrip = (tripId, payload) => request(`/api/trips/${tripId}`, { method: "PATCH", body: payload });
export const getManifest = (tripId) => request(`/api/trips/${tripId}/manifest`);

// ---- Reservations oversight (admin/staff) -------------------------------------------------------------
export const searchBookings = (q, tripId) => request("/api/bookings/search", { params: { q, tripId } });

// ---- Dashboard & reports (admin) -------------------------------------------------------------
export const getDashboardSummary = () => request("/api/dashboard/summary");
export const getOnTimeReport = (params) => request("/api/reports/on-time-performance", { params });
export const getFleetUtilizationReport = (params) => request("/api/reports/fleet-utilization", { params });
export const getReservationTrendsReport = (params) => request("/api/reports/reservation-trends", { params });
export const getReportExportUrl = (type, params) => {
  const url = new URL(`${BASE_URL}/api/reports/export`);
  url.searchParams.set("type", type);
  url.searchParams.set("format", "csv");
  Object.entries(params ?? {}).forEach(([k, v]) => v && url.searchParams.set(k, v));
  return url.toString();
};

// ---- Notifications -------------------------------------------------------------
export const getNotifications = (recipientType, recipientId) =>
  request("/api/notifications", { params: { recipientType, recipientId } });
export const markNotificationRead = (notificationId) =>
  request(`/api/notifications/${notificationId}/read`, { method: "PATCH" });
export const markAllNotificationsRead = (recipientType, recipientId) =>
  request("/api/notifications/read-all", { method: "PATCH", body: { recipientType, recipientId } });

// CSV export needs the admin's login header, which a plain <a href> can't
// send (so the old link always failed with 401). Fetch it, then hand the
// browser the file.
export async function downloadReportCsv(type, params) {
  const url = getReportExportUrl(type, params);
  let response;
  try {
    response = await fetch(url, { headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  if (!response.ok) {
    if (response.status === 401 && authToken) unauthorizedHandler?.();
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `Export failed (${response.status})`);
  }
  const blob = await response.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `drs-${type}-report.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

export { BASE_URL };
