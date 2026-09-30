import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import bcrypt from "bcryptjs";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "data");

/**
 * WIPES the `routes` table and reloads it as one row per km post from the
 * fare chart — 161 routes, each "Baguio -> <stop>" (or "Baguio -> KM n"
 * where the chart didn't print a name), carrying that stop's own
 * distance/regular/special fare. Also seeds the driver/bus roster.
 *
 * No data lives in this file — it's all read from:
 *   server/src/db/data/baguio-bontoc-roster.json      (drivers, buses)
 *   server/src/db/data/baguio-bontoc-fare-matrix.json (161 km rows -> routes)
 * Edit those JSON files to correct placeholder/guessed values — this
 * script just applies whatever is in them.
 *
 * ⚠ This DELETES every existing row in `routes` before reloading. If any
 * trips already reference a route being deleted, this will leave those
 * trips pointing at a route_id that no longer exists — same trade-off as
 * the raw wipe-and-reload-routes.sql script. Check for orphaned trips
 * after running this if you already have real trip data:
 *   SELECT t.trip_id FROM trips t
 *   LEFT JOIN routes r ON r.route_id = t.route_id WHERE r.route_id IS NULL;
 *
 * Bus stop pins (routes.latitude/longitude) survive a reseed, in this order:
 *   1. "latitude"/"longitude" on a fare-matrix row, when BOTH are real numbers
 *      (add them to the JSON to make a pin permanent), else
 *   2. the pin that stop already had in the database before the wipe,
 *      matched by destination name ("KM 12", "Sayangan", ...), else
 *   3. unpinned (NULL). No position is ever invented for a stop.
 *
 * Driver password comes from SEED_DRIVER_PASSWORD (see .env.example);
 * falls back to a dev-only default if unset.
 *
 * Run AFTER migrate.js has added the new columns:
 *   node src/db/migrate.js
 *   node src/db/seed-baguio-bontoc.js
 */
// A pin in the fare-matrix JSON counts only when BOTH coordinates are real,
// in-range numbers — a half-filled or placeholder row stays unpinned.
function pinFromJson(row) {
  const lat = row.latitude;
  const lng = row.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { latitude: lat, longitude: lng };
}
const hasAnyJsonPin = (rows) => rows.some((r) => pinFromJson(r) !== null);

async function main() {
  const roster = JSON.parse(readFileSync(path.join(dataDir, "baguio-bontoc-roster.json"), "utf8"));
  const fareMatrix = JSON.parse(readFileSync(path.join(dataDir, "baguio-bontoc-fare-matrix.json"), "utf8"));
  const driverPasswordHash = await bcrypt.hash(process.env.SEED_DRIVER_PASSWORD || "driver123", 10);

  // ---- Remember existing pins before the wipe ----------------------------
  // An admin may have spent an afternoon pinning stops on the map; TRUNCATE
  // would silently throw that away. Tolerates a database that migrate.js
  // hasn't given the pin columns yet (nothing to keep in that case).
  const existingPins = new Map(); // destination -> { latitude, longitude, pinnedAt }
  try {
    const [pinned] = await pool.query(
      `SELECT destination, latitude, longitude, pinned_at FROM routes WHERE latitude IS NOT NULL AND longitude IS NOT NULL`
    );
    for (const r of pinned) existingPins.set(r.destination, { latitude: r.latitude, longitude: r.longitude, pinnedAt: r.pinned_at });
  } catch (err) {
    if (err.code !== "ER_BAD_FIELD_ERROR") throw err;
    console.warn("routes has no latitude/longitude columns yet — run `node src/db/migrate.js` first to keep pins across reseeds.");
  }

  // ---- Wipe + reload routes, one row per km post ------------------------
  await pool.query(`SET FOREIGN_KEY_CHECKS = 0`);
  await pool.query(`TRUNCATE TABLE routes`);
  await pool.query(`SET FOREIGN_KEY_CHECKS = 1`);

  // Only touch the pin columns when there's a pin to write, so a seed on a
  // database without them (migrate.js not run yet) still works as before.
  const writePins = existingPins.size > 0 || hasAnyJsonPin(fareMatrix);
  let pinsFromJson = 0;
  let pinsKept = 0;
  for (const row of fareMatrix) {
    const destination = row.stopName || `KM ${row.km}`;
    const jsonPin = pinFromJson(row);
    const pin = jsonPin ?? existingPins.get(destination) ?? null;
    if (jsonPin) pinsFromJson += 1;
    else if (pin) pinsKept += 1;

    if (writePins) {
      await pool.query(
        `INSERT INTO routes (origin, destination, distance, base_fare, special_fare, latitude, longitude, pinned_at)
         VALUES ('Baguio', ?, ?, ?, ?, ?, ?, ?)`,
        [
          destination,
          row.km,
          row.regularFare,
          row.specialFare,
          pin?.latitude ?? null,
          pin?.longitude ?? null,
          pin ? (jsonPin ? new Date() : pin.pinnedAt ?? new Date()) : null,
        ]
      );
    } else {
      // The original insert.
      await pool.query(
        `INSERT INTO routes (origin, destination, distance, base_fare, special_fare)
         VALUES ('Baguio', ?, ?, ?, ?)`,
        [destination, row.km, row.regularFare, row.specialFare]
      );
    }
  }

  // ---- Drivers ---------------------------------------------------------
  for (const d of roster.drivers) {
    await pool.query(
      `INSERT INTO drivers (name, license_number, email, phoneno, password_hash, hire_date)
       VALUES (?, ?, ?, ?, ?, CURDATE())
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [d.name, d.licenseNumber, d.email, d.phoneno ?? null, driverPasswordHash]
    );
  }
  const [driverRows] = await pool.query(
    `SELECT driver_id, license_number FROM drivers WHERE license_number IN (?)`,
    [roster.drivers.map((d) => d.licenseNumber)]
  );
  const driverIdByLicense = Object.fromEntries(driverRows.map((r) => [r.license_number, r.driver_id]));

  // ---- Buses -------------------------------------------------------
  for (const b of roster.buses) {
    const driver = roster.drivers.find((d) => d.busNumber === b.busNumber);
    const currentDriverId = driver ? driverIdByLicense[driver.licenseNumber] : null;
    await pool.query(
      `INSERT INTO buses (bus_number, plate_num, capacity, type, status, current_driver_id, boarding_point)
       VALUES (?, ?, ?, ?, 'Active', ?, ?)
       ON DUPLICATE KEY UPDATE plate_num = VALUES(plate_num), current_driver_id = VALUES(current_driver_id), boarding_point = VALUES(boarding_point)`,
      [b.busNumber, b.plateNum, b.capacity, b.type, currentDriverId, b.boardingPoint ?? null]
    );
  }

  console.log("Baguio–Bontoc seed complete.");
  console.log(`Routes reloaded: ${fareMatrix.length} (routes table was wiped first)`);
  console.log(`Bus stop pins: ${pinsFromJson} from the fare-matrix JSON, ${pinsKept} kept from before the wipe.`);
  console.log(`Buses seeded: ${roster.buses.map((b) => b.busNumber).join(", ")}`);
  console.log("Edit server/src/db/data/baguio-bontoc-roster.json to fix placeholder license numbers/emails, then re-run.");

  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
