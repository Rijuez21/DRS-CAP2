import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireRole, authenticate } from "../middleware/auth.js";
import {
  loadTripForSale,
  whyTripNotBookable,
  parseSeatRequest,
  insertSeatsAtomically,
  whyStatusChangeNotAllowed,
} from "../services/bookingRules.js";
import { notifyRecipient } from "../services/notify.js";
import { logAudit } from "../services/audit.js";

export const bookingsRouter = Router();

// The document's Booking entity requires passenger_id (FK -> commuters),
// but a walk-in sale (WalkInSales.jsx) is entered by terminal staff for
// someone with no commuter account. Rather than making passenger_id
// nullable (which would mean relaxing the schema's FK/NOT NULL contract),
// a single shared "Walk-in Counter" commuter row acts as the placeholder
// passenger every walk-in booking points to — passenger_name on the
// booking row is still the actual rider's name for receipts/manifests.
const WALK_IN_EMAIL = "walk-in@drs.local";

async function getOrCreateWalkInPassengerId() {
  const [existing] = await pool.query(`SELECT commuter_id FROM commuters WHERE email = ?`, [WALK_IN_EMAIL]);
  if (existing.length > 0) return existing[0].commuter_id;

  const [result] = await pool.query(
    `INSERT INTO commuters (name, email, password_hash) VALUES ('Walk-in Counter', ?, '')`,
    [WALK_IN_EMAIL]
  );
  return result.insertId;
}

// Socket.io handle for the few Book Ahead writes that must push a live
// event (a passenger cancelling a flagged ride tells that bus's driver not
// to stop). Set once by index.js via attachBookingsIo(io); the router stays
// a plain export so Mode 1's mounting in index.js didn't have to change.
let bookingsIo = null;
export function attachBookingsIo(io) {
  bookingsIo = io;
}

const MAX_ONLINE_SEATS = 6; // same cap SeatMap.jsx shows passengers (maxSeats)
const MAX_WALK_IN_SEATS = 10; // staff selling for a family/group at the counter
const MAX_CASH_AMOUNT = 100000; // sanity cap on a typed "cash received" amount

// Counter (cash) payment confirmation. Staff type how much cash the
// passenger handed over; the server works out the fare itself and refuses
// anything short of it, so a ticket is never issued on an underpayment.
// Returns { cash } (a number) or { error }. Blank is allowed only when
// `required` is false (older clients that don't send it yet).
function parseCashReceived(value, { required }) {
  if (value === undefined || value === null || value === "") {
    return required ? { error: "Enter how much cash the passenger gave" } : { cash: null };
  }
  const cash = Number(value);
  if (!Number.isFinite(cash) || cash < 0 || cash > MAX_CASH_AMOUNT) {
    return { error: "Enter a valid cash amount" };
  }
  return { cash: Math.round(cash * 100) / 100 };
}

const peso = (n) => `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

// Columns every booking list returns. trip_status lets MyBookings tell a
// passenger their trip was cancelled/finished instead of showing a
// forever-"Reserved" ticket; bus/plate help staff and drivers match riders.
const BOOKING_LIST_SELECT = `
  SELECT bk.booking_id, bk.passenger_id, bk.passenger_name, bk.seat_number, bk.status, bk.channel, bk.booked_at,
         tr.trip_id, tr.departure_time, tr.arrival_time, tr.status AS trip_status, tr.driver_id,
         rt.origin, rt.destination, rt.base_fare, b.plate_num, b.bus_number
  FROM bookings bk
  JOIN trips tr ON tr.trip_id = bk.trip_id
  JOIN routes rt ON rt.route_id = tr.route_id
  JOIN buses b ON b.bus_id = tr.bus_id`;

// GET /api/bookings — MyBookings (passenger: always their own, whatever the
// query says), the driver Manifest (?tripId= of their own trip), and
// admin/staff oversight (any filters, or none = most recent 500). Before,
// this was open to anyone and ?passengerId= exposed any passenger's trips.
bookingsRouter.get("/", authenticate, async (req, res) => {
  const { channel, status, tripId } = req.query;
  let { passengerId } = req.query;

  const allowedStatus = ["Reserved", "Confirmed", "Boarded", "Cancelled", "No-Show"];
  const allowedChannel = ["online", "walk_in", "flagged"]; // "flagged" = created by a driver acknowledging a roadside hail (buildFlagRequestsRouter below)
  if (status && !allowedStatus.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowedStatus.join(", ")}` });
  }
  if (channel && !allowedChannel.includes(channel)) {
    return res.status(400).json({ error: `channel must be one of: ${allowedChannel.join(", ")}` });
  }

  try {
    if (req.user.role === "passenger") {
      passengerId = req.user.id;
    } else if (req.user.role === "driver") {
      if (!tripId) return res.status(400).json({ error: "tripId is required" });
      const [[trip]] = await pool.query(`SELECT driver_id FROM trips WHERE trip_id = ?`, [tripId]);
      if (!trip) return res.status(404).json({ error: "Trip not found" });
      if (trip.driver_id !== req.user.id) return res.status(403).json({ error: "This trip isn't assigned to you" });
    }

    const conditions = [];
    const params = [];
    if (passengerId) { conditions.push("bk.passenger_id = ?"); params.push(passengerId); }
    if (channel) { conditions.push("bk.channel = ?"); params.push(channel); }
    if (status) { conditions.push("bk.status = ?"); params.push(status); }
    if (tripId) { conditions.push("bk.trip_id = ?"); params.push(tripId); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await pool.query(
      `${BOOKING_LIST_SELECT} ${where} ORDER BY bk.booked_at DESC LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load bookings" });
  }
});

// GET /api/bookings/search?q= — ReservationValidation.jsx. Matches a
// booking code ("12", "#12") exactly, or a passenger name. BookingConfirmed
// tells passengers to "show your booking code at the terminal", so staff
// must be able to type that code — before, only names were searchable.
bookingsRouter.get("/search", requireRole("staff", "admin"), async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const { tripId } = req.query;
  if (!q) return res.status(400).json({ error: "Enter a booking code or passenger name" });

  const code = q.replace(/^#/, "");
  const conditions = [/^\d+$/.test(code) ? "(bk.booking_id = ? OR bk.passenger_name LIKE ?)" : "bk.passenger_name LIKE ?"];
  const params = /^\d+$/.test(code) ? [Number(code), `%${q}%`] : [`%${q}%`];
  if (tripId) { conditions.push("bk.trip_id = ?"); params.push(tripId); }

  try {
    const [rows] = await pool.query(
      `${BOOKING_LIST_SELECT} WHERE ${conditions.join(" AND ")} ORDER BY bk.booked_at DESC LIMIT 25`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to search bookings" });
  }
});

// GET /api/bookings/:id — BookingDetails.jsx. A passenger may only open
// their own booking (booking ids are sequential, so they were guessable).
bookingsRouter.get("/:id", authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(`${BOOKING_LIST_SELECT} WHERE bk.booking_id = ?`, [req.params.id]);
    const booking = rows[0];
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if (req.user.role === "passenger" && booking.passenger_id !== req.user.id) {
      return res.status(404).json({ error: "Booking not found" });
    }
    if (req.user.role === "driver" && booking.driver_id !== req.user.id) {
      return res.status(403).json({ error: "This booking isn't on your trip" });
    }
    res.json(booking);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load booking" });
  }
});

// POST /api/bookings — Book Ahead (TripDetail.jsx).
// body: { tripId, seatNumbers: ["3","4"], passengerName? }  (seatNumber: "3" still accepted)
// The passenger comes from the login token, never the body. All seats are
// booked together or not at all; on a conflict nothing is kept and the
// response names the seat that was just taken (409 + conflictSeat).
bookingsRouter.post("/", requireRole("passenger"), async (req, res) => {
  const { tripId } = req.body;
  if (!tripId) return res.status(400).json({ error: "tripId is required" });

  try {
    const trip = await loadTripForSale(pool, tripId);
    const notBookable = whyTripNotBookable(trip);
    if (notBookable) return res.status(trip ? 409 : 404).json({ error: notBookable });

    const parsed = parseSeatRequest(req.body, trip.capacity, MAX_ONLINE_SEATS);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const [[commuter]] = await pool.query(`SELECT name FROM commuters WHERE commuter_id = ?`, [req.user.id]);
    if (!commuter) return res.status(404).json({ error: "Passenger account not found" });
    const passengerName = String(req.body.passengerName ?? "").trim().slice(0, 150) || commuter.name;

    const result = await insertSeatsAtomically(pool, {
      tripId, passengerId: req.user.id, passengerName, seats: parsed.seats, status: "Reserved", channel: "online",
    });
    if (result.conflictSeat) {
      return res.status(409).json({
        error: `Seat ${result.conflictSeat} was just taken by someone else. Nothing was booked — please pick another seat.`,
        conflictSeat: result.conflictSeat,
      });
    }
    res.status(201).json({ tripId: Number(tripId), passengerName, bookings: result.created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create booking" });
  }
});

// POST /api/bookings/walk-in — WalkInSales.jsx (terminal staff).
// body: { tripId, passengerName, seatNumbers: [...], cashReceived }. Same
// all-or-nothing rule as online booking; walk-ins are paid at the counter,
// so Confirmed. cashReceived is the payment confirmation: the sale only
// goes through if it covers the fare, and the amount + change are recorded
// in the audit log so the counter's cash can be reconciled later.
bookingsRouter.post("/walk-in", requireRole("staff", "admin"), async (req, res) => {
  const { tripId } = req.body;
  const passengerName = String(req.body.passengerName ?? "").trim().slice(0, 150);
  if (!tripId || !passengerName) return res.status(400).json({ error: "Choose a trip and enter the passenger's name" });
  const payment = parseCashReceived(req.body.cashReceived, { required: false });
  if (payment.error) return res.status(400).json({ error: payment.error });

  try {
    const trip = await loadTripForSale(pool, tripId);
    const notBookable = whyTripNotBookable(trip);
    if (notBookable) return res.status(trip ? 409 : 404).json({ error: notBookable });

    const parsed = parseSeatRequest(req.body, trip.capacity, MAX_WALK_IN_SEATS);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const [[fareRow]] = await pool.query(
      `SELECT rt.base_fare FROM trips tr JOIN routes rt ON rt.route_id = tr.route_id WHERE tr.trip_id = ?`,
      [tripId]
    );
    const fare = fareRow?.base_fare != null ? Number(fareRow.base_fare) : null;
    const total = fare != null ? fare * parsed.seats.length : null;
    if (payment.cash != null && total != null && payment.cash < total) {
      return res.status(400).json({ error: `Cash received (${peso(payment.cash)}) is less than the total fare (${peso(total)}). Nothing was sold.` });
    }

    const passengerId = await getOrCreateWalkInPassengerId();
    const result = await insertSeatsAtomically(pool, {
      tripId, passengerId, passengerName, seats: parsed.seats, status: "Confirmed", channel: "walk_in",
    });
    if (result.conflictSeat) {
      return res.status(409).json({
        error: `Seat ${result.conflictSeat} was just sold elsewhere. Nothing was sold — pick another seat.`,
        conflictSeat: result.conflictSeat,
      });
    }
    const change = payment.cash != null && total != null ? Math.round((payment.cash - total) * 100) / 100 : null;
    await logAudit({
      staffId: req.user.id,
      action: "walk_in_sale",
      entityType: "booking",
      entityId: result.created[0]?.booking_id,
      details: {
        tripId: Number(tripId),
        passengerName,
        bookingIds: result.created.map((b) => b.booking_id),
        seats: parsed.seats,
        method: "cash",
        total,
        cashReceived: payment.cash,
        change,
      },
    });
    res.status(201).json({
      tripId: Number(tripId),
      passengerName,
      bookings: result.created,
      payment: { method: "cash", total, cashReceived: payment.cash, change },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create walk-in booking" });
  }
});

// POST /api/bookings/:id/counter-payment — ReservationValidation.jsx.
// body: { cashReceived }. An online passenger who didn't pay by QR pays the
// fare in cash at the terminal: staff confirm the cash, and the booking
// moves Reserved -> Confirmed in the same step (the passenger is notified).
// Refused while a QR payment for the booking is still waiting for review,
// so nobody is charged twice — verify or reject that one first.
bookingsRouter.post("/:id/counter-payment", requireRole("staff", "admin"), async (req, res) => {
  const payment = parseCashReceived(req.body.cashReceived, { required: true });
  if (payment.error) return res.status(400).json({ error: payment.error });

  const conn = await pool.getConnection();
  let booking;
  let change;
  try {
    await conn.beginTransaction();
    // FOR UPDATE: serializes against a passenger cancelling, or another
    // staff member verifying a QR payment for the same booking.
    [[booking]] = await conn.query(
      `SELECT bk.booking_id, bk.passenger_id, bk.passenger_name, bk.status, bk.seat_number, bk.channel,
              tr.trip_id, tr.status AS trip_status, tr.driver_id, rt.base_fare
       FROM bookings bk
       JOIN trips tr ON tr.trip_id = bk.trip_id
       JOIN routes rt ON rt.route_id = tr.route_id
       WHERE bk.booking_id = ?
       FOR UPDATE`,
      [req.params.id]
    );
    if (!booking) {
      await conn.rollback();
      return res.status(404).json({ error: "Booking not found" });
    }
    if (booking.status !== "Reserved") {
      await conn.rollback();
      return res.status(409).json({ error: `Booking #${booking.booking_id} is ${booking.status} — there's no payment to collect.` });
    }
    if (["Completed", "Cancelled"].includes(booking.trip_status)) {
      await conn.rollback();
      return res.status(409).json({ error: `This trip is ${booking.trip_status.toLowerCase()} — don't collect a fare for it.` });
    }
    const refusal = whyStatusChangeNotAllowed({ user: req.user, booking, trip: { status: booking.trip_status, driver_id: booking.driver_id }, next: "Confirmed" });
    if (refusal) {
      await conn.rollback();
      return res.status(409).json({ error: refusal });
    }
    if (booking.base_fare == null) {
      await conn.rollback();
      return res.status(409).json({ error: "This route has no fare on file yet — set it in Route Management first." });
    }
    const fare = Number(booking.base_fare);
    if (payment.cash < fare) {
      await conn.rollback();
      return res.status(400).json({ error: `Cash received (${peso(payment.cash)}) is less than the fare (${peso(fare)}).` });
    }

    const [[pendingQr]] = await conn.query(
      `SELECT payment_id, reference_number FROM payments WHERE booking_id = ? AND status = 'Pending' LIMIT 1`,
      [booking.booking_id]
    );
    if (pendingQr) {
      await conn.rollback();
      return res.status(409).json({
        error: `An online payment (ref ${pendingQr.reference_number}) for this booking is still waiting for review. Verify or reject it in Online Payments first so the passenger isn't charged twice.`,
      });
    }

    const [result] = await conn.query(
      `UPDATE bookings SET status = 'Confirmed' WHERE booking_id = ? AND status = 'Reserved'`,
      [booking.booking_id]
    );
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(409).json({ error: "This booking was just updated by someone else. Refresh to see its current status." });
    }
    await conn.commit();
    booking.fare = fare;
    change = Math.round((payment.cash - fare) * 100) / 100;
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error(err);
    return res.status(500).json({ error: "Failed to confirm the payment" });
  } finally {
    conn.release();
  }

  // Side effects only after the commit (both non-fatal).
  await logAudit({
    staffId: req.user.id,
    action: "counter_payment",
    entityType: "booking",
    entityId: booking.booking_id,
    details: { method: "cash", fare: booking.fare, cashReceived: payment.cash, change, seat: booking.seat_number },
  });
  if (booking.channel === "online") {
    await notifyRecipient(
      bookingsIo,
      { type: "passenger", id: booking.passenger_id },
      `Payment of ${peso(booking.fare)} received at the terminal — booking #${booking.booking_id} (seat ${booking.seat_number}) is confirmed.`,
      "payment_verified"
    );
  }

  res.json({
    booking_id: booking.booking_id,
    status: "Confirmed",
    payment: { method: "cash", fare: booking.fare, cashReceived: payment.cash, change },
  });
});

// PATCH /api/bookings/:id/status — passenger cancel (BookingDetails), driver
// Boarded/No-Show (Manifest), staff validation, admin oversight. Who may make
// which change lives in whyStatusChangeNotAllowed (services/bookingRules.js).
bookingsRouter.patch("/:id/status", authenticate, async (req, res) => {
  const { status: next } = req.body;
  const allowed = ["Reserved", "Confirmed", "Boarded", "Cancelled", "No-Show"];
  if (!allowed.includes(next)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
  }

  try {
    const [[booking]] = await pool.query(
      `SELECT booking_id, passenger_id, trip_id, status, seat_number FROM bookings WHERE booking_id = ?`,
      [req.params.id]
    );
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    // Someone else's booking looks exactly like a missing one — no status leak.
    if (req.user.role === "passenger" && booking.passenger_id !== req.user.id) {
      return res.status(404).json({ error: "Booking not found" });
    }
    const [[trip]] = await pool.query(`SELECT status, driver_id FROM trips WHERE trip_id = ?`, [booking.trip_id]);

    const refusal = whyStatusChangeNotAllowed({ user: req.user, booking, trip, next });
    if (refusal) return res.status(409).json({ error: refusal });

    try {
      const [result] = await pool.query(`UPDATE bookings SET status = ? WHERE booking_id = ? AND status = ?`, [next, booking.booking_id, booking.status]);
      // Someone else changed it between our read and this write — e.g. staff
      // verified a QR payment (Reserved -> Confirmed) while the passenger was
      // cancelling. Say so instead of reporting a change that didn't happen.
      if (result.affectedRows === 0) {
        return res.status(409).json({ error: "This booking was just updated by someone else. Refresh to see its current status." });
      }
    } catch (err) {
      // No-Show -> Boarded re-takes the seat; someone may have bought it since.
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: `Seat ${booking.seat_number} has been given to someone else since. Seat this passenger elsewhere.` });
      }
      throw err;
    }

    // A flagged ride cancelled from BookingDetails: close its flag too and
    // tell the driver not to stop (before, the driver kept a stale pickup).
    if (next === "Cancelled") {
      const [[flag]] = await pool.query(
        `SELECT fr.flag_id, fr.passenger_name, tr.driver_id FROM flag_requests fr JOIN trips tr ON tr.trip_id = fr.trip_id
         WHERE fr.booking_id = ? AND fr.status = 'Acknowledged'`,
        [booking.booking_id]
      );
      if (flag) {
        await pool.query(`UPDATE flag_requests SET status = 'Cancelled' WHERE flag_id = ?`, [flag.flag_id]);
        emitFlagUpdate(bookingsIo, await loadFlag(flag.flag_id)); // same full payload the Flag UIs always get
        await notifyRecipient(bookingsIo, { type: "driver", id: flag.driver_id }, `${flag.passenger_name} cancelled their flagged ride — no need to stop.`, "flag_cancelled");
      }
    }

    res.json({ booking_id: booking.booking_id, status: next });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update booking" });
  }
});

// ============================================================================
// Flag a Bus (passenger Mode 2) — /api/bookings/flags
// ============================================================================
// Everything above is the terminal "Book Ahead" flow (and walk-in sales) and
// is intentionally untouched by this section. A flag request is a roadside
// hail for a bus that is already In Transit: no seat is picked, and it isn't
// a booking until the driver says they'll stop — see the flag_requests
// comment in schema.sql for why it doesn't go straight into `bookings`.
//
// Lifecycle:
//   Pending ──driver acknowledges──> Acknowledged (+ bookings row, channel 'flagged', status 'Confirmed')
//      │                                  └─> Boarded / No-Show via the normal manifest (bookings lifecycle)
//      ├──driver declines──> Declined (with a reason the passenger sees)
//      ├──passenger cancels─> Cancelled
//      └──sweeper──> Expired (nobody responded within FLAG_TTL_MINUTES, or the trip left 'In Transit')
//
// Socket.io events (all pushed to the rooms NotificationBell already joins
// via "subscribe:notifications", so no new subscribe handler is needed in
// index.js):
//   "flag:new"      -> driver:<driverId>              a passenger just hailed this driver's bus
//   "flag:updated"  -> driver:<id> and passenger:<id>  any status change (ack/decline/cancel/expire)
// Payload for both is the same row shape GET /flags returns (FLAG_SELECT).
// "flag:updated" also fires when an open flag's pickup pin moves
// (PATCH /:id/location), so the driver's map link always points at the
// passenger's current position.

// A hail is a "right now" signal — a passenger standing at KM 42 for 15
// minutes with no response has almost certainly caught something else or
// given up, so the driver shouldn't still be told to stop for them.
const FLAG_TTL_MINUTES = 15;
const FLAG_SWEEP_INTERVAL_MS = 60 * 1000;

// The stop has to be where the passenger actually is, so the pickup point
// is always the phone's own GPS fix — never a typed description alone.
// Browsers report each fix's accuracy radius in metres; above this, the
// fix is a Wi-Fi/cell-tower estimate (typical indoors or on a laptop),
// which on a switchback road can put the pin on the wrong bend entirely.
// 100 m is loose enough for a phone outdoors in the Cordillera to meet
// within seconds, tight enough that the driver stops at the right spot.
const MAX_PICKUP_ACCURACY_M = 100;
// A GPS fix can still land on the wrong side of the road, and indoors or on
// a laptop it may never get under 100 m at all. So the passenger can also
// drop the pin by hand on the map — but only inside the area their device
// says they're in: the fix's accuracy radius plus this margin, capped at
// MANUAL_PIN_MAX_DISTANCE_M. The device fix itself is still required, so a
// pin can't be dropped somewhere the passenger obviously isn't.
// Mirrored in FlagBus.jsx (display only; this is the authoritative check).
const MANUAL_PIN_MARGIN_M = 100;
const MANUAL_PIN_MAX_DISTANCE_M = 5000;

function distanceMetres(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function manualPinLimitMetres(deviceAccuracy) {
  return Math.min(Math.max(deviceAccuracy, MAX_PICKUP_ACCURACY_M) + MANUAL_PIN_MARGIN_M, MANUAL_PIN_MAX_DISTANCE_M);
}

const FLAG_SELECT = `
  SELECT fr.flag_id, fr.trip_id, fr.passenger_id, fr.passenger_name,
         fr.pickup_latitude, fr.pickup_longitude, fr.pickup_landmark,
         fr.status, fr.decline_reason, fr.booking_id, fr.requested_at, fr.responded_at,
         bk.seat_number, bk.status AS booking_status,
         tr.driver_id, tr.status AS trip_status,
         b.bus_id, b.plate_num, b.bus_number, rt.origin, rt.destination
  FROM flag_requests fr
  JOIN trips tr ON tr.trip_id = fr.trip_id
  JOIN buses b ON b.bus_id = tr.bus_id
  JOIN routes rt ON rt.route_id = tr.route_id
  LEFT JOIN bookings bk ON bk.booking_id = fr.booking_id`;

async function loadFlag(flagId, conn = pool) {
  const [rows] = await conn.query(`${FLAG_SELECT} WHERE fr.flag_id = ?`, [flagId]);
  return rows[0] ?? null;
}

// Both sides always get the same payload, so the passenger's FlagBus page
// and the driver's FlagRequestsPanel never disagree about a flag's state.
function emitFlagUpdate(io, flag) {
  if (!flag) return;
  io?.to(`passenger:${flag.passenger_id}`).emit("flag:updated", flag);
  io?.to(`driver:${flag.driver_id}`).emit("flag:updated", flag);
}

// Same "live booking" rule as trips.js's booked_count and /:id/seats
// (anything not Cancelled/No-Show holds a seat), so a flag can never be
// accepted onto a bus the terminal would also consider full.
async function getTripOccupancy(conn, tripId) {
  const [[trip]] = await conn.query(
    `SELECT tr.trip_id, tr.status, tr.driver_id, b.capacity, b.plate_num
     FROM trips tr JOIN buses b ON b.bus_id = tr.bus_id
     WHERE tr.trip_id = ?`,
    [tripId]
  );
  if (!trip) return null;
  const [taken] = await conn.query(
    `SELECT seat_number FROM bookings WHERE trip_id = ? AND status NOT IN ('Cancelled', 'No-Show')`,
    [tripId]
  );
  return { ...trip, takenSeats: new Set(taken.map((r) => String(r.seat_number))) };
}

// A flagged rider never picks a seat, but bookings.seat_number is NOT NULL
// and is what the (trip_id, active_seat_number) lock protects. Rather than
// relaxing that column (which would ripple into SeatMap, the manifest and
// every "Seat N" label in the Book Ahead flow), the server assigns the
// lowest free seat number. It's nominal — the conductor seats them wherever
// is free — but it keeps the seat count and the seat lock honest.
function lowestFreeSeat(capacity, takenSeats) {
  for (let n = 1; n <= capacity; n += 1) {
    if (!takenSeats.has(String(n))) return String(n);
  }
  return null;
}

function parseCoordinate(value, limit) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : NaN;
}

// Shared by POST / (the hail) and PATCH /:id/location (the pin following
// the passenger), so both enforce the same "exact location" rule.
// Returns { latitude, longitude } or { error }.
//
// Two ways to set the pin:
//   GPS    { pickupLatitude, pickupLongitude, pickupAccuracy }  — the fix itself, ±100 m or better
//   Manual { pickupLatitude, pickupLongitude, pinnedManually: true,
//            deviceLatitude, deviceLongitude, deviceAccuracy }  — a point the passenger tapped,
//            accepted only within the device fix's accuracy area (see manualPinLimitMetres)
function parsePickupFix(body) {
  const { pickupLatitude, pickupLongitude, pickupAccuracy, pinnedManually } = body;
  const latitude = parseCoordinate(pickupLatitude, 90);
  const longitude = parseCoordinate(pickupLongitude, 180);
  if (latitude == null || longitude == null) {
    return { error: "Your GPS location is required — the driver stops exactly where you are. Turn on location for this site and try again." };
  }
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    return { error: "pickupLatitude and pickupLongitude must be a valid coordinate pair" };
  }

  if (pinnedManually === true) {
    const deviceLatitude = parseCoordinate(body.deviceLatitude, 90);
    const deviceLongitude = parseCoordinate(body.deviceLongitude, 180);
    const deviceAccuracy = Number(body.deviceAccuracy);
    if (deviceLatitude == null || deviceLongitude == null || Number.isNaN(deviceLatitude) || Number.isNaN(deviceLongitude)) {
      return { error: "Your device's location is still needed when you place the pin yourself. Turn on location for this site and try again." };
    }
    if (!Number.isFinite(deviceAccuracy) || deviceAccuracy <= 0) {
      return { error: "deviceAccuracy (metres) is required with a manually placed pin" };
    }
    const limit = manualPinLimitMetres(deviceAccuracy);
    const off = distanceMetres({ latitude, longitude }, { latitude: deviceLatitude, longitude: deviceLongitude });
    if (off > limit) {
      return {
        error: `Your pin is ${Math.round(off)} m from where your device says you are (limit ${Math.round(limit)} m). Place it where you're actually standing.`,
      };
    }
    return { latitude, longitude };
  }

  const accuracy = Number(pickupAccuracy);
  if (!Number.isFinite(accuracy) || accuracy <= 0) {
    return { error: "pickupAccuracy (metres, from the phone's GPS) is required" };
  }
  if (accuracy > MAX_PICKUP_ACCURACY_M) {
    return {
      error: `Your location isn't precise enough yet (±${Math.round(accuracy)} m, needs ±${MAX_PICKUP_ACCURACY_M} m or better). Step into the open for a few seconds and try again.`,
    };
  }
  return { latitude, longitude };
}

async function expireStaleFlags(io) {
  try {
    const [rows] = await pool.query(
      `SELECT fr.flag_id FROM flag_requests fr
       JOIN trips tr ON tr.trip_id = fr.trip_id
       WHERE fr.status = 'Pending'
         AND (fr.requested_at < NOW() - INTERVAL ? MINUTE OR tr.status <> 'In Transit')`,
      [FLAG_TTL_MINUTES]
    );
    if (rows.length === 0) return;

    const ids = rows.map((r) => r.flag_id);
    await pool.query(
      `UPDATE flag_requests SET status = 'Expired', responded_at = NOW()
       WHERE flag_id IN (?) AND status = 'Pending'`,
      [ids]
    );
    for (const id of ids) emitFlagUpdate(io, await loadFlag(id));
  } catch (err) {
    console.error("Flag expiry sweep failed (non-fatal):", err.message);
  }
}

// Wrapped in a builder like buildTripsRouter/buildTrackingRouter because
// every write here has to push a Socket.io event through the io instance
// index.js creates. Mounted at /api/bookings/flags AHEAD of bookingsRouter
// in index.js, otherwise GET /api/bookings/flags would be swallowed by
// bookingsRouter's GET /:id and answered with "Booking not found".
export function buildFlagRequestsRouter(io) {
  const flagsRouter = Router();

  // Expiry runs on a timer rather than lazily on the next request, so a
  // passenger watching FlagBus.jsx sees "Expired" at roughly the right time
  // even if nobody else touches the flags endpoints. unref() so this
  // interval alone never keeps the Node process alive.
  setInterval(() => expireStaleFlags(io), FLAG_SWEEP_INTERVAL_MS).unref?.();

  // POST /api/bookings/flags — passenger hails an in-transit bus.
  // body: { tripId, pickupLatitude, pickupLongitude, pickupAccuracy, pickupLandmark? }
  // The pickup point is the passenger's own GPS fix and is required (see
  // MAX_PICKUP_ACCURACY_M). pickupLandmark is only an optional note to help
  // the driver spot them ("yellow umbrella by the waiting shed") — it never
  // stands in for coordinates. passengerId comes from the JWT, not the
  // body, since a hail makes a real driver pull over on a mountain road.
  flagsRouter.post("/", requireRole("passenger"), async (req, res) => {
    const { tripId, pickupLandmark } = req.body;
    const landmark = typeof pickupLandmark === "string" ? pickupLandmark.trim().slice(0, 150) : "";

    if (!tripId) return res.status(400).json({ error: "tripId is required" });
    const fix = parsePickupFix(req.body);
    if (fix.error) return res.status(400).json({ error: fix.error });
    const { latitude, longitude } = fix;

    try {
      const [[commuter]] = await pool.query(`SELECT name FROM commuters WHERE commuter_id = ?`, [req.user.id]);
      if (!commuter) return res.status(404).json({ error: "Passenger account not found" });

      const trip = await getTripOccupancy(pool, tripId);
      if (!trip) return res.status(404).json({ error: "Trip not found" });
      if (trip.status !== "In Transit") {
        return res.status(409).json({
          error: "This bus isn't on the road right now. Flagging is only for buses already in transit — use Book Ahead to reserve a seat on a scheduled departure.",
        });
      }
      if (trip.capacity == null) {
        return res.status(409).json({ error: "This bus's seating capacity isn't on file yet, so it can't take flag requests" });
      }
      if (trip.takenSeats.size >= trip.capacity) {
        return res.status(409).json({ error: "This bus is already full" });
      }

      const [result] = await pool.query(
        `INSERT INTO flag_requests (trip_id, passenger_id, passenger_name, pickup_latitude, pickup_longitude, pickup_landmark)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [tripId, req.user.id, commuter.name, latitude, longitude, landmark || null]
      );
      const flag = await loadFlag(result.insertId);

      io?.to(`driver:${flag.driver_id}`).emit("flag:new", flag);
      await notifyRecipient(
        io,
        { type: "driver", id: flag.driver_id },
        `Flag request: ${flag.passenger_name} is waiting at a pinned roadside location${landmark ? ` (${landmark})` : ""}. Open your dashboard to respond.`,
        "flag_request"
      );

      res.status(201).json(flag);
    } catch (err) {
      // one_pending_flag_per_passenger (schema.sql) — the DB is the source
      // of truth here, same as the seat lock on POST /api/bookings.
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "You already have an open flag request. Cancel it before flagging another bus." });
      }
      console.error(err);
      res.status(500).json({ error: "Failed to send flag request" });
    }
  });

  // GET /api/bookings/flags/mine — passenger's recent flags, newest first.
  // Lets FlagBus.jsx restore an open hail after a refresh or app switch
  // instead of the passenger losing track of whether the driver answered.
  flagsRouter.get("/mine", requireRole("passenger"), async (req, res) => {
    try {
      const [rows] = await pool.query(
        `${FLAG_SELECT} WHERE fr.passenger_id = ? ORDER BY fr.requested_at DESC, fr.flag_id DESC LIMIT 5`,
        [req.user.id]
      );
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load flag requests" });
    }
  });

  // GET /api/bookings/flags?tripId= — driver's pickup list for one trip:
  // every Pending hail plus Acknowledged ones whose rider hasn't boarded
  // yet (booking still 'Confirmed'), i.e. "people I still need to stop
  // for". Restricted to the driver actually assigned to that trip.
  flagsRouter.get("/", requireRole("driver"), async (req, res) => {
    const { tripId } = req.query;
    if (!tripId) return res.status(400).json({ error: "tripId is required" });

    try {
      const [[trip]] = await pool.query(`SELECT driver_id FROM trips WHERE trip_id = ?`, [tripId]);
      if (!trip) return res.status(404).json({ error: "Trip not found" });
      if (trip.driver_id !== req.user.id) return res.status(403).json({ error: "This trip isn't assigned to you" });

      const [rows] = await pool.query(
        `${FLAG_SELECT}
         WHERE fr.trip_id = ?
           AND (fr.status = 'Pending' OR (fr.status = 'Acknowledged' AND bk.status = 'Confirmed'))
         ORDER BY fr.requested_at ASC, fr.flag_id ASC`,
        [tripId]
      );
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load flag requests" });
    }
  });

  // PATCH /api/bookings/flags/:id/location — keeps the pickup pin on the
  // passenger while the hail is open. If they walk after flagging (to a
  // wider shoulder, out of the rain), the driver's pin moves with them, so
  // the stop is where they are now, not where they were when they tapped.
  // Same accuracy rule as the hail; a poor fix is rejected rather than
  // replacing a good pin with a worse one. FlagBus.jsx throttles these
  // (only after real movement), and no bell notification is written —
  // that would spam the driver; the live "flag:updated" is enough.
  flagsRouter.patch("/:id/location", requireRole("passenger"), async (req, res) => {
    const fix = parsePickupFix(req.body);
    if (fix.error) return res.status(400).json({ error: fix.error });

    try {
      const existing = await loadFlag(req.params.id);
      if (!existing) return res.status(404).json({ error: "Flag request not found" });
      if (existing.passenger_id !== req.user.id) return res.status(403).json({ error: "This isn't your flag request" });

      const [result] = await pool.query(
        `UPDATE flag_requests fr
         LEFT JOIN bookings bk ON bk.booking_id = fr.booking_id
         SET fr.pickup_latitude = ?, fr.pickup_longitude = ?
         WHERE fr.flag_id = ?
           AND (fr.status = 'Pending' OR (fr.status = 'Acknowledged' AND bk.status = 'Confirmed'))`,
        [fix.latitude, fix.longitude, req.params.id]
      );
      if (result.affectedRows === 0) {
        return res.status(409).json({ error: "This flag request is no longer open" });
      }

      const flag = await loadFlag(req.params.id);
      emitFlagUpdate(io, flag);
      res.json(flag);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update pickup location" });
    }
  });

  // PATCH /api/bookings/flags/:id/acknowledge — driver commits to stopping.
  // This is the moment the hail becomes a real booking. Runs in a
  // transaction with the flag + trip rows locked (FOR UPDATE), so two
  // acknowledgements on the same trip can't both take the last seat —
  // the capacity re-check and the seat assignment happen under that lock.
  flagsRouter.patch("/:id/acknowledge", requireRole("driver"), async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [[locked]] = await conn.query(
        `SELECT fr.flag_id, fr.trip_id, fr.passenger_id, fr.passenger_name, fr.status,
                tr.driver_id, tr.status AS trip_status
         FROM flag_requests fr JOIN trips tr ON tr.trip_id = fr.trip_id
         WHERE fr.flag_id = ? FOR UPDATE`,
        [req.params.id]
      );
      if (!locked) {
        await conn.rollback();
        return res.status(404).json({ error: "Flag request not found" });
      }
      if (locked.driver_id !== req.user.id) {
        await conn.rollback();
        return res.status(403).json({ error: "This flag request isn't for your bus" });
      }
      if (locked.status !== "Pending") {
        await conn.rollback();
        return res.status(409).json({ error: `This flag request was already ${locked.status.toLowerCase()}` });
      }
      if (locked.trip_status !== "In Transit") {
        await conn.rollback();
        return res.status(409).json({ error: "This trip is no longer in transit" });
      }

      const trip = await getTripOccupancy(conn, locked.trip_id);
      const seat = trip.capacity == null ? null : lowestFreeSeat(trip.capacity, trip.takenSeats);

      if (!seat) {
        // Bus filled up between the hail and the driver's response — close
        // the flag out as Declined so the passenger knows to wait for the
        // next bus rather than watching a Pending that can never succeed.
        await conn.query(
          `UPDATE flag_requests SET status = 'Declined', decline_reason = 'Bus filled up before pickup', responded_at = NOW()
           WHERE flag_id = ?`,
          [locked.flag_id]
        );
        await conn.commit();
        const flag = await loadFlag(locked.flag_id);
        emitFlagUpdate(io, flag);
        await notifyRecipient(io, { type: "passenger", id: flag.passenger_id }, `Bus ${flag.plate_num} filled up before it reached you. Please wait for the next bus.`, "flag_declined");
        return res.status(409).json({ error: "The bus is full — this flag request was declined automatically", flag });
      }

      const [bookingResult] = await conn.query(
        `INSERT INTO bookings (trip_id, passenger_id, passenger_name, seat_number, status, channel)
         VALUES (?, ?, ?, ?, 'Confirmed', 'flagged')`,
        [locked.trip_id, locked.passenger_id, locked.passenger_name, seat]
      );
      await conn.query(
        `UPDATE flag_requests SET status = 'Acknowledged', booking_id = ?, responded_at = NOW() WHERE flag_id = ?`,
        [bookingResult.insertId, locked.flag_id]
      );
      await conn.commit();

      const flag = await loadFlag(locked.flag_id);
      emitFlagUpdate(io, flag);
      await notifyRecipient(
        io,
        { type: "passenger", id: flag.passenger_id },
        `Bus ${flag.plate_num} is stopping for you. Seat ${flag.seat_number} is held — pay the conductor on board.`,
        "flag_acknowledged"
      );
      res.json(flag);
    } catch (err) {
      await conn.rollback().catch(() => {});
      // A terminal Book Ahead booking (which doesn't take the trip lock)
      // grabbed the same seat number in the same instant — the seat lock
      // caught it; the driver can simply tap Acknowledge again.
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "Seat assignment collided with another booking — please try again" });
      }
      console.error(err);
      res.status(500).json({ error: "Failed to acknowledge flag request" });
    } finally {
      conn.release();
    }
  });

  // PATCH /api/bookings/flags/:id/decline — driver can't stop (full,
  // unsafe spot, already passed them). body: { reason? } — shown to the
  // passenger so a decline tells them what to do next.
  flagsRouter.patch("/:id/decline", requireRole("driver"), async (req, res) => {
    const reason = typeof req.body?.reason === "string" && req.body.reason.trim()
      ? req.body.reason.trim().slice(0, 150)
      : "Driver couldn't stop";

    try {
      const existing = await loadFlag(req.params.id);
      if (!existing) return res.status(404).json({ error: "Flag request not found" });
      if (existing.driver_id !== req.user.id) return res.status(403).json({ error: "This flag request isn't for your bus" });

      const [result] = await pool.query(
        `UPDATE flag_requests SET status = 'Declined', decline_reason = ?, responded_at = NOW()
         WHERE flag_id = ? AND status = 'Pending'`,
        [reason, req.params.id]
      );
      if (result.affectedRows === 0) {
        return res.status(409).json({ error: `This flag request was already ${existing.status.toLowerCase()}` });
      }

      const flag = await loadFlag(req.params.id);
      emitFlagUpdate(io, flag);
      await notifyRecipient(io, { type: "passenger", id: flag.passenger_id }, `Bus ${flag.plate_num} can't stop for you: ${reason}.`, "flag_declined");
      res.json(flag);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to decline flag request" });
    }
  });

  // PATCH /api/bookings/flags/:id/cancel — passenger no longer needs the
  // ride. Allowed while Pending, and also after Acknowledged as long as
  // they haven't boarded — in that case the linked booking is cancelled
  // too, freeing the seat and telling the driver not to stop.
  flagsRouter.patch("/:id/cancel", requireRole("passenger"), async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[locked]] = await conn.query(
        `SELECT fr.flag_id, fr.passenger_id, fr.status, fr.booking_id, bk.status AS booking_status
         FROM flag_requests fr LEFT JOIN bookings bk ON bk.booking_id = fr.booking_id
         WHERE fr.flag_id = ? FOR UPDATE`,
        [req.params.id]
      );
      if (!locked) {
        await conn.rollback();
        return res.status(404).json({ error: "Flag request not found" });
      }
      if (locked.passenger_id !== req.user.id) {
        await conn.rollback();
        return res.status(403).json({ error: "This isn't your flag request" });
      }
      const cancellable =
        locked.status === "Pending" || (locked.status === "Acknowledged" && locked.booking_status === "Confirmed");
      if (!cancellable) {
        await conn.rollback();
        return res.status(409).json({ error: `This flag request can't be cancelled (it's ${locked.status.toLowerCase()})` });
      }

      if (locked.booking_id) {
        await conn.query(`UPDATE bookings SET status = 'Cancelled' WHERE booking_id = ?`, [locked.booking_id]);
      }
      await conn.query(
        `UPDATE flag_requests SET status = 'Cancelled', responded_at = COALESCE(responded_at, NOW()) WHERE flag_id = ?`,
        [locked.flag_id]
      );
      await conn.commit();

      const flag = await loadFlag(locked.flag_id);
      emitFlagUpdate(io, flag);
      await notifyRecipient(io, { type: "driver", id: flag.driver_id }, `${flag.passenger_name} cancelled their flag request — no need to stop.`, "flag_cancelled");
      res.json(flag);
    } catch (err) {
      await conn.rollback().catch(() => {});
      console.error(err);
      res.status(500).json({ error: "Failed to cancel flag request" });
    } finally {
      conn.release();
    }
  });

  return flagsRouter;
}