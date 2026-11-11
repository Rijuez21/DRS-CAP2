// What passengers (and anyone outside the company) see of a trip's driver:
// the FIRST name only, and only from the day of travel — before then the
// assignment can still change, and a name shown days ahead reads like a
// promise. Admins, terminal staff and drivers keep the full name.
// Shown on the ticket (BookingDetails), Live Tracking and the departure
// reminder; never on the receipt (a permanent payment record).

// "Ma. Lourdes Santos" -> "Ma. Lourdes", "Boyet Marzan" -> "Boyet".
// drivers.name is one field, so the first word is the best guess; "Ma." on
// its own isn't a name.
export function driverFirstName(fullName) {
  const words = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.length > 1 && /^(ma\.?|mª)$/i.test(words[0])) return `${words[0]} ${words[1]}`;
  return words[0];
}

const manilaDate = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); // YYYY-MM-DD

// The trip's driver as a passenger may see it, or null (not yet / cancelled).
export function passengerDriverName({ driverName, departureTime, tripStatus }, now = new Date()) {
  if (!driverName || !departureTime || tripStatus === "Cancelled") return null;
  const travelDay = manilaDate(departureTime) <= manilaDate(now) || ["Boarding", "In Transit"].includes(tripStatus);
  return travelDay ? driverFirstName(driverName) : null;
}

// Roles that see the driver's full name on the shared trip endpoints.
export const SEES_FULL_DRIVER_NAME = ["admin", "staff", "driver"];

// A trip row for the public / passenger view: driver_name (full) removed,
// driver_first_name added when it may be shown.
export function publicTripRow(row) {
  const { driver_name: driverName, ...rest } = row;
  return { ...rest, driver_first_name: passengerDriverName({ driverName, departureTime: row.departure_time, tripStatus: row.status }) };
}
