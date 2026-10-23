import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";
import { optionalText, requiredText, integer } from "../services/validate.js";
import { validateSeatLayout, getSeatLabels, busSeatLabels, readStoredLayout, naturalCompare } from "../services/seatLayout.js";
import { clearTripsCache } from "./trips.js";

const BUS_TYPES = ["ordinary", "air_conditioned"];

// Capacity decides which seat numbers can be sold, so it must be a sane
// whole number; plate/bus numbers are shown on passenger maps and tickets.
function parseBusBody(body, { partial }) {
  const out = {};
  let layout = null;
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has("plateNum")) {
    const r = requiredText(body.plateNum, { max: 20, label: "Plate number" });
    if (r.error) return r;
    if (!/^[A-Za-z0-9 \-]+$/.test(r.value)) return { error: "Plate number may only contain letters, numbers, spaces and dashes" };
    out.plate_num = r.value;
  }
  if (has("busNumber")) {
    const r = optionalText(body.busNumber, { max: 10, label: "Bus number" });
    if (r.error) return r;
    if (r.value && !/^[A-Za-z0-9\-]+$/.test(r.value)) return { error: "Bus number may only contain letters, numbers and dashes" };
    out.bus_number = r.value;
  }
  if (has("capacity")) {
    const r = integer(body.capacity, { label: "Capacity", min: 1, max: 120, nullable: true });
    if (r.error) return r;
    out.capacity = r.value;
  }
  // seatLayout: the admin's seat map (services/seatLayout.js). Capacity is
  // then just the number of seats in it — a capacity sent alongside that
  // disagrees is refused rather than silently overwritten. null removes the
  // layout, putting the bus back on the generated 1..capacity seats.
  if (has("seatLayout")) {
    if (body.seatLayout === null) {
      out.seat_layout = null;
    } else {
      const v = validateSeatLayout(body.seatLayout);
      if (v.error) return v;
      const seats = getSeatLabels(v.layout).length;
      if (out.capacity != null && out.capacity !== seats) {
        return { error: `Capacity (${out.capacity}) doesn't match the seat layout, which has ${seats} seats. Capacity is counted from the layout.` };
      }
      out.seat_layout = JSON.stringify(v.layout);
      out.capacity = seats;
      layout = v.layout;
    }
  }
  if (has("type")) {
    if (body.type !== null && body.type !== "" && !BUS_TYPES.includes(body.type)) return { error: `type must be one of: ${BUS_TYPES.join(", ")}` };
    out.type = body.type || null;
  }
  if (has("yearModel")) {
    const r = integer(body.yearModel, { label: "Year model", min: 1950, max: 2100, nullable: true });
    if (r.error) return r;
    out.year_model = r.value;
  }
  if (has("currentDriverId")) {
    const r = integer(body.currentDriverId, { label: "Driver", min: 1, max: 2147483646, nullable: true });
    if (r.error) return r;
    out.current_driver_id = r.value;
  }
  if (has("boardingPoint")) {
    const r = optionalText(body.boardingPoint, { max: 150, label: "Boarding point" });
    if (r.error) return r;
    out.boarding_point = r.value;
  }
  // The tracker's ID as Traccar knows it (for a SinoTrack, the device ID on
  // its label) — POST /api/tracking/device matches positions to a bus by it.
  if (has("gpsDeviceId")) {
    const r = optionalText(body.gpsDeviceId, { max: 32, label: "GPS device ID" });
    if (r.error) return r;
    if (r.value && !/^[A-Za-z0-9\-]+$/.test(r.value)) return { error: "GPS device ID may only contain letters, numbers and dashes" };
    out.gps_device_id = r.value;
  }
  return { fields: out, layout };
}

// Seats that would disappear (removed or renamed) while someone holds them
// on a trip that hasn't finished — the same "holds a seat" rule as
// /api/trips/:id/seats. Completed and Cancelled trips don't count.
async function seatsInUseOutside(busId, nextLabels) {
  const keep = new Set(nextLabels.map((l) => l.toUpperCase()));
  const [rows] = await pool.query(
    `SELECT tr.trip_id, tr.departure_time, tr.status AS trip_status, rt.origin, rt.destination, bk.seat_number
     FROM bookings bk
     JOIN trips tr ON tr.trip_id = bk.trip_id
     JOIN routes rt ON rt.route_id = tr.route_id
     WHERE tr.bus_id = ? AND tr.status IN ('Scheduled', 'Boarding', 'In Transit')
       AND bk.status NOT IN ('Cancelled', 'No-Show')
     ORDER BY tr.departure_time`,
    [busId]
  );
  const byTrip = new Map();
  for (const r of rows) {
    if (keep.has(String(r.seat_number).toUpperCase())) continue;
    if (!byTrip.has(r.trip_id)) {
      byTrip.set(r.trip_id, {
        tripId: r.trip_id,
        departureTime: r.departure_time,
        status: r.trip_status,
        route: `${r.origin} → ${r.destination}`,
        seats: [],
      });
    }
    byTrip.get(r.trip_id).seats.push(String(r.seat_number));
  }
  const trips = [...byTrip.values()];
  trips.forEach((t) => t.seats.sort(naturalCompare));
  return trips;
}

export const busesRouter = Router();

// GET /api/buses — powers admin/FleetManagement.jsx, plus the bus picker in
// TripScheduling.jsx, which terminal staff also use (read-only for them —
// every write below stays admin-only).
busesRouter.get("/", requireRole("admin", "staff"), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.bus_id, b.bus_number, b.plate_num, b.capacity, b.seat_layout, b.type, b.year_model, b.status,
              b.current_driver_id, b.boarding_point, b.gps_device_id, d.name AS driver_name
       FROM buses b
       LEFT JOIN drivers d ON d.driver_id = b.current_driver_id
       ORDER BY b.bus_number IS NULL, b.bus_number, b.plate_num`
    );
    // seat_layout: null for a bus without its own layout (seats 1..capacity)
    res.json(rows.map((r) => ({ ...r, seat_layout: readStoredLayout(r.seat_layout) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load buses" });
  }
});

// POST /api/buses — admin adds a bus to the fleet
busesRouter.post("/", requireRole("admin"), async (req, res) => {
  const { busNumber, plateNum, capacity, type, yearModel, currentDriverId, boardingPoint, gpsDeviceId } = req.body ?? {};
  if (!plateNum) {
    return res.status(400).json({ error: "plateNum is required" });
  }
  const parsed = parseBusBody(req.body, { partial: false });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const f = parsed.fields;
  // Without a layout this is exactly the old behaviour (capacity as sent);
  // with one, capacity is the layout's seat count.
  const savedCapacity = parsed.layout ? f.capacity : capacity;

  try {
    const [result] = await pool.query(
      `INSERT INTO buses (bus_number, plate_num, capacity, seat_layout, type, year_model, current_driver_id, boarding_point, gps_device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [f.bus_number ?? null, f.plate_num, f.capacity ?? null, f.seat_layout ?? null, f.type ?? null, f.year_model ?? null, f.current_driver_id ?? null, f.boarding_point ?? null, f.gps_device_id ?? null]
    );
    await logAudit({
      staffId: req.user.id,
      action: "create",
      entityType: "bus",
      entityId: result.insertId,
      details: { busNumber, plateNum, capacity: savedCapacity, seatLayout: parsed.layout ?? undefined, type, yearModel, currentDriverId, boardingPoint, gpsDeviceId },
    });
    await clearTripsCache();
    res.status(201).json({
      bus_id: result.insertId,
      busNumber,
      plateNum,
      capacity: savedCapacity,
      seatLayout: parsed.layout,
      type,
      yearModel,
      status: "Active",
      currentDriverId,
      boardingPoint,
      gpsDeviceId,
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "A bus with that plate number, bus number or GPS device ID already exists" });
    }
    if (err.code === "ER_NO_REFERENCED_ROW_2") return res.status(400).json({ error: "That driver doesn't exist" });
    console.error(err);
    res.status(500).json({ error: "Failed to add bus" });
  }
});

// PATCH /api/buses/:id — admin edits plate/capacity/type/year/driver/etc.
// (Fleet Management's edit action, Table 4)
busesRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const parsed = parseBusBody(req.body ?? {}, { partial: true });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const fields = Object.keys(parsed.fields).map((c) => `${c} = ?`);
  const params = Object.values(parsed.fields);

  if (fields.length === 0) return res.status(400).json({ error: "No editable fields provided" });
  const f = parsed.fields;
  const changesSeats = "seat_layout" in f || "capacity" in f;

  try {
    let capacity;
    if (changesSeats) {
      const [[current]] = await pool.query(`SELECT capacity, seat_layout FROM buses WHERE bus_id = ?`, [req.params.id]);
      if (!current) return res.status(404).json({ error: "Bus not found" });
      const keepsLayout = !("seat_layout" in f) && readStoredLayout(current.seat_layout);
      if (keepsLayout && f.capacity !== current.capacity) {
        return res.status(400).json({ error: `This bus has a seat layout with ${current.capacity} seats. Change the layout to change its capacity.` });
      }
      const next = {
        capacity: "capacity" in f ? f.capacity : current.capacity,
        seat_layout: "seat_layout" in f ? f.seat_layout : current.seat_layout,
      };
      capacity = next.capacity;
      // Never take away a seat someone is holding on an upcoming or
      // running trip — they'd show up to a seat that no longer exists.
      const affected = await seatsInUseOutside(req.params.id, busSeatLabels(next));
      if (affected.length > 0) {
        const seats = [...new Set(affected.flatMap((t) => t.seats))].sort(naturalCompare);
        const one = seats.length === 1;
        return res.status(409).json({
          error: `Seat${one ? "" : "s"} ${seats.join(", ")} ${one ? "is" : "are"} booked on ${affected.length} upcoming trip${affected.length === 1 ? "" : "s"}, so ${one ? "it" : "they"} can't be removed or renamed. Keep ${one ? "that seat" : "those seats"} in the layout, or move or cancel the bookings first.`,
          code: "SEATS_IN_USE",
          affected,
        });
      }
    }

    params.push(req.params.id);
    const [result] = await pool.query(`UPDATE buses SET ${fields.join(", ")} WHERE bus_id = ?`, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Bus not found" });
    await logAudit({
      staffId: req.user.id,
      action: "update",
      entityType: "bus",
      entityId: req.params.id,
      details: parsed.layout ? { ...req.body, capacity } : req.body,
    });
    await clearTripsCache();
    const seatInfo = changesSeats ? { capacity, seatLayout: parsed.layout ?? (f.seat_layout === null ? null : undefined) } : {};
    res.json({ bus_id: Number(req.params.id), ...req.body, ...seatInfo });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "A bus with that plate number, bus number or GPS device ID already exists" });
    }
    if (err.code === "ER_NO_REFERENCED_ROW_2") return res.status(400).json({ error: "That driver doesn't exist" });
    console.error(err);
    res.status(500).json({ error: "Failed to update bus" });
  }
});

// DELETE /api/buses/:id — blocked (409) if the bus has any future trip, so
// deleting it can't orphan a schedule (Table 4's Fleet Management scope).
busesRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  try {
    const [[futureTrip]] = await pool.query(
      `SELECT trip_id FROM trips WHERE bus_id = ? AND departure_time > NOW() AND status != 'Cancelled' LIMIT 1`,
      [req.params.id]
    );
    if (futureTrip) {
      return res.status(409).json({ error: "This bus has upcoming trips scheduled — reassign or cancel them first" });
    }

    const [result] = await pool.query(`DELETE FROM buses WHERE bus_id = ?`, [req.params.id]).catch((err) => {
      if (err.code === "ER_ROW_IS_REFERENCED_2") throw Object.assign(new Error("in use"), { inUse: true });
      throw err;
    });
    if (result.affectedRows === 0) return res.status(404).json({ error: "Bus not found" });
    await logAudit({ staffId: req.user.id, action: "delete", entityType: "bus", entityId: req.params.id });
    res.status(204).end();
  } catch (err) {
    if (err.inUse) return res.status(409).json({ error: "This bus has past trips on record, so it can't be deleted. Set it to Maintenance or Idle instead." });
    console.error(err);
    res.status(500).json({ error: "Failed to delete bus" });
  }
});

// PATCH /api/buses/:id/status — e.g. flip to 'Maintenance', drives the
// dashboard alerts and trip-scheduling conflict prevention noted in 3.2.3.1
busesRouter.patch("/:id/status", requireRole("admin"), async (req, res) => {
  const { status } = req.body;
  const allowed = ["Active", "Idle", "Maintenance"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
  }

  try {
    await pool.query(`UPDATE buses SET status = ? WHERE bus_id = ?`, [status, req.params.id]);
    await logAudit({ staffId: req.user.id, action: "status_change", entityType: "bus", entityId: req.params.id, details: { status } });
    res.json({ bus_id: Number(req.params.id), status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update bus status" });
  }
});
