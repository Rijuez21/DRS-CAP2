export function formatTime(isoString) {
  if (!isoString) return null;
  return new Date(isoString).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}

export function formatDate(isoString) {
  if (!isoString) return null;
  return new Date(isoString).toLocaleDateString("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDuration(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const minutes = Math.round((new Date(endIso) - new Date(startIso)) / 60000);
  if (minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function isSameDay(isoString, yyyyMmDd) {
  if (!yyyyMmDd) return true;
  const d = new Date(isoString);
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return local === yyyyMmDd;
}

/** Maps a backend trip row (snake_case, base_fare, etc.) to the shape TripCard/TripDetail expect. */
// "air_conditioned" -> "Air-conditioned" etc. — raw enum values were shown
// on screen as-is before.
export function busTypeLabel(type) {
  if (!type) return null;
  return type === "air_conditioned" ? "Air-conditioned" : type === "ordinary" ? "Ordinary" : type;
}

// Today as YYYY-MM-DD in the user's local time (for <input type="date" min>).
export function todayIsoDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function mapTrip(row) {
  // Unknown (null) when the server didn't send a count — never guessed as
  // "full capacity", which is what the listing used to show for every trip.
  const seatsAvailable =
    row.capacity != null && row.booked_count != null ? Math.max(0, row.capacity - Number(row.booked_count)) : null;

  return {
    id: row.trip_id,
    origin: row.origin,
    destination: row.destination,
    departureTime: formatTime(row.departure_time),
    arrivalTime: formatTime(row.arrival_time),
    duration: formatDuration(row.departure_time, row.arrival_time),
    busModel: row.bus_type ? `${busTypeLabel(row.bus_type)} Bus` : null,
    plateNumber: row.plate_num,
    busType: busTypeLabel(row.bus_type),
    busNumber: row.bus_number ?? null,
    arrivalIso: row.arrival_time,
    totalSeats: row.capacity,
    seatsAvailable,
    fare: row.base_fare != null ? Number(row.base_fare) : null,
    status: row.status,
    distanceKm: row.distance != null ? Number(row.distance) : null,
    departureIso: row.departure_time,
    driverName: row.driver_name,
    busId: row.bus_id,
    // Where this trip's stop is on the map (the admin's pin on the route),
    // or null when it hasn't been pinned — never a guessed position.
    stop:
      row.stop_latitude != null && row.stop_longitude != null
        ? { name: row.destination, latitude: Number(row.stop_latitude), longitude: Number(row.stop_longitude) }
        : null,
  };
}

// Up to two initials for an avatar chip, e.g. "Juan dela Cruz" -> "JC".
export function initials(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

// Printable receipt number for a payment, e.g. 42 -> "OR-000042".
export function receiptNumber(paymentId) {
  return `OR-${String(paymentId ?? "").padStart(6, "0")}`;
}

// Booking reference shown to passengers and staff, e.g. DRS-2026-00125.
// Mirrors bookingReference() in server/src/services/paymentRules.js (the
// server sends it too; this is for rows that don't carry it).
export function bookingReference(bookingId, bookedAt) {
  if (bookingId == null) return "—";
  const year = bookedAt
    ? new Date(bookedAt).toLocaleString("en-US", { timeZone: "Asia/Manila", year: "numeric" })
    : new Date().getFullYear();
  return `DRS-${year}-${String(bookingId).padStart(5, "0")}`;
}

// "Oct 12, 2026, 3:05 PM"
export function formatDateTime(isoString) {
  if (!isoString) return null;
  return new Date(isoString).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

// Payment status as people say it. 'Pending' is stored for backward
// compatibility but means "under review".
export const PAYMENT_STATUS_LABELS = {
  "Awaiting Payment": "Awaiting payment",
  Pending: "Under review",
  "Needs Resubmission": "Needs resubmission",
  Verified: "Verified",
  Rejected: "Rejected",
  Escalated: "Escalated",
  "Refund Pending": "Refund pending",
  Refunded: "Refunded",
  Mixed: "Mixed",
};
export function paymentStatusLabel(status) {
  return PAYMENT_STATUS_LABELS[status] ?? status;
}

export const PAYMENT_METHOD_LABELS = { gcash: "GCash", bank_transfer: "Bank transfer", qr_ph: "QR Ph" };

// "2026-10-12T15:05" in the browser's local time, for <input type="datetime-local">.
export function toDateTimeLocal(date = new Date()) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
