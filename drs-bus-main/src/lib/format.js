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
  };
}
