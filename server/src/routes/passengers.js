import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireRole, invalidateAccount } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";
import { likeEscape } from "../services/validate.js";
import { WALK_IN_EMAIL } from "../services/bookingRules.js";

// Passenger accounts for admins — the Passengers tab of
// admin/UserManagement.jsx. Passengers sign themselves up, so there's no
// create here: admins look people up, suspend someone abusing bookings
// (they're signed out at once and can't sign in), lift a suspension, and
// confirm an email by hand for someone who can't receive the code.
export const passengersRouter = Router();
passengersRouter.use(requireRole("admin"));

const MAX_REASON = 255;
const PAGE_SIZE = 50;

function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// GET /api/passengers?q=&status=active|suspended|unverified|closed&page=
passengersRouter.get("/", async (req, res) => {
  const q = String(req.query.q ?? "").trim().slice(0, 100);
  const status = String(req.query.status ?? "");
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const where = ["c.email <> ?"];
  const params = [WALK_IN_EMAIL];
  if (q) {
    const like = `%${likeEscape(q)}%`;
    where.push("(c.name LIKE ? OR c.email LIKE ? OR c.phoneno LIKE ?)");
    params.push(like, like, like);
  }
  const STATUS_SQL = {
    active: "c.closed_at IS NULL AND c.suspended_at IS NULL AND c.email_verified = TRUE",
    suspended: "c.suspended_at IS NOT NULL AND c.closed_at IS NULL",
    unverified: "c.email_verified = FALSE AND c.closed_at IS NULL",
    closed: "c.closed_at IS NOT NULL",
  };
  if (status) {
    if (!STATUS_SQL[status]) return res.status(400).json({ error: `status must be one of: ${Object.keys(STATUS_SQL).join(", ")}` });
    where.push(STATUS_SQL[status]);
  }
  try {
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM commuters c ${whereSql}`, params);
    const [rows] = await pool.query(
      `SELECT c.commuter_id, c.name, c.email, c.phoneno, c.email_verified, c.suspended_at, c.suspension_reason,
              c.closed_at, c.created_at, c.discount_category, c.discount_expires_at,
              (SELECT COUNT(*) FROM bookings bk WHERE bk.passenger_id = c.commuter_id) AS bookings,
              (SELECT COUNT(*) FROM bookings bk WHERE bk.passenger_id = c.commuter_id AND bk.status = 'No-Show') AS no_shows,
              (SELECT MAX(bk.booked_at) FROM bookings bk WHERE bk.passenger_id = c.commuter_id) AS last_booked_at
       FROM commuters c ${whereSql}
       ORDER BY c.commuter_id DESC
       LIMIT ? OFFSET ?`,
      [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE]
    );
    res.json({
      passengers: rows.map((r) => ({ ...r, email_verified: Boolean(r.email_verified) })),
      total: Number(total),
      page,
      pageSize: PAGE_SIZE,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load passengers" });
  }
});

async function findOpen(id) {
  const [[row]] = await pool.query(
    `SELECT commuter_id, name, email, suspended_at, email_verified, closed_at FROM commuters WHERE commuter_id = ? AND email <> ?`,
    [id, WALK_IN_EMAIL]
  );
  return row && !row.closed_at ? row : null;
}

// PATCH /api/passengers/:id/suspend  { reason }
passengersRouter.patch("/:id/suspend", async (req, res) => {
  const id = parseId(req.params.id);
  const reason = String(req.body?.reason ?? "").trim();
  if (!reason) return res.status(400).json({ error: "Give a reason for the suspension" });
  if (reason.length > MAX_REASON) return res.status(400).json({ error: `Keep the reason under ${MAX_REASON} characters` });
  try {
    const p = id && (await findOpen(id));
    if (!p) return res.status(404).json({ error: "Passenger not found" });
    if (p.suspended_at) return res.status(409).json({ error: "This passenger is already suspended" });
    await pool.query(`UPDATE commuters SET suspended_at = NOW(), suspension_reason = ? WHERE commuter_id = ?`, [reason, id]);
    invalidateAccount("passenger", id);
    await logAudit({ staffId: req.user.id, action: "suspend", entityType: "passenger", entityId: id, details: { reason } });
    res.json({ commuter_id: id, suspended: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to suspend the passenger" });
  }
});

// PATCH /api/passengers/:id/unsuspend
passengersRouter.patch("/:id/unsuspend", async (req, res) => {
  const id = parseId(req.params.id);
  try {
    const p = id && (await findOpen(id));
    if (!p) return res.status(404).json({ error: "Passenger not found" });
    if (!p.suspended_at) return res.status(409).json({ error: "This passenger isn't suspended" });
    await pool.query(`UPDATE commuters SET suspended_at = NULL, suspension_reason = NULL WHERE commuter_id = ?`, [id]);
    invalidateAccount("passenger", id);
    await logAudit({ staffId: req.user.id, action: "unsuspend", entityType: "passenger", entityId: id });
    res.json({ commuter_id: id, suspended: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to lift the suspension" });
  }
});

// PATCH /api/passengers/:id/verify-email — for a passenger who can't get
// the emailed code (staff checked their identity at the terminal).
passengersRouter.patch("/:id/verify-email", async (req, res) => {
  const id = parseId(req.params.id);
  try {
    const p = id && (await findOpen(id));
    if (!p) return res.status(404).json({ error: "Passenger not found" });
    if (p.email_verified) return res.status(409).json({ error: "This email is already confirmed" });
    await pool.query(`UPDATE commuters SET email_verified = TRUE WHERE commuter_id = ?`, [id]);
    await pool.query(`UPDATE email_verifications SET used_at = NOW() WHERE commuter_id = ? AND used_at IS NULL`, [id]);
    await logAudit({ staffId: req.user.id, action: "verify_email", entityType: "passenger", entityId: id });
    res.json({ commuter_id: id, email_verified: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to confirm the email" });
  }
});
