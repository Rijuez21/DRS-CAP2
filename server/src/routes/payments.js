import { Router } from "express";
import { pool } from "../db/pool.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { notifyRecipient } from "../services/notify.js";
import { logAudit } from "../services/audit.js";
import { BOOKABLE_TRIP_STATUSES } from "../services/bookingRules.js";

// ============================================================================
// QR Ph online payment — /api/payments
// ============================================================================
// There is NO payment gateway behind this. The QR the admin uploads is a
// static image of the operator's own GCash / Maya / bank QR; it can't call
// back into this server, so nothing here ever learns "payment succeeded" on
// its own. The flow is:
//
//   passenger books online ──> booking Reserved (unchanged)
//   passenger pays the QR in their own app, reports the reference number
//        ──> payments row, status Pending (booking stays Reserved, seat held)
//   staff compare it against the receiving account and either
//        Verify ──> payment Verified + booking Reserved→Confirmed + bell
//                   notification, all decided inside one transaction
//        Reject ──> payment Rejected (reason required), booking untouched,
//                   passenger notified and can resubmit
//
// Verification is the one manual step; everything after it is automatic.
// Do not bolt "auto-detection" onto this — that needs a real merchant
// gateway account with webhooks, which is a different (paid) architecture.

// Images arrive as base64 data: URLs inside the JSON body (index.js raises
// the body limit for this router only). Stored in the DB, not on disk,
// because Railway's filesystem is wiped on every redeploy.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;

const MAX_SEATS_PER_SUBMISSION = 10;
const MAX_REFERENCE_LENGTH = 100;
const MAX_REASON_LENGTH = 255;

// Returns { image } (the normalized data URL), { image: null } when the
// field is empty and optional, or { error }.
function parseImage(value, { fieldLabel, required }) {
  if (value === undefined || value === null || value === "") {
    return required ? { error: `${fieldLabel} is required` } : { image: null };
  }
  if (typeof value !== "string") return { error: `${fieldLabel} must be an image` };
  const match = IMAGE_DATA_URL.exec(value.replace(/\s+/g, ""));
  if (!match) return { error: `${fieldLabel} must be a PNG, JPEG, WebP or GIF image` };
  const base64 = match[2];
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = (base64.length * 3) / 4 - padding;
  if (bytes > MAX_IMAGE_BYTES) {
    return { error: `${fieldLabel} is too large (${(bytes / 1024 / 1024).toFixed(1)} MB). The limit is 5 MB.` };
  }
  return { image: `data:${match[1]};base64,${base64}` };
}

function optionalText(value, max) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

// Why a Reserved-only action can't happen on this booking, in words the
// passenger understands. null = it's fine.
function whyBookingNotPayable(booking) {
  if (booking.status === "Confirmed") return `Booking #${booking.booking_id} is already confirmed — there's nothing left to pay online.`;
  if (booking.status === "Cancelled") return `Booking #${booking.booking_id} was cancelled, so it can't be paid for.`;
  if (booking.status === "Boarded") return `Booking #${booking.booking_id} has already boarded.`;
  if (booking.status === "No-Show") return `Booking #${booking.booking_id} was marked as a no-show.`;
  if (booking.status !== "Reserved") return `Booking #${booking.booking_id} can't be paid for right now.`;
  if (booking.trip_status === "Cancelled") return `The trip for booking #${booking.booking_id} was cancelled — don't send a payment.`;
  if (!BOOKABLE_TRIP_STATUSES.includes(booking.trip_status)) {
    return `The bus for booking #${booking.booking_id} has already left the terminal — pay the conductor instead.`;
  }
  if (booking.base_fare == null) return `The fare for booking #${booking.booking_id} isn't on file yet — please pay at the terminal.`;
  return null;
}

// Review-queue / status columns. proof_image is deliberately left out —
// it can be megabytes per row — and fetched one at a time via /:id/proof.
const PAYMENT_SELECT = `
  SELECT p.payment_id, p.booking_id, p.amount, p.reference_number, p.status, p.rejection_reason,
         p.submitted_at, p.verified_at, p.verified_by, (p.proof_image IS NOT NULL) AS has_proof,
         sa.name AS verified_by_name,
         bk.status AS booking_status, bk.seat_number, bk.passenger_id, bk.passenger_name,
         c.email AS passenger_email, c.phoneno AS passenger_phone,
         tr.trip_id, tr.departure_time, tr.status AS trip_status,
         rt.origin, rt.destination, b.plate_num, b.bus_number
  FROM payments p
  JOIN bookings bk ON bk.booking_id = p.booking_id
  JOIN commuters c ON c.commuter_id = bk.passenger_id
  JOIN trips tr ON tr.trip_id = bk.trip_id
  JOIN routes rt ON rt.route_id = tr.route_id
  JOIN buses b ON b.bus_id = tr.bus_id
  LEFT JOIN staff_accounts sa ON sa.staff_id = p.verified_by`;

function toPaymentJson(row) {
  if (!row) return null;
  return { ...row, amount: Number(row.amount), has_proof: Boolean(row.has_proof) };
}

export function buildPaymentsRouter(io) {
  const router = Router();

  // --------------------------------------------------------------------
  // GET /api/payments/qr — the one QR every passenger sees at checkout.
  // null (not 404) when the admin hasn't uploaded one yet, so checkout can
  // fall back to "pay at the terminal" without treating it as an error.
  //
  // The image can be several MB and every passenger fetches it at every
  // checkout, so it's served with an ETag. The tag is built from a cheap
  // query (last-changed time + image length + who's asking), so when the
  // browser already has the current QR the server answers 304 without even
  // reading the image out of the database or sending it again.
  router.get("/qr", authenticate, async (req, res) => {
    try {
      const isStaff = req.user.role === "admin" || req.user.role === "staff";
      const [[meta]] = await pool.query(
        `SELECT UNIX_TIMESTAMP(updated_at) AS ts, CHAR_LENGTH(qr_image) AS len FROM payment_settings WHERE setting_id = 1`
      );
      if (!meta) return res.json(null);
      // "private, no-cache": the browser may keep it but must re-check (cheap
      // 304) every time, so a replaced QR shows up immediately -- a stale QR
      // would send passengers' money to the wrong account.
      res.set("Cache-Control", "private, no-cache");
      res.set("Vary", "Authorization");
      res.set("ETag", `W/"qr-${meta.ts}-${meta.len}-${isStaff ? "s" : "p"}"`);
      if (req.fresh) return res.status(304).end();

      const [[row]] = await pool.query(
        `SELECT ps.qr_image, ps.label, ps.instructions, ps.updated_at, sa.name AS updated_by_name
         FROM payment_settings ps LEFT JOIN staff_accounts sa ON sa.staff_id = ps.updated_by
         WHERE ps.setting_id = 1`
      );
      if (!row) return res.json(null);
      res.json({
        qrImage: row.qr_image,
        label: row.label,
        instructions: row.instructions,
        updatedAt: row.updated_at,
        // Staff/admin see who last changed it; passengers don't need a staff name.
        ...(isStaff ? { updatedByName: row.updated_by_name } : {}),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load the payment QR" });
    }
  });

  // PUT /api/payments/qr — admin uploads/replaces the QR.
  // body: { qrImage, label?, instructions? }
  router.put("/qr", requireRole("admin"), async (req, res) => {
    const parsed = parseImage(req.body.qrImage, { fieldLabel: "QR image", required: true });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const label = optionalText(req.body.label, 150);
    const instructions = optionalText(req.body.instructions, 500);

    try {
      await pool.query(
        `INSERT INTO payment_settings (setting_id, qr_image, label, instructions, updated_by)
         VALUES (1, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE qr_image = VALUES(qr_image), label = VALUES(label),
                                 instructions = VALUES(instructions), updated_by = VALUES(updated_by)`,
        [parsed.image, label, instructions, req.user.id]
      );
      // The image itself is far too big for an audit row — record that it changed.
      await logAudit({ staffId: req.user.id, action: "update", entityType: "payment_qr", entityId: 1, details: { label, instructions, qrImage: "(replaced)" } });
      res.json({ qrImage: parsed.image, label, instructions });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to save the payment QR" });
    }
  });

  // --------------------------------------------------------------------
  // POST /api/payments — passenger reports a payment.
  // body: { bookingIds: [12, 13], referenceNumber, proofImage? }
  // One payments row per booking (seat), all sharing the reference number —
  // typically one GCash transfer covering several seats bought together.
  // All-or-nothing: if any booking can't be paid for, nothing is recorded.
  router.post("/", requireRole("passenger"), async (req, res) => {
    const rawIds = Array.isArray(req.body.bookingIds) ? req.body.bookingIds : [];
    const bookingIds = [...new Set(rawIds.map(Number))];
    if (bookingIds.length === 0 || bookingIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      return res.status(400).json({ error: "Choose at least one booking to pay for" });
    }
    if (bookingIds.length > MAX_SEATS_PER_SUBMISSION) {
      return res.status(400).json({ error: `You can pay for up to ${MAX_SEATS_PER_SUBMISSION} seats at a time` });
    }

    // Reference numbers are typed from a phone screen — ignore spacing so
    // "1234 5678 9" and "123456789" are the same number to staff.
    const referenceNumber = String(req.body.referenceNumber ?? "").replace(/\s+/g, "").trim();
    if (!referenceNumber) return res.status(400).json({ error: "Enter the reference number from your payment app" });
    if (referenceNumber.length > MAX_REFERENCE_LENGTH) {
      return res.status(400).json({ error: `The reference number is too long (max ${MAX_REFERENCE_LENGTH} characters)` });
    }
    if (!/^[A-Za-z0-9\-/#.]+$/.test(referenceNumber)) {
      return res.status(400).json({ error: "The reference number should only contain letters and numbers" });
    }

    const proof = parseImage(req.body.proofImage, { fieldLabel: "Screenshot", required: false });
    if (proof.error) return res.status(400).json({ error: proof.error });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // FOR UPDATE locks these booking rows for the rest of the transaction:
      // two simultaneous submissions (double-tapped button, two tabs) queue up
      // here, so the second one sees the first one's Pending row below. It
      // also serializes against a passenger cancel or a staff verify.
      const [bookings] = await conn.query(
        `SELECT bk.booking_id, bk.passenger_id, bk.status, bk.seat_number,
                tr.status AS trip_status, rt.base_fare
         FROM bookings bk
         JOIN trips tr ON tr.trip_id = bk.trip_id
         JOIN routes rt ON rt.route_id = tr.route_id
         WHERE bk.booking_id IN (?)
         FOR UPDATE`,
        [bookingIds]
      );
      const byId = new Map(bookings.map((b) => [b.booking_id, b]));

      for (const id of bookingIds) {
        const booking = byId.get(id);
        // Someone else's booking looks exactly like a missing one.
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

      const [pending] = await conn.query(
        `SELECT booking_id FROM payments WHERE booking_id IN (?) AND status = 'Pending'`,
        [bookingIds]
      );
      if (pending.length > 0) {
        await conn.rollback();
        const codes = pending.map((p) => `#${p.booking_id}`).join(", ");
        return res.status(409).json({
          error: `A payment for booking ${codes} is already waiting for staff to verify it. You'll be notified once it's checked.`,
          bookingIds: pending.map((p) => p.booking_id),
        });
      }

      const created = [];
      for (const id of bookingIds) {
        const booking = byId.get(id);
        const [result] = await conn.query(
          `INSERT INTO payments (booking_id, amount, reference_number, proof_image) VALUES (?, ?, ?, ?)`,
          [id, booking.base_fare, referenceNumber, proof.image]
        );
        created.push({
          payment_id: result.insertId,
          booking_id: id,
          seat_number: booking.seat_number,
          amount: Number(booking.base_fare),
          reference_number: referenceNumber,
          status: "Pending",
        });
      }

      await conn.commit();
      res.status(201).json({
        referenceNumber,
        total: created.reduce((sum, p) => sum + p.amount, 0),
        payments: created,
      });
    } catch (err) {
      await conn.rollback().catch(() => {});
      console.error(err);
      res.status(500).json({ error: "Failed to submit your payment" });
    } finally {
      conn.release();
    }
  });

  // --------------------------------------------------------------------
  // GET /api/payments/booking/:bookingId — the latest payment for one
  // booking, plus that booking's current status and the amount due, so the
  // passenger's checkout / booking page can pick the right state after a
  // refresh: nothing yet (show the form), Pending (waiting), Rejected
  // (reason + resubmit), Verified / Confirmed (nothing left to do).
  // Passenger: own bookings only. Staff/admin: any.
  router.get("/booking/:bookingId", authenticate, async (req, res) => {
    const role = req.user.role;
    if (!["passenger", "staff", "admin"].includes(role)) {
      return res.status(403).json({ error: "Forbidden: insufficient role" });
    }
    try {
      const [[booking]] = await pool.query(
        `SELECT bk.booking_id, bk.passenger_id, bk.status, bk.channel, tr.status AS trip_status, rt.base_fare
         FROM bookings bk
         JOIN trips tr ON tr.trip_id = bk.trip_id
         JOIN routes rt ON rt.route_id = tr.route_id
         WHERE bk.booking_id = ?`,
        [req.params.bookingId]
      );
      if (!booking || (role === "passenger" && booking.passenger_id !== req.user.id)) {
        return res.status(404).json({ error: "Booking not found" });
      }

      // "Latest" by payment_id, not submitted_at: ids are strictly
      // increasing, timestamps only have one-second resolution.
      const [[payment]] = await pool.query(
        `${PAYMENT_SELECT} WHERE p.booking_id = ? ORDER BY p.payment_id DESC LIMIT 1`,
        [booking.booking_id]
      );
      const json = toPaymentJson(payment);
      if (json && role === "passenger") {
        // Passengers don't need staff names or their own contact details echoed back.
        delete json.verified_by;
        delete json.verified_by_name;
        delete json.passenger_email;
        delete json.passenger_phone;
      }

      res.json({
        booking_id: booking.booking_id,
        booking_status: booking.status,
        channel: booking.channel,
        trip_status: booking.trip_status,
        amount_due: booking.base_fare != null ? Number(booking.base_fare) : null,
        // Can the passenger submit a payment for this booking right now?
        can_pay: !whyBookingNotPayable(booking) && json?.status !== "Pending" && json?.status !== "Verified",
        payment: json,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load payment status" });
    }
  });

  // --------------------------------------------------------------------
  // GET /api/payments?status=Pending — staff/admin review queue.
  // Pending is oldest-first (work the queue in order); every other view is
  // newest-first.
  router.get("/", requireRole("staff", "admin"), async (req, res) => {
    const { status } = req.query;
    const allowed = ["Pending", "Verified", "Rejected"];
    if (status && !allowed.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
    }
    // reference_used_by_other_passenger: a reference number another
    // passenger also submitted is worth a second look (a reused or shared
    // screenshot). Rows sharing a reference with the SAME passenger are just
    // a multi-seat order paid in one transfer.
    try {
      const [rows] = await pool.query(
        `SELECT q.*,
                EXISTS (
                  SELECT 1 FROM payments p2 JOIN bookings b2 ON b2.booking_id = p2.booking_id
                  WHERE p2.reference_number = q.reference_number AND b2.passenger_id <> q.passenger_id
                ) AS reference_used_by_other_passenger
         FROM (${PAYMENT_SELECT} ${status ? "WHERE p.status = ?" : ""}) q
         ORDER BY q.submitted_at ${status === "Pending" ? "ASC" : "DESC"}, q.payment_id ${status === "Pending" ? "ASC" : "DESC"}
         LIMIT 500`,
        status ? [status] : []
      );
      res.json(
        rows.map((r) => ({ ...toPaymentJson(r), reference_used_by_other_passenger: Boolean(r.reference_used_by_other_passenger) }))
      );
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load payments" });
    }
  });

  // GET /api/payments/:id/proof — the screenshot at full size, one payment
  // at a time (kept out of the queue listing because of its size).
  router.get("/:id/proof", requireRole("staff", "admin"), async (req, res) => {
    try {
      const [[row]] = await pool.query(`SELECT proof_image FROM payments WHERE payment_id = ?`, [req.params.id]);
      if (!row) return res.status(404).json({ error: "Payment not found" });
      res.json({ proofImage: row.proof_image });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load the screenshot" });
    }
  });

  // --------------------------------------------------------------------
  // Shared by verify and reject: lock the payment AND its booking (the JOIN
  // under FOR UPDATE locks both rows), so a passenger cancelling at the same
  // moment, or a second staff member clicking the same row, waits for this
  // decision instead of racing it.
  async function lockPayment(conn, paymentId) {
    const [[row]] = await conn.query(
      `SELECT p.payment_id, p.booking_id, p.status, p.amount, p.reference_number,
              bk.status AS booking_status, bk.passenger_id, bk.seat_number, tr.status AS trip_status
       FROM payments p
       JOIN bookings bk ON bk.booking_id = p.booking_id
       JOIN trips tr ON tr.trip_id = bk.trip_id
       WHERE p.payment_id = ?
       FOR UPDATE`,
      [paymentId]
    );
    return row ?? null;
  }

  // PATCH /api/payments/:id/verify — the automatic part. In one
  // transaction: payment -> Verified and, if the booking is still Reserved,
  // booking -> Confirmed. Only a Pending payment can be verified, so a
  // double-click or a second staff member gets a 409 instead of re-running
  // the confirm/notify side effects.
  router.patch("/:id/verify", requireRole("staff", "admin"), async (req, res) => {
    const conn = await pool.getConnection();
    let payment;
    let bookingConfirmed = false;
    try {
      await conn.beginTransaction();
      payment = await lockPayment(conn, req.params.id);
      if (!payment) {
        await conn.rollback();
        return res.status(404).json({ error: "Payment not found" });
      }
      if (payment.status !== "Pending") {
        await conn.rollback();
        return res.status(409).json({ error: `This payment was already ${payment.status.toLowerCase()}.`, status: payment.status });
      }

      await conn.query(
        `UPDATE payments SET status = 'Verified', verified_at = NOW(), verified_by = ?, rejection_reason = NULL
         WHERE payment_id = ? AND status = 'Pending'`,
        [req.user.id, payment.payment_id]
      );

      // The money arrived either way, so the payment is Verified regardless.
      // But a booking the passenger already cancelled is never reopened (its
      // seat may already be resold), and one staff already moved on
      // (Confirmed at the counter, Boarded, No-Show) is left as it is.
      // A Reserved seat on a trip that was called off or already finished
      // isn't confirmed either — there's no ride left to confirm.
      if (payment.booking_status === "Reserved" && !["Cancelled", "Completed"].includes(payment.trip_status)) {
        const [result] = await conn.query(
          `UPDATE bookings SET status = 'Confirmed' WHERE booking_id = ? AND status = 'Reserved'`,
          [payment.booking_id]
        );
        bookingConfirmed = result.affectedRows === 1;
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback().catch(() => {});
      console.error(err);
      return res.status(500).json({ error: "Failed to verify the payment" });
    } finally {
      conn.release();
    }

    // Side effects only after the commit succeeded (a rolled-back verify
    // must never tell a passenger they're confirmed). Both are non-fatal.
    // Every verified payment gets an official receipt — the passenger's
    // receipt page reads it straight from this payment row
    // (GET /booking/:bookingId), and the bell links to it for
    // "payment_verified" notifications.
    const peso = `₱${Number(payment.amount).toLocaleString("en-PH")}`;
    const message = bookingConfirmed
      ? `Payment verified — booking #${payment.booking_id} (seat ${payment.seat_number}) is confirmed. Your official receipt is ready.`
      : payment.booking_status === "Cancelled"
        ? `Your ${peso} payment for booking #${payment.booking_id} was received, but that booking had already been cancelled. Please contact the terminal about it — your receipt is ready as proof of payment.`
        : `Your ${peso} payment for booking #${payment.booking_id} has been verified. Your official receipt is ready.`;
    await notifyRecipient(io, { type: "passenger", id: payment.passenger_id }, message, "payment_verified");
    await logAudit({
      staffId: req.user.id,
      action: "verify",
      entityType: "payment",
      entityId: payment.payment_id,
      details: {
        bookingId: payment.booking_id,
        amount: Number(payment.amount),
        referenceNumber: payment.reference_number,
        bookingStatusBefore: payment.booking_status,
        bookingConfirmed,
      },
    });

    res.json({
      payment_id: payment.payment_id,
      status: "Verified",
      booking_id: payment.booking_id,
      booking_status: bookingConfirmed ? "Confirmed" : payment.booking_status,
      booking_confirmed: bookingConfirmed,
    });
  });

  // PATCH /api/payments/:id/reject — body: { reason } (required, shown to
  // the passenger). The booking is left exactly as it was (still Reserved,
  // seat still held) so the passenger can submit a corrected reference.
  router.patch("/:id/reject", requireRole("staff", "admin"), async (req, res) => {
    const reason = String(req.body.reason ?? "").trim();
    if (!reason) return res.status(400).json({ error: "Give a reason — the passenger will see it" });
    if (reason.length > MAX_REASON_LENGTH) {
      return res.status(400).json({ error: `Keep the reason under ${MAX_REASON_LENGTH} characters` });
    }

    const conn = await pool.getConnection();
    let payment;
    try {
      await conn.beginTransaction();
      payment = await lockPayment(conn, req.params.id);
      if (!payment) {
        await conn.rollback();
        return res.status(404).json({ error: "Payment not found" });
      }
      if (payment.status !== "Pending") {
        await conn.rollback();
        return res.status(409).json({ error: `This payment was already ${payment.status.toLowerCase()}.`, status: payment.status });
      }
      // verified_at / verified_by double as "reviewed at / by" on a
      // rejected row, so both outcomes carry the same audit trail.
      await conn.query(
        `UPDATE payments SET status = 'Rejected', rejection_reason = ?, verified_at = NOW(), verified_by = ?
         WHERE payment_id = ? AND status = 'Pending'`,
        [reason, req.user.id, payment.payment_id]
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback().catch(() => {});
      console.error(err);
      return res.status(500).json({ error: "Failed to reject the payment" });
    } finally {
      conn.release();
    }

    const stillHeld = payment.booking_status === "Reserved";
    await notifyRecipient(
      io,
      { type: "passenger", id: payment.passenger_id },
      stillHeld
        ? `Payment for booking #${payment.booking_id} couldn't be verified: ${reason}. Your seat is still held — open the booking to send a corrected reference number.`
        : `Payment for booking #${payment.booking_id} couldn't be verified: ${reason}.`,
      "payment_rejected"
    );
    await logAudit({
      staffId: req.user.id,
      action: "reject",
      entityType: "payment",
      entityId: payment.payment_id,
      details: { bookingId: payment.booking_id, referenceNumber: payment.reference_number, reason },
    });

    res.json({ payment_id: payment.payment_id, status: "Rejected", rejection_reason: reason, booking_id: payment.booking_id });
  });

  return router;
}
