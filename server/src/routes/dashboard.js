import { Router } from "express";
import { pool } from "../db/pool.js";
import { redis, CACHE_TTL_SECONDS } from "../cache/redis.js";
import { requireRole } from "../middleware/auth.js";

export const dashboardRouter = Router();

const DASHBOARD_CACHE_KEY = "cache:dashboard:summary";

// GET /api/dashboard/summary — powers admin/Dashboard.jsx's metric cards +
// recent-activity feed (Table 4's "Dashboard and Reporting" feature).
// Redis-cached with a short TTL like the tracking endpoints, fail-open to
// MySQL on a miss/error.
dashboardRouter.get("/summary", requireRole("admin", "staff"), async (req, res) => {
  try {
    const cached = await redis.get(DASHBOARD_CACHE_KEY).catch(() => null);
    if (cached) return res.json(JSON.parse(cached));

    const [[activeFleet]] = await pool.query(`SELECT COUNT(*) AS count FROM buses WHERE status = 'Active'`);
    const [[todaysTrips]] = await pool.query(
      `SELECT COUNT(*) AS count FROM trips WHERE DATE(departure_time) = CURDATE() AND status != 'Cancelled'`
    );
    const [[reservationsToday]] = await pool.query(
      `SELECT COUNT(*) AS count FROM bookings WHERE DATE(booked_at) = CURDATE() AND status != 'Cancelled'`
    );
    const [[reservationsThisWeek]] = await pool.query(
      `SELECT COUNT(*) AS count FROM bookings WHERE YEARWEEK(booked_at, 1) = YEARWEEK(CURDATE(), 1) AND status != 'Cancelled'`
    );
    const [dailyTrend] = await pool.query(
      `SELECT DATE(booked_at) AS day, COUNT(*) AS count
       FROM bookings
       WHERE booked_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) AND status != 'Cancelled'
       GROUP BY DATE(booked_at)
       ORDER BY day ASC`
    );
    const [recentActivity] = await pool.query(
      `SELECT al.audit_id, al.action, al.entity_type, al.entity_id, al.created_at, sa.name AS staff_name
       FROM audit_log al
       JOIN staff_accounts sa ON sa.staff_id = al.staff_id
       ORDER BY al.created_at DESC
       LIMIT 10`
    );

    const summary = {
      activeFleetCount: activeFleet.count,
      todaysTripCount: todaysTrips.count,
      reservationsToday: reservationsToday.count,
      reservationsThisWeek: reservationsThisWeek.count,
      dailyReservationTrend: dailyTrend,
      recentActivity,
    };

    redis.set(DASHBOARD_CACHE_KEY, JSON.stringify(summary), "EX", CACHE_TTL_SECONDS.dashboardSummary).catch((err) =>
      console.error("Redis set failed (non-fatal):", err.message)
    );

    res.json(summary);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load dashboard summary" });
  }
});

// GET /api/dashboard/audit-log — admin/ActivityLog.jsx: every recorded
// staff action (audit_log), newest first, 50 per page.
// Filters: staffId, action, entityType, from, to (YYYY-MM-DD, Manila dates).
const AUDIT_PAGE_SIZE = 50;
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

dashboardRouter.get("/audit-log", requireRole("admin"), async (req, res) => {
  const { staffId, action, entityType, from, to } = req.query;
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const where = [];
  const params = [];
  if (staffId) {
    const id = Number(staffId);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "staffId must be a staff account id" });
    where.push("al.staff_id = ?");
    params.push(id);
  }
  if (action) {
    where.push("al.action = ?");
    params.push(String(action).slice(0, 50));
  }
  if (entityType) {
    where.push("al.entity_type = ?");
    params.push(String(entityType).slice(0, 50));
  }
  if (from) {
    if (!isDate(from)) return res.status(400).json({ error: "from must be a date (YYYY-MM-DD)" });
    where.push("al.created_at >= ?");
    params.push(`${from} 00:00:00`);
  }
  if (to) {
    if (!isDate(to)) return res.status(400).json({ error: "to must be a date (YYYY-MM-DD)" });
    where.push("al.created_at < DATE_ADD(?, INTERVAL 1 DAY)");
    params.push(`${to} 00:00:00`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  try {
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM audit_log al ${whereSql}`, params);
    const [rows] = await pool.query(
      `SELECT al.audit_id, al.staff_id, sa.name AS staff_name, sa.role AS staff_role, al.action, al.entity_type,
              al.entity_id, al.details, al.created_at
       FROM audit_log al
       LEFT JOIN staff_accounts sa ON sa.staff_id = al.staff_id
       ${whereSql}
       ORDER BY al.created_at DESC, al.audit_id DESC
       LIMIT ? OFFSET ?`,
      [...params, AUDIT_PAGE_SIZE, (page - 1) * AUDIT_PAGE_SIZE]
    );
    // Choices for the filter dropdowns.
    const [actions] = await pool.query(`SELECT DISTINCT action FROM audit_log ORDER BY action`);
    const [entityTypes] = await pool.query(`SELECT DISTINCT entity_type FROM audit_log ORDER BY entity_type`);
    const [staff] = await pool.query(
      `SELECT DISTINCT sa.staff_id, sa.name FROM audit_log al JOIN staff_accounts sa ON sa.staff_id = al.staff_id ORDER BY sa.name`
    );
    res.json({
      entries: rows.map((r) => ({ ...r, details: typeof r.details === "string" ? JSON.parse(r.details) : r.details })),
      total: Number(total),
      page,
      pageSize: AUDIT_PAGE_SIZE,
      filters: { actions: actions.map((a) => a.action), entityTypes: entityTypes.map((e) => e.entity_type), staff },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load the activity log" });
  }
});
