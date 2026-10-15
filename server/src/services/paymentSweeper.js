import { pool } from "../db/pool.js";
import { notifyRecipient, notifyStaff } from "./notify.js";
import { logPaymentEvent } from "./paymentAudit.js";
import { OPEN_STATUSES, FUNDS_RECEIVED_STATUSES, bookingReference, paymentConfig } from "./paymentRules.js";

// ============================================================================
// Seat-hold enforcement for online bookings (runs on a timer, index.js).
//
//   1. warn   — passenger told their hold is about to lapse (once)
//   2. expire — a Reserved online booking past its payment_deadline with NO
//               proof under review is cancelled and its seat freed
//   3. alert  — staff told about unresolved proofs on trips leaving soon
//
// Never released: a booking whose proof is Pending/Escalated (the passenger
// did their part before the deadline; slow review is not their fault), or
// one with money already received. Nothing here ever approves a payment.
// ============================================================================

const BATCH = 200;

export async function expireUnpaidBookings(io) {
  const [candidates] = await pool.query(
    `SELECT booking_id FROM bookings
     WHERE status = 'Reserved' AND channel = 'online' AND payment_deadline IS NOT NULL AND payment_deadline < NOW()
     ORDER BY payment_deadline LIMIT ?`,
    [BATCH]
  );
  const released = [];
  for (const { booking_id } of candidates) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Same lock order as the payment routes: booking first. A passenger
      // submitting proof right now either committed already (we'll see the
      // Pending row below) or waits for us and is then told the window closed.
      const [[b]] = await conn.query(
        `SELECT booking_id, passenger_id, seat_number, booked_at, status, payment_deadline FROM bookings WHERE booking_id = ? FOR UPDATE`,
        [booking_id]
      );
      if (!b || b.status !== "Reserved" || !b.payment_deadline || new Date(b.payment_deadline) >= new Date()) {
        await conn.rollback();
        continue;
      }
      const [payments] = await conn.query(`SELECT status FROM payments WHERE booking_id = ? FOR UPDATE`, [booking_id]);
      if (payments.some((p) => OPEN_STATUSES.includes(p.status) || FUNDS_RECEIVED_STATUSES.includes(p.status))) {
        await conn.rollback();
        continue;
      }
      await conn.query(
        `UPDATE bookings SET status = 'Cancelled', cancellation_reason = 'payment_expired' WHERE booking_id = ? AND status = 'Reserved'`,
        [booking_id]
      );
      await logPaymentEvent(conn, {
        actor: null,
        action: "seat_released",
        bookingId: booking_id,
        reason: "Payment deadline passed with no payment proof under review",
        details: { paymentDeadline: b.payment_deadline, previousBookingStatus: "Reserved" },
      });
      await conn.commit();
      released.push(b);
    } catch (err) {
      await conn.rollback().catch(() => {});
      console.error(`Seat release for booking ${booking_id} failed (non-fatal):`, err.message);
    } finally {
      conn.release();
    }
  }
  for (const b of released) {
    await notifyRecipient(
      io,
      { type: "passenger", id: b.passenger_id },
      `The payment window for booking #${b.booking_id} (${bookingReference(b.booking_id, b.booked_at)}, seat ${b.seat_number}) closed without a payment, so the seat was released. You can book again if seats are available.`,
      "booking_expired"
    );
  }
  return released.map((b) => b.booking_id);
}

export async function warnExpiringBookings(io) {
  if (!paymentConfig.expiryWarningMinutes) return [];
  const [rows] = await pool.query(
    `SELECT bk.booking_id, bk.passenger_id, bk.booked_at, bk.payment_deadline
     FROM bookings bk
     WHERE bk.status = 'Reserved' AND bk.channel = 'online' AND bk.expiry_warned_at IS NULL
       AND bk.payment_deadline IS NOT NULL
       AND bk.payment_deadline BETWEEN NOW() AND NOW() + INTERVAL ? MINUTE
       AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = bk.booking_id AND p.status IN ('Pending', 'Escalated'))
     LIMIT ?`,
    [paymentConfig.expiryWarningMinutes, BATCH]
  );
  const warned = [];
  for (const r of rows) {
    const [result] = await pool.query(`UPDATE bookings SET expiry_warned_at = NOW() WHERE booking_id = ? AND expiry_warned_at IS NULL`, [r.booking_id]);
    if (result.affectedRows !== 1) continue;
    warned.push(r.booking_id);
    const minutes = Math.max(1, Math.round((new Date(r.payment_deadline) - Date.now()) / 60000));
    await notifyRecipient(
      io,
      { type: "passenger", id: r.passenger_id },
      `Booking #${r.booking_id} (${bookingReference(r.booking_id, r.booked_at)}) will be released in about ${minutes} minute(s) unless you submit your payment proof.`,
      "booking_expiring"
    );
  }
  return warned;
}

export async function alertDepartingSoon(io) {
  const [rows] = await pool.query(
    `SELECT s.submission_id, MIN(tr.departure_time) AS departure_time
     FROM payment_submissions s
     JOIN payments p ON p.submission_id = s.submission_id
     JOIN bookings bk ON bk.booking_id = p.booking_id
     JOIN trips tr ON tr.trip_id = bk.trip_id
     WHERE s.departure_alert_sent_at IS NULL AND p.status IN ('Pending', 'Escalated')
       AND tr.departure_time BETWEEN NOW() AND NOW() + INTERVAL ? HOUR
     GROUP BY s.submission_id
     LIMIT ?`,
    [paymentConfig.departureAlertHours, BATCH]
  );
  const alerted = [];
  for (const r of rows) {
    const [result] = await pool.query(
      `UPDATE payment_submissions SET departure_alert_sent_at = NOW() WHERE submission_id = ? AND departure_alert_sent_at IS NULL`,
      [r.submission_id]
    );
    if (result.affectedRows !== 1) continue;
    alerted.push(r.submission_id);
    const when = new Date(r.departure_time).toLocaleString("en-PH", { timeZone: "Asia/Manila", timeStyle: "short", dateStyle: "medium" });
    await notifyStaff(io, `Departing soon: submission #${r.submission_id} is still unverified and its trip leaves ${when}.`, "payment_review_departing");
  }
  return alerted;
}

export async function runPaymentSweep(io) {
  const out = { warned: [], released: [], alerted: [] };
  try {
    out.warned = await warnExpiringBookings(io);
    out.released = await expireUnpaidBookings(io);
    out.alerted = await alertDepartingSoon(io);
    if (out.released.length) io?.to("payments:staff").emit("payments:changed", { type: "seat_released" });
  } catch (err) {
    console.error("Payment sweep failed (non-fatal):", err.message);
  }
  return out;
}

let sweeping = false;
export function startPaymentSweeper(io) {
  const timer = setInterval(async () => {
    if (sweeping) return; // never overlap runs
    sweeping = true;
    try {
      await runPaymentSweep(io);
    } finally {
      sweeping = false;
    }
  }, paymentConfig.sweepIntervalMs);
  timer.unref?.();
  return timer;
}

// Trip cancelled by the operator: every seat already paid for is owed back.
// Called by routes/trips.js after the bookings were cancelled. Proofs still
// under review stay open — if staff later verify them, the verify route sees
// the cancelled booking and opens the refund itself.
export async function openRefundsForCancelledTrip(io, tripId, actor) {
  const conn = await pool.getConnection();
  let refunds = [];
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT p.payment_id, p.submission_id, p.booking_id, p.amount, bk.passenger_id, bk.booked_at
       FROM payments p JOIN bookings bk ON bk.booking_id = p.booking_id
       WHERE bk.trip_id = ? AND p.status = 'Verified'
       FOR UPDATE`,
      [tripId]
    );
    for (const r of rows) {
      await conn.query(
        `UPDATE payments SET status = 'Refund Pending', refund_reason = 'Trip cancelled by the operator', refund_requested_at = NOW(), refund_requested_by = ?
         WHERE payment_id = ? AND status = 'Verified'`,
        [actor?.id ?? null, r.payment_id]
      );
      await logPaymentEvent(conn, {
        actor: null,
        action: "refund_requested",
        paymentId: r.payment_id,
        submissionId: r.submission_id,
        bookingId: r.booking_id,
        previousStatus: "Verified",
        newStatus: "Refund Pending",
        reason: "Trip cancelled by the operator",
        details: { tripId, cancelledBy: actor?.id ?? null },
      });
    }
    await conn.commit();
    refunds = rows;
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error("Opening refunds for a cancelled trip failed:", err.message);
    throw err;
  } finally {
    conn.release();
  }
  for (const r of refunds) {
    await notifyRecipient(
      io,
      { type: "passenger", id: r.passenger_id },
      `Your trip was cancelled. A refund for booking #${r.booking_id} (${bookingReference(r.booking_id, r.booked_at)}) has been opened — you'll be notified when it's sent.`,
      "payment_refund"
    );
  }
  if (refunds.length) {
    await notifyStaff(io, `Trip #${tripId} was cancelled: ${refunds.length} verified online payment(s) now need refunds.`, "payment_review_refund", { adminsOnly: true });
  }
  return refunds.length;
}
