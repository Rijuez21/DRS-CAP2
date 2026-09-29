import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";

export const issuesRouter = Router();

const ISSUE_STATUSES = ["Open", "Acknowledged", "Resolved"];
const ISSUE_CATEGORIES = ["mechanical", "safety", "passenger", "route", "other"];

// GET /api/issues — driver: their own reports (IssueReports.jsx);
// admin: every report, newest first, optionally ?status= (the Issue
// Reports section of MaintenanceTracking.jsx). Before, reports had no
// reader besides the driver who filed them, so nothing ever got fixed.
issuesRouter.get("/", requireRole("driver", "admin"), async (req, res) => {
  const { status } = req.query;
  const conditions = [];
  const params = [];
  if (req.user.role === "driver") { conditions.push("ir.driver_id = ?"); params.push(req.user.id); }
  if (status) {
    if (!ISSUE_STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of: ${ISSUE_STATUSES.join(", ")}` });
    conditions.push("ir.status = ?"); params.push(status);
  }

  try {
    const [rows] = await pool.query(
      `SELECT ir.issue_id, ir.trip_id, ir.bus_id, ir.driver_id, ir.category,
              ir.description, ir.status, ir.reported_at, b.plate_num, b.bus_number, d.name AS driver_name
       FROM issue_reports ir
       JOIN buses b ON b.bus_id = ir.bus_id
       JOIN drivers d ON d.driver_id = ir.driver_id
       ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY (ir.status = 'Resolved'), ir.reported_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load issue reports" });
  }
});

// POST /api/issues — IssueReports.jsx. body: { tripId, category, description }.
// Driver and bus come from the trip (which must be the driver's own), not
// from the client, so a report can't be filed against someone else's bus.
issuesRouter.post("/", requireRole("driver"), async (req, res) => {
  const { tripId, category } = req.body;
  const description = String(req.body.description ?? "").trim();
  if (!tripId) return res.status(400).json({ error: "Select the trip this issue relates to" });
  if (!description) return res.status(400).json({ error: "Describe the issue" });
  const cat = ISSUE_CATEGORIES.includes(category) ? category : "other";

  try {
    const [[trip]] = await pool.query(`SELECT bus_id, driver_id FROM trips WHERE trip_id = ?`, [tripId]);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    if (trip.driver_id !== req.user.id) return res.status(403).json({ error: "This trip isn't assigned to you" });

    const [result] = await pool.query(
      `INSERT INTO issue_reports (trip_id, bus_id, driver_id, category, description, status)
       VALUES (?, ?, ?, ?, ?, 'Open')`,
      [tripId, trip.bus_id, req.user.id, cat, description.slice(0, 2000)]
    );
    res.status(201).json({ issue_id: result.insertId, tripId: Number(tripId), busId: trip.bus_id, category: cat, description, status: "Open" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit issue report" });
  }
});

// PATCH /api/issues/:id — admin marks a report Acknowledged or Resolved.
issuesRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const { status } = req.body;
  if (!ISSUE_STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of: ${ISSUE_STATUSES.join(", ")}` });
  try {
    const [result] = await pool.query(`UPDATE issue_reports SET status = ? WHERE issue_id = ?`, [status, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Issue report not found" });
    res.json({ issue_id: Number(req.params.id), status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update issue report" });
  }
});
