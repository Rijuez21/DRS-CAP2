// Clears the database's ACTIVITY — trips, bookings, payments, notifications,
// GPS history, logs — while keeping every ACCOUNT and the set-up data:
// staff/admin, drivers, bus owners, passengers, buses, routes & fares,
// payment methods/settings, discount applications, login sessions.
//
// Before deleting anything it writes a JSON backup of every table it clears.
// It points at whatever MYSQL_URL is in server/.env — CHECK THAT FIRST.
//
//   node scripts/clear-activity.js            -> dry run: shows what would go
//   node scripts/clear-activity.js --yes      -> backs up, then clears
//
// IDs restart at 1 afterwards (booking DRS-YYYY-00001 again, trip #1, ...).

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const ACTIVITY_TABLES = [
  "bookings",
  "trips",
  "payments",
  "payment_submissions",
  "payment_reference_claims",
  "payment_audit_logs",
  "notifications",
  "flag_requests",
  "location_tracking",
  "onboard_fares",
  "trip_remittances",
  "audit_log",
  "email_verifications",
  "password_resets",
  "gateway_payments",
  "gateway_webhook_events",
  "issue_reports",
  "maintenance",
  "vehicle_checklists",
];

const confirmed = process.argv.includes("--yes");
const url = process.env.MYSQL_URL || process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("No MYSQL_URL in server/.env");
  process.exit(1);
}
const host = new URL(url).host;

const conn = await mysql.createConnection({ uri: url, dateStrings: true });
const [existing] = await conn.query(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()`);
const present = new Set(existing.map((r) => r.t ?? r.TABLE_NAME));
const tables = ACTIVITY_TABLES.filter((t) => present.has(t));

console.log(`Database: ${host}`);
for (const t of tables) {
  const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
  console.log(`  ${t.padEnd(26)} ${n} row(s) ${confirmed ? "-> clearing" : "would be cleared"}`);
}

if (!confirmed) {
  console.log("\nDry run — nothing changed. Re-run with --yes to back up and clear.");
  await conn.end();
  process.exit(0);
}

// Backup first.
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "backups");
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `activity-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const backup = {};
for (const t of tables) [backup[t]] = await conn.query(`SELECT * FROM \`${t}\``);
writeFileSync(file, JSON.stringify({ host, takenAt: new Date().toISOString(), tables: backup }));
console.log(`\nBackup written: ${file}`);

await conn.query("SET FOREIGN_KEY_CHECKS = 0");
try {
  for (const t of tables) await conn.query(`TRUNCATE TABLE \`${t}\``);
} finally {
  await conn.query("SET FOREIGN_KEY_CHECKS = 1");
}
console.log("Activity cleared. Accounts, buses, routes and payment settings were kept.");
await conn.end();

// Cached trip lists / last bus positions would otherwise linger for a bit.
const redisUrl = process.env.REDIS_URL;
if (redisUrl) {
  const { default: Redis } = await import("ioredis");
  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    const keys = await redis.keys("cache:*");
    if (keys.length) await redis.del(...keys);
    console.log(`Cleared ${keys.length} cached entr${keys.length === 1 ? "y" : "ies"} in Redis.`);
  } catch (err) {
    console.log(`Redis cache not cleared (${err.message}) — it expires on its own within minutes.`);
  } finally {
    redis.disconnect();
  }
}
