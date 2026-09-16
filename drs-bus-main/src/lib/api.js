const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

// Set by AuthContext on sign-in/sign-out/rehydrate so this plain module
// (not a React component) can still attach the Bearer token to requests
// that now require it (admin/staff writes, the fleet tracking endpoint).
let authToken = null;
export function setAuthToken(token) {
  authToken = token ?? null;
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
    throw new Error(data?.error || `Request failed (${response.status})`);
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
export const createBooking = ({ tripId, passengerId, passengerName, seatNumber }) =>
  request("/api/bookings", { method: "POST", body: { tripId, passengerId, passengerName, seatNumber } });

export const createWalkInBooking = ({ tripId, passengerName, seatNumber }) =>
  request("/api/bookings/walk-in", { method: "POST", body: { tripId, passengerName, seatNumber } });

export const getBookings = (params) => request("/api/bookings", { params });
export const getBooking = (bookingId) => request(`/api/bookings/${bookingId}`);
export const updateBookingStatus = (bookingId, status) =>
  request(`/api/bookings/${bookingId}/status`, { method: "PATCH", body: { status } });

// ---- Tracking -------------------------------------------------------------
export const getLatestLocation = (busId) => request(`/api/tracking/${busId}/latest`);
export const getFleetLocations = () => request("/api/tracking/fleet/latest");
export const postLocation = (payload) => request("/api/tracking", { method: "POST", body: payload });
export const postLocationBatch = (points) => request("/api/tracking/batch", { method: "POST", body: { points } });

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

// ---- Maintenance (admin) -------------------------------------------------------------
export const getMaintenance = () => request("/api/maintenance");
export const createMaintenance = (payload) => request("/api/maintenance", { method: "POST", body: payload });
export const updateMaintenance = (maintenanceId, payload) =>
  request(`/api/maintenance/${maintenanceId}`, { method: "PATCH", body: payload });

// ---- Trip scheduling (admin) -------------------------------------------------------------
export const createTrip = (payload) => request("/api/trips", { method: "POST", body: payload });
export const updateTrip = (tripId, payload) => request(`/api/trips/${tripId}`, { method: "PATCH", body: payload });
export const getManifest = (tripId) => request(`/api/trips/${tripId}/manifest`);

// ---- Reservations oversight (admin/staff) -------------------------------------------------------------
export const searchBookings = (q, tripId) => request("/api/bookings/search", { params: { q, tripId } });

// ---- Dashboard & reports (admin) -------------------------------------------------------------
export const getDashboardSummary = () => request("/api/dashboard/summary");
export const getOnTimeReport = (params) => request("/api/reports/on-time-performance", { params });
export const getFleetUtilizationReport = (params) => request("/api/reports/fleet-utilization", { params });
export const getMaintenanceCostReport = (params) => request("/api/reports/maintenance-costs", { params });
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

// ---- Vehicle checklists -------------------------------------------------------------
export const getChecklist = (tripId) => request("/api/checklists", { params: { tripId } });
export const submitChecklist = (payload) => request("/api/checklists", { method: "POST", body: payload });

// ---- Issue reports -------------------------------------------------------------
export const getIssues = (driverId) => request("/api/issues", { params: { driverId } });
export const submitIssue = (payload) => request("/api/issues", { method: "POST", body: payload });

export { BASE_URL };
