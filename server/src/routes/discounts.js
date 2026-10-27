import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { notifyRecipient, notifyStaff } from "../services/notify.js";
import { logAudit } from "../services/audit.js";
import { rateLimit } from "../services/rateLimit.js";
import { id as parseId } from "../services/validate.js";
import {
  DISCOUNT_CATEGORIES,
  CATEGORY_LABELS,
  activeDiscount,
  expiryFor,
  whyCannotApply,
  parseIdImage,
  parseIdNumber,
} from "../services/discounts.js";

const STATUSES = ["Pending", "Approved", "Rejected"];
const formatDate = (d) => new Date(d).toLocaleDateString("en-PH", { dateStyle: "long", timeZone: "Asia/Manila" });

// Student / PWD / senior citizen fare discount (services/discounts.js).
//   passenger:     GET /mine, POST / (send an ID)
//   staff / admin: GET / (review queue), GET /:id/image,
//                  PATCH /:id/approve, PATCH /:id/reject
export function buildDiscountsRouter(io) {
  const router = Router();
  const submitLimit = rateLimit({ name: "discount-submit", max: 10, windowSeconds: 60 * 60, message: "Too many ID uploads. Try again later." });

  // The passenger's discount right now, plus their latest application.
  router.get("/mine", requireRole("passenger"), async (req, res) => {
    try {
      const [[commuter]] = await pool.query(
        `SELECT discount_category, discount_verified_at, discount_expires_at FROM commuters WHERE commuter_id = ?`,
        [req.user.id]
      );
      const [[latest]] = await pool.query(
        `SELECT application_id, category, id_number, status, rejection_reason, submitted_at, reviewed_at, expires_at
         FROM discount_applications WHERE commuter_id = ? ORDER BY application_id DESC LIMIT 1`,
        [req.user.id]
      );
      const active = activeDiscount(commuter);
      const cannotApply = latest?.status === "Pending" ? "Your ID is waiting for staff to check it." : whyCannotApply(commuter);
      // ?tripId=: has their one discounted seat on that trip already been used?
      const tripId = parseId(req.query.tripId);
      let usedOnTrip = false;
      if (active && tripId) {
        const [[used]] = await pool.query(
          `SELECT 1 FROM bookings WHERE trip_id = ? AND passenger_id = ? AND discount_category IS NOT NULL AND status NOT IN ('Cancelled', 'No-Show') LIMIT 1`,
          [tripId, req.user.id]
        );
        usedOnTrip = Boolean(used);
      }
      res.json({
        active,
        // Had one, but it ran out (students, after a year).
        expired: commuter?.discount_category && !active ? { category: commuter.discount_category, expires_at: commuter.discount_expires_at } : null,
        latest: latest ?? null,
        can_apply: !cannotApply,
        cannot_apply_reason: cannotApply,
        used_on_trip: usedOnTrip,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load your discount" });
    }
  });

  // body: { category: "student" | "pwd" | "senior", idNumber?, idImage }
  router.post("/", requireRole("passenger"), submitLimit, async (req, res) => {
    const body = req.body ?? {};
    if (!DISCOUNT_CATEGORIES.includes(body.category)) {
      return res.status(400).json({ error: "Choose Student, PWD, or Senior Citizen" });
    }
    const idNumber = parseIdNumber(body.idNumber);
    if (idNumber.error) return res.status(400).json({ error: idNumber.error });
    const image = parseIdImage(body.idImage);
    if (image.error) return res.status(400).json({ error: image.error });

    try {
      const [[commuter]] = await pool.query(
        `SELECT name, discount_category, discount_verified_at, discount_expires_at FROM commuters WHERE commuter_id = ?`,
        [req.user.id]
      );
      if (!commuter) return res.status(404).json({ error: "Passenger account not found" });
      const blocked = whyCannotApply(commuter);
      if (blocked) return res.status(409).json({ error: blocked });

      const [result] = await pool.query(
        `INSERT INTO discount_applications (commuter_id, category, id_number, id_image) VALUES (?, ?, ?, ?)`,
        [req.user.id, body.category, idNumber.value, image.image]
      );
      await notifyStaff(io, `${commuter.name} sent a ${CATEGORY_LABELS[body.category]} ID for the fare discount — check it in ID Verification.`, "discount_submitted");
      res.status(201).json({ application_id: result.insertId, category: body.category, status: "Pending" });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "Your ID is already waiting for staff to check it." });
      }
      console.error(err);
      res.status(500).json({ error: "Failed to submit your ID" });
    }
  });

  // Review queue (no images — those come from /:id/image).
  router.get("/", requireRole("staff", "admin"), async (req, res) => {
    const status = req.query.status ?? "Pending";
    if (!STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of: ${STATUSES.join(", ")}` });
    try {
      const [rows] = await pool.query(
        `SELECT da.application_id, da.commuter_id, da.category, da.id_number, da.status, da.rejection_reason,
                da.submitted_at, da.reviewed_at, da.expires_at,
                c.name AS passenger_name, c.email AS passenger_email, s.name AS reviewed_by_name
         FROM discount_applications da
         JOIN commuters c ON c.commuter_id = da.commuter_id
         LEFT JOIN staff_accounts s ON s.staff_id = da.reviewed_by
         WHERE da.status = ?
         ORDER BY ${status === "Pending" ? "da.submitted_at ASC" : "da.reviewed_at DESC"}
         LIMIT 200`,
        [status]
      );
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load ID submissions" });
    }
  });

  // The ID photo itself — private, so served only to signed-in staff.
  router.get("/:id/image", requireRole("staff", "admin"), async (req, res) => {
    const applicationId = parseId(req.params.id);
    if (!applicationId) return res.status(404).json({ error: "Submission not found" });
    try {
      const [[row]] = await pool.query(`SELECT id_image FROM discount_applications WHERE application_id = ?`, [applicationId]);
      if (!row) return res.status(404).json({ error: "Submission not found" });
      const match = /^data:(image\/(?:png|jpeg|webp));base64,(.*)$/s.exec(row.id_image);
      if (!match) return res.status(500).json({ error: "Stored ID image is unreadable" });
      res.set({ "Content-Type": match[1], "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.send(Buffer.from(match[2], "base64"));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load the ID image" });
    }
  });

  // Takes a Pending application, locked, or answers the request itself.
  async function lockPending(conn, req, res) {
    const applicationId = parseId(req.params.id);
    if (!applicationId) {
      res.status(404).json({ error: "Submission not found" });
      return null;
    }
    const [[app]] = await conn.query(
      `SELECT da.*, c.name AS passenger_name FROM discount_applications da
       JOIN commuters c ON c.commuter_id = da.commuter_id
       WHERE da.application_id = ? FOR UPDATE`,
      [applicationId]
    );
    if (!app) {
      res.status(404).json({ error: "Submission not found" });
      return null;
    }
    if (app.status !== "Pending") {
      res.status(409).json({ error: `This ID was already ${app.status.toLowerCase()}.` });
      return null;
    }
    return app;
  }

  router.patch("/:id/approve", requireRole("staff", "admin"), async (req, res) => {
    const conn = await pool.getConnection();
    let app;
    let expiresAt;
    try {
      await conn.beginTransaction();
      app = await lockPending(conn, req, res);
      if (!app) {
        await conn.rollback();
        return;
      }
      const now = new Date();
      expiresAt = expiryFor(app.category, now);
      await conn.query(
        `UPDATE discount_applications SET status = 'Approved', reviewed_at = ?, reviewed_by = ?, expires_at = ? WHERE application_id = ?`,
        [now, req.user.id, expiresAt, app.application_id]
      );
      await conn.query(
        `UPDATE commuters SET discount_category = ?, discount_verified_at = ?, discount_expires_at = ? WHERE commuter_id = ?`,
        [app.category, now, expiresAt, app.commuter_id]
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback().catch(() => {});
      console.error(err);
      return res.status(500).json({ error: "Failed to approve the ID" });
    } finally {
      conn.release();
    }

    const label = CATEGORY_LABELS[app.category];
    await logAudit({ staffId: req.user.id, action: "approve_discount", entityType: "discount_application", entityId: app.application_id, details: { commuterId: app.commuter_id, category: app.category, expiresAt } });
    await notifyRecipient(
      io,
      { type: "passenger", id: app.commuter_id },
      `Your ${label} ID was verified. You now get 20% off your own seat when you book${expiresAt ? `, until ${formatDate(expiresAt)}` : ""}.`,
      "discount_approved"
    );
    res.json({ application_id: app.application_id, status: "Approved", category: app.category, expires_at: expiresAt });
  });

  // body: { reason } — shown to the passenger so they know what to fix.
  router.patch("/:id/reject", requireRole("staff", "admin"), async (req, res) => {
    const reason = String(req.body?.reason ?? "").trim();
    if (!reason) return res.status(400).json({ error: "Give a reason so the passenger knows what to fix" });
    if (reason.length > 255) return res.status(400).json({ error: "Keep the reason under 255 characters" });

    const conn = await pool.getConnection();
    let app;
    try {
      await conn.beginTransaction();
      app = await lockPending(conn, req, res);
      if (!app) {
        await conn.rollback();
        return;
      }
      await conn.query(
        `UPDATE discount_applications SET status = 'Rejected', rejection_reason = ?, reviewed_at = ?, reviewed_by = ? WHERE application_id = ?`,
        [reason, new Date(), req.user.id, app.application_id]
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback().catch(() => {});
      console.error(err);
      return res.status(500).json({ error: "Failed to reject the ID" });
    } finally {
      conn.release();
    }

    await logAudit({ staffId: req.user.id, action: "reject_discount", entityType: "discount_application", entityId: app.application_id, details: { commuterId: app.commuter_id, category: app.category, reason } });
    await notifyRecipient(
      io,
      { type: "passenger", id: app.commuter_id },
      `Your ${CATEGORY_LABELS[app.category]} ID couldn't be verified: ${reason}. You can send a new photo from your profile.`,
      "discount_rejected"
    );
    res.json({ application_id: app.application_id, status: "Rejected" });
  });

  return router;
}
