import { Router } from "express";
import { pool } from "../db/pool.js";

export const checklistsRouter = Router();

// GET /api/checklists?tripId= — powers VehicleChecklist.jsx's "already
// submitted for this trip" prefill. One row per trip at most, per the
// vehicle_checklists.one_checklist_per_trip unique key (3.2.3.3).
checklistsRouter.get("/", async (req, res) => {
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
checklistsRouter.post("/", async (req, res) => {
  const { tripId, driverId, engineOk, tiresOk, brakesOk, lightsOk, fuelOk, cleanlinessOk, notes } = req.body;
  if (!tripId || !driverId) {
    return res.status(400).json({ error: "tripId and driverId are required" });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO vehicle_checklists
         (trip_id, driver_id, engine_ok, tires_ok, brakes_ok, lights_ok, fuel_ok, cleanliness_ok, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tripId,
        driverId,
        !!engineOk,
        !!tiresOk,
        !!brakesOk,
        !!lightsOk,
        !!fuelOk,
        !!cleanlinessOk,
        notes ?? null,
      ]
    );
    res.status(201).json({
      checklist_id: result.insertId,
      tripId,
      driverId,
      engineOk: !!engineOk,
      tiresOk: !!tiresOk,
      brakesOk: !!brakesOk,
      lightsOk: !!lightsOk,
      fuelOk: !!fuelOk,
      cleanlinessOk: !!cleanlinessOk,
      notes: notes ?? null,
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "A checklist has already been submitted for this trip" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to submit checklist" });
  }
});
