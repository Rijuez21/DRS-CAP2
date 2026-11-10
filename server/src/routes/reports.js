import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { csvCell } from "../services/validate.js";
import { tripCollections, dailySummary } from "../services/collections.js";

export const reportsRouter = Router();
reportsRouter.use(requireRole("admin"));

// Shared date-range guard: defaults to the last 30 days so every report
// endpoint below has a sane bound instead of scanning the whole table.
// Only YYYY-MM-DD is accepted: the values also end up in the export's
// Content-Disposition filename, so nothing else may pass through.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function resolveRange(req) {
  const to = DATE_RE.test(String(req.query.to ?? "")) ? req.query.to : new Date().toISOString().slice(0, 10);
  const from = DATE_RE.test(String(req.query.from ?? "")) ? req.query.from : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { from, to };
}

// GET /api/reports/on-time-performance?from=&to=&routeId= — % of trips
// completed within 15 minutes of scheduled arrival_time, and average delay
// in minutes, per route (fleet-wide if routeId is omitted).
reportsRouter.get("/on-time-performance", async (req, res) => {
  const { from, to } = resolveRange(req);
  const routeId = req.query.routeId && /^\d+$/.test(String(req.query.routeId)) ? Number(req.query.routeId) : null;
  try {
    const [rows] = await pool.query(
      `SELECT rt.route_id, rt.origin, rt.destination,
              COUNT(*) AS completedTrips,
              SUM(CASE WHEN ABS(TIMESTAMPDIFF(MINUTE, tr.arrival_time, tr.completed_at)) <= 15 THEN 1 ELSE 0 END) AS onTimeTrips,
              ROUND(AVG(GREATEST(TIMESTAMPDIFF(MINUTE, tr.arrival_time, tr.completed_at), 0)), 1) AS avgDelayMinutes
       FROM trips tr
       JOIN routes rt ON rt.route_id = tr.route_id
       WHERE tr.status = 'Completed' AND tr.arrival_time IS NOT NULL AND tr.completed_at IS NOT NULL
         AND DATE(tr.departure_time) BETWEEN ? AND ?
         ${routeId ? "AND rt.route_id = ?" : ""}
       GROUP BY rt.route_id, rt.origin, rt.destination
       ORDER BY rt.origin`,
      routeId ? [from, to, routeId] : [from, to]
    );
    res.json(rows.map((r) => ({ ...r, onTimePercentage: r.completedTrips ? Math.round((r.onTimeTrips / r.completedTrips) * 100) : 0 })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to build on-time performance report" });
  }
});

// GET /api/reports/fleet-utilization?from=&to= — trips run per bus in the
// period vs. its share of total fleet capacity, and rough idle days.
reportsRouter.get("/fleet-utilization", async (req, res) => {
  const { from, to } = resolveRange(req);
  try {
    const [rows] = await pool.query(
      `SELECT b.bus_id, b.plate_num, b.capacity, b.status,
              COUNT(tr.trip_id) AS tripsRun,
              COUNT(DISTINCT DATE(tr.departure_time)) AS activeDays
       FROM buses b
       LEFT JOIN trips tr ON tr.bus_id = b.bus_id AND tr.status != 'Cancelled' AND DATE(tr.departure_time) BETWEEN ? AND ?
       GROUP BY b.bus_id, b.plate_num, b.capacity, b.status
       ORDER BY tripsRun DESC`,
      [from, to]
    );
    const periodDays = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
    res.json(rows.map((r) => ({ ...r, idleDays: periodDays - r.activeDays })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to build fleet utilization report" });
  }
});

// GET /api/reports/reservation-trends?from=&to= — bookings per day, per
// route, and per channel over the period.
reportsRouter.get("/reservation-trends", async (req, res) => {
  const { from, to } = resolveRange(req);
  try {
    const [byDay] = await pool.query(
      `SELECT DATE(bk.booked_at) AS day, COUNT(*) AS count
       FROM bookings bk
       WHERE DATE(bk.booked_at) BETWEEN ? AND ? AND bk.status != 'Cancelled'
       GROUP BY DATE(bk.booked_at) ORDER BY day ASC`,
      [from, to]
    );
    const [byRoute] = await pool.query(
      `SELECT rt.origin, rt.destination, COUNT(*) AS count
       FROM bookings bk
       JOIN trips tr ON tr.trip_id = bk.trip_id
       JOIN routes rt ON rt.route_id = tr.route_id
       WHERE DATE(bk.booked_at) BETWEEN ? AND ? AND bk.status != 'Cancelled'
       GROUP BY rt.route_id, rt.origin, rt.destination ORDER BY count DESC`,
      [from, to]
    );
    const [byChannel] = await pool.query(
      `SELECT channel, COUNT(*) AS count FROM bookings
       WHERE DATE(booked_at) BETWEEN ? AND ? AND status != 'Cancelled'
       GROUP BY channel`,
      [from, to]
    );
    res.json({ byDay, byRoute, byChannel });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to build reservation trends report" });
  }
});

const CSV_BUILDERS = {
  "on-time-performance": (rows) => toCsv(rows, ["origin", "destination", "completedTrips", "onTimeTrips", "onTimePercentage", "avgDelayMinutes"]),
  "fleet-utilization": (rows) => toCsv(rows, ["plate_num", "capacity", "status", "tripsRun", "activeDays", "idleDays"]),
  "reservation-trends": (data) => toCsv(data.byDay, ["day", "count"]),
  "trip-collections": (rows) => toCsv(rows, ["trip_id", "departure", "route", "bus", "driver", "trip_status", "passengers", "walk_on", "flagged_unpaid", "online", "terminal", "on_board", "total", "remitted", "difference", "status", "received_by"]),
  "daily-collections": (rows) => toCsv(rows, ["day", "trips", "passengers", "online", "terminal", "on_board", "total", "remitted", "awaiting", "short_trips", "shortage"]),
};

// Flat rows for the trip collection CSV.
const flatTrip = (t) => ({
  trip_id: t.trip_id,
  departure: new Date(t.departure_time).toISOString(),
  route: `${t.origin} - ${t.destination}`,
  bus: t.bus_number ? `${t.bus_number} (${t.plate_num})` : t.plate_num,
  driver: t.driver_name,
  trip_status: t.trip_status,
  passengers: t.passengers.total,
  walk_on: t.passengers.walk_on,
  flagged_unpaid: t.flagged_unpaid,
  online: t.collected.online,
  terminal: t.collected.terminal,
  on_board: t.collected.on_board,
  total: t.collected.total,
  remitted: t.remittance?.remitted ?? "",
  difference: t.difference ?? "",
  status: t.status,
  received_by: t.remittance?.received_by ?? "",
});

// GET /api/reports/trip-collections?from=&to= — per trip: passengers
// carried (by channel, plus walk-ons), money collected online / at the
// terminal / on board, and the conductor's remittance against it.
reportsRouter.get("/trip-collections", async (req, res) => {
  const { from, to } = resolveRange(req);
  try {
    res.json(await tripCollections({ from, to }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to build the trip collection report" });
  }
});

// GET /api/reports/daily-collections?from=&to= — the same, totalled per day.
reportsRouter.get("/daily-collections", async (req, res) => {
  const { from, to } = resolveRange(req);
  try {
    res.json(dailySummary(await tripCollections({ from, to })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to build the daily collection summary" });
  }
});

function toCsv(rows, columns) {
  const header = columns.join(",");
  const body = rows
    .map((row) => columns.map((col) => csvCell(row[col])).join(","))
    .join("\n");
  return `${header}\n${body}`;
}

// GET /api/reports/export?type=&format=csv&from=&to= — same data as the
// report endpoints above, streamed as a download. Hand-rolled CSV (no extra
// dependency needed for that); PDF export needs a rendering library this
// project doesn't have installed yet, so only format=csv is implemented —
// requesting format=pdf returns 501 rather than silently no-op'ing.
reportsRouter.get("/export", async (req, res) => {
  const { type, format = "csv" } = req.query;
  if (!CSV_BUILDERS[type]) {
    return res.status(400).json({ error: `type must be one of: ${Object.keys(CSV_BUILDERS).join(", ")}` });
  }
  if (format !== "csv") {
    return res.status(501).json({ error: "Only format=csv is currently supported" });
  }

  const { from, to } = resolveRange(req);
  try {
    let data;
    if (type === "trip-collections") {
      data = (await tripCollections({ from, to })).map(flatTrip);
    } else if (type === "daily-collections") {
      data = dailySummary(await tripCollections({ from, to }));
    } else if (type === "on-time-performance") {
      const [rows] = await pool.query(
        `SELECT rt.origin, rt.destination, COUNT(*) AS completedTrips,
                SUM(CASE WHEN ABS(TIMESTAMPDIFF(MINUTE, tr.arrival_time, tr.completed_at)) <= 15 THEN 1 ELSE 0 END) AS onTimeTrips,
                ROUND(AVG(GREATEST(TIMESTAMPDIFF(MINUTE, tr.arrival_time, tr.completed_at), 0)), 1) AS avgDelayMinutes
         FROM trips tr JOIN routes rt ON rt.route_id = tr.route_id
         WHERE tr.status = 'Completed' AND tr.arrival_time IS NOT NULL AND tr.completed_at IS NOT NULL
           AND DATE(tr.departure_time) BETWEEN ? AND ?
         GROUP BY rt.route_id, rt.origin, rt.destination`,
        [from, to]
      );
      data = rows.map((r) => ({ ...r, onTimePercentage: r.completedTrips ? Math.round((r.onTimeTrips / r.completedTrips) * 100) : 0 }));
    } else if (type === "fleet-utilization") {
      const [rows] = await pool.query(
        `SELECT b.plate_num, b.capacity, b.status, COUNT(tr.trip_id) AS tripsRun,
                COUNT(DISTINCT DATE(tr.departure_time)) AS activeDays
         FROM buses b
         LEFT JOIN trips tr ON tr.bus_id = b.bus_id AND tr.status != 'Cancelled' AND DATE(tr.departure_time) BETWEEN ? AND ?
         GROUP BY b.bus_id, b.plate_num, b.capacity, b.status`,
        [from, to]
      );
      const periodDays = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
      data = rows.map((r) => ({ ...r, idleDays: periodDays - r.activeDays }));
    } else if (type === "reservation-trends") {
      const [byDay] = await pool.query(
        `SELECT DATE(booked_at) AS day, COUNT(*) AS count FROM bookings
         WHERE DATE(booked_at) BETWEEN ? AND ? AND status != 'Cancelled'
         GROUP BY DATE(booked_at) ORDER BY day ASC`,
        [from, to]
      );
      data = { byDay };
    }

    const csv = CSV_BUILDERS[type](data);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${type}-${from}-to-${to}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to export report" });
  }
});
