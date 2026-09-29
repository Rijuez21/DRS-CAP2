import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";

export const checklistsRouter = Router();

// GET /api/checklists?tripId= — powers VehicleChecklist.jsx's "already
// submitted for this trip" prefill. One row per trip at most, per the
// vehicle_checklists.one_checklist_per_trip unique key (3.2.3.3).
checklistsRouter.get("/", requireRole("driver", "admin"), async (req, res) => {
  const { tripId } = req.query;
  if (!tripId) return res.status(400).json({ error: "tripId is required" });

  try {
    const [rows] = await pool.query(
      `SELECT checklist_id, trip_id, driver_id, engine_ok, tires_ok, brakes_ok,
              lights_ok, fuel_ok, cleanliness_ok, notes, submitted_at
       FROM vehicle_checklists WHERE trip_id = ?`,
      [tripId]
    );
    if (rows.length === 0) return res.status(404).json({ error: "No checklist submitted for this trip yet" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load checklist" });
  }
});

// POST /api/checklists — powers VehicleChecklist.jsx's submit. One
// checklist per trip, so a second submission for the same trip is a
// conflict (3.2.3.3's "digitizes the mandatory safety inspection" is a
// once-per-trip gate, not an editable log).
// POST /api/checklists — VehicleChecklist.jsx. Saving again updates the
// same checklist (the page always said "saving again will update it", but
// this used to be a plain INSERT that 409'd on the second save). The driver
// comes from the login token and must be the one assigned to the trip.
checklistsRouter.post("/", requireRole("driver"), async (req, res) => {
  const { tripId, engineOk, tiresOk, brakesOk, lightsOk, fuelOk, cleanlinessOk, notes } = req.body;
  if (!tripId) return res.status(400).json({ error: "Choose the trip this checklist is for" });

  try {
    const [[trip]] = await pool.query(`SELECT driver_id, status FROM trips WHERE trip_id = ?`, [tripId]);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    if (trip.driver_id !== req.user.id) return res.status(403).json({ error: "This trip isn't assigned to you" });
    if (trip.status === "Completed" || trip.status === "Cancelled") {
      return res.status(409).json({ error: `This trip is ${trip.status.toLowerCase()} — its checklist can't be changed` });
    }

    const values = [!!engineOk, !!tiresOk, !!brakesOk, !!lightsOk, !!fuelOk, !!cleanlinessOk, notes ? String(notes).slice(0, 2000) : null];
    const [result] = await pool.query(
      `INSERT INTO vehicle_checklists
         (trip_id, driver_id, engine_ok, tires_ok, brakes_ok, lights_ok, fuel_ok, cleanliness_ok, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         engine_ok = VALUES(engine_ok), tires_ok = VALUES(tires_ok), brakes_ok = VALUES(brakes_ok),
         lights_ok = VALUES(lights_ok), fuel_ok = VALUES(fuel_ok), cleanliness_ok = VALUES(cleanliness_ok),
         notes = VALUES(notes), submitted_at = CURRENT_TIMESTAMP`,
      [tripId, req.user.id, ...values]
    );
    // affectedRows: 1 = inserted, 2 = updated (MySQL's upsert convention)
    res.status(result.affectedRows === 1 ? 201 : 200).json({
      tripId: Number(tripId),
      updated: result.affectedRows !== 1,
      allOk: values.slice(0, 6).every(Boolean),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save checklist" });
  }
});
