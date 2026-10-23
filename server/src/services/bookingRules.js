import { busSeatLabels, matchSeatLabel, readStoredLayout } from "./seatLayout.js";

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

// Every walk-in sale points at this one placeholder commuter (bookings.js).
// It must never be a real, loginable account: if a passenger could register
// it, every walk-in ticket would land in their My Bookings. /register refuses
// it, and the placeholder is the row with an empty password_hash.
export const WALK_IN_EMAIL = "walk-in@drs.local";

// MySQL compares emails case-insensitively, so "Walk-In@DRS.local" is the
// same account — compare the same way here.
export function isReservedEmail(email) {
  return String(email ?? "").trim().toLowerCase() === WALK_IN_EMAIL;
}

// Load the trip + bus facts every sale decision needs.
export async function loadTripForSale(conn, tripId) {
  const [[trip]] = await conn.query(
    `SELECT tr.trip_id, tr.status, tr.departure_time, tr.driver_id, b.capacity, b.seat_layout, b.plate_num
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

// A bus's sellable seats: its seat layout's labels, or "1".."capacity" for
// a bus without a layout — exactly the ids SeatMap.jsx renders. `bus` is a
// row with capacity (+ seat_layout), or a plain capacity number.
const seatsOf = (bus) => (typeof bus === "number" ? busSeatLabels({ capacity: bus }) : busSeatLabels(bus));
const isLegacy = (bus) => typeof bus === "number" || readStoredLayout(bus?.seat_layout) == null;

// Normalizes " 07 " -> "7" (and "1a" -> "1A" on a labelled bus); returns
// null for a seat the bus doesn't have.
export function normalizeSeat(value, bus) {
  return matchSeatLabel(value, seatsOf(bus));
}

// Validates a whole seat request up front (so a bad seat 3 doesn't leave
// seats 1–2 half-booked). Returns { seats } or { error }.
export function parseSeatRequest(body, bus, maxSeats) {
  const raw = Array.isArray(body.seatNumbers) ? body.seatNumbers : body.seatNumber != null ? [body.seatNumber] : [];
  if (raw.length === 0) return { error: "Choose at least one seat" };
  if (raw.length > maxSeats) return { error: `You can book up to ${maxSeats} seats at a time` };
  const labels = seatsOf(bus);
  const seats = [];
  for (const value of raw) {
    const seat = matchSeatLabel(value, labels);
    if (!seat) {
      const which = isLegacy(bus) ? ` (seats 1–${labels.length})` : "";
      return { error: `Seat ${String(value).trim() || "(blank)"} doesn't exist on this bus${which}` };
    }
    if (seats.includes(seat)) return { error: `Seat ${seat} was selected twice` };
    seats.push(seat);
  }
  return { seats };
}

// The first free seat in seat-map reading order — for a flagged rider, who
// never picks one (see bookings.js). Legacy buses: the lowest number.
export function firstFreeSeat(bus, takenSeats) {
  const taken = new Set([...takenSeats].map((s) => String(s).toUpperCase()));
  return seatsOf(bus).find((label) => !taken.has(label.toUpperCase())) ?? null;
}

// Inserts one booking per seat inside a transaction: either every seat is
// booked or none are. The unique (trip_id, active_seat_number) key is still
// the real race guard — if someone else took a seat a moment ago, the whole
// request rolls back and the caller learns exactly which seat.
// paymentDeadline (optional): online seat hold — see services/paymentRules.js.
export async function insertSeatsAtomically(pool, { tripId, passengerId, passengerName, seats, status, channel, paymentDeadline = null }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const created = [];
    for (const seat of seats) {
      try {
        const [result] = await conn.query(
          `INSERT INTO bookings (trip_id, passenger_id, passenger_name, seat_number, status, channel, payment_deadline)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [tripId, passengerId, passengerName, seat, status, channel, paymentDeadline]
        );
        created.push({ booking_id: result.insertId, seat_number: seat, status, channel, payment_deadline: paymentDeadline });
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
//   staff/admin: terminal validation — Reserved/Confirmed -> Boarded/No-Show/
//              Cancelled, No-Show -> Boarded (late arrival). Reserved -> Confirmed
//              is NOT a bare status change: it only happens through a payment
//              (POST /api/bookings/:id/counter-payment for cash, or verifying
//              an online payment), so a seat is never confirmed unpaid.
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
      Reserved: ["Boarded", "No-Show", "Cancelled"],
      Confirmed: ["Boarded", "No-Show", "Cancelled"],
      Boarded: ["No-Show"],
      "No-Show": ["Boarded"],
    };
    if (from === "Reserved" && next === "Confirmed") {
      return "Confirm a reserved seat by collecting the fare (Collect fare & confirm) or by verifying its online payment";
    }
    return allowed[from]?.includes(next) ? null : `A ${from} booking can't be changed to ${next}`;
  }

  return "You don't have permission to change bookings";
}
