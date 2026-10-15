import { pool } from "../db/pool.js";

// Append-only payment history (payment_audit_logs). Unlike services/audit.js
// (best-effort, after the fact), this is written on the SAME connection and
// inside the SAME transaction as the status change it describes: if the
// change rolls back, so does its log row, and a committed change always has
// one. Never pass secrets, tokens or receipt image data in `details`.
//
// actor: { id, role } from the JWT (role "staff" | "admin" | "passenger"),
// or null for the server's own automation (actor_role 'system').
export async function logPaymentEvent(conn, {
  actor,
  action,
  paymentId = null,
  submissionId = null,
  bookingId = null,
  previousStatus = null,
  newStatus = null,
  reason = null,
  internalNote = null,
  details = null,
}) {
  const role = actor ? (actor.role === "admin" ? "admin" : actor.role === "passenger" ? "passenger" : "staff") : "system";
  await (conn ?? pool).query(
    `INSERT INTO payment_audit_logs
       (payment_id, submission_id, booking_id, actor_id, actor_role, previous_status, new_status, action, reason, internal_note, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      paymentId,
      submissionId,
      bookingId,
      actor?.id ?? null,
      role,
      previousStatus,
      newStatus,
      action,
      reason ? String(reason).slice(0, 500) : null,
      internalNote ? String(internalNote).slice(0, 1000) : null,
      details ? JSON.stringify(details) : null,
    ]
  );
}
