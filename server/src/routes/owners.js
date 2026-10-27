import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { requireRole, invalidateAccount } from "../middleware/auth.js";
import { whyPasswordWeak, cleanEmail, cleanName, cleanPhone } from "../services/passwordPolicy.js";
import { logAudit } from "../services/audit.js";

// Bus owners: operators whose buses run out of the terminal. An admin
// creates their accounts and links their buses (admin/UserManagement.jsx);
// the owner's only access is the Owner portal's live map of those buses
// (GET /me/fleet, owner/OwnerTracking via admin/FleetTracking.jsx).
export const ownersRouter = Router();

// Returns { value } (text or null) or { error }.
function cleanAddress(value) {
  if (value === undefined || value === null || value === "") return { value: null };
  if (typeof value !== "string") return { error: "Address must be text" };
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length > 255) return { error: "Keep the address under 255 characters" };
  if (/[<>\u0000-\u001f]/.test(text)) return { error: "The address contains characters that aren't allowed" };
  return { value: text || null };
}

// Returns { value } (array of unique bus ids) or { error }.
function cleanBusIds(value) {
  if (!Array.isArray(value)) return { error: "busIds must be a list of buses" };
  const ids = [...new Set(value.map(Number))];
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return { error: "busIds must be a list of buses" };
  return { value: ids };
}

// Makes busIds exactly the buses this owner has: releases the ones no
// longer listed and takes over the listed ones (from another owner too —
// a bus has one owner). Runs on the caller's transaction.
async function assignBuses(conn, ownerId, busIds) {
  if (busIds.length > 0) {
    const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM buses WHERE bus_id IN (?)`, [busIds]);
    if (Number(n) !== busIds.length) return "One of the selected buses no longer exists. Reload and try again.";
    await conn.query(`UPDATE buses SET owner_id = NULL WHERE owner_id = ? AND bus_id NOT IN (?)`, [ownerId, busIds]);
    await conn.query(`UPDATE buses SET owner_id = ? WHERE bus_id IN (?)`, [ownerId, busIds]);
  } else {
    await conn.query(`UPDATE buses SET owner_id = NULL WHERE owner_id = ?`, [ownerId]);
  }
  return null;
}

// GET /api/owners/me/fleet — the Owner portal map: every bus this owner
// has, with its last GPS point (null if it never reported) and today's
// trip. Same row shape as /api/tracking/fleet/latest so FleetTracking.jsx
// renders both. Never cached: it's per owner, and small.
ownersRouter.get("/me/fleet", requireRole("owner"), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.bus_id AS busId, b.plate_num AS plateNum, b.bus_number AS busNumber, b.status,
              lt.latitude, lt.longitude, lt.timestamp, lt.sync_status AS syncStatus, lt.source,
              rt.origin, rt.destination, d.name AS driverName
       FROM buses b
       LEFT JOIN location_tracking lt ON lt.tracking_id = (
         SELECT lt2.tracking_id FROM location_tracking lt2
         WHERE lt2.bus_id = b.bus_id
         ORDER BY lt2.timestamp DESC LIMIT 1
       )
       LEFT JOIN trips tr ON tr.trip_id = (
         SELECT tr2.trip_id FROM trips tr2
         WHERE tr2.bus_id = b.bus_id AND DATE(tr2.departure_time) = CURDATE()
         ORDER BY tr2.departure_time ASC LIMIT 1
       )
       LEFT JOIN routes rt ON rt.route_id = tr.route_id
       LEFT JOIN drivers d ON d.driver_id = tr.driver_id
       WHERE b.owner_id = ?
       ORDER BY b.plate_num`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load your buses" });
  }
});

// GET /api/owners — admin/UserManagement.jsx. Never returns password_hash.
ownersRouter.get("/", requireRole("admin"), async (req, res) => {
  try {
    const [owners] = await pool.query(`SELECT owner_id, name, email, phoneno, address FROM bus_owners ORDER BY name`);
    const [buses] = await pool.query(`SELECT bus_id, owner_id FROM buses WHERE owner_id IS NOT NULL`);
    res.json(owners.map((o) => ({ ...o, bus_ids: buses.filter((b) => b.owner_id === o.owner_id).map((b) => b.bus_id) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load owners" });
  }
});

ownersRouter.post("/", requireRole("admin"), async (req, res) => {
  const body = req.body ?? {};
  const name = cleanName(body.name, 100);
  if (name.error) return res.status(400).json({ error: name.error });
  const email = cleanEmail(body.email);
  if (email.error) return res.status(400).json({ error: email.error });
  const weak = whyPasswordWeak(body.password, { email: email.value, name: name.value });
  if (weak) return res.status(400).json({ error: weak });
  const phone = cleanPhone(body.phoneno);
  if (phone.error) return res.status(400).json({ error: phone.error });
  const address = cleanAddress(body.address);
  if (address.error) return res.status(400).json({ error: address.error });
  const busIds = cleanBusIds(body.busIds ?? []);
  if (busIds.error) return res.status(400).json({ error: busIds.error });

  const conn = await pool.getConnection();
  try {
    const passwordHash = await bcrypt.hash(body.password, 10);
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO bus_owners (name, email, password_hash, phoneno, address) VALUES (?, ?, ?, ?, ?)`,
      [name.value, email.value, passwordHash, phone.value, address.value]
    );
    const refusal = await assignBuses(conn, result.insertId, busIds.value);
    if (refusal) {
      await conn.rollback();
      return res.status(409).json({ error: refusal });
    }
    await conn.commit();
    await logAudit({ staffId: req.user.id, action: "create", entityType: "owner", entityId: result.insertId, details: { name: name.value, email: email.value, busIds: busIds.value } });
    res.status(201).json({ owner_id: result.insertId, name: name.value, email: email.value, phoneno: phone.value, address: address.value, bus_ids: busIds.value });
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "An owner account with that email already exists" });
    console.error(err);
    res.status(500).json({ error: "Failed to add owner account" });
  } finally {
    conn.release();
  }
});

// PATCH /api/owners/:id — name/email/phone/address, a new password, and
// (busIds) the full list of buses the owner should have.
ownersRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const ownerId = Number(req.params.id);
  if (!Number.isInteger(ownerId) || ownerId <= 0) return res.status(404).json({ error: "Owner account not found" });
  const body = req.body ?? {};
  const fields = [];
  const params = [];
  const changes = {};
  if (body.name !== undefined) {
    const name = cleanName(body.name, 100);
    if (name.error) return res.status(400).json({ error: name.error });
    fields.push("name = ?"); params.push(name.value); changes.name = name.value;
  }
  if (body.email !== undefined) {
    const email = cleanEmail(body.email);
    if (email.error) return res.status(400).json({ error: email.error });
    fields.push("email = ?"); params.push(email.value); changes.email = email.value;
  }
  if (body.phoneno !== undefined) {
    const phone = cleanPhone(body.phoneno);
    if (phone.error) return res.status(400).json({ error: phone.error });
    fields.push("phoneno = ?"); params.push(phone.value); changes.phoneno = phone.value;
  }
  if (body.address !== undefined) {
    const address = cleanAddress(body.address);
    if (address.error) return res.status(400).json({ error: address.error });
    fields.push("address = ?"); params.push(address.value); changes.address = address.value;
  }
  if (body.password !== undefined && body.password !== "") {
    const weak = whyPasswordWeak(body.password, { email: changes.email });
    if (weak) return res.status(400).json({ error: weak });
    fields.push("password_hash = ?"); params.push(await bcrypt.hash(body.password, 10));
  }
  let busIds = null;
  if (body.busIds !== undefined) {
    const cleaned = cleanBusIds(body.busIds);
    if (cleaned.error) return res.status(400).json({ error: cleaned.error });
    busIds = cleaned.value;
    changes.busIds = busIds;
  }
  if (fields.length === 0 && busIds === null) return res.status(400).json({ error: "No editable fields provided" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[exists]] = await conn.query(`SELECT owner_id FROM bus_owners WHERE owner_id = ? FOR UPDATE`, [ownerId]);
    if (!exists) {
      await conn.rollback();
      return res.status(404).json({ error: "Owner account not found" });
    }
    if (fields.length > 0) await conn.query(`UPDATE bus_owners SET ${fields.join(", ")} WHERE owner_id = ?`, [...params, ownerId]);
    if (busIds !== null) {
      const refusal = await assignBuses(conn, ownerId, busIds);
      if (refusal) {
        await conn.rollback();
        return res.status(409).json({ error: refusal });
      }
    }
    await conn.commit();
    // A new password ends the owner's existing sessions now.
    invalidateAccount("owner", ownerId);
    await logAudit({ staffId: req.user.id, action: "update", entityType: "owner", entityId: ownerId, details: { ...changes, ...(body.password ? { password: "(changed)" } : {}) } });
    res.json({ owner_id: ownerId, ...changes });
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "That email is already in use" });
    console.error(err);
    res.status(500).json({ error: "Failed to update owner account" });
  } finally {
    conn.release();
  }
});

// DELETE /api/owners/:id — their buses stay; they just have no owner
// account linked any more (owner_id is ON DELETE SET NULL).
ownersRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  try {
    const [result] = await pool.query(`DELETE FROM bus_owners WHERE owner_id = ?`, [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Owner account not found" });
    invalidateAccount("owner", Number(req.params.id));
    await logAudit({ staffId: req.user.id, action: "delete", entityType: "owner", entityId: req.params.id });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete owner account" });
  }
});
