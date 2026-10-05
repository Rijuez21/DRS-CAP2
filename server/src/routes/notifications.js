import { Router } from "express";
import { pool } from "../db/pool.js";
import { authenticate } from "../middleware/auth.js";

export const notificationsRouter = Router();

// Notifications belong to one passenger or driver (recipient_type matches
// the login role). Every route now reads "who" from the login token, not
// the query — before, ?recipientType=driver&recipientId=1 read anyone's.
notificationsRouter.use(authenticate);
function recipientOf(req, res) {
  if (req.user.role !== "passenger" && req.user.role !== "driver") {
    res.status(403).json({ error: "Only passengers and drivers receive notifications" });
    return null;
  }
  return { type: req.user.role, id: req.user.id };
}

// GET /api/notifications?recipientType=&recipientId= — powers the bell
// dropdown in the shared header (passenger/driver). Unread first, newest
// first within each group.
notificationsRouter.get("/", async (req, res) => {
  const me = recipientOf(req, res);
  if (!me) return;
  const recipientType = me.type;
  const recipientId = me.id;

  try {
    const [rows] = await pool.query(
      `SELECT notification_id, message, type, read_at, created_at
       FROM notifications
       WHERE recipient_type = ? AND recipient_id = ?
       ORDER BY (read_at IS NULL) DESC, created_at DESC
       LIMIT 50`,
      [recipientType, recipientId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load notifications" });
  }
});

// PATCH /api/notifications/:id/read — marks one notification read when the
// bell dropdown opens / an item is clicked.
notificationsRouter.patch("/:id/read", async (req, res) => {
  try {
    const me = recipientOf(req, res);
    if (!me) return;
    await pool.query(
      `UPDATE notifications SET read_at = NOW()
       WHERE notification_id = ? AND recipient_type = ? AND recipient_id = ? AND read_at IS NULL`,
      [req.params.id, me.type, me.id]
    );
    res.json({ notification_id: Number(req.params.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to mark notification read" });
  }
});

// PATCH /api/notifications/read-all — marks every notification for a
// recipient read in one call, used when the bell dropdown opens.
notificationsRouter.patch("/read-all", async (req, res) => {
  const me = recipientOf(req, res);
  if (!me) return;
  const recipientType = me.type;
  const recipientId = me.id;

  try {
    await pool.query(
      `UPDATE notifications SET read_at = NOW() WHERE recipient_type = ? AND recipient_id = ? AND read_at IS NULL`,
      [recipientType, recipientId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to mark notifications read" });
  }
});
