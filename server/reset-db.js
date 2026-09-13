import { pool } from "./src/db/pool.js";

// One-off cleanup: drops every table regardless of foreign key order, then
// you can run `npm run db:init` to rebuild everything from schema.sql fresh.
// Run with: node reset-db.js

async function main() {
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");

  const tables = [
    "audit_log",
    "notifications",
    "bookings",
    "vehicle_checklists",
    "issue_reports",
    "location_tracking",
    "maintenance",
    "trips",
    "drivers",
    "buses",
    "routes",
    "commuters",
    "staff_accounts",
  ];

  for (const table of tables) {
    await pool.query(`DROP TABLE IF EXISTS ${table}`);
    console.log(`Dropped ${table}`);
  }

  await pool.query("SET FOREIGN_KEY_CHECKS = 1");
  console.log("All tables dropped. Now run: npm run db:init");
  await pool.end();
}

main().catch((err) => {
  console.error("Reset failed:", err.message);
  process.exit(1);
});