// Single source of truth for "can this seat be sold?" and "who may move a
// booking from status A to status B?". Before this, each route (online
// booking, walk-in sales, validation, manifest) trusted whatever the client
// sent: seats on Completed trips, seat "999" or "banana", Cancelled bookings
// revived onto a seat someone else had since bought. Every booking write now
// goes through these checks.

// A seat can only be sold while the bus hasn't left: Scheduled (before
// departure time) or Boarding (passengers are getting on at the terminal).
// In Transit riders come through Flag a Bus instead (flag_requests).
export const BOOKABLE_TRIP_STATUSES = ["Scheduled", "Boarding"];

// Booking statuses that hold a seat — same rule as trips.js booked_count,
// /api/trips/:id/seats and the active_seat_number lock in schema.sql.
export const SEAT_HOLDING_STATUSES = ["Reserved", "Confirmed", "Boarded"];

// Load the trip + bus facts every sale decision needs.
export async function loadTripForSale(conn, tripId) {
  const [[trip]] = await conn.query(
    `SELECT tr.trip_id, tr.status, tr.departure_time, tr.driver_id, b.capacity, b.plate_num
     FROM trips tr JOIN buses b ON b.bus_id = tr.bus_id
     WHERE tr.trip_id = ?`,
    [tripId]
  );
  return trip ?? null;
}

// Returns an error string (human-readable, shown as-is in the UI) or null.
export function whyTripNotBookable(trip) {
  if (!trip) return "Trip not found";
  if (trip.status === "Cancelled") return "This trip has been cancelled";
  if (trip.status === "Completed") return "This trip has already finished";
  if (trip.status === "In Transit") return "This bus has already left the terminal. Use Flag a Bus to catch it on the road.";
  if (!BOOKABLE_TRIP_STATUSES.includes(trip.status)) return "This trip isn't open for booking";
  if (trip.status === "Scheduled" && new Date(trip.departure_time) <= new Date()) {
    return "This trip's departure time has passed";
  }
  if (trip.capacity == null) return "This bus's seating capacity isn't on file yet, so seats can't be sold";
  return null;
}

// Seats are the integers "1".."capacity" — exactly the ids SeatMap.jsx
// renders. Normalizes " 07 " -> "7"; returns null for anything else.
export function normalizeSeat(value, capacity) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= capacity ? String(n) : null;
}

// Validates a whole seat request up front (so a bad seat 3 doesn't leave
// seats 1–2 half-booked). Returns { seats } or { error }.
export function parseSeatRequest(body, capacity, maxSeats) {
  const raw = Array.isArray(body.seatNumbers) ? body.seatNumbers : body.seatNumber != null ? [body.seatNumber] : [];
  if (raw.length === 0) return { error: "Choose at least one seat" };
  if (raw.length > maxSeats) return { error: `You can book up to ${maxSeats} seats at a time` };
  const seats = [];
  for (const value of raw) {
    const seat = normalizeSeat(value, capacity);
    if (!seat) return { error: `Seat ${String(value).trim() || "(blank)"} doesn't exist on this bus (seats 1–${capacity})` };
    if (seats.includes(seat)) return { error: `Seat ${seat} was selected twice` };
    seats.push(seat);
  }
  return { seats };
}

// Inserts one booking per seat inside a transaction: either every seat is
// booked or none are. The unique (trip_id, active_seat_number) key is still
// the real race guard — if someone else took a seat a moment ago, the whole
// request rolls back and the caller learns exactly which seat.
export async function insertSeatsAtomically(pool, { tripId, passengerId, passengerName, seats, status, channel }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const created = [];
    for (const seat of seats) {
      try {
        const [result] = await conn.query(
          `INSERT INTO bookings (trip_id, passenger_id, passenger_name, seat_number, status, channel)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [tripId, passengerId, passengerName, seat, status, channel]
        );
        created.push({ booking_id: result.insertId, seat_number: seat, status, channel });
      } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
          await conn.rollback();
          return { conflictSeat: seat };
        }
        throw err;
      }
    }
    await conn.commit();
    return { created };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

// Who may change a booking's status, and to what. Cancelled is terminal: a
// cancelled seat may already be resold, so "reviving" it is never allowed —
// book again instead. Returns an error string or null.
//   passenger: own booking, Reserved/Confirmed -> Cancelled, before the bus leaves
//   driver:    own trip, Reserved/Confirmed -> Boarded/No-Show, and fix a
//              mis-tap between Boarded and No-Show
//   staff/admin: terminal validation — Reserved -> Confirmed, Reserved/
//              Confirmed -> Boarded/No-Show/Cancelled, No-Show -> Boarded (late arrival)
export function whyStatusChangeNotAllowed({ user, booking, trip, next }) {
  const from = booking.status;
  if (from === next) return `This booking is already ${next}`;
  if (from === "Cancelled") return "This booking was cancelled and can't be changed. Book a new seat instead.";

  if (user.role === "passenger") {
    if (booking.passenger_id !== user.id) return "This isn't your booking";
    if (next !== "Cancelled") return "You can only cancel your own booking";
    if (!["Reserved", "Confirmed"].includes(from)) return `A ${from} booking can't be cancelled`;
    if (!BOOKABLE_TRIP_STATUSES.includes(trip.status)) return "The bus has already left — this booking can no longer be cancelled";
    return null;
  }

  if (user.role === "driver") {
    if (trip.driver_id !== user.id) return "This booking isn't on your trip";
    const allowed = {
      Reserved: ["Boarded", "No-Show"],
      Confirmed: ["Boarded", "No-Show"],
      Boarded: ["No-Show"],
      "No-Show": ["Boarded"],
    };
    return allowed[from]?.includes(next) ? null : `Drivers can't change a ${from} booking to ${next}`;
  }

  if (user.role === "staff" || user.role === "admin") {
    const allowed = {
      Reserved: ["Confirmed", "Boarded", "No-Show", "Cancelled"],
      Confirmed: ["Boarded", "No-Show", "Cancelled"],
      Boarded: ["No-Show"],
      "No-Show": ["Boarded"],
    };
    return allowed[from]?.includes(next) ? null : `A ${from} booking can't be changed to ${next}`;
  }

  return "You don't have permission to change bookings";
}
