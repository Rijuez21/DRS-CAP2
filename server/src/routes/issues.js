import { Router } from "express";
import { pool } from "../db/pool.js";

export const issuesRouter = Router();

// GET /api/issues?driverId= — powers IssueReports.jsx's "Your Reports"
// list. Joins buses for plate_num since the page displays it alongside
// each report's category/status.
issuesRouter.get("/", async (req, res) => {
  const { driverId } = req.query;
  if (!driverId) return res.status(400).json({ error: "driverId is required" });

  try {
    const [rows] = await pool.query(
      `SELECT ir.issue_id, ir.trip_id, ir.bus_id, ir.driver_id, ir.category,
              ir.description, ir.status, ir.reported_at, b.plate_num
       FROM issue_reports ir
       JOIN buses b ON b.bus_id = ir.bus_id
       WHERE ir.driver_id = ?
       ORDER BY ir.reported_at DESC`,
      [driverId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load issue reports" });
  }
});

// POST /api/issues — powers IssueReports.jsx's submit form. Always starts
// 'Open' (3.2.3.3's Driver Module incident reporting); a dispatcher/admin
// later moves it through Acknowledged/Resolved.
issuesRouter.post("/", async (req, res) => {
  const { tripId, busId, driverId, category, description } = req.body;
  if (!busId || !driverId || !description) {
    return res.status(400).json({ error: "busId, driverId and description are required" });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO issue_reports (trip_id, bus_id, driver_id, category, description, status)
       VALUES (?, ?, ?, ?, ?, 'Open')`,
      [tripId ?? null, busId, driverId, category ?? "other", description]
    );
    res.status(201).json({
      issue_id: result.insertId,
      tripId: tripId ?? null,
      busId,
      driverId,
      category: category ?? "other",
      description,
      status: "Open",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit issue report" });
  }
});
