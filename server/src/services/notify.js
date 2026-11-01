import { pool } from "../db/pool.js";
import { sendMail, APP_URL } from "./mailer.js";
import { notificationEmail } from "./emailTemplates.js";
import { isReservedEmail } from "./bookingRules.js";

// Notification types a passenger also gets by email (subject line here),
// because they need action or change their trip. Everything else (Flag a
// Bus updates, which are live and short-lived) stays in the app.
// payment_verified isn't here: services/receiptEmail.js sends the receipt.
const PASSENGER_EMAIL_TITLES = {
  booking_expiring: "Your payment window is closing",
  booking_expired: "Your seat was released",
  payment_rejected: "Your payment couldn't be verified",
  payment_resubmission: "We need more details about your payment",
  payment_refund: "Update on your refund",
  discount_approved: "Your fare discount was approved",
  discount_rejected: "Your discount ID wasn't verified",
  schedule_change: "Your trip's schedule changed",
  trip_cancelled: "Your trip was cancelled",
  departure_reminder: "Your bus leaves soon",
};

// Email copy of a passenger notification. Never throws; never delays the
// caller (not awaited).
async function copyToPassenger(passengerId, message, type) {
  const title = PASSENGER_EMAIL_TITLES[type];
  if (!title) return;
  try {
    const [[p]] = await pool.query(
      `SELECT name, email FROM commuters WHERE commuter_id = ? AND closed_at IS NULL`,
      [passengerId]
    );
    if (!p || isReservedEmail(p.email)) return;
    await sendMail({ to: p.email, ...notificationEmail({ name: p.name, title, message, link: `${APP_URL}/passenger/my-bookings` }) });
  } catch (err) {
    console.error("Notification email failed (non-fatal):", err.message);
  }
}

// Reliability requirement: notify passengers/drivers when a trip's
// departure_time or status changes after bookings/assignments already
// exist on it. One notifyRecipient() per person on the trip.
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
    for (const r of recipients) await notifyRecipient(io, r, message, type);
  } catch (err) {
    console.error("Notification dispatch failed (non-fatal):", err.message);
  }
}

// One recipient: persisted to `notifications` so it survives a missed
// socket event (a phone in a dead zone), and pushed live as
// `notification:new` to the recipient's own Socket.io room
// (`passenger:<id>` / `driver:<id>` / `staff:<id>`, joined via
// "subscribe:notifications" in index.js) so the bell updates without a
// refresh. Passengers also get the email copy above.
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
  if (recipientType === "passenger") copyToPassenger(recipientId, message, type);
}

// Payment review alerts for terminal staff and admins (recipient_type
// 'staff', recipient_id = staff_accounts.staff_id — admins live in the same
// table). One row per account so each person's bell tracks its own read
// state; pushed live to the staff:<id> room joined via
// "subscribe:notifications". adminsOnly: escalations go to admins only.
export async function notifyStaff(io, message, type, { adminsOnly = false } = {}) {
  try {
    const [staff] = await pool.query(
      `SELECT staff_id FROM staff_accounts ${adminsOnly ? "WHERE role = 'admin'" : ""}`
    );
    for (const s of staff) {
      await notifyRecipient(io, { type: "staff", id: s.staff_id }, message, type);
    }
    // Lets an open Payment Verification page refresh its queue immediately.
    io?.to("payments:staff").emit("payments:changed", { type });
  } catch (err) {
    console.error("Staff notification failed (non-fatal):", err.message);
  }
}
