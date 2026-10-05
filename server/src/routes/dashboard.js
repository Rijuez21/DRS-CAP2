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
