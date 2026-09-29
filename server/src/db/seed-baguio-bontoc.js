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
 * Driver password comes from SEED_DRIVER_PASSWORD (see .env.example);
 * falls back to a dev-only default if unset.
 *
 * Run AFTER migrate.js has added the new columns:
 *   node src/db/migrate.js
 *   node src/db/seed-baguio-bontoc.js
 */
async function main() {
  const roster = JSON.parse(readFileSync(path.join(dataDir, "baguio-bontoc-roster.json"), "utf8"));
  const fareMatrix = JSON.parse(readFileSync(path.join(dataDir, "baguio-bontoc-fare-matrix.json"), "utf8"));
  const driverPasswordHash = await bcrypt.hash(process.env.SEED_DRIVER_PASSWORD || "driver123", 10);

  // ---- Wipe + reload routes, one row per km post ------------------------
  await pool.query(`SET FOREIGN_KEY_CHECKS = 0`);
  await pool.query(`TRUNCATE TABLE routes`);
  await pool.query(`SET FOREIGN_KEY_CHECKS = 1`);

  for (const row of fareMatrix) {
    const destination = row.stopName || `KM ${row.km}`;
    await pool.query(
      `INSERT INTO routes (origin, destination, distance, base_fare, special_fare)
       VALUES ('Baguio', ?, ?, ?, ?)`,
      [destination, row.km, row.regularFare, row.specialFare]
    );
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
  console.log(`Buses seeded: ${roster.buses.map((b) => b.busNumber).join(", ")}`);
  console.log("Edit server/src/db/data/baguio-bontoc-roster.json to fix placeholder license numbers/emails, then re-run.");

  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
