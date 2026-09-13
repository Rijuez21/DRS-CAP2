import { Router } from "express";
import { pool } from "../db/pool.js";

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

// GET /api/bookings — powers MyBookings.jsx (?passengerId=) and
// admin/ReservationsManagement.jsx (?channel=&status=, no passengerId —
// oversight view across every passenger). At least one filter is required
// so this never accidentally returns the whole bookings table unscoped.
bookingsRouter.get("/", async (req, res) => {
  const { passengerId, channel, status, tripId } = req.query;
  if (!passengerId && !channel && !status && !tripId) {
    return res.status(400).json({ error: "At least one of passengerId, channel, status or tripId is required" });
  }

  const allowedStatus = ["Reserved", "Confirmed", "Boarded", "Cancelled", "No-Show"];
  const allowedChannel = ["online", "walk_in"];
  if (status && !allowedStatus.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowedStatus.join(", ")}` });
  }
  if (channel && !allowedChannel.includes(channel)) {
    return res.status(400).json({ error: `channel must be one of: ${allowedChannel.join(", ")}` });
  }

  const conditions = [];
  const params = [];
  if (passengerId) { conditions.push("bk.passenger_id = ?"); params.push(passengerId); }
  if (channel) { conditions.push("bk.channel = ?"); params.push(channel); }
  if (status) { conditions.push("bk.status = ?"); params.push(status); }
  if (tripId) { conditions.push("bk.trip_id = ?"); params.push(tripId); }

  try {
    const [rows] = await pool.query(
      `SELECT bk.booking_id, bk.passenger_name, bk.seat_number, bk.status, bk.channel, bk.booked_at,
              tr.trip_id, tr.departure_time, rt.origin, rt.destination
       FROM bookings bk
       JOIN trips tr ON tr.trip_id = bk.trip_id
       JOIN routes rt ON rt.route_id = tr.route_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY bk.booked_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load bookings" });
  }
});

// GET /api/bookings/search?q=&tripId= — powers staff/ReservationValidation.jsx's
// counter lookup. There's no separate booking "code" in the schema, so this
// matches on passenger name (case-insensitive, partial) — optionally scoped
// to one trip since that's how a counter clerk actually works (this trip's
// manifest, find this passenger).
bookingsRouter.get("/search", async (req, res) => {
  const { q, tripId } = req.query;
  if (!q) return res.status(400).json({ error: "q (passenger name) is required" });

  const conditions = ["bk.passenger_name LIKE ?"];
  const params = [`%${q}%`];
  if (tripId) { conditions.push("bk.trip_id = ?"); params.push(tripId); }

  try {
    const [rows] = await pool.query(
      `SELECT bk.booking_id, bk.passenger_name, bk.seat_number, bk.status, bk.channel,
              tr.trip_id, tr.departure_time, rt.origin, rt.destination
       FROM bookings bk
       JOIN trips tr ON tr.trip_id = bk.trip_id
       JOIN routes rt ON rt.route_id = tr.route_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY bk.booked_at DESC
       LIMIT 25`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to search bookings" });
  }
});

// GET /api/bookings/:id — powers BookingDetails.jsx / BookingConfirmed.jsx
bookingsRouter.get("/:id", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT bk.booking_id, bk.passenger_name, bk.seat_number, bk.status, bk.booked_at,
              tr.trip_id, tr.departure_time, rt.origin, rt.destination, rt.base_fare
       FROM bookings bk
       JOIN trips tr ON tr.trip_id = bk.trip_id
       JOIN routes rt ON rt.route_id = tr.route_id
       WHERE bk.booking_id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Booking not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load booking" });
  }
});

// POST /api/bookings — powers the seat selection -> booking confirmation flow.
// Status starts at 'Reserved', matching the document's Booking status enum
// (Reserved, Confirmed, Boarded, Cancelled, No-Show) — terminal staff or
// payment-on-boarding is what later moves it to 'Confirmed'/'Boarded'.
bookingsRouter.post("/", async (req, res) => {
  const { tripId, passengerId, passengerName, seatNumber } = req.body;
  if (!tripId || !passengerId || !passengerName || !seatNumber) {
    return res.status(400).json({ error: "tripId, passengerId, passengerName and seatNumber are required" });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO bookings (trip_id, passenger_id, passenger_name, seat_number, status)
       VALUES (?, ?, ?, ?, 'Reserved')`,
      [tripId, passengerId, passengerName, seatNumber]
    );
    res.status(201).json({
      booking_id: result.insertId,
      tripId,
      passengerId,
      passengerName,
      seatNumber,
      status: "Reserved",
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "That seat is already booked for this trip" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create booking" });
  }
});

// POST /api/bookings/walk-in — powers WalkInSales.jsx (createWalkInBooking
// in api.js). Same seat-uniqueness guarantee as the online path (the
// trip_id + active_seat_number unique key in schema.sql), just entered by
// terminal staff at the counter instead of a passenger account, so there's
// no passengerId in the request body — channel = 'walk_in' records that.
bookingsRouter.post("/walk-in", async (req, res) => {
  const { tripId, passengerName, seatNumber } = req.body;
  if (!tripId || !passengerName || !seatNumber) {
    return res.status(400).json({ error: "tripId, passengerName and seatNumber are required" });
  }

  try {
    const passengerId = await getOrCreateWalkInPassengerId();
    const [result] = await pool.query(
      `INSERT INTO bookings (trip_id, passenger_id, passenger_name, seat_number, status, channel)
       VALUES (?, ?, ?, ?, 'Confirmed', 'walk_in')`,
      [tripId, passengerId, passengerName, seatNumber]
    );
    res.status(201).json({
      booking_id: result.insertId,
      tripId,
      passengerName,
      seatNumber,
      status: "Confirmed",
      channel: "walk_in",
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "That seat is already booked for this trip" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create walk-in booking" });
  }
});

// PATCH /api/bookings/:id/status — move a booking through its lifecycle
// (Reserved -> Confirmed -> Boarded, or -> Cancelled/No-Show). Used by
// Terminal Staff (ReservationValidation.jsx) and drivers (Manifest.jsx).
bookingsRouter.patch("/:id/status", async (req, res) => {
  const { status } = req.body;
  const allowed = ["Reserved", "Confirmed", "Boarded", "Cancelled", "No-Show"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
  }

  try {
    await pool.query(`UPDATE bookings SET status = ? WHERE booking_id = ?`, [status, req.params.id]);
    res.json({ booking_id: Number(req.params.id), status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update booking" });
  }
});
