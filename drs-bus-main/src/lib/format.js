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
export function mapTrip(row) {
  const seatsAvailable =
    row.capacity != null && row.booked_count != null ? row.capacity - row.booked_count : row.capacity ?? null;

  return {
    id: row.trip_id,
    origin: row.origin,
    destination: row.destination,
    departureTime: formatTime(row.departure_time),
    arrivalTime: formatTime(row.arrival_time),
    duration: formatDuration(row.departure_time, row.arrival_time),
    busModel: row.bus_type ? (row.bus_type === "air_conditioned" ? "Air-Conditioned Bus" : "Ordinary Bus") : null,
    plateNumber: row.plate_num,
    busType: row.bus_type,
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
