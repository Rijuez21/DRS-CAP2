import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";
import { notifyRecipient, notifyStaff } from "../services/notify.js";
import { fareStopsForTrip, fareBetween, tripCollections } from "../services/collections.js";

// /api/collections — cash accountability (see services/collections.js).
//   Driver (conductor on the driver's phone): record fares collected on board.
//   Terminal staff: record the cash the conductor remits after the trip.
//   Admin: everything staff can, plus correcting a recorded remittance.

const peso = (n) => `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_WALK_ON = 60;
const MAX_REMIT = 1000000;
const OPEN_FOR_FARES = ["Boarding", "In Transit"];

async function loadTrip(tripId, conn = pool) {
  const [[trip]] = await conn.query(
    `SELECT tr.trip_id, tr.status, tr.driver_id, tr.bus_id, tr.departure_time, rt.origin, rt.destination, rt.distance,
            b.plate_num, b.bus_number, d.name AS driver_name
     FROM trips tr JOIN routes rt ON rt.route_id = tr.route_id JOIN buses b ON b.bus_id = tr.bus_id JOIN drivers d ON d.driver_id = tr.driver_id
     WHERE tr.trip_id = ?`,
    [tripId]
  );
  return trip ?? null;
}

const fareSelect = `
  SELECT f.fare_id, f.trip_id, f.booking_id, f.passenger_count, f.board_stop, f.drop_stop, f.fare_type, f.fare_each, f.amount,
         f.recorded_at, f.voided_at, f.void_reason, bk.passenger_name
  FROM onboard_fares f LEFT JOIN bookings bk ON bk.booking_id = f.booking_id`;

export function buildCollectionsRouter(io) {
  const router = Router();

  // GET /api/collections/trips/:tripId — everything the Fare Collection page
  // needs: the fare list for the route, fares recorded so far, flagged riders
  // (paid or not), the totals, and the remittance if one was recorded.
  router.get("/trips/:tripId", requireRole("driver", "staff", "admin"), async (req, res) => {
    try {
      const trip = await loadTrip(req.params.tripId);
      if (!trip) return res.status(404).json({ error: "Trip not found" });
      if (req.user.role === "driver" && trip.driver_id !== req.user.id) return res.status(403).json({ error: "This trip isn't assigned to you" });
      const fareList = await fareStopsForTrip(pool, trip);
      const [fares] = await pool.query(`${fareSelect} WHERE f.trip_id = ? ORDER BY f.recorded_at DESC, f.fare_id DESC`, [trip.trip_id]);
      const [flagged] = await pool.query(
        `SELECT bk.booking_id, bk.passenger_name, bk.seat_number, bk.status, f.fare_id, f.amount, f.drop_stop
         FROM bookings bk LEFT JOIN onboard_fares f ON f.booking_id = bk.booking_id AND f.voided_at IS NULL
         WHERE bk.trip_id = ? AND bk.channel = 'flagged' AND bk.status IN ('Confirmed', 'Boarded')
         ORDER BY bk.booked_at`,
        [trip.trip_id]
      );
      const [summary] = await tripCollections({ tripId: trip.trip_id });
      res.json({
        trip: { ...trip, can_record: OPEN_FOR_FARES.includes(trip.status) },
        fare_list: fareList,
        fares,
        flagged_riders: flagged,
        summary,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load the trip's collections" });
    }
  });

  // POST /api/collections/trips/:tripId/fares — the conductor records a fare.
  // body: { bookingId?, boardStop, dropStop, fareType: 'regular'|'discounted', passengerCount? }
  // bookingId = a flagged rider on this trip (one fare each); without it, a
  // walk-on group of passengerCount riders. The amount is always computed
  // here from the fare list, never taken from the phone.
  router.post("/trips/:tripId/fares", requireRole("driver"), async (req, res) => {
    const body = req.body ?? {};
    const fareType = body.fareType === "discounted" ? "discounted" : body.fareType === "regular" || body.fareType == null ? "regular" : null;
    if (!fareType) return res.status(400).json({ error: "fareType must be regular or discounted" });
    const bookingId = body.bookingId == null || body.bookingId === "" ? null : Number(body.bookingId);
    const count = bookingId ? 1 : Number(body.passengerCount ?? 1);
    if (!Number.isInteger(count) || count < 1 || count > MAX_WALK_ON) return res.status(400).json({ error: `Number of passengers must be 1 to ${MAX_WALK_ON}` });
    try {
      const trip = await loadTrip(req.params.tripId);
      if (!trip) return res.status(404).json({ error: "Trip not found" });
      if (trip.driver_id !== req.user.id) return res.status(403).json({ error: "This trip isn't assigned to you" });
      if (!OPEN_FOR_FARES.includes(trip.status)) {
        return res.status(409).json({ error: `Fares can only be recorded while the trip is boarding or on the road (this trip is ${trip.status})` });
      }
      if (bookingId) {
        const [[bk]] = await pool.query(`SELECT booking_id, trip_id, channel, status FROM bookings WHERE booking_id = ?`, [bookingId]);
        if (!bk || bk.trip_id !== trip.trip_id || bk.channel !== "flagged") return res.status(400).json({ error: "That isn't a flagged rider on this trip" });
        if (!["Confirmed", "Boarded"].includes(bk.status)) return res.status(409).json({ error: `This rider's booking is ${bk.status}` });
      }
      const fareList = await fareStopsForTrip(pool, trip);
      if (!fareList) return res.status(409).json({ error: "This route has no fare list yet — ask an admin to set fares in Route Management" });
      const priced = fareBetween(fareList, String(body.boardStop ?? ""), String(body.dropStop ?? ""), fareType);
      if (priced.error) return res.status(400).json({ error: priced.error });
      const amount = Math.round(priced.fare * count * 100) / 100;
      const [r] = await pool.query(
        `INSERT INTO onboard_fares (trip_id, booking_id, passenger_count, board_stop, drop_stop, fare_type, fare_each, amount, recorded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [trip.trip_id, bookingId, count, body.boardStop, body.dropStop, fareType, priced.fare, amount, req.user.id]
      );
      const [[fare]] = await pool.query(`${fareSelect} WHERE f.fare_id = ?`, [r.insertId]);
      res.status(201).json(fare);
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "This rider's fare is already recorded" });
      console.error(err);
      res.status(500).json({ error: "Failed to record the fare" });
    }
  });

  // POST /api/collections/fares/:fareId/void — undo a mistaken entry while
  // the trip is still running. Kept (marked void, with a reason), not deleted.
  router.post("/fares/:fareId/void", requireRole("driver"), async (req, res) => {
    const reason = String(req.body?.reason ?? "").trim().slice(0, 150);
    if (!reason) return res.status(400).json({ error: "Say why this entry is being removed" });
    try {
      const [[fare]] = await pool.query(`SELECT f.fare_id, f.voided_at, f.recorded_by, tr.status, tr.driver_id FROM onboard_fares f JOIN trips tr ON tr.trip_id = f.trip_id WHERE f.fare_id = ?`, [req.params.fareId]);
      if (!fare) return res.status(404).json({ error: "Fare entry not found" });
      if (fare.driver_id !== req.user.id) return res.status(403).json({ error: "This trip isn't assigned to you" });
      if (fare.voided_at) return res.status(409).json({ error: "This entry was already removed" });
      if (!OPEN_FOR_FARES.includes(fare.status)) return res.status(409).json({ error: "The trip is finished — entries can no longer be changed" });
      await pool.query(`UPDATE onboard_fares SET voided_at = NOW(), void_reason = ? WHERE fare_id = ? AND voided_at IS NULL`, [reason, fare.fare_id]);
      res.json({ fare_id: fare.fare_id, voided: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to remove the entry" });
    }
  });

  // GET /api/collections/remittances?date=YYYY-MM-DD (or from/to) — the
  // terminal's list of trips with their on-board cash and remittance status.
  router.get("/remittances", requireRole("staff", "admin"), async (req, res) => {
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const from = DATE_RE.test(String(req.query.from ?? "")) ? req.query.from : DATE_RE.test(String(req.query.date ?? "")) ? req.query.date : today;
    const to = DATE_RE.test(String(req.query.to ?? "")) ? req.query.to : from;
    try {
      res.json({ from, to, trips: await tripCollections({ from, to }) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load remittances" });
    }
  });

  // POST /api/collections/trips/:tripId/remittance — staff record the cash the
  // conductor handed over. body: { amount, notes? }. Once per trip; the staff
  // member is saved as the receiver, the driver is told the amount received,
  // and administrators are alerted when it's short.
  router.post("/trips/:tripId/remittance", requireRole("staff", "admin"), async (req, res) => {
    const amount = Number(req.body?.amount);
    if (req.body?.amount === "" || req.body?.amount == null || !Number.isFinite(amount) || amount < 0 || amount > MAX_REMIT) {
      return res.status(400).json({ error: "Enter the amount of cash received" });
    }
    const remitted = Math.round(amount * 100) / 100;
    const notes = String(req.body?.notes ?? "").trim().slice(0, 255) || null;
    try {
      const trip = await loadTrip(req.params.tripId);
      if (!trip) return res.status(404).json({ error: "Trip not found" });
      if (trip.status !== "Completed") return res.status(409).json({ error: "Record the remittance after the driver completes the trip" });
      const [summary] = await tripCollections({ tripId: trip.trip_id });
      const expected = summary.collected.on_board;
      try {
        await pool.query(
          `INSERT INTO trip_remittances (trip_id, driver_id, expected_amount, remitted_amount, received_by, notes) VALUES (?, ?, ?, ?, ?, ?)`,
          [trip.trip_id, trip.driver_id, expected, remitted, req.user.id, notes]
        );
      } catch (err) {
        if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "A remittance for this trip is already recorded. An administrator can correct it." });
        throw err;
      }
      const diff = Math.round((remitted - expected) * 100) / 100;
      const bus = trip.bus_number ? `Bus ${trip.bus_number}` : trip.plate_num;
      await logAudit({ staffId: req.user.id, action: "record_remittance", entityType: "trip", entityId: trip.trip_id, details: { driver: trip.driver_name, expected, remitted, difference: diff, notes } });
      await notifyRecipient(io, { type: "driver", id: trip.driver_id }, `Remittance received for your ${trip.origin} → ${trip.destination} trip (${bus}): ${peso(remitted)}.`, "remittance_received");
      if (diff < 0) {
        await notifyStaff(io, `Short remittance: trip #${trip.trip_id} (${bus}, driver ${trip.driver_name}) remitted ${peso(remitted)} — ${peso(-diff)} short of the ${peso(expected)} recorded on board.`, "remittance_short", { adminsOnly: true });
      }
      const [after] = await tripCollections({ tripId: trip.trip_id });
      res.status(201).json(after);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to record the remittance" });
    }
  });

  // PATCH /api/collections/remittances/:id — admin corrects a recorded amount
  // (miscount, typo). body: { amount, reason }. Audited with before/after.
  router.patch("/remittances/:id", requireRole("admin"), async (req, res) => {
    const amount = Number(req.body?.amount);
    const reason = String(req.body?.reason ?? "").trim().slice(0, 255);
    if (req.body?.amount === "" || req.body?.amount == null || !Number.isFinite(amount) || amount < 0 || amount > MAX_REMIT) return res.status(400).json({ error: "Enter the correct amount" });
    if (!reason) return res.status(400).json({ error: "Give a reason for the correction" });
    try {
      const [[rm]] = await pool.query(`SELECT remittance_id, trip_id, remitted_amount, notes FROM trip_remittances WHERE remittance_id = ?`, [req.params.id]);
      if (!rm) return res.status(404).json({ error: "Remittance not found" });
      const corrected = Math.round(amount * 100) / 100;
      await pool.query(
        `UPDATE trip_remittances SET remitted_amount = ?, notes = ?, corrected_by = ?, corrected_at = NOW() WHERE remittance_id = ?`,
        [corrected, [rm.notes, `Corrected: ${reason}`].filter(Boolean).join(" · ").slice(0, 255), req.user.id, rm.remittance_id]
      );
      await logAudit({ staffId: req.user.id, action: "correct_remittance", entityType: "trip", entityId: rm.trip_id, details: { before: Number(rm.remitted_amount), after: corrected, reason } });
      const [after] = await tripCollections({ tripId: rm.trip_id });
      res.json(after);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to correct the remittance" });
    }
  });

  return router;
}
