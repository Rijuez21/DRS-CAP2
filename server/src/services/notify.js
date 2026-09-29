import { pool } from "../db/pool.js";

// Reliability requirement: notify passengers/drivers when a trip's
// departure_time or status changes after bookings/assignments already
// exist on it. Persists to `notifications` and pushes a live
// `notification:new` event to the recipient's own Socket.io room
// (`passenger:<id>` / `driver:<id>`, joined via "subscribe:notifications"
// in index.js) so the bell in the header updates without a refresh.
export async function notifyTripChange(io, tripId, message, type = "schedule_change") {
  try {
    const [passengers] = await pool.query(
      `SELECT DISTINCT passenger_id FROM bookings WHERE trip_id = ? AND status NOT IN ('Cancelled', 'No-Show')`,
      [tripId]
    );
    const [[trip]] = await pool.query(`SELECT driver_id FROM trips WHERE trip_id = ?`, [tripId]);

    const recipients = [
      ...passengers.map((p) => ({ type: "passenger", id: p.passenger_id })),
      ...(trip?.driver_id ? [{ type: "driver", id: trip.driver_id }] : []),
    ];

    for (const r of recipients) {
      const [result] = await pool.query(
        `INSERT INTO notifications (recipient_type, recipient_id, message, type) VALUES (?, ?, ?, ?)`,
        [r.type, r.id, message, type]
      );
      io?.to(`${r.type}:${r.id}`).emit("notification:new", {
        notification_id: result.insertId,
        message,
        type,
        created_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error("Notification dispatch failed (non-fatal):", err.message);
  }
}

// Flag a Bus mode: a single-recipient version of the above. A roadside
// hail concerns exactly one driver (the one on the flagged trip) or one
// passenger (the one who hailed), not everyone on the trip, so this skips
// the recipient fan-out but keeps the same two-part delivery -- persisted
// to `notifications` so it survives a missed socket event (driver's phone
// was in a dead zone when the hail arrived) and pushed live as the same
// `notification:new` the bell already listens for. The structured
// `flag:*` events in bookings.js are what the Flag UIs actually react to;
// this is the durable, human-readable trail alongside them.
export async function notifyRecipient(io, { type: recipientType, id: recipientId }, message, type) {
  try {
    const [result] = await pool.query(
      `INSERT INTO notifications (recipient_type, recipient_id, message, type) VALUES (?, ?, ?, ?)`,
      [recipientType, recipientId, message, type]
    );
    io?.to(`${recipientType}:${recipientId}`).emit("notification:new", {
      notification_id: result.insertId,
      message,
      type,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Notification dispatch failed (non-fatal):", err.message);
  }
}
