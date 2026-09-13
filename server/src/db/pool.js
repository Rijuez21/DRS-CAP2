import mysql from "mysql2/promise";
import "dotenv/config";

// Railway gives you a full connection string (MYSQL_URL / MYSQL_PUBLIC_URL).
// Falling back to discrete MYSQLHOST/MYSQLUSER/etc vars too, since Railway
// exposes both forms.
const connectionString =
  process.env.MYSQL_URL || process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL;

export const pool = connectionString
  ? mysql.createPool(connectionString)
  : mysql.createPool({
      host: process.env.MYSQLHOST,
      port: process.env.MYSQLPORT ? Number(process.env.MYSQLPORT) : 3306,
      user: process.env.MYSQLUSER,
      password: process.env.MYSQLPASSWORD,
      database: process.env.MYSQLDATABASE,
      waitForConnections: true,
      connectionLimit: 10,
    });

export async function pingDatabase() {
  const [rows] = await pool.query("SELECT 1 AS ok");
  return rows[0]?.ok === 1;
}
