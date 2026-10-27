import { Router } from "express";
import { pool } from "../db/pool.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { notifyRecipient, notifyStaff } from "../services/notify.js";
import { logAudit } from "../services/audit.js";
import { logPaymentEvent } from "../services/paymentAudit.js";
import { rateLimit } from "../services/rateLimit.js";
import { BOOKABLE_TRIP_STATUSES } from "../services/bookingRules.js";
import { likeEscape } from "../services/validate.js";
import { FARE_DUE_SQL } from "../services/discounts.js";
import {
  OPEN_STATUSES,
  FUNDS_RECEIVED_STATUSES,
  RESUBMITTABLE_STATUSES,
  PAYMENT_STATUSES,
  PAYMENT_METHOD_TYPES,
  METHOD_LABELS,
  MAX_ATTEMPTS_PER_BOOKING,
  whyPaymentTransitionNotAllowed,
  transitionTarget,
  toCentavos,
  centavosToDecimal,
  centavosToNumber,
  formatPesoCentavos,
  parseReference,
  parseReceiptImage,
  detectImageType,
  bookingReference,
  parseBookingReference,
  paymentConfig,
  holdDeadline,
} from "../services/paymentRules.js";

// ============================================================================
// Manual online payment verification — /api/payments
// ============================================================================
// There is NO payment gateway. Passengers pay the operator's GCash / bank /
// QR Ph account in their own app, then report the transfer here (method,
// reference number, amount, time, receipt screenshot). Nothing in this file
// ever treats that report as proof: a payment becomes Verified only when an
// authorized staff member confirms — against the company's own account or
// merchant records, outside this system — that the money actually arrived,
// and records the amount they saw.
//
//   passenger books online      -> booking Reserved, payment_deadline set
//   passenger submits proof     -> payment_submissions row + one payments row
//                                  per seat, status Pending ("under review");
//                                  the seat can no longer expire
//   staff decide (whole transfer at once):
//     verify   -> Verified, booking Reserved -> Confirmed (same transaction)
//     reject / request resubmission -> passenger told why, seat window extended
//     escalate -> Escalated, admins decide
//   refunds (per seat): Verified -> Refund Pending -> Refunded (admin)
//
// Status rules: services/paymentRules.js. History: payment_audit_logs,
// written inside the same transaction as each change.
// ============================================================================

const MAX_SEATS_PER_SUBMISSION = 10;
const MAX_REASON_LENGTH = 255;
const MAX_NOTE_LENGTH = 1000;
const MAX_QR_BYTES = 5 * 1024 * 1024;
const PAID_AT_MAX_AGE_DAYS = 30;

// Per passenger, counting every attempt (including invalid ones).
const submitLimiter = rateLimit({ name: "payment-submit", max: Number(process.env.PAYMENT_SUBMIT_RATE_LIMIT) || 6, windowSeconds: 600 });
const receiptLimiter = rateLimit({ name: "payment-receipt", max: 120, windowSeconds: 600 });
const staffActionLimiter = rateLimit({ name: "payment-staff-action", max: 60, windowSeconds: 60 });
const settingsLimiter = rateLimit({ name: "payment-settings", max: 30, windowSeconds: 600 });

const isStaffRole = (role) => role === "staff" || role === "admin";

function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function cleanText(value, max) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

const centavosOf = (decimal) => (decimal == null ? null : toCentavos(decimal));

// Lock waits / deadlocks between two simultaneous writers are retried by
// the user, not surfaced as a 500.
function isLockConflict(err) {
  return err?.code === "ER_LOCK_DEADLOCK" || err?.code === "ER_LOCK_WAIT_TIMEOUT";
}

// Why this booking can't be paid online right now, in words the passenger
// understands. null = fine. Caller has the booking row locked.
function whyBookingNotPayable(booking, now = new Date()) {
  const ref = bookingReference(booking.booking_id, booking.booked_at);
  if (booking.channel !== "online") return `Booking ${ref} is paid at the terminal, not online.`;
  if (booking.status === "Confirmed") return `Booking ${ref} is already confirmed — there's nothing left to pay.`;
  if (booking.status === "Cancelled") {
    return booking.cancellation_reason === "payment_expired"
      ? `The payment window for booking ${ref} closed and the seat was released. Please book again.`
      : `Booking ${ref} was cancelled, so it can't be paid for.`;
  }
  if (booking.status !== "Reserved") return `Booking ${ref} is ${booking.status} and can't be paid for online.`;
  if (booking.trip_status === "Cancelled") return `The trip for booking ${ref} was cancelled — don't send a payment.`;
  if (!BOOKABLE_TRIP_STATUSES.includes(booking.trip_status)) {
    return `The bus for booking ${ref} has already left the terminal.`;
  }
  if (booking.base_fare == null) return `The fare for booking ${ref} isn't on file yet — please pay at the terminal.`;
  if (booking.payment_deadline && new Date(booking.payment_deadline) < now) {
    return `The payment window for booking ${ref} has closed. Please book again.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Payment methods (configurable instructions)
// ---------------------------------------------------------------------------
function methodJson(row, { staff }) {
  return {
    method_id: row.method_id,
    method_type: row.method_type,
    method_label: METHOD_LABELS[row.method_type],
    display_name: row.display_name,
    account_name: row.account_name,
    account_number: row.account_number,
    bank_name: row.bank_name,
    qr_image: row.qr_image,
    instructions: row.instructions,
    ...(staff ? { is_active: Boolean(row.is_active), sort_order: row.sort_order, updated_at: row.updated_at, updated_by_name: row.updated_by_name } : {}),
  };
}

// QR images are not receipts (no minimum size), but get the same real
// content check: decoded bytes must be PNG / JPEG / WebP.
function parseQrImage(value) {
  if (value === null || value === "") return { image: null };
  if (typeof value !== "string") return { error: "The QR must be an image" };
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value.replace(/\s+/g, ""));
  if (!m) return { error: "The QR must be a PNG, JPEG or WebP image" };
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_QR_BYTES) return { error: "The QR image is too large. The limit is 5 MB." };
  if (detectImageType(buf) !== m[1]) return { error: "That file isn't a valid PNG, JPEG or WebP image" };
  return { image: `data:${m[1]};base64,${buf.toString("base64")}` };
}

// Validates an admin create/update body. partial = PATCH (only given fields).
function parseMethodBody(body, { partial }) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has("methodType")) {
    if (!PAYMENT_METHOD_TYPES.includes(body.methodType)) return { error: `methodType must be one of: ${PAYMENT_METHOD_TYPES.join(", ")}` };
    out.method_type = body.methodType;
  }
  if (!partial || has("displayName")) {
    const name = cleanText(body.displayName, 100);
    if (!name) return { error: "Give the method a name passengers will recognise (e.g. GCash)" };
    out.display_name = name;
  }
  for (const [key, col, max] of [
    ["accountName", "account_name", 150],
    ["accountNumber", "account_number", 60],
    ["bankName", "bank_name", 100],
    ["instructions", "instructions", 1000],
  ]) {
    if (has(key)) out[col] = cleanText(body[key], max);
  }
  if (out.account_number && !/^[A-Za-z0-9 +\-.]+$/.test(out.account_number)) {
    return { error: "The account number may only contain letters, numbers, spaces and dashes" };
  }
  if (has("qrImage")) {
    const qr = parseQrImage(body.qrImage);
    if (qr.error) return { error: qr.error };
    out.qr_image = qr.image;
  }
  if (has("isActive")) out.is_active = Boolean(body.isActive);
  if (has("sortOrder")) {
    const n = Number(body.sortOrder);
    if (!Number.isInteger(n) || n < 0 || n > 1000) return { error: "sortOrder must be a whole number 0–1000" };
    out.sort_order = n;
  }
  return { fields: out };
}

// An active method must actually tell passengers where to send money.
function whyMethodIncomplete(m) {
  if (!m.is_active) return null;
  if (!m.account_number && !m.qr_image) return "An active method needs an account number or a QR image so passengers know where to pay";
  if (m.method_type === "bank_transfer" && !m.bank_name) return "Enter the bank name for a bank transfer method";
  if (!m.account_name) return "Enter the account name so passengers can check they're paying the right account";
  return null;
}

// ---------------------------------------------------------------------------
// Queue / detail SQL
// ---------------------------------------------------------------------------
// One row per seat with everything staff need to compare. Never selects
// receipt image data (megabytes) — that comes from /submissions/:id/receipt.
const PAYMENT_ROW_SELECT = `
  SELECT p.payment_id, p.submission_id, p.booking_id, p.amount, p.reference_number, p.status, p.rejection_reason,
         p.submitted_at, p.verified_at, p.verified_by, sa.name AS verified_by_name,
         p.refund_reason, p.refund_requested_at, p.refund_reference, p.refunded_at,
         bk.status AS booking_status, bk.seat_number, bk.passenger_id, bk.passenger_name, bk.booked_at,
         bk.payment_deadline, bk.channel, bk.cancellation_reason,
         c.email AS passenger_email, c.phoneno AS passenger_phone,
         tr.trip_id, tr.departure_time, tr.status AS trip_status,
         rt.route_id, rt.origin, rt.destination, b.plate_num, b.bus_number
  FROM payments p
  JOIN bookings bk ON bk.booking_id = p.booking_id
  JOIN commuters c ON c.commuter_id = bk.passenger_id
  JOIN trips tr ON tr.trip_id = bk.trip_id
  JOIN routes rt ON rt.route_id = tr.route_id
  JOIN buses b ON b.bus_id = tr.bus_id
  LEFT JOIN staff_accounts sa ON sa.staff_id = p.verified_by`;

function paymentRowJson(r) {
  return {
    ...r,
    amount: centavosToNumber(centavosOf(r.amount)),
    booking_reference: bookingReference(r.booking_id, r.booked_at),
  };
}

// What a passenger may see about one payment attempt: no staff names,
// no internal notes, no other passengers' data.
function passengerPaymentJson(r) {
  return {
    payment_id: r.payment_id,
    submission_id: r.submission_id,
    booking_id: r.booking_id,
    booking_reference: bookingReference(r.booking_id, r.booked_at),
    status: r.status,
    amount: centavosToNumber(centavosOf(r.amount)),
    reference_number: r.reference_number,
    payment_method: r.payment_method ?? "qr_ph",
    method_label: METHOD_LABELS[r.payment_method ?? "qr_ph"],
    method_name: r.method_name ?? null,
    amount_claimed: centavosToNumber(centavosOf(r.amount_claimed)),
    paid_at: r.paid_at ?? null,
    has_receipt: Boolean(r.has_receipt),
    submitted_at: r.submitted_at,
    reviewed_at: r.verified_at,
    rejection_reason: r.rejection_reason, // the passenger-visible reason staff typed
    refund_reason: r.refund_reason,
    refund_reference: r.status === "Refunded" ? r.refund_reference : null,
    refunded_at: r.refunded_at,
    seat_number: r.seat_number,
    origin: r.origin,
    destination: r.destination,
    departure_time: r.departure_time,
    passenger_name: r.passenger_name,
    bus_number: r.bus_number,
    plate_num: r.plate_num,
  };
}

const PASSENGER_PAYMENT_SELECT = `
  SELECT p.payment_id, p.submission_id, p.booking_id, p.amount, p.reference_number, p.status, p.rejection_reason,
         p.submitted_at, p.verified_at, p.refund_reason, p.refund_reference, p.refunded_at,
         s.payment_method, s.amount_claimed, s.paid_at, pm.display_name AS method_name,
         (s.receipt_data IS NOT NULL OR p.proof_image IS NOT NULL) AS has_receipt,
         bk.seat_number, bk.passenger_name, bk.booked_at, tr.departure_time, rt.origin, rt.destination,
         b.bus_number, b.plate_num
  FROM payments p
  JOIN bookings bk ON bk.booking_id = p.booking_id
  JOIN trips tr ON tr.trip_id = bk.trip_id
  JOIN routes rt ON rt.route_id = tr.route_id
  JOIN buses b ON b.bus_id = tr.bus_id
  LEFT JOIN payment_submissions s ON s.submission_id = p.submission_id
  LEFT JOIN payment_methods pm ON pm.method_id = s.method_id`;

// Other submissions sharing this transfer's normalized reference or the
// exact same receipt image (SHA-256) — the duplicate warning staff see.
async function findDuplicates(conn, submission) {
  const [rows] = await conn.query(
    `SELECT s.submission_id, s.passenger_id, s.payment_method, s.reference_number, s.submitted_at,
            c.name AS passenger_name,
            (s.reference_normalized = ?) AS same_reference,
            (s.receipt_sha256 IS NOT NULL AND s.receipt_sha256 = ?) AS same_receipt,
            GROUP_CONCAT(DISTINCT p.status ORDER BY p.status SEPARATOR ', ') AS statuses,
            GROUP_CONCAT(DISTINCT p.booking_id ORDER BY p.booking_id) AS booking_ids
     FROM payment_submissions s
     JOIN commuters c ON c.commuter_id = s.passenger_id
     LEFT JOIN payments p ON p.submission_id = s.submission_id
     WHERE s.submission_id <> ? AND (s.reference_normalized = ? OR (s.receipt_sha256 IS NOT NULL AND s.receipt_sha256 = ?))
     GROUP BY s.submission_id
     ORDER BY s.submission_id DESC
     LIMIT 20`,
    [submission.reference_normalized, submission.receipt_sha256, submission.submission_id, submission.reference_normalized, submission.receipt_sha256]
  );
  return rows.map((r) => ({
    submission_id: r.submission_id,
    passenger_name: r.passenger_name,
    same_passenger: r.passenger_id === submission.passenger_id,
    payment_method: r.payment_method,
    reference_number: r.reference_number,
    submitted_at: r.submitted_at,
    same_reference: Boolean(r.same_reference),
    same_receipt: Boolean(r.same_receipt),
    statuses: r.statuses,
    booking_ids: r.booking_ids ? String(r.booking_ids).split(",").map(Number) : [],
  }));
}

// Locks, in the one order every payment writer uses (bookings, then the
// submission, then its payment rows) so two writers never deadlock each
// other: booking rows FOR UPDATE, submission FOR UPDATE, payments FOR UPDATE.
async function lockSubmission(conn, submissionId) {
  const [bookingIds] = await conn.query(`SELECT DISTINCT booking_id FROM payments WHERE submission_id = ?`, [submissionId]);
  if (bookingIds.length === 0) return null;
  const [bookings] = await conn.query(
    `SELECT bk.booking_id, bk.status, bk.passenger_id, bk.seat_number, bk.booked_at, bk.payment_deadline, bk.channel,
            tr.trip_id, tr.status AS trip_status, tr.departure_time
     FROM bookings bk JOIN trips tr ON tr.trip_id = bk.trip_id
     WHERE bk.booking_id IN (?) ORDER BY bk.booking_id FOR UPDATE`,
    [bookingIds.map((r) => r.booking_id)]
  );
  const [[submission]] = await conn.query(`SELECT * FROM payment_submissions WHERE submission_id = ? FOR UPDATE`, [submissionId]);
  const [payments] = await conn.query(
    `SELECT payment_id, booking_id, status, amount, reference_number FROM payments WHERE submission_id = ? ORDER BY payment_id FOR UPDATE`,
    [submissionId]
  );
  return { submission, payments, bookings: new Map(bookings.map((b) => [b.booking_id, b])) };
}

// Gives the passenger a fresh window to resubmit after a rejection, but
// never past departure, and only when holds are enabled for that booking.
async function extendDeadline(conn, booking) {
  if (!booking.payment_deadline || booking.status !== "Reserved") return null;
  const extended = holdDeadline(paymentConfig.resubmitMinutes, booking.departure_time);
  if (extended <= new Date(booking.payment_deadline)) return booking.payment_deadline;
  await conn.query(`UPDATE bookings SET payment_deadline = ?, expiry_warned_at = NULL WHERE booking_id = ?`, [extended, booking.booking_id]);
  return extended;
}

export function buildPaymentsRouter(io) {
  const router = Router();
  const changed = (type) => io?.to("payments:staff").emit("payments:changed", { type });

  // ==========================================================================
  // Payment methods — passengers read active ones; admins manage them.
  // ==========================================================================
  router.get("/methods", authenticate, async (req, res) => {
    const staff = isStaffRole(req.user.role);
    const all = staff && req.query.all === "1";
    try {
      const [rows] = await pool.query(
        `SELECT pm.*, sa.name AS updated_by_name FROM payment_methods pm
         LEFT JOIN staff_accounts sa ON sa.staff_id = pm.updated_by
         ${all ? "" : "WHERE pm.is_active = TRUE"}
         ORDER BY pm.sort_order, pm.method_id`
      );
      res.set("Cache-Control", "private, no-cache");
      res.json(rows.map((r) => methodJson(r, { staff })));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load payment methods" });
    }
  });

  router.post("/methods", requireRole("admin"), settingsLimiter, async (req, res) => {
    const parsed = parseMethodBody(req.body ?? {}, { partial: false });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const m = { is_active: false, sort_order: 0, account_name: null, account_number: null, bank_name: null, qr_image: null, instructions: null, ...parsed.fields };
    const incomplete = whyMethodIncomplete(m);
    if (incomplete) return res.status(400).json({ error: incomplete });
    try {
      const [result] = await pool.query(
        `INSERT INTO payment_methods (method_type, display_name, account_name, account_number, bank_name, qr_image, instructions, is_active, sort_order, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [m.method_type, m.display_name, m.account_name, m.account_number, m.bank_name, m.qr_image, m.instructions, m.is_active, m.sort_order, req.user.id]
      );
      await logAudit({
        staffId: req.user.id,
        action: "create",
        entityType: "payment_method",
        entityId: result.insertId,
        details: { ...m, qr_image: m.qr_image ? "(image)" : null },
      });
      const [[row]] = await pool.query(`SELECT * FROM payment_methods WHERE method_id = ?`, [result.insertId]);
      res.status(201).json(methodJson(row, { staff: true }));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to save the payment method" });
    }
  });

  router.patch("/methods/:id", requireRole("admin"), settingsLimiter, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: "Payment method not found" });
    const parsed = parseMethodBody(req.body ?? {}, { partial: true });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const fields = parsed.fields;
    if (Object.keys(fields).length === 0) return res.status(400).json({ error: "Nothing to update" });
    try {
      const [[current]] = await pool.query(`SELECT * FROM payment_methods WHERE method_id = ?`, [id]);
      if (!current) return res.status(404).json({ error: "Payment method not found" });
      const incomplete = whyMethodIncomplete({ ...current, ...fields, is_active: fields.is_active ?? Boolean(current.is_active) });
      if (incomplete) return res.status(400).json({ error: incomplete });
      const cols = Object.keys(fields);
      await pool.query(
        `UPDATE payment_methods SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_by = ? WHERE method_id = ?`,
        [...cols.map((c) => fields[c]), req.user.id, id]
      );
      await logAudit({
        staffId: req.user.id,
        action: "update",
        entityType: "payment_method",
        entityId: id,
        details: { ...fields, ...(fields.qr_image !== undefined ? { qr_image: fields.qr_image ? "(replaced)" : "(removed)" } : {}) },
      });
      const [[row]] = await pool.query(`SELECT * FROM payment_methods WHERE method_id = ?`, [id]);
      res.json(methodJson(row, { staff: true }));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update the payment method" });
    }
  });

  // Legacy single-QR endpoints (pre-payment-methods clients). GET returns
  // the first active method that has a QR, in the old shape; PUT is retired
  // so there's only one place payment details are edited.
  router.get("/qr", authenticate, async (req, res) => {
    try {
      const [[row]] = await pool.query(
        `SELECT qr_image, display_name, account_name, instructions, updated_at FROM payment_methods
         WHERE is_active = TRUE AND qr_image IS NOT NULL ORDER BY sort_order, method_id LIMIT 1`
      );
      res.set("Cache-Control", "private, no-cache");
      res.json(row ? { qrImage: row.qr_image, label: row.account_name ?? row.display_name, instructions: row.instructions, updatedAt: row.updated_at } : null);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load the payment QR" });
    }
  });
  router.put("/qr", requireRole("admin"), (req, res) =>
    res.status(410).json({ error: "Payment details are now managed under Payment Methods." })
  );

  // ==========================================================================
  // Passenger: submit proof of payment (also used to resubmit)
  // body: { bookingIds: [12, 13], methodId, referenceNumber, amountClaimed,
  //         paidAt (ISO date-time), receiptImage (data: URL) }
  // One transfer may cover several seats of the same passenger. All-or-
  // nothing: if any booking can't be paid for, nothing is recorded.
  // The amount DUE is always computed here from route fares.
  // ==========================================================================
  router.post("/", requireRole("passenger"), submitLimiter, async (req, res) => {
    const body = req.body ?? {};
    // Anything a client might try to set itself is refused outright rather
    // than silently ignored, so tampering is visible in testing.
    for (const forbidden of ["status", "amountDue", "amount", "verified", "verifiedBy", "passengerId"]) {
      if (Object.prototype.hasOwnProperty.call(body, forbidden)) {
        return res.status(400).json({ error: `${forbidden} can't be set by the passenger` });
      }
    }

    const rawIds = Array.isArray(body.bookingIds) ? body.bookingIds : [];
    const bookingIds = [...new Set(rawIds.map(Number))];
    if (bookingIds.length === 0 || bookingIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      return res.status(400).json({ error: "Choose at least one booking to pay for" });
    }
    if (bookingIds.length > MAX_SEATS_PER_SUBMISSION) {
      return res.status(400).json({ error: `You can pay for up to ${MAX_SEATS_PER_SUBMISSION} seats at a time` });
    }
    const methodId = parseId(body.methodId);
    if (!methodId) return res.status(400).json({ error: "Choose how you paid" });

    const claimed = toCentavos(body.amountClaimed);
    if (claimed == null || claimed <= 0) return res.status(400).json({ error: "Enter the amount you sent (e.g. 350 or 350.00)" });

    const paidAt = new Date(body.paidAt);
    if (!body.paidAt || Number.isNaN(paidAt.getTime())) return res.status(400).json({ error: "Enter the date and time you paid" });
    if (paidAt.getTime() > Date.now() + 5 * 60000) return res.status(400).json({ error: "The payment time can't be in the future" });
    if (paidAt.getTime() < Date.now() - PAID_AT_MAX_AGE_DAYS * 86400000) {
      return res.status(400).json({ error: `The payment time is more than ${PAID_AT_MAX_AGE_DAYS} days ago — check the date` });
    }

    const receipt = parseReceiptImage(body.receiptImage);
    if (receipt.error) return res.status(400).json({ error: receipt.error });

    let conn;
    let submissionId;
    let createdPayments = [];
    let dueCentavos = 0;
    let isResubmission = false;
    let reference;
    let method;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();

      [[method]] = await conn.query(`SELECT * FROM payment_methods WHERE method_id = ? AND is_active = TRUE`, [methodId]);
      if (!method) {
        await conn.rollback();
        return res.status(400).json({ error: "That payment method isn't available. Choose another one." });
      }
      reference = parseReference(method.method_type, body.referenceNumber);
      if (reference.error) {
        await conn.rollback();
        return res.status(400).json({ error: reference.error });
      }

      // Booking rows are locked first (same order as every other payment
      // writer): a double-tap, a cancel, the expiry sweeper and a staff
      // decision on these seats all queue behind this transaction.
      const [bookings] = await conn.query(
        `SELECT bk.booking_id, bk.passenger_id, bk.status, bk.seat_number, bk.channel, bk.booked_at,
                bk.payment_deadline, bk.cancellation_reason, tr.status AS trip_status, rt.base_fare, ${FARE_DUE_SQL} AS fare_due
         FROM bookings bk
         JOIN trips tr ON tr.trip_id = bk.trip_id
         JOIN routes rt ON rt.route_id = tr.route_id
         WHERE bk.booking_id IN (?)
         ORDER BY bk.booking_id
         FOR UPDATE`,
        [bookingIds]
      );
      const byId = new Map(bookings.map((b) => [b.booking_id, b]));
      for (const id of bookingIds) {
        const booking = byId.get(id);
        // Someone else's booking looks exactly like a missing one (no IDOR leak).
        if (!booking || booking.passenger_id !== req.user.id) {
          await conn.rollback();
          return res.status(404).json({ error: `Booking #${id} not found` });
        }
        const refusal = whyBookingNotPayable(booking);
        if (refusal) {
          await conn.rollback();
          return res.status(409).json({ error: refusal, bookingId: id });
        }
      }

      // Latest attempt per booking decides whether a (re)submission is allowed.
      const [history] = await conn.query(
        `SELECT booking_id, status, payment_id FROM payments WHERE booking_id IN (?) ORDER BY payment_id FOR UPDATE`,
        [bookingIds]
      );
      for (const id of bookingIds) {
        const attempts = history.filter((h) => h.booking_id === id);
        const latest = attempts[attempts.length - 1];
        const ref = bookingReference(id, byId.get(id).booked_at);
        if (latest && OPEN_STATUSES.includes(latest.status)) {
          await conn.rollback();
          return res.status(409).json({ error: `A payment for booking ${ref} is already being reviewed. You'll be notified once it's checked.`, bookingId: id });
        }
        if (attempts.some((a) => FUNDS_RECEIVED_STATUSES.includes(a.status))) {
          await conn.rollback();
          return res.status(409).json({ error: `Booking ${ref} has already been paid.`, bookingId: id });
        }
        if (latest && !RESUBMITTABLE_STATUSES.includes(latest.status)) {
          await conn.rollback();
          return res.status(409).json({ error: `Booking ${ref} can't take a new payment right now.`, bookingId: id });
        }
        if (attempts.length >= MAX_ATTEMPTS_PER_BOOKING) {
          await conn.rollback();
          return res.status(409).json({
            error: `Booking ${ref} has reached the limit of ${MAX_ATTEMPTS_PER_BOOKING} payment submissions. Please contact the terminal.`,
            bookingId: id,
          });
        }
        if (latest) isResubmission = true;
      }

      // A reference already verified for any other transfer is a reused or
      // borrowed receipt — refused outright. (Same reference still under
      // review elsewhere is allowed but flagged to staff: blocking it would
      // let whoever submits a stolen reference first lock out its owner.)
      const [[claim]] = await conn.query(
        `SELECT submission_id FROM payment_reference_claims WHERE payment_method = ? AND reference_normalized = ?`,
        [method.method_type, reference.normalized]
      );
      if (claim) {
        await conn.rollback();
        return res.status(409).json({ error: "This reference number has already been used for another payment. Check the reference on your receipt." });
      }

      for (const id of bookingIds) {
        const fare = toCentavos(byId.get(id).fare_due);
        if (fare == null) {
          await conn.rollback();
          return res.status(409).json({ error: "A fare on this booking isn't valid — please pay at the terminal." });
        }
        dueCentavos += fare;
      }

      const [sub] = await conn.query(
        `INSERT INTO payment_submissions
           (passenger_id, method_id, payment_method, reference_number, reference_normalized, amount_due, amount_claimed,
            paid_at, receipt_data, receipt_mime, receipt_bytes, receipt_sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.id,
          method.method_id,
          method.method_type,
          reference.display,
          reference.normalized,
          centavosToDecimal(dueCentavos),
          centavosToDecimal(claimed),
          paidAt,
          receipt.base64,
          receipt.mime,
          receipt.bytes,
          receipt.sha256,
        ]
      );
      submissionId = sub.insertId;

      for (const id of bookingIds) {
        const booking = byId.get(id);
        const fare = toCentavos(booking.fare_due);
        const [result] = await conn.query(
          `INSERT INTO payments (booking_id, submission_id, amount, reference_number, status) VALUES (?, ?, ?, ?, 'Pending')`,
          [id, submissionId, centavosToDecimal(fare), reference.display]
        );
        createdPayments.push({ payment_id: result.insertId, booking_id: id, seat_number: booking.seat_number, amount: centavosToNumber(fare) });
        await logPaymentEvent(conn, {
          actor: req.user,
          action: isResubmission ? "resubmitted" : "submitted",
          paymentId: result.insertId,
          submissionId,
          bookingId: id,
          previousStatus: null,
          newStatus: "Pending",
          details: {
            method: method.method_type,
            reference: reference.display,
            amountDue: centavosToDecimal(fare),
            amountClaimedForTransfer: centavosToDecimal(claimed),
            receiptBytes: receipt.bytes,
          },
        });
      }
      await conn.commit();
    } catch (err) {
      await conn?.rollback().catch(() => {});
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "A payment for this booking is already being reviewed." });
      }
      if (isLockConflict(err)) return res.status(409).json({ error: "This booking was busy for a moment. Please try again." });
      console.error(err);
      return res.status(500).json({ error: "Failed to submit your payment" });
    } finally {
      conn?.release();
    }

    // After commit: duplicate flags + notifications (non-fatal).
    let duplicates = [];
    try {
      duplicates = await findDuplicates(pool, { submission_id: submissionId, passenger_id: req.user.id, reference_normalized: reference.normalized, receipt_sha256: receipt.sha256 });
    } catch (err) {
      console.error("Duplicate check failed (non-fatal):", err.message);
    }
    const mismatch = claimed !== dueCentavos;
    const codes = createdPayments.map((p) => `#${p.booking_id}`).join(", ");
    await notifyRecipient(
      io,
      { type: "passenger", id: req.user.id },
      `Payment proof received for booking ${codes} (ref ${reference.display}). Staff will verify it against our account — uploading a receipt doesn't confirm the booking until they do.`,
      "payment_submitted"
    );
    await notifyStaff(
      io,
      `New payment to verify: submission #${submissionId} · ${formatPesoCentavos(claimed)} via ${METHOD_LABELS[method.method_type]} (ref ${reference.display}) for booking ${codes}.`,
      "payment_review_new"
    );
    const otherPassengerDupes = duplicates.filter((d) => !d.same_passenger || d.same_receipt);
    if (otherPassengerDupes.length > 0) {
      await notifyStaff(
        io,
        `Possible duplicate: submission #${submissionId} shares a reference number or receipt image with ${otherPassengerDupes.length} other submission(s). Check before verifying.`,
        "payment_review_duplicate"
      );
    }

    res.status(201).json({
      submission_id: submissionId,
      status: "Pending",
      reference_number: reference.display,
      payment_method: method.method_type,
      amount_due: centavosToNumber(dueCentavos),
      amount_claimed: centavosToNumber(claimed),
      amount_mismatch: mismatch,
      payments: createdPayments,
      message: "Proof received. Your payment is under review — it isn't confirmed until staff verify the money arrived.",
    });
  });

  // ==========================================================================
  // Passenger (own) / staff: payment status for one booking
  // ==========================================================================
  router.get("/booking/:bookingId", authenticate, async (req, res) => {
    const role = req.user.role;
    if (!["passenger", "staff", "admin"].includes(role)) return res.status(403).json({ error: "Forbidden: insufficient role" });
    const bookingId = parseId(req.params.bookingId);
    if (!bookingId) return res.status(404).json({ error: "Booking not found" });
    try {
      const [[booking]] = await pool.query(
        `SELECT bk.booking_id, bk.passenger_id, bk.status, bk.channel, bk.booked_at, bk.payment_deadline, bk.cancellation_reason,
                tr.status AS trip_status, tr.departure_time, rt.base_fare, ${FARE_DUE_SQL} AS fare_due, bk.discount_category
         FROM bookings bk
         JOIN trips tr ON tr.trip_id = bk.trip_id
         JOIN routes rt ON rt.route_id = tr.route_id
         WHERE bk.booking_id = ?`,
        [bookingId]
      );
      if (!booking || (role === "passenger" && booking.passenger_id !== req.user.id)) {
        return res.status(404).json({ error: "Booking not found" });
      }
      const [rows] = await pool.query(`${PASSENGER_PAYMENT_SELECT} WHERE p.booking_id = ? ORDER BY p.payment_id DESC`, [booking.booking_id]);
      const history = rows.map(passengerPaymentJson);
      const latest = history[0] ?? null;
      const paid = history.some((h) => FUNDS_RECEIVED_STATUSES.includes(h.status));
      const attemptsLeft = Math.max(0, MAX_ATTEMPTS_PER_BOOKING - history.length);
      const canPay =
        !whyBookingNotPayable(booking) &&
        !paid &&
        attemptsLeft > 0 &&
        (!latest || RESUBMITTABLE_STATUSES.includes(latest.status));

      res.json({
        booking_id: booking.booking_id,
        booking_reference: bookingReference(booking.booking_id, booking.booked_at),
        booking_status: booking.status,
        cancellation_reason: booking.cancellation_reason,
        channel: booking.channel,
        trip_status: booking.trip_status,
        departure_time: booking.departure_time,
        amount_due: centavosToNumber(centavosOf(booking.fare_due)),
        discount_category: booking.discount_category,
        payment_deadline: booking.payment_deadline,
        payment_status: latest ? latest.status : "Awaiting Payment",
        can_pay: canPay,
        attempts_left: attemptsLeft,
        not_payable_reason: canPay ? null : whyBookingNotPayable(booking),
        review_sla_minutes: paymentConfig.reviewSlaMinutes,
        payment: latest,
        history,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load payment status" });
    }
  });

  // Passenger payment history across all their bookings.
  router.get("/mine", requireRole("passenger"), async (req, res) => {
    try {
      const [rows] = await pool.query(
        `${PASSENGER_PAYMENT_SELECT} WHERE bk.passenger_id = ? ORDER BY p.payment_id DESC LIMIT 200`,
        [req.user.id]
      );
      res.json(rows.map(passengerPaymentJson));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load your payments" });
    }
  });

  // ==========================================================================
  // Receipt image — private. Passenger: own submissions only. Staff: any.
  // Served as the image itself (never a public URL), not cacheable.
  // ==========================================================================
  router.get("/submissions/:id/receipt", authenticate, receiptLimiter, async (req, res) => {
    const id = parseId(req.params.id);
    const role = req.user.role;
    if (!id || !["passenger", "staff", "admin"].includes(role)) return res.status(404).json({ error: "Receipt not found" });
    try {
      const [[row]] = await pool.query(`SELECT passenger_id, receipt_data, receipt_mime FROM payment_submissions WHERE submission_id = ?`, [id]);
      if (!row || (role === "passenger" && row.passenger_id !== req.user.id)) return res.status(404).json({ error: "Receipt not found" });
      let base64 = row.receipt_data;
      let mime = row.receipt_mime;
      if (!base64) {
        // Legacy rows kept their image on the payments row.
        const [[legacy]] = await pool.query(`SELECT proof_image FROM payments WHERE submission_id = ? AND proof_image IS NOT NULL LIMIT 1`, [id]);
        const m = /^data:(image\/[a-z]+);base64,(.+)$/s.exec(legacy?.proof_image ?? "");
        if (m) [, mime, base64] = m;
      }
      if (!base64) return res.status(404).json({ error: "No receipt was uploaded for this payment" });
      const buf = Buffer.from(base64, "base64");
      const actual = detectImageType(buf) ?? (mime === "image/gif" ? "image/gif" : null);
      if (!actual) return res.status(404).json({ error: "The stored receipt couldn't be read" });
      res.set({
        "Content-Type": actual,
        "Content-Length": String(buf.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="receipt-${id}"`,
        "Content-Security-Policy": "default-src 'none'",
      });
      res.end(buf);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load the receipt" });
    }
  });

  // ==========================================================================
  // Staff / admin: dashboard summary
  // ==========================================================================
  router.get("/summary", requireRole("staff", "admin"), async (req, res) => {
    try {
      // Counted per transfer (submission), using each submission's rows.
      const [byStatus] = await pool.query(
        `SELECT p.status, COUNT(DISTINCT p.submission_id) AS n,
                COUNT(DISTINCT CASE WHEN s.assigned_to IS NOT NULL THEN p.submission_id END) AS assigned
         FROM payments p JOIN payment_submissions s ON s.submission_id = p.submission_id
         GROUP BY p.status`
      );
      const counts = Object.fromEntries(PAYMENT_STATUSES.map((s) => [s, 0]));
      let pendingAssigned = 0;
      for (const r of byStatus) {
        counts[r.status] = Number(r.n);
        if (r.status === "Pending") pendingAssigned = Number(r.assigned);
      }
      const [[overdue]] = await pool.query(
        `SELECT COUNT(DISTINCT p.submission_id) AS n FROM payments p JOIN payment_submissions s ON s.submission_id = p.submission_id
         WHERE p.status IN ('Pending', 'Escalated') AND s.submitted_at < NOW() - INTERVAL ? MINUTE`,
        [paymentConfig.reviewSlaMinutes]
      );
      const [[departingSoon]] = await pool.query(
        `SELECT COUNT(DISTINCT p.submission_id) AS n FROM payments p
         JOIN bookings bk ON bk.booking_id = p.booking_id JOIN trips tr ON tr.trip_id = bk.trip_id
         WHERE p.status IN ('Pending', 'Escalated') AND tr.departure_time BETWEEN NOW() AND NOW() + INTERVAL ? HOUR`,
        [paymentConfig.departureAlertHours]
      );
      const [recent] = await pool.query(
        `SELECT l.audit_log_id, l.action, l.previous_status, l.new_status, l.submission_id, l.payment_id, l.booking_id,
                l.actor_role, l.created_at,
                CASE WHEN l.actor_role IN ('staff', 'admin') THEN sa.name WHEN l.actor_role = 'passenger' THEN c.name ELSE 'System' END AS actor_name
         FROM payment_audit_logs l
         LEFT JOIN staff_accounts sa ON l.actor_role IN ('staff', 'admin') AND sa.staff_id = l.actor_id
         LEFT JOIN commuters c ON l.actor_role = 'passenger' AND c.commuter_id = l.actor_id
         WHERE l.action <> 'legacy_backfill'
         ORDER BY l.audit_log_id DESC LIMIT 15`
      );
      res.json({
        awaitingReview: counts.Pending - pendingAssigned,
        underReview: pendingAssigned,
        pendingTotal: counts.Pending,
        verified: counts.Verified,
        rejected: counts.Rejected,
        needsResubmission: counts["Needs Resubmission"],
        escalated: counts.Escalated,
        refundPending: counts["Refund Pending"],
        refunded: counts.Refunded,
        overdue: Number(overdue.n),
        departingSoon: Number(departingSoon.n),
        reviewSlaMinutes: paymentConfig.reviewSlaMinutes,
        departureAlertHours: paymentConfig.departureAlertHours,
        recentActivity: recent,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load the payment summary" });
    }
  });

  // ==========================================================================
  // Staff / admin: review queue, one row per transfer (submission).
  // ?status=open|all|<status> &method= &from=YYYY-MM-DD &to= &routeId=
  // &departingWithinHours= &q= (booking ref, name, reference no.)
  // &assigned=me &sort=priority|oldest|newest
  // ==========================================================================
  router.get("/queue", requireRole("staff", "admin"), async (req, res) => {
    const { status = "open", method, from, to, q, assigned, sort = "priority" } = req.query;
    const conditions = [];
    const params = [];

    if (status === "open") conditions.push("p.status IN ('Pending', 'Escalated')");
    else if (status !== "all") {
      if (!PAYMENT_STATUSES.includes(status)) return res.status(400).json({ error: "Unknown status filter" });
      conditions.push("p.status = ?");
      params.push(status);
    }
    if (method) {
      if (!PAYMENT_METHOD_TYPES.includes(method)) return res.status(400).json({ error: "Unknown payment method filter" });
      conditions.push("s.payment_method = ?");
      params.push(method);
    }
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (from) {
      if (!dateRe.test(from)) return res.status(400).json({ error: "from must be YYYY-MM-DD" });
      conditions.push("s.submitted_at >= ?");
      params.push(`${from} 00:00:00`);
    }
    if (to) {
      if (!dateRe.test(to)) return res.status(400).json({ error: "to must be YYYY-MM-DD" });
      conditions.push("s.submitted_at < ? + INTERVAL 1 DAY");
      params.push(`${to} 00:00:00`);
    }
    if (req.query.routeId) {
      const routeId = parseId(req.query.routeId);
      if (!routeId) return res.status(400).json({ error: "routeId must be a number" });
      conditions.push("rt.route_id = ?");
      params.push(routeId);
    }
    if (req.query.departingWithinHours) {
      const hours = Number(req.query.departingWithinHours);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 720) return res.status(400).json({ error: "departingWithinHours must be 1–720" });
      conditions.push("tr.departure_time BETWEEN NOW() AND NOW() + INTERVAL ? MINUTE");
      params.push(Math.round(hours * 60));
    }
    if (assigned === "me") {
      conditions.push("s.assigned_to = ?");
      params.push(req.user.id);
    }
    const search = String(q ?? "").trim().slice(0, 100);
    if (search) {
      const bookingId = parseBookingReference(search);
      const parts = ["c.name LIKE ?", "bk.passenger_name LIKE ?", "s.reference_normalized LIKE ?"];
      params.push(`%${likeEscape(search)}%`, `%${likeEscape(search)}%`, `%${search.toUpperCase().replace(/[^A-Z0-9]/g, "")}%`);
      if (bookingId) {
        parts.push("p.booking_id = ?", "s.submission_id = ?");
        params.push(bookingId, bookingId);
      }
      conditions.push(`(${parts.join(" OR ")})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const order =
      sort === "oldest"
        ? "first_submitted ASC, s.submission_id ASC"
        : sort === "newest"
          ? "s.submission_id DESC"
          : // priority: undecided first, then the soonest departure, then oldest
            "has_open DESC, (earliest_departure < NOW()) ASC, earliest_departure ASC, s.submission_id ASC";

    try {
      const [subs] = await pool.query(
        `SELECT s.submission_id, MIN(s.submitted_at) AS first_submitted,
                MAX(p.status IN ('Pending', 'Escalated')) AS has_open,
                MIN(tr.departure_time) AS earliest_departure
         FROM payment_submissions s
         JOIN payments p ON p.submission_id = s.submission_id
         JOIN bookings bk ON bk.booking_id = p.booking_id
         JOIN commuters c ON c.commuter_id = s.passenger_id
         JOIN trips tr ON tr.trip_id = bk.trip_id
         JOIN routes rt ON rt.route_id = tr.route_id
         ${where}
         GROUP BY s.submission_id
         ORDER BY ${order}
         LIMIT 300`,
        params
      );
      if (subs.length === 0) return res.json([]);
      const ids = subs.map((s) => s.submission_id);
      const [details] = await pool.query(
        `SELECT s.submission_id, s.passenger_id, s.payment_method, s.reference_number, s.reference_normalized, s.amount_due,
                s.amount_claimed, s.amount_received, s.paid_at, s.submitted_at, s.is_legacy, s.receipt_sha256,
                (s.receipt_data IS NOT NULL) AS has_receipt, s.assigned_to, s.assigned_at, asg.name AS assigned_to_name,
                pm.display_name AS method_name, c.name AS passenger_account_name,
                (SELECT COUNT(*) FROM payment_submissions d WHERE d.submission_id <> s.submission_id AND d.reference_normalized = s.reference_normalized) AS duplicate_reference_count,
                (SELECT COUNT(*) FROM payment_submissions d WHERE d.submission_id <> s.submission_id AND s.receipt_sha256 IS NOT NULL AND d.receipt_sha256 = s.receipt_sha256) AS duplicate_receipt_count
         FROM payment_submissions s
         JOIN commuters c ON c.commuter_id = s.passenger_id
         LEFT JOIN payment_methods pm ON pm.method_id = s.method_id
         LEFT JOIN staff_accounts asg ON asg.staff_id = s.assigned_to
         WHERE s.submission_id IN (?)`,
        [ids]
      );
      const [rows] = await pool.query(`${PAYMENT_ROW_SELECT} WHERE p.submission_id IN (?) ORDER BY p.payment_id`, [ids]);
      const detailById = new Map(details.map((d) => [d.submission_id, d]));
      const slaCutoff = Date.now() - paymentConfig.reviewSlaMinutes * 60000;
      const soonCutoff = Date.now() + paymentConfig.departureAlertHours * 3600000;
      res.json(
        subs.map(({ submission_id }) => {
          const d = detailById.get(submission_id);
          const seats = rows.filter((r) => r.submission_id === submission_id).map(paymentRowJson);
          const statuses = [...new Set(seats.map((r) => r.status))];
          const due = centavosOf(d.amount_due);
          const claimedC = centavosOf(d.amount_claimed);
          const open = seats.some((r) => OPEN_STATUSES.includes(r.status));
          const earliest = seats.reduce((min, r) => (!min || new Date(r.departure_time) < new Date(min) ? r.departure_time : min), null);
          return {
            submission_id,
            status: statuses.length === 1 ? statuses[0] : "Mixed",
            statuses,
            passenger_id: d.passenger_id,
            passenger_name: seats[0]?.passenger_name ?? d.passenger_account_name,
            passenger_phone: seats[0]?.passenger_phone,
            passenger_email: seats[0]?.passenger_email,
            payment_method: d.payment_method,
            method_label: METHOD_LABELS[d.payment_method],
            method_name: d.method_name,
            reference_number: d.reference_number,
            amount_due: centavosToNumber(due),
            amount_claimed: centavosToNumber(claimedC),
            amount_received: centavosToNumber(centavosOf(d.amount_received)),
            amount_mismatch: claimedC != null && claimedC !== due,
            paid_at: d.paid_at,
            submitted_at: d.submitted_at,
            is_legacy: Boolean(d.is_legacy),
            has_receipt: Boolean(d.has_receipt) || Boolean(d.is_legacy),
            assigned_to: d.assigned_to,
            assigned_to_name: d.assigned_to_name,
            duplicate_reference_count: Number(d.duplicate_reference_count),
            duplicate_receipt_count: Number(d.duplicate_receipt_count),
            sla_overdue: open && new Date(d.submitted_at).getTime() < slaCutoff,
            departing_soon: open && earliest && new Date(earliest).getTime() < soonCutoff && new Date(earliest).getTime() > Date.now(),
            earliest_departure: earliest,
            seats,
          };
        })
      );
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load payments" });
    }
  });

  // ==========================================================================
  // Staff / admin: one transfer with everything needed to decide on it
  // ==========================================================================
  router.get("/submissions/:id", requireRole("staff", "admin"), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: "Payment not found" });
    try {
      const [[s]] = await pool.query(
        `SELECT s.submission_id, s.passenger_id, s.method_id, s.payment_method, s.reference_number, s.reference_normalized,
                s.amount_due, s.amount_claimed, s.amount_received, s.ledger_reference, s.paid_at, s.submitted_at, s.is_legacy,
                s.receipt_sha256, s.receipt_mime, s.receipt_bytes, (s.receipt_data IS NOT NULL) AS has_receipt,
                s.assigned_to, s.assigned_at, asg.name AS assigned_to_name,
                pm.display_name AS method_name, pm.account_name AS method_account_name, pm.account_number AS method_account_number,
                pm.bank_name AS method_bank_name, c.name AS passenger_account_name, c.email AS passenger_email, c.phoneno AS passenger_phone
         FROM payment_submissions s
         JOIN commuters c ON c.commuter_id = s.passenger_id
         LEFT JOIN payment_methods pm ON pm.method_id = s.method_id
         LEFT JOIN staff_accounts asg ON asg.staff_id = s.assigned_to
         WHERE s.submission_id = ?`,
        [id]
      );
      if (!s) return res.status(404).json({ error: "Payment not found" });
      const [rows] = await pool.query(`${PAYMENT_ROW_SELECT} WHERE p.submission_id = ? ORDER BY p.payment_id`, [id]);
      const seats = rows.map(paymentRowJson);
      const bookingIds = seats.map((r) => r.booking_id);
      const duplicates = await findDuplicates(pool, s);
      const [[claim]] = await pool.query(
        `SELECT cl.submission_id, cl.claimed_at, sa.name AS claimed_by_name FROM payment_reference_claims cl
         LEFT JOIN staff_accounts sa ON sa.staff_id = cl.claimed_by
         WHERE cl.payment_method = ? AND cl.reference_normalized = ?`,
        [s.payment_method, s.reference_normalized]
      );
      const [previous] = bookingIds.length
        ? await pool.query(
            `SELECT p.payment_id, p.submission_id, p.booking_id, p.status, p.rejection_reason, p.reference_number, p.submitted_at,
                    s2.amount_claimed, s2.payment_method
             FROM payments p LEFT JOIN payment_submissions s2 ON s2.submission_id = p.submission_id
             WHERE p.booking_id IN (?) AND (p.submission_id IS NULL OR p.submission_id <> ?)
             ORDER BY p.payment_id DESC`,
            [bookingIds, id]
          )
        : [[]];
      const paymentIds = seats.map((r) => r.payment_id);
      const [history] = await pool.query(
        `SELECT l.audit_log_id, l.payment_id, l.submission_id, l.booking_id, l.action, l.previous_status, l.new_status,
                l.reason, l.internal_note, l.details, l.actor_role, l.created_at,
                CASE WHEN l.actor_role IN ('staff', 'admin') THEN sa.name WHEN l.actor_role = 'passenger' THEN c.name ELSE 'System' END AS actor_name
         FROM payment_audit_logs l
         LEFT JOIN staff_accounts sa ON l.actor_role IN ('staff', 'admin') AND sa.staff_id = l.actor_id
         LEFT JOIN commuters c ON l.actor_role = 'passenger' AND c.commuter_id = l.actor_id
         WHERE l.submission_id = ? ${paymentIds.length ? "OR l.payment_id IN (?)" : ""} ${bookingIds.length ? "OR (l.booking_id IN (?) AND l.payment_id IS NULL AND l.submission_id IS NULL)" : ""}
         ORDER BY l.audit_log_id ASC`,
        [id, ...(paymentIds.length ? [paymentIds] : []), ...(bookingIds.length ? [bookingIds] : [])]
      );
      const due = centavosOf(s.amount_due);
      const claimedC = centavosOf(s.amount_claimed);
      res.json({
        submission_id: s.submission_id,
        statuses: [...new Set(seats.map((r) => r.status))],
        passenger_id: s.passenger_id,
        passenger_name: seats[0]?.passenger_name ?? s.passenger_account_name,
        passenger_account_name: s.passenger_account_name,
        passenger_email: s.passenger_email,
        passenger_phone: s.passenger_phone,
        payment_method: s.payment_method,
        method_label: METHOD_LABELS[s.payment_method],
        method_name: s.method_name,
        method_account_name: s.method_account_name,
        method_account_number: s.method_account_number,
        method_bank_name: s.method_bank_name,
        reference_number: s.reference_number,
        reference_normalized: s.reference_normalized,
        amount_due: centavosToNumber(due),
        amount_claimed: centavosToNumber(claimedC),
        amount_received: centavosToNumber(centavosOf(s.amount_received)),
        amount_mismatch: claimedC != null && claimedC !== due,
        ledger_reference: s.ledger_reference,
        paid_at: s.paid_at,
        submitted_at: s.submitted_at,
        is_legacy: Boolean(s.is_legacy),
        has_receipt: Boolean(s.has_receipt) || Boolean(s.is_legacy),
        receipt_mime: s.receipt_mime,
        receipt_bytes: s.receipt_bytes,
        assigned_to: s.assigned_to,
        assigned_to_name: s.assigned_to_name,
        reference_claim: claim ?? null,
        reference_already_verified_elsewhere: Boolean(claim && claim.submission_id !== s.submission_id),
        duplicates,
        previous_attempts: previous.map((p) => ({
          ...p,
          amount_claimed: centavosToNumber(centavosOf(p.amount_claimed)),
          booking_reference: bookingReference(p.booking_id, seats.find((r) => r.booking_id === p.booking_id)?.booked_at),
        })),
        history: history.map((h) => ({ ...h, details: typeof h.details === "string" ? JSON.parse(h.details) : h.details })),
        seats,
        sla_minutes: paymentConfig.reviewSlaMinutes,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load the payment" });
    }
  });

  // ==========================================================================
  // Staff decisions on a whole transfer. Every action:
  //   - locks the booking, submission and payment rows (one order, always)
  //   - re-checks the CURRENT status under that lock with the transition
  //     validator, so a retry/double-click/second reviewer gets 409 and the
  //     side effects (confirming seats, notifications) never run twice
  //   - writes payment_audit_logs in the same transaction
  // ==========================================================================
  async function decide(req, res, action, perform) {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: "Payment not found" });
    let conn;
    let outcome;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const locked = await lockSubmission(conn, id);
      if (!locked?.submission) {
        await conn.rollback();
        return res.status(404).json({ error: "Payment not found" });
      }
      const target = transitionTarget(action);
      const actionable = locked.payments.filter((p) => !whyPaymentTransitionNotAllowed({ role: req.user.role, action, from: p.status }));
      if (actionable.length === 0) {
        await conn.rollback();
        const current = [...new Set(locked.payments.map((p) => p.status))];
        const refusal = whyPaymentTransitionNotAllowed({ role: req.user.role, action, from: locked.payments[0].status });
        const already = current.includes(target);
        // 403 = wrong role for this state (e.g. staff on an Escalated
        // payment); 409 = the state itself doesn't allow it (already decided).
        const forbidden = !already && /administrator|permission/.test(refusal ?? "");
        return res.status(forbidden ? 403 : 409).json({
          error: already ? `This payment is already ${current.join(", ").toLowerCase()} — nothing was changed.` : refusal,
          statuses: current,
        });
      }
      outcome = await perform({ conn, locked, actionable, target });
      if (outcome?.error) {
        await conn.rollback();
        return res.status(outcome.status ?? 409).json({ error: outcome.error, ...(outcome.extra ?? {}) });
      }
      await conn.commit();
    } catch (err) {
      await conn?.rollback().catch(() => {});
      if (isLockConflict(err)) return res.status(409).json({ error: "Someone else is updating this payment. Refresh and try again." });
      if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "This booking already has a verified payment. Refresh to see it." });
      console.error(err);
      return res.status(500).json({ error: "Failed to update the payment" });
    } finally {
      conn?.release();
    }
    await outcome.after?.();
    changed(action);
    res.json(outcome.response);
  }

  // PATCH /submissions/:id/verify
  // body: { fundsConfirmed: true, amountReceived, ledgerReference?, acknowledgeDuplicate?, note? }
  router.patch("/submissions/:id/verify", requireRole("staff", "admin"), staffActionLimiter, (req, res) => {
    const body = req.body ?? {};
    if (body.fundsConfirmed !== true) {
      return res.status(400).json({
        error: "Confirm that you found this exact payment in the official account or merchant records. A screenshot alone is not proof.",
      });
    }
    const received = toCentavos(body.amountReceived);
    if (received == null || received <= 0) return res.status(400).json({ error: "Enter the amount you actually saw received in the account" });
    const ledgerReference = cleanText(body.ledgerReference, 100);
    const note = cleanText(body.note, MAX_NOTE_LENGTH);

    return decide(req, res, "verify", async ({ conn, locked, actionable }) => {
      const { submission, bookings } = locked;
      // Verifying is all-or-nothing for the transfer: every seat on it must
      // still be undecided, otherwise staff are looking at stale data.
      if (actionable.length !== locked.payments.length) {
        return { error: "Some seats on this payment were already decided. Refresh before verifying." };
      }
      const due = actionable.reduce((sum, p) => sum + toCentavos(p.amount), 0);
      if (received < due) {
        return {
          error: `The amount received (${formatPesoCentavos(received)}) is less than the fare due (${formatPesoCentavos(due)}). An underpayment can't be verified — reject it or ask the passenger for the rest.`,
        };
      }
      const duplicates = await findDuplicates(conn, submission);
      const suspicious = duplicates.filter((d) => !d.same_passenger || d.same_receipt);
      if (suspicious.length > 0 && body.acknowledgeDuplicate !== true) {
        return {
          error: `This reference number or receipt also appears on ${suspicious.length} other submission(s). Review them, then confirm it's not a duplicate.`,
          extra: { code: "DUPLICATE_ACK_REQUIRED", duplicates: suspicious },
        };
      }
      // One real transaction, one claim — enforced by a unique key, so two
      // reviewers verifying different submissions with the same reference
      // at the same moment can't both succeed.
      try {
        await conn.query(
          `INSERT INTO payment_reference_claims (payment_method, reference_normalized, submission_id, claimed_by) VALUES (?, ?, ?, ?)`,
          [submission.payment_method, submission.reference_normalized, submission.submission_id, req.user.id]
        );
      } catch (err) {
        if (err.code !== "ER_DUP_ENTRY") throw err;
        const [[existing]] = await conn.query(
          `SELECT submission_id FROM payment_reference_claims WHERE payment_method = ? AND reference_normalized = ?`,
          [submission.payment_method, submission.reference_normalized]
        );
        if (existing?.submission_id !== submission.submission_id) {
          return { error: `This reference number was already verified for another payment (submission #${existing?.submission_id}). It can't pay for a second booking.` };
        }
      }
      await conn.query(
        `UPDATE payment_submissions SET amount_received = ?, ledger_reference = ? WHERE submission_id = ?`,
        [centavosToDecimal(received), ledgerReference, submission.submission_id]
      );

      const results = [];
      for (const p of actionable) {
        const booking = bookings.get(p.booking_id);
        const [[alreadyPaid]] = await conn.query(
          `SELECT payment_id FROM payments WHERE booking_id = ? AND status = 'Verified' AND payment_id <> ? FOR UPDATE`,
          [p.booking_id, p.payment_id]
        );
        // Money that arrived for a seat that can't use it (already paid, or
        // the booking was cancelled meanwhile) is recorded as received AND
        // owed back: Verified, then straight to Refund Pending.
        const refundReason = alreadyPaid
          ? "Booking was already paid by another payment"
          : booking.status === "Cancelled"
            ? "Booking was cancelled before the payment was verified"
            : null;
        // (One UPDATE either way: briefly setting Verified on an already-paid
        // seat would collide with uq_payments_verified_booking.)
        await conn.query(
          `UPDATE payments SET status = ?, verified_at = NOW(), verified_by = ?, rejection_reason = NULL,
                  refund_reason = ?, refund_requested_at = ${refundReason ? "NOW()" : "NULL"}
           WHERE payment_id = ?`,
          [refundReason ? "Refund Pending" : "Verified", req.user.id, refundReason, p.payment_id]
        );
        await logPaymentEvent(conn, {
          actor: req.user,
          action: "verified",
          paymentId: p.payment_id,
          submissionId: submission.submission_id,
          bookingId: p.booking_id,
          previousStatus: p.status,
          newStatus: "Verified",
          internalNote: note,
          details: {
            fundsConfirmed: true,
            amountReceivedForTransfer: centavosToDecimal(received),
            amountDueForTransfer: centavosToDecimal(due),
            ledgerReference,
            duplicatesAcknowledged: suspicious.length > 0 ? suspicious.map((d) => d.submission_id) : undefined,
          },
        });
        let refund = null;
        if (refundReason) {
          refund = alreadyPaid ? "duplicate" : "cancelled";
          await logPaymentEvent(conn, {
            actor: null,
            action: "refund_requested",
            paymentId: p.payment_id,
            submissionId: submission.submission_id,
            bookingId: p.booking_id,
            previousStatus: "Verified",
            newStatus: "Refund Pending",
            reason: refundReason,
          });
        }
        let confirmed = false;
        if (!refund && booking.status === "Reserved" && !["Cancelled", "Completed"].includes(booking.trip_status)) {
          const [r] = await conn.query(`UPDATE bookings SET status = 'Confirmed' WHERE booking_id = ? AND status = 'Reserved'`, [p.booking_id]);
          confirmed = r.affectedRows === 1;
        }
        results.push({ payment_id: p.payment_id, booking_id: p.booking_id, seat_number: booking.seat_number, booking_status: confirmed ? "Confirmed" : booking.status, booking_confirmed: confirmed, refund });
      }
      const overpaid = received - due;
      return {
        response: {
          submission_id: submission.submission_id,
          status: "Verified",
          amount_due: centavosToNumber(due),
          amount_received: centavosToNumber(received),
          overpaid: overpaid > 0 ? centavosToNumber(overpaid) : 0,
          seats: results,
        },
        after: async () => {
          for (const r of results) {
            const ref = bookingReference(r.booking_id, bookings.get(r.booking_id).booked_at);
            const message = r.booking_confirmed
              ? `Payment verified — booking #${r.booking_id} (${ref}, seat ${r.seat_number}) is confirmed. Your official receipt is ready.`
              : r.refund === "cancelled"
                ? `Your payment for booking #${r.booking_id} (${ref}) was received, but the booking had already been cancelled. A refund has been opened — staff will contact you.`
                : r.refund === "duplicate"
                  ? `Your payment for booking #${r.booking_id} (${ref}) was received, but the seat was already paid. The extra payment will be refunded.`
                  : `Your payment for booking #${r.booking_id} (${ref}) has been verified. Your official receipt is ready.`;
            await notifyRecipient(io, { type: "passenger", id: submission.passenger_id }, message, r.refund ? "payment_refund" : "payment_verified");
          }
          await logAudit({
            staffId: req.user.id,
            action: "verify",
            entityType: "payment",
            entityId: submission.submission_id,
            details: { submissionId: submission.submission_id, amountReceived: centavosToDecimal(received), bookings: results.map((r) => r.booking_id) },
          });
        },
      };
    });
  });

  // reject + request resubmission share everything but the target status.
  function reviewWithReason(action, { verb }) {
    return (req, res) => {
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return res.status(400).json({ error: "Give a reason — the passenger will see it" });
      if (reason.length > MAX_REASON_LENGTH) return res.status(400).json({ error: `Keep the reason under ${MAX_REASON_LENGTH} characters` });
      const note = cleanText(req.body?.note, MAX_NOTE_LENGTH);
      return decide(req, res, action, async ({ conn, locked, actionable, target }) => {
        const { submission, bookings } = locked;
        const deadlines = {};
        for (const p of actionable) {
          await conn.query(
            `UPDATE payments SET status = ?, rejection_reason = ?, verified_at = NOW(), verified_by = ? WHERE payment_id = ?`,
            [target, reason, req.user.id, p.payment_id]
          );
          await logPaymentEvent(conn, {
            actor: req.user,
            action: action === "reject" ? "rejected" : "resubmission_requested",
            paymentId: p.payment_id,
            submissionId: submission.submission_id,
            bookingId: p.booking_id,
            previousStatus: p.status,
            newStatus: target,
            reason,
            internalNote: note,
          });
          deadlines[p.booking_id] = await extendDeadline(conn, bookings.get(p.booking_id));
        }
        await conn.query(`UPDATE payment_submissions SET assigned_to = NULL, assigned_at = NULL WHERE submission_id = ?`, [submission.submission_id]);
        return {
          response: { submission_id: submission.submission_id, status: target, reason, payment_deadlines: deadlines },
          after: async () => {
            for (const p of actionable) {
              const booking = bookings.get(p.booking_id);
              const deadline = deadlines[p.booking_id];
              const ref = bookingReference(p.booking_id, booking.booked_at);
              const window = deadline ? ` Please resubmit before ${new Date(deadline).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })} or the seat will be released.` : "";
              await notifyRecipient(
                io,
                { type: "passenger", id: submission.passenger_id },
                action === "reject"
                  ? `Payment for booking #${p.booking_id} (${ref}) couldn't be verified: ${reason}.${booking.status === "Reserved" ? ` You can submit a corrected payment proof.${window}` : ""}`
                  : `We need a clearer receipt or more details for booking #${p.booking_id} (${ref}): ${reason}.${booking.status === "Reserved" ? window : ""}`,
                action === "reject" ? "payment_rejected" : "payment_resubmission"
              );
            }
            await logAudit({ staffId: req.user.id, action: verb, entityType: "payment", entityId: submission.submission_id, details: { reason } });
          },
        };
      });
    };
  }
  router.patch("/submissions/:id/reject", requireRole("staff", "admin"), staffActionLimiter, reviewWithReason("reject", { verb: "reject" }));
  router.patch(
    "/submissions/:id/request-resubmission",
    requireRole("staff", "admin"),
    staffActionLimiter,
    reviewWithReason("request_resubmission", { verb: "request_resubmission" })
  );

  // PATCH /submissions/:id/escalate — body: { note } (internal, required)
  router.patch("/submissions/:id/escalate", requireRole("staff", "admin"), staffActionLimiter, (req, res) => {
    const note = cleanText(req.body?.note, MAX_NOTE_LENGTH);
    if (!note) return res.status(400).json({ error: "Add a note explaining what needs investigating (staff only)" });
    return decide(req, res, "escalate", async ({ conn, locked, actionable, target }) => {
      for (const p of actionable) {
        await conn.query(`UPDATE payments SET status = ? WHERE payment_id = ?`, [target, p.payment_id]);
        await logPaymentEvent(conn, {
          actor: req.user,
          action: "escalated",
          paymentId: p.payment_id,
          submissionId: locked.submission.submission_id,
          bookingId: p.booking_id,
          previousStatus: p.status,
          newStatus: target,
          internalNote: note,
        });
      }
      return {
        response: { submission_id: locked.submission.submission_id, status: target },
        after: async () => {
          await notifyStaff(io, `Payment escalated: submission #${locked.submission.submission_id} needs an administrator's decision.`, "payment_review_escalated", { adminsOnly: true });
          await logAudit({ staffId: req.user.id, action: "escalate", entityType: "payment", entityId: locked.submission.submission_id });
        },
      };
    });
  });

  // PATCH /submissions/:id/assign — { assign: true|false }: claim it so other
  // reviewers can see someone is checking the account (moves it from
  // "awaiting review" to "under review" on the dashboard).
  router.patch("/submissions/:id/assign", requireRole("staff", "admin"), staffActionLimiter, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: "Payment not found" });
    const assign = req.body?.assign !== false;
    try {
      const [[open]] = await pool.query(
        `SELECT COUNT(*) AS n FROM payments WHERE submission_id = ? AND status IN ('Pending', 'Escalated')`,
        [id]
      );
      if (!Number(open.n)) return res.status(409).json({ error: "Only payments still awaiting a decision can be assigned" });
      const [result] = await pool.query(
        `UPDATE payment_submissions SET assigned_to = ?, assigned_at = ? WHERE submission_id = ? ${assign ? "AND (assigned_to IS NULL OR assigned_to = ?)" : ""}`,
        assign ? [req.user.id, new Date(), id, req.user.id] : [null, null, id]
      );
      if (result.affectedRows === 0) return res.status(409).json({ error: "Another reviewer is already checking this payment" });
      await logPaymentEvent(null, { actor: req.user, action: assign ? "assigned" : "unassigned", submissionId: id });
      changed("assign");
      res.json({ submission_id: id, assigned_to: assign ? req.user.id : null });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to assign the payment" });
    }
  });

  // POST /submissions/:id/notes — internal note, never shown to passengers.
  router.post("/submissions/:id/notes", requireRole("staff", "admin"), staffActionLimiter, async (req, res) => {
    const id = parseId(req.params.id);
    const note = cleanText(req.body?.note, MAX_NOTE_LENGTH);
    if (!id) return res.status(404).json({ error: "Payment not found" });
    if (!note) return res.status(400).json({ error: "Write a note first" });
    try {
      const [[s]] = await pool.query(`SELECT submission_id FROM payment_submissions WHERE submission_id = ?`, [id]);
      if (!s) return res.status(404).json({ error: "Payment not found" });
      await logPaymentEvent(null, { actor: req.user, action: "note", submissionId: id, internalNote: note });
      res.status(201).json({ submission_id: id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to save the note" });
    }
  });

  // ==========================================================================
  // Refunds — per seat (payments row).
  // ==========================================================================
  async function refundAction(req, res, action, perform) {
    const paymentId = parseId(req.params.paymentId);
    if (!paymentId) return res.status(404).json({ error: "Payment not found" });
    let conn;
    let outcome;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [[ids]] = await conn.query(`SELECT booking_id, submission_id FROM payments WHERE payment_id = ?`, [paymentId]);
      if (!ids) {
        await conn.rollback();
        return res.status(404).json({ error: "Payment not found" });
      }
      const [[booking]] = await conn.query(
        `SELECT bk.booking_id, bk.status, bk.passenger_id, bk.booked_at, tr.status AS trip_status
         FROM bookings bk JOIN trips tr ON tr.trip_id = bk.trip_id WHERE bk.booking_id = ? FOR UPDATE`,
        [ids.booking_id]
      );
      if (ids.submission_id) await conn.query(`SELECT submission_id FROM payment_submissions WHERE submission_id = ? FOR UPDATE`, [ids.submission_id]);
      const [[payment]] = await conn.query(`SELECT * FROM payments WHERE payment_id = ? FOR UPDATE`, [paymentId]);
      const refusal = whyPaymentTransitionNotAllowed({ role: req.user.role, action, from: payment.status });
      if (refusal) {
        await conn.rollback();
        return res.status(/administrator|permission/.test(refusal) ? 403 : 409).json({ error: refusal, status: payment.status });
      }
      outcome = await perform({ conn, payment, booking });
      if (outcome.error) {
        await conn.rollback();
        return res.status(outcome.status ?? 409).json({ error: outcome.error });
      }
      await conn.commit();
    } catch (err) {
      await conn?.rollback().catch(() => {});
      if (isLockConflict(err)) return res.status(409).json({ error: "Someone else is updating this payment. Refresh and try again." });
      if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "This booking already has another verified payment." });
      console.error(err);
      return res.status(500).json({ error: "Failed to update the refund" });
    } finally {
      conn?.release();
    }
    await outcome.after?.();
    changed(action);
    res.json(outcome.response);
  }

  // PATCH /:paymentId/refund-request — { reason, cancelBooking? }
  // A seat that is still held must be released as part of the refund
  // (cancelBooking: true), so nobody rides on refunded money.
  router.patch("/:paymentId/refund-request", requireRole("staff", "admin"), staffActionLimiter, (req, res) => {
    const reason = String(req.body?.reason ?? "").trim();
    if (!reason) return res.status(400).json({ error: "Give a reason for the refund" });
    if (reason.length > MAX_REASON_LENGTH) return res.status(400).json({ error: `Keep the reason under ${MAX_REASON_LENGTH} characters` });
    return refundAction(req, res, "refund_request", async ({ conn, payment, booking }) => {
      const holdsSeat = ["Reserved", "Confirmed"].includes(booking.status);
      if (holdsSeat && req.body?.cancelBooking !== true) {
        return { error: "This booking still holds a seat. Refunding also cancels the booking — confirm that to continue.", status: 409 };
      }
      if (holdsSeat) {
        await conn.query(`UPDATE bookings SET status = 'Cancelled', cancellation_reason = 'refunded' WHERE booking_id = ?`, [booking.booking_id]);
      }
      await conn.query(
        `UPDATE payments SET status = 'Refund Pending', refund_reason = ?, refund_requested_at = NOW(), refund_requested_by = ? WHERE payment_id = ?`,
        [reason, req.user.id, payment.payment_id]
      );
      await logPaymentEvent(conn, {
        actor: req.user,
        action: "refund_requested",
        paymentId: payment.payment_id,
        submissionId: payment.submission_id,
        bookingId: booking.booking_id,
        previousStatus: payment.status,
        newStatus: "Refund Pending",
        reason,
        details: holdsSeat ? { bookingCancelled: true, bookingStatusBefore: booking.status } : undefined,
      });
      return {
        response: { payment_id: payment.payment_id, status: "Refund Pending", booking_cancelled: holdsSeat },
        after: () =>
          notifyRecipient(
            io,
            { type: "passenger", id: booking.passenger_id },
            `A refund of ${formatPesoCentavos(toCentavos(payment.amount))} for booking #${booking.booking_id} (${bookingReference(booking.booking_id, booking.booked_at)}) has been requested: ${reason}.${holdsSeat ? " The booking has been cancelled." : ""} You'll be notified when it's sent.`,
            "payment_refund"
          ),
      };
    });
  });

  // PATCH /:paymentId/refund-confirm — admin only. { refundReference, note? }
  // Only after the money was actually sent back.
  router.patch("/:paymentId/refund-confirm", requireRole("admin"), staffActionLimiter, (req, res) => {
    const refundReference = cleanText(req.body?.refundReference, 100);
    if (!refundReference) return res.status(400).json({ error: "Enter the reference number of the refund transfer you sent" });
    const note = cleanText(req.body?.note, MAX_NOTE_LENGTH);
    return refundAction(req, res, "refund_confirm", async ({ conn, payment, booking }) => {
      await conn.query(
        `UPDATE payments SET status = 'Refunded', refund_reference = ?, refunded_at = NOW(), refunded_by = ? WHERE payment_id = ?`,
        [refundReference, req.user.id, payment.payment_id]
      );
      await logPaymentEvent(conn, {
        actor: req.user,
        action: "refund_confirmed",
        paymentId: payment.payment_id,
        submissionId: payment.submission_id,
        bookingId: booking.booking_id,
        previousStatus: payment.status,
        newStatus: "Refunded",
        internalNote: note,
        details: { refundReference },
      });
      return {
        response: { payment_id: payment.payment_id, status: "Refunded", refund_reference: refundReference },
        after: () =>
          notifyRecipient(
            io,
            { type: "passenger", id: booking.passenger_id },
            `Your refund of ${formatPesoCentavos(toCentavos(payment.amount))} for booking #${booking.booking_id} has been sent (refund ref ${refundReference}).`,
            "payment_refund"
          ),
      };
    });
  });

  // PATCH /:paymentId/refund-cancel — admin only, a refund opened by mistake.
  // Returns the payment to Verified; the booking is NOT reopened (its seat
  // may be resold) — the passenger keeps a verified payment on record.
  router.patch("/:paymentId/refund-cancel", requireRole("admin"), staffActionLimiter, (req, res) => {
    const note = cleanText(req.body?.note, MAX_NOTE_LENGTH);
    if (!note) return res.status(400).json({ error: "Explain why the refund is being cancelled" });
    return refundAction(req, res, "refund_cancel", async ({ conn, payment, booking }) => {
      await conn.query(
        `UPDATE payments SET status = 'Verified', refund_reason = NULL, refund_requested_at = NULL, refund_requested_by = NULL WHERE payment_id = ?`,
        [payment.payment_id]
      );
      await logPaymentEvent(conn, {
        actor: req.user,
        action: "refund_cancelled",
        paymentId: payment.payment_id,
        submissionId: payment.submission_id,
        bookingId: booking.booking_id,
        previousStatus: payment.status,
        newStatus: "Verified",
        internalNote: note,
      });
      return { response: { payment_id: payment.payment_id, status: "Verified" } };
    });
  });

  // GET /:paymentId/audit — full history of one seat's payment (staff).
  router.get("/:paymentId/audit", requireRole("staff", "admin"), async (req, res) => {
    const paymentId = parseId(req.params.paymentId);
    if (!paymentId) return res.status(404).json({ error: "Payment not found" });
    try {
      const [[p]] = await pool.query(`SELECT payment_id, submission_id, booking_id FROM payments WHERE payment_id = ?`, [paymentId]);
      if (!p) return res.status(404).json({ error: "Payment not found" });
      const [rows] = await pool.query(
        `SELECT l.*, CASE WHEN l.actor_role IN ('staff', 'admin') THEN sa.name WHEN l.actor_role = 'passenger' THEN c.name ELSE 'System' END AS actor_name
         FROM payment_audit_logs l
         LEFT JOIN staff_accounts sa ON l.actor_role IN ('staff', 'admin') AND sa.staff_id = l.actor_id
         LEFT JOIN commuters c ON l.actor_role = 'passenger' AND c.commuter_id = l.actor_id
         WHERE l.payment_id = ? OR (l.submission_id = ? AND l.payment_id IS NULL)
         ORDER BY l.audit_log_id`,
        [paymentId, p.submission_id ?? 0]
      );
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load the payment history" });
    }
  });

  // Retired single-seat endpoints: verifying without the funds-received
  // check would bypass the rules above, so stale clients get a clear 410.
  for (const path of ["/:id/verify", "/:id/reject"]) {
    router.patch(path, requireRole("staff", "admin"), (req, res) =>
      res.status(410).json({ error: "This screen is out of date. Reload the page to use Payment Verification." })
    );
  }

  return router;
}
