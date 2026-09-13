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
