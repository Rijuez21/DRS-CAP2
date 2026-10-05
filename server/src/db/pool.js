import mysql from "mysql2/promise";
import "dotenv/config";

// Railway gives you a full connection string (MYSQL_URL / MYSQL_PUBLIC_URL).
// Falling back to discrete MYSQLHOST/MYSQLUSER/etc vars too, since Railway
// exposes both forms.
const connectionString =
  process.env.MYSQL_URL || process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL;

// D'Rising Sun operates only in the Philippines, so every DATETIME in the
// database means Philippine time (UTC+8, no daylight saving). Two settings
// make that true no matter where the server runs (Railway defaults to UTC):
//   - timezone: how mysql2 converts JS Date <-> DATETIME on the wire. Without
//     it, mysql2 used the *server's* zone, so an admin's "8:00 AM" departure
//     was read back as 8:00 UTC and shown as 4:00 PM in Manila.
//   - SET time_zone (below): makes MySQL's own NOW()/CURRENT_TIMESTAMP agree,
//     since queries compare departure_time and requested_at against NOW().
const DB_TIMEZONE = "+08:00";

const shared = { waitForConnections: true, connectionLimit: 10, timezone: DB_TIMEZONE };

export const pool = connectionString
  ? mysql.createPool({ uri: connectionString, ...shared })
  : mysql.createPool({
      host: process.env.MYSQLHOST,
      port: process.env.MYSQLPORT ? Number(process.env.MYSQLPORT) : 3306,
      user: process.env.MYSQLUSER,
      password: process.env.MYSQLPASSWORD,
      database: process.env.MYSQLDATABASE,
      ...shared,
    });

// Runs once per new pooled connection, before it's handed to any query.
pool.pool.on("connection", (conn) => {
  conn.query(`SET time_zone = '${DB_TIMEZONE}'`);
});

export async function pingDatabase() {
  const [rows] = await pool.query("SELECT 1 AS ok");
  return rows[0]?.ok === 1;
}
